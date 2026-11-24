"""Bygger docs/data/idrett.json fra anleggsregisteret (idrettsanlegg.no).

Bruk:  python scripts/bygg_idrett.py [--excel data/idrettsanlegg.xlsx]

Merk: Uttrekket er ikke en komplett liste over idrettsanlegg i Oslo.
"""
import argparse
import json
import re
from pathlib import Path

import pandas as pd

from geo import Stedsoppslag

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "data"

KOMMUNAL = re.compile(r"OSLO KOMMUNE|OSLOBYGG|BOLIGBYGG OSLO|OSLO HAVN|UNDERVISNINGSBYGG|OMSORGSBYGG|KULTUR- OG IDRETTSBYGG", re.I)
STATLIG = re.compile(r"STATSBYGG|FORSVARSBYGG|UNIVERSITETET|HØGSKOLE|STATEN|NORGES IDRETTSHØGSKOLE|DIREKTORAT", re.I)


def eierklasse(eier):
    eier = eier or ""
    if KOMMUNAL.search(eier):
        return "K"
    if STATLIG.search(eier):
        return "S"
    return "P"


def tall(v):
    return None if pd.isna(v) else int(v)


def tekst(v):
    return None if pd.isna(v) else str(v).strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--excel", default=str(ROOT / "data" / "idrettsanlegg.xlsx"))
    a = ap.parse_args()

    d = pd.read_excel(a.excel)
    sted = Stedsoppslag(OUT / "eiendommer.geojson", ROOT / "data" / "bydeler.geojson")
    poster = []
    d = d.rename(columns={"Siste ombyggingsår": "ombygd", "Byggeår": "bygget"})
    for r in d.itertuples(index=False):
        lat, lon = float(r.Breddegrad), float(r.Lengdegrad)
        eier = tekst(r.Eier)
        poster.append({
            "nr": int(r.Anleggsnummer),
            "n": tekst(r.Navn),
            "u": tekst(r.Anleggskategori) or "Uten kategori",
            "t": tekst(r.Anleggstype) or "Uten type",
            "kl": tekst(r.Anleggsklasse),
            "eier": eier,
            "ei": eierklasse(eier),
            "dr": tekst(r.Drifter),
            "by": tall(r.bygget),
            "ob": tall(r.ombygd),
            "lat": round(lat, 6), "lon": round(lon, 6),
            **sted.slaa_opp(lon, lat),
        })
    # Et koordinat som deles av anlegg i mange ulike kategorier er en standardplassering,
    # ikke anleggets faktiske plassering. Disse merkes og vises ikke i kartet.
    grupper = {}
    for p in poster:
        grupper.setdefault((p["lat"], p["lon"]), []).append(p)
    for gruppe in grupper.values():
        if len({p["u"] for p in gruppe}) >= 10:
            for p in gruppe:
                p.update({"up": 1, "e": None, "b": None})
    print("uten presis plassering:", sum(1 for p in poster if p.get("up")))

    data = {"kilde": "Anleggsregisteret (idrettsanlegg.no), uttrekk for Oslo",
            "merknad": "Ikke en komplett liste over idrettsanlegg i Oslo.",
            "antall": len(poster), "poster": poster}
    with open(OUT / "idrett.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    s = pd.DataFrame(poster)
    print(len(s), s.ei.value_counts().to_dict(), "på kommunal eiendom:", s.e.notna().sum())
    print(s[s.ei == "P"].eier.value_counts().head(12).to_string())


if __name__ == "__main__":
    main()
