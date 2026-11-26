"""Terreng for ubebygde kommunale tomter → docs/data/tomt_terreng.json.

Henter Kartverkets laserbaserte terrengmodell (DTM, «Høyde DTM sømløs», CC BY 4.0)
for hver tomt og regner ut høydeforskjell, helning og hellingsretning.

Tomter som allerede ligger i utfilen hoppes over, så jobben kan kjøres på nytt
når eiendomsoversikten får nye tomter. Bruk --alle for å regne alt på nytt.

Med: eiendommer uten bygg utenom småbygg, utenom veigrunn, seksjoner og Marka.

Felter per tomt:
  z0, z1  laveste og høyeste terrenghøyde på tomten (moh.)
  s       gjennomsnittlig helning (%)
  f       andel av arealet med helning under 10 %, 10–25 % og over 25 % (%)
  a       areal (m²) som både er minst 20 m bredt og har helning under 10 %
  r       hovedretning terrenget heller mot (N, NØ, Ø, SØ, S, SV, V, NV), eller null når tomten er nær flat
  o       oppløsning i meter (1, eller 2 for store tomter)

Bruk: python scripts/hent_terreng.py [--alle] [--maks N]
"""
import argparse
import io
import json
import math
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import geopandas as gpd
import numpy as np
import rasterio
import shapely
from rasterio.features import geometry_mask

ROT = Path(__file__).resolve().parent.parent
INN = ROT / "docs" / "data" / "eiendommer.geojson"
UT = ROT / "docs" / "data" / "tomt_terreng.json"
WCS = "https://hoydedata.no/arcgis/services/las_dtm_somlos/ImageServer/WCSServer"
KILDE = "Kartverket, Høyde DTM (laserdata), CC BY 4.0"
GRENSER = (10, 25)          # helning i prosent
KJERNE_RADIUS = 10          # samme som i bygg_tomtform.py
MAKS_RUTER = 2500           # bredde/høyde i ruter per forespørsel
RETNINGER = ["N", "NØ", "Ø", "SØ", "S", "SV", "V", "NV"]
COVERAGE = None             # finnes ved første vellykkede kall


def hent_dtm(x0, y0, x1, y1, opp):
    """GeoTIFF for boksen med gitt oppløsning (m). Prøver kjente coverage-navn."""
    global COVERAGE
    w, h = int(round((x1 - x0) / opp)), int(round((y1 - y0) / opp))
    navn = [COVERAGE] if COVERAGE else ["1", "las_dtm"]
    siste = None
    for cov in navn:
        q = {"service": "WCS", "version": "1.0.0", "request": "GetCoverage", "coverage": cov,
             "crs": "EPSG:25833", "bbox": f"{x0},{y0},{x1},{y1}", "width": w, "height": h,
             "format": "GeoTIFF"}
        for forsok in range(4):
            try:
                with urlopen(Request(f"{WCS}?{urlencode(q)}", headers={"User-Agent": "oslokart"}), timeout=120) as r:
                    data = r.read()
                if data[:4] in (b"II*\x00", b"MM\x00*"):
                    COVERAGE = cov
                    return data
                siste = data[:300]
                break
            except Exception as e:  # noqa: BLE001
                siste = str(e).encode()
                time.sleep(2 * (forsok + 1))
    raise RuntimeError(f"Fikk ikke GeoTIFF: {siste!r}")


