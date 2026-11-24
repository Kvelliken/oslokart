"""Lager data/boliger.csv: boligbygg i Oslo med antall bruksenheter (fra matrikkelen).

Brukes til å fordele befolkningen i hver grunnkrets på boligene der.
Bruk: python scripts/bygg_boliger.py --bygning <..._MatrikkelenBygning_FGDB.gdb>
"""
import argparse
from pathlib import Path

import pandas as pd
import pyogrio

ROOT = Path(__file__).resolve().parents[1]
EKSISTERER = {"TB", "FA", "MB", "MF", "FS", "IP", "GR"}
IKKE_BOLIG = {161, 162, 163, 171, 172, 181, 182, 183}


def er_bosted(t):
    return (111 <= t <= 199 and t not in IKKE_BOLIG) or 721 <= t <= 723


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bygning", required=True)
    a = ap.parse_args()
    byg = pyogrio.read_dataframe(a.bygning, layer="bygning", columns=["bygningid", "bygningstype", "bygningsstatus"])
    byg["t"] = pd.to_numeric(byg.bygningstype, errors="coerce").fillna(0).astype(int)
    byg = byg[byg.bygningsstatus.isin(EKSISTERER) & byg.t.map(er_bosted)]
    be = pyogrio.read_dataframe(a.bygning, layer="bruksenhet", columns=["bygning_fk"], read_geometry=False)
    n = be.groupby("bygning_fk").size()
    byg["enheter"] = byg.bygningid.astype(str).map(n).fillna(1).astype(int)
    byg = byg.to_crs(25833)
    ut = pd.DataFrame({"x": byg.geometry.x.round().astype(int), "y": byg.geometry.y.round().astype(int), "enheter": byg.enheter})
    ut = ut.groupby(["x", "y"], as_index=False).enheter.sum()
    ut.to_csv(ROOT / "data" / "boliger.csv", index=False)
    print(len(ut), "boligpunkter,", ut.enheter.sum(), "boenheter")


if __name__ == "__main__":
    main()
