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
from rasterio.transform import from_origin

ROT = Path(__file__).resolve().parent.parent
INN = ROT / "docs" / "data" / "eiendommer.geojson"
UT = ROT / "docs" / "data" / "tomt_terreng.json"
WCS = "https://hoydedata.no/arcgis/services/las_dtm_somlos/ImageServer/WCSServer"
KILDE = "Kartverket, Høyde DTM (laserdata), CC BY 4.0"
GRENSER = (10, 25)          # helning i prosent
KJERNE_RADIUS = 10          # samme som i bygg_tomtform.py
MAKS_RUTER = 1500           # bredde/høyde i ruter per forespørsel
RUTE = 1000                 # tomter som får plass hentes samlet i ruter på 1 × 1 km
MARGIN = 100                # med så mye margin rundt ruten (m)
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
        for forsok in range(3):
            try:
                with urlopen(Request(f"{WCS}?{urlencode(q)}", headers={"User-Agent": "oslokart"}), timeout=90) as r:
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


def boks(geom):
    x0, y0, x1, y1 = geom.bounds
    return math.floor(x0) - 2, math.floor(y0) - 2, math.ceil(x1) + 2, math.ceil(y1) + 2


def les_dtm(x0, y0, x1, y1, opp):
    with rasterio.open(io.BytesIO(hent_dtm(x0, y0, x1, y1, opp))) as ds:
        z = ds.read(1).astype("float64")
        nodata = ds.nodata
    # Georeferansen settes ut fra forespørselen; enkelte svar mangler den
    if z.shape != (int(round((y1 - y0) / opp)), int(round((x1 - x0) / opp))):
        raise RuntimeError(f"Uventet størrelse {z.shape}")
    if nodata is not None:
        z[z == nodata] = np.nan
    return z


def analyser(geom):
    """Henter terrenget for én tomt og regner ut verdiene."""
    x0, y0, x1, y1 = boks(geom)
    opp = 1
    while max(x1 - x0, y1 - y0) / opp > MAKS_RUTER:
        opp *= 2
    return beregn(les_dtm(x0, y0, x1, y1, opp), x0, y1, opp, geom)


def analyser_rute(kx, ky, tomter):
    """Henter én rute (med margin) og regner ut alle tomtene som ligger i den."""
    rx0, ry0 = kx * RUTE - MARGIN, ky * RUTE - MARGIN
    rx1, ry1 = (kx + 1) * RUTE + MARGIN, (ky + 1) * RUTE + MARGIN
    Z = les_dtm(rx0, ry0, rx1, ry1, 1)
    ut = {}
    for e, geom in tomter:
        x0, y0, x1, y1 = boks(geom)
        r0, c0 = ry1 - y1, x0 - rx0
        ut[e] = beregn(Z[r0:r0 + (y1 - y0), c0:c0 + (x1 - x0)].copy(), x0, y1, 1, geom)
    return ut


def beregn(z, x0, y1, opp, geom):
    transform = from_origin(x0, y1, opp, opp)
    nodata = None
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


def lagre(resultat, med):
    gyldige = {e: v for e, v in resultat.items() if v is not None and e in med}
    UT.write_text(json.dumps({"kilde": KILDE, "hentet": date.today().isoformat(), "grenser": list(GRENSER),
                              "kjerne_bredde": 2 * KJERNE_RADIUS, "tomter": gyldige},
                             ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return gyldige


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

    resultat, feil = dict(gammel), []
    med = set(utvalg["e"])
    rader = list(nye[["e", "geometry"]].itertuples(index=False))
    ruter, enkeltvis = {}, []
    for e, geom in rader:
        x0, y0, x1, y1 = boks(geom)
        kx, ky = int((x0 + 2) // RUTE), int((y0 + 2) // RUTE)
        if x0 >= kx * RUTE - MARGIN and y0 >= ky * RUTE - MARGIN and \
                x1 <= (kx + 1) * RUTE + MARGIN and y1 <= (ky + 1) * RUTE + MARGIN:
            ruter.setdefault((kx, ky), []).append((e, geom))
        else:
            enkeltvis.append((e, geom))
    oppgaver = [("rute", k, v) for k, v in ruter.items()] + [("tomt", e, g) for e, g in enkeltvis]
    print(f"{len(ruter)} ruter og {len(enkeltvis)} store tomter hentes enkeltvis", flush=True)
    if not oppgaver:
        lagre(resultat, med)
        return

    def kjor(o):
        if o[0] == "rute":
            return analyser_rute(o[1][0], o[1][1], o[2])
        return {o[1]: analyser(o[2])}

    # Første kall alene, så coverage-navnet blir funnet før parallell henting
    try:
        resultat.update(kjor(oppgaver[0]))
    except Exception as ex:  # noqa: BLE001
        sys.exit(f"Første forespørsel feilet: {ex}")
    print(f"Coverage: {COVERAGE}", flush=True)
    start = time.time()
    with ThreadPoolExecutor(max_workers=4) as pool:
        jobber = {pool.submit(kjor, o): o for o in oppgaver[1:]}
        for i, f in enumerate(as_completed(jobber), 1):
            o = jobber[f]
            try:
                resultat.update(f.result())
            except Exception as ex:  # noqa: BLE001
                tapt = [e for e, _ in o[2]] if o[0] == "rute" else [o[1]]
                feil.extend(tapt)
                print(f"  {o[0]} {o[1]}: {ex}", file=sys.stderr)
            if i % 20 == 0:
                print(f"  {i}/{len(oppgaver) - 1} oppgaver, {len(feil)} tomter feilet, {time.time() - start:.0f} s", flush=True)
                lagre(resultat, med)
    gyldige = lagre(resultat, med)
    print(f"{len(gyldige)} tomter med terreng → {UT.relative_to(ROT)} ({UT.stat().st_size // 1024} kB). Feil: {len(feil)}")
    if feil:
        print("Feilet:", ", ".join(feil[:50]))
    if feil and len(feil) > len(rader) * 0.1:
        sys.exit("Mer enn 10 % av forespørslene feilet")


if __name__ == "__main__":
    main()