def analyser(geom):
    x0, y0, x1, y1 = geom.bounds
    x0, y0 = math.floor(x0) - 2, math.floor(y0) - 2
    x1, y1 = math.ceil(x1) + 2, math.ceil(y1) + 2
    opp = 1
    while max(x1 - x0, y1 - y0) / opp > MAKS_RUTER:
        opp *= 2
    with rasterio.open(io.BytesIO(hent_dtm(x0, y0, x1, y1, opp))) as ds:
        z = ds.read(1).astype("float64")
        nodata = ds.nodata
        transform = ds.transform
    ugyldig = ~np.isfinite(z) | (z < -50) | (z > 3000)
    if nodata is not None:
        ugyldig |= z == nodata
    z[ugyldig] = np.nan
    # helning: gradient i begge retninger (rad = nord→sør)
    dzdy, dzdx = np.gradient(z, abs(transform.e), transform.a)
    dzdy = -dzdy  # positiv mot nord
    helning = np.hypot(dzdx, dzdy) * 100
    inne = geometry_mask([geom], out_shape=z.shape, transform=transform, invert=True, all_touched=False)
    gyldig = inne & np.isfinite(helning) & np.isfinite(z)
    if gyldig.sum() < 3:
        return None
    hs = helning[gyldig]
    zz = z[gyldig]
    celle = opp * opp
    kjerne = shapely.intersection(shapely.buffer(shapely.buffer(geom, -KJERNE_RADIUS), KJERNE_RADIUS), geom)
    flat_bred = 0
    if not kjerne.is_empty:
        km = geometry_mask([kjerne], out_shape=z.shape, transform=transform, invert=True)
        flat_bred = int(((helning < GRENSER[0]) & km & np.isfinite(helning)).sum() * celle)
    snitt = float(hs.mean())
    # hovedretning terrenget heller mot: motsatt av gjennomsnittlig gradient
    gx, gy = float(-dzdx[gyldig].mean()), float(-dzdy[gyldig].mean())
    retning = None
    if np.hypot(gx, gy) * 100 >= 3:
        vinkel = (math.degrees(math.atan2(gx, gy)) + 360) % 360  # 0 = nord, 90 = øst
        retning = RETNINGER[int((vinkel + 22.5) // 45) % 8]
    n = len(hs)
    return {
        "z0": round(float(np.nanmin(zz)), 1), "z1": round(float(np.nanmax(zz)), 1),
        "s": round(snitt, 1),
        "f": [round(float((hs < GRENSER[0]).sum()) / n * 100),
              round(float(((hs >= GRENSER[0]) & (hs <= GRENSER[1])).sum()) / n * 100),
              round(float((hs > GRENSER[1]).sum()) / n * 100)],
        "a": flat_bred, "r": retning, "o": opp,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--alle", action="store_true", help="regn alle tomter på nytt")
    ap.add_argument("--maks", type=int, default=0, help="høyst så mange nye tomter (til testing)")
    arg = ap.parse_args()

    g = gpd.read_file(INN).to_crs(25833)
    g["geometry"] = shapely.make_valid(g.geometry.values)
    utvalg = g[(g["ns"] == 0) & (g["v"] == 0) & (g["s"] == 0) & (g["b"] != "Marka")]
    gammel = {}
    if UT.exists() and not arg.alle:
        gammel = json.loads(UT.read_text(encoding="utf-8")).get("tomter", {})
    nye = utvalg[~utvalg["e"].isin(gammel.keys())]
    if arg.maks:
        nye = nye.head(arg.maks)
    print(f"{len(utvalg)} tomter i utvalget, {len(gammel)} beregnet fra før, {len(nye)} skal hentes")

    # Første kall alene, så coverage-navnet blir funnet før parallell henting
    resultat, feil = dict(gammel), []
    rader = list(nye[["e", "geometry"]].itertuples(index=False))
    if rader:
        e, geom = rader[0]
        try:
            resultat[e] = analyser(geom)
        except Exception as ex:  # noqa: BLE001
            sys.exit(f"Første forespørsel feilet: {ex}")
        print(f"Coverage: {COVERAGE}")
    with ThreadPoolExecutor(max_workers=6) as pool:
        jobber = {pool.submit(analyser, geom): e for e, geom in rader[1:]}
        for i, f in enumerate(as_completed(jobber), 1):
            e = jobber[f]
            try:
                resultat[e] = f.result()
            except Exception as ex:  # noqa: BLE001
                feil.append(e)
                print(f"  {e}: {ex}", file=sys.stderr)
            if i % 200 == 0:
                print(f"  {i}/{len(rader) - 1}")
    gyldige = {e: v for e, v in resultat.items() if v is not None and e in set(utvalg["e"])}
    UT.write_text(json.dumps({"kilde": KILDE, "hentet": date.today().isoformat(), "grenser": list(GRENSER),
                              "kjerne_bredde": 2 * KJERNE_RADIUS, "tomter": gyldige},
                             ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(gyldige)} tomter med terreng → {UT.relative_to(ROT)} ({UT.stat().st_size // 1024} kB). Feil: {len(feil)}")
    if feil and len(feil) > len(rader) * 0.1:
        sys.exit("Mer enn 10 % av forespørslene feilet")


if __name__ == "__main__":
    main()
