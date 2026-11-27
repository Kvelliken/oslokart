"""Brannstasjoner, kvikkleire og fredede bygninger i Oslo → docs/data/.

Kilde: Geonorge-nedlastingspakke (FME) med Oslo-uttrekk (EPSG:25833):
- Samfunnssikkerhet_0301_Oslo_25833_Brannstasjoner_GML  (DSB)
- Samfunnssikkerhet_0301_Oslo_25833_Kvikkleire_FGDB     (NVE)
- Kulturminner_0301_Oslo_25833_Fredabygninger_FGDB      (Riksantikvaren)
- Kulturminner_0301_Oslo_25833_Fredabygninger_GML       (fulle verneparagrafer)

Skriver:
- brannstasjoner.json   punkter med navn, brannvesen, stasjonstype, bemanning, bydel og eiendom
- kvikkleire.geojson    faresoner (utløsningsområder, t="s") og utløpsområder (t="u")
- fredabygninger.json   punkter med navn, vernetype, verneparagraf, datering og lenke

Bruk: python scripts/bygg_samfunnssikkerhet.py <mappe med de utpakkede datasettene>
"""
import json
import sys
from datetime import date
from pathlib import Path

import geopandas as gpd
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from geo import Stedsoppslag  # noqa: E402

ROT = Path(__file__).resolve().parent.parent
UT = ROT / "docs" / "data"

STASJONSTYPE = {"H": "Hovedstasjon", "L": "Bistasjon"}
BEMANNING = {"DN": "Kasernert hele døgnet", "D": "Kasernert på dagtid", "N": "Ikke kasernert"}
VERNETYPE = {"FOR": "Forskriftsfredet", "VED": "Vedtaksfredet", "LIST": "Listeført kirke", "AUT": "Automatisk fredet"}


def finn(mappe, del_av_navn, endelse):
    treff = [p for p in Path(mappe).rglob(f"*{endelse}") if del_av_navn in p.name]
    if not treff:
        sys.exit(f"Fant ikke {del_av_navn}*{endelse} i {mappe}")
    return treff[0]


def tekst(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    s = " ".join(str(v).split())
    return s or None


def rund(obj, n=6):
    if isinstance(obj, float):
        return round(obj, n)
    if isinstance(obj, (list, tuple)):
        return [rund(x, n) for x in obj]
    return obj


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    mappe = sys.argv[1]
    sted = Stedsoppslag(UT / "eiendommer.geojson", ROT / "data" / "bydeler.geojson")
    hentet = date.today().isoformat()

    # --- Brannstasjoner
    b = gpd.read_file(finn(mappe, "Brannstasjoner", ".gml")).to_crs(4326)
    stasjoner = []
    for _, r in b.iterrows():
        lon, lat = r.geometry.x, r.geometry.y
        stasjoner.append({
            "n": f"{r['brannstasjon']} brannstasjon", "br": tekst(r["brannvesen"]),
            "st": STASJONSTYPE.get(r["stasjonstype"], tekst(r["stasjonstype"])),
            "ka": BEMANNING.get(r["kasernert"], tekst(r["kasernert"])),
            "lat": round(lat, 6), "lon": round(lon, 6), **sted.slaa_opp(lon, lat)})
    stasjoner.sort(key=lambda p: p["n"])
    (UT / "brannstasjoner.json").write_text(json.dumps(
        {"kilde": "DSB, brannstasjoner (Geonorge)", "hentet": hentet, "antall": len(stasjoner), "poster": stasjoner},
        ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # --- Kvikkleire: faresoner og utløpsområder
    gdb = finn(mappe, "Kvikkleire_FGDB", ".gdb")
    deler = []
    for lag, t in (("kvikkleire_utlosningomr", "s"), ("kvikkleire_utlopomr", "u")):
        g = gpd.read_file(gdb, layer=lag)
        g["geometry"] = g.geometry.make_valid().simplify(1.0, preserve_topology=True)
        g = g.to_crs(4326)
        for _, r in g.iterrows():
            konsekvens = r["skredskadekonsekvensklasse"]
            deler.append({"type": "Feature", "properties": {
                "t": t, "n": tekst(r["skredomrnavn"]), "id": tekst(r["skredomrid"]),
                "fg": tekst(r["skredfaregradklasse"]),
                "kk": None if pd.isna(konsekvens) else int(konsekvens),
                "rk": None if pd.isna(r["skredrisikokvikkleireklasse"]) else int(r["skredrisikokvikkleireklasse"]),
                "o": tekst(r["opphav"]), "r": tekst(r["rapporturl"])},
                "geometry": rund(r.geometry.__geo_interface__)})
    (UT / "kvikkleire.geojson").write_text(json.dumps(
        {"type": "FeatureCollection", "kilde": "NVE, faresoner for kvikkleire (Geonorge)", "hentet": hentet,
         "features": deler}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # --- Fredede bygninger (geometri fra FGDB, fulle paragrafer fra GML)
    f = gpd.read_file(finn(mappe, "Fredabygninger_FGDB", ".gdb")).to_crs(4326)
    gml = gpd.read_file(finn(mappe, "Fredabygninger_GML", ".gml"))
    paragraf = dict(zip(gml["lokalId"], gml["verneparagraf"]))
    lov = dict(zip(gml["lokalId"], gml["vernelov"]))
    bygg = []
    for _, r in f.iterrows():
        bygg.append({
            "n": tekst(r["navn"]), "v": VERNETYPE.get(r["vernetype"], tekst(r["vernetype"])),
            "p": tekst(paragraf.get(r["lokalid"])), "l": tekst(lov.get(r["lokalid"])),
            "d": tekst(r["vernedato"])[:10] if tekst(r["vernedato"]) else None,
            "da": tekst(r["kulturminnedateringeksakt"]), "w": tekst(r["linkkulturminnesok"]),
            "o": tekst(r["opphav"]), "lat": round(r.geometry.y, 6), "lon": round(r.geometry.x, 6)})
    (UT / "fredabygninger.json").write_text(json.dumps(
        {"kilde": "Riksantikvaren og Byantikvaren i Oslo, fredede bygninger (Geonorge)", "hentet": hentet,
         "antall": len(bygg), "poster": bygg}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    for navn in ("brannstasjoner.json", "kvikkleire.geojson", "fredabygninger.json"):
        print(navn, (UT / navn).stat().st_size // 1024, "kB")


if __name__ == "__main__":
    main()
