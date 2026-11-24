"""Henter befolkning fra Oslo kommunes statistikkbank (PxWeb-API).

- BEF003: folkemengde per grunnkrets, 8 aldersgrupper
- BEF002: folkemengde per delbydel, 13 aldersgrupper
- UTD006: andel barn 1-5 år i barnehage per delbydel

Skriver data/befolkning.json. Kjøres av GitHub Actions (.github/workflows/dekning.yml).
"""
import json
import sys
import time
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
API = "https://statistikkbanken.oslo.kommune.no/statbank/api/v1/no/db1"


def sporring(tabell, utvalg):
    body = json.dumps({"query": [{"code": k, "selection": v} for k, v in utvalg.items()],
                       "response": {"format": "json-stat2"}}).encode()
    for i in range(4):
        try:
            req = Request(f"{API}/{quote(tabell)}", data=body, headers={"Content-Type": "application/json"})
            with urlopen(req, timeout=120) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001
            if i == 3:
                raise
            print(f"  feil ({e}), prøver igjen", file=sys.stderr)
            time.sleep(3 * (i + 1))


def tabell_til_dict(ds):
    """json-stat2 -> {(kode1, kode2, ...): verdi} og etiketter per dimensjon."""
    ider = ds["id"]
    storrelse = ds["size"]
    koder = []
    for d in ider:
        idx = ds["dimension"][d]["category"]["index"]
        koder.append(sorted(idx, key=idx.get) if isinstance(idx, dict) else idx)
    etiketter = {d: ds["dimension"][d]["category"].get("label", {}) for d in ider}
    verdier = ds["value"]
    ut = {}
    for flat, v in (enumerate(verdier) if isinstance(verdier, list) else ((int(k), x) for k, x in verdier.items())):
        nokkel, rest = [], flat
        for s in reversed(storrelse):
            nokkel.append(rest % s)
            rest //= s
        nokkel.reverse()
        ut[tuple(koder[i][j] for i, j in enumerate(nokkel))] = v
    return ider, ut, etiketter


ALLE = {"filter": "all", "values": ["*"]}
FRAM = "Befolkning/Befolkningsframskrivinger/OK_BEF038.px"
SISTE = {"filter": "top", "values": ["1"]}


def main():
    # Grunnkrets, 8 grupper
    ider, gk, et = tabell_til_dict(sporring("Befolkning/Folkemengde/OK-BEF003.px",
                                            {"bosted": ALLE, "aldersgruppe": ALLE, "år": SISTE}))
    aar_gk = list(et["år"].values())[0]
    gk_grupper = [et["aldersgruppe"][k] for k in sorted(et["aldersgruppe"], key=int)]
    grunnkretser = {}
    for nokkel, v in gk.items():
        d = dict(zip(ider, nokkel))
        kode = d["bosted"][-4:]
        rad = grunnkretser.setdefault(kode, {"navn": et["bosted"][d["bosted"]].split(" ", 1)[-1], "a": [0] * len(gk_grupper)})
        rad["a"][int(d["aldersgruppe"]) - 1] = v or 0

    # Delbydel, 13 grupper
    ider, db, et = tabell_til_dict(sporring("Befolkning/Folkemengde/OK-BEF002.px",
                                            {"bosted": ALLE, "aldersgruppe": ALLE, "år": SISTE}))
    aar_db = list(et["år"].values())[0]
    db_grupper = [et["aldersgruppe"][k] for k in sorted(et["aldersgruppe"], key=int)]
    delbydeler = {}
    for nokkel, v in db.items():
        d = dict(zip(ider, nokkel))
        rad = delbydeler.setdefault(d["bosted"], {"navn": et["bosted"][d["bosted"]], "a": [0] * len(db_grupper)})
        rad["a"][int(d["aldersgruppe"]) - 1] = v or 0

    # Andel barn 1-5 år i barnehage per delbydel
    ider, bh, et = tabell_til_dict(sporring("Barnehage, skole og utdanning/Barnehage/OK-UTD006.px",
                                            {"årgang": SISTE, "bosted": ALLE, "aldersgruppe": {"filter": "item", "values": ["2"]},
                                             "statistikkvariabel": {"filter": "item", "values": ["0"]}}))
    aar_bh = list(et["årgang"].values())[0]
    barnehageandel = {}
    for nokkel, v in bh.items():
        d = dict(zip(ider, nokkel))
        if v is not None:
            barnehageandel[d["bosted"]] = v

    # Framskriving per delbydel og ettårig alder (mellomalternativet), samlet i delbydelsgruppene
    grenser = [(0, 0), (1, 5), (6, 12), (13, 15), (16, 19), (20, 29), (30, 39), (40, 49), (50, 59), (60, 66),
               (67, 79), (80, 89), (90, 200)]
    fram_aar = ["2026", "2030", "2035", "2040", "2050"]
    meta = json.load(urlopen(Request(f"{API}/{quote(FRAM)}"), timeout=60))
    aar_var = next(v for v in meta["variables"] if v["code"] == "år")
    aar_idx = [aar_var["values"][aar_var["valueTexts"].index(a)] for a in fram_aar if a in aar_var["valueTexts"]]
    ider, fr, et = tabell_til_dict(sporring(FRAM, {"geografi": ALLE, "kjønn": {"filter": "item", "values": ["0"]},
                                                   "alder": ALLE, "statistikkvariabel": ALLE,
                                                   "år": {"filter": "item", "values": aar_idx}}))
    framskriving = {}
    for nokkel, v in fr.items():
        d = dict(zip(ider, nokkel))
        aar = et["år"][d["år"]]
        alder = int(d["alder"])
        g = next(i for i, (a, b) in enumerate(grenser) if a <= alder <= b)
        rad = framskriving.setdefault(aar, {}).setdefault(d["geografi"], [0] * 13)
        rad[g] += v or 0

    data = {
        "kilde": "Oslo kommune, statistikkbanken (BEF003, BEF002, UTD006, BEF038). Grunnlagstall fra SSB.",
        "aar": {"grunnkrets": aar_gk, "delbydel": aar_db, "barnehage": aar_bh},
        "grupper_grunnkrets": gk_grupper,
        "grupper_delbydel": db_grupper,
        "grunnkretser": grunnkretser,
        "delbydeler": delbydeler,
        "barnehageandel_1_5": barnehageandel,
        "framskriving": framskriving,
    }
    with open(ROOT / "data" / "befolkning.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Grunnkretser: {len(grunnkretser)} ({aar_gk}), delbydeler: {len(delbydeler)} ({aar_db}), "
          f"barnehageandel: {len(barnehageandel)} ({aar_bh})")
    print("Framskriving:", {a: round(sum(sum(r) for r in v.values())) for a, v in framskriving.items()})
    print("Grupper grunnkrets:", gk_grupper)
    print("Grupper delbydel:", db_grupper)
    print("Sum grunnkrets:", sum(sum(r["a"]) for r in grunnkretser.values()),
          "sum delbydel:", sum(sum(r["a"]) for r in delbydeler.values()))


if __name__ == "__main__":
    main()
