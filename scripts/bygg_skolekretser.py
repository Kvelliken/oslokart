"""Barneskolekretser (inntaksområder) i Oslo → docs/data/skolekretser.geojson.

Kilde: grensene fra Plan- og bygningsetatens skolekart (juni 2026), levert som en
HTML-side eller GeoJSON med én flate per krets. Bare geometri, kretsnavn og
skolenavn tas med. Alle andre egenskaper i kilden (kapasitet, elevtall, areal,
tilstand o.l.) blir bevisst utelatt, slik at repoet bare inneholder grensene.

Skolene kobles til Udirs Nasjonalt skoleregister (docs/data/skoler.json) på navn.

Bruk: python scripts/bygg_skolekretser.py <kilde.html|kilde.geojson>
"""
import json
import re
import sys
from pathlib import Path

from shapely.geometry import mapping, shape
from shapely.validation import make_valid

ROT = Path(__file__).resolve().parent.parent
UT = ROT / "docs" / "data" / "skolekretser.geojson"
SKOLER = ROT / "docs" / "data" / "skoler.json"


def les_kilde(sti):
    tekst = Path(sti).read_text(encoding="utf-8")
    if sti.endswith(".html"):
        i = tekst.find('"type":"FeatureCollection"')
        if i < 0:
            sys.exit("Fant ingen FeatureCollection i HTML-filen")
        start = tekst.rfind("{", 0, i)
        fc, _ = json.JSONDecoder().raw_decode(tekst[start:])
        return fc
    return json.loads(tekst)


def rund(obj):
    if isinstance(obj, float):
        return round(obj, 5)
    if isinstance(obj, (list, tuple)):
        return [rund(x) for x in obj]
    return obj


def flate(geom):
    g = make_valid(shape(geom))
    if g.geom_type == "GeometryCollection":
        deler = [d for d in g.geoms if d.geom_type in ("Polygon", "MultiPolygon")]
        g = deler[0] if len(deler) == 1 else make_valid(shape({"type": "MultiPolygon", "coordinates": [
            p for d in deler for p in (mapping(d)["coordinates"] if d.geom_type == "MultiPolygon" else [mapping(d)["coordinates"]])]}))
    return {"type": g.geom_type, "coordinates": rund(mapping(g)["coordinates"])}


# Navn i skolekartet som skiller seg fra navnet i Udir
ALIAS = {"tvillingskolene oppsal og vetland": "oppsal"}


def normaliser(navn):
    n = re.sub(r"\(.*?\)|\b1-10\b", "", navn.lower()).replace(" skole", "")
    n = re.sub(r"\s+", " ", n).strip()
    return ALIAS.get(n, n)


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    fc = les_kilde(sys.argv[1])
    sk = json.loads(SKOLER.read_text(encoding="utf-8"))
    udir = {normaliser(p["n"]): p for p in sk["poster"] + sk.get("uten_plassering", [])
            if p.get("ei") == "K" and p.get("u") != "Spesialskole"}
    ut, umatchet = [], []
    for f in fc["features"]:
        p = f["properties"]
        krets = p["SKRETSNAVN"]
        navn = p.get("skole") or p.get("matchede_skoler") or f"{krets} skole"
        skoler = [s.strip() for s in navn.split(",") if s.strip()]
        orgnr = []
        for s in skoler:
            treff = udir.get(normaliser(s))
            if treff:
                orgnr.append(treff["o"])
            else:
                umatchet.append(s)
        ut.append({"type": "Feature", "properties": {"k": krets, "s": skoler, "o": orgnr},
                   "geometry": flate(f["geometry"])})
    ut.sort(key=lambda f: f["properties"]["k"])
    UT.write_text(json.dumps({
        "type": "FeatureCollection",
        "kilde": "Plan- og bygningsetaten, Oslo kommune: skolekart med barneskolekretser (juni 2026)",
        "features": ut}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(ut)} kretser → {UT.relative_to(ROT)} ({UT.stat().st_size // 1024} kB)")
    if umatchet:
        print("Ikke funnet i Udir:", ", ".join(umatchet))


if __name__ == "__main__":
    main()
