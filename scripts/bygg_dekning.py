"""Bygger grunnlaget for fanen Dekningsgrad.

Kobler befolkning (data/befolkning.json), boliger (data/boliger.csv), gangnett
(data/gangnett_raa.json) og områdegrenser. Skriver til docs/data/:

- dekning_nett.json        noder (lengde/bredde x 1e5) og kanter (a, b, meter)
- dekning_grunnlag.json    områder per nivå med befolkning i 13 aldersgrupper,
                           og etterspørselspunkter (node, område, vekt)
- omrader_<nivå>.geojson   grenser for visning

Befolkningen i hvert område fordeles på boligene etter antall boenheter.
Grunnkrets brukes som minste område når data/grunnkretser.geojson finnes;
ellers delbydel. Grunnkretsens åtte aldersgrupper deles i 13 med fordelingen
i delbydelen grunnkretsen ligger i.
"""
import json
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from pyproj import Transformer
from scipy.spatial import cKDTree
from shapely.geometry import mapping

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OUT = ROOT / "docs" / "data"

# Hvordan grunnkretsens 8 grupper fordeles på delbydelens 13 grupper (indekser)
GK_TIL_DB = [[0, 1], [2, 3], [4], [5], [6], [7], [8, 9], [10, 11, 12]]


def les_geojson(sti, crs=4326):
    return gpd.read_file(sti).set_crs(crs, allow_override=True).to_crs(25833)


def main():
    bef = json.load(open(DATA / "befolkning.json", encoding="utf-8"))
    nett = json.load(open(DATA / "gangnett_raa.json"))
    boliger = pd.read_csv(DATA / "boliger.csv")

    # --- Områder: delbydel og bydel
    db = les_geojson(DATA / "delbydeler.geojson")
    bd = les_geojson(DATA / "bydeler.geojson")
    bd["navn"] = bd["name"].str.replace("St.Hanshaugen", "St. Hanshaugen")
    bydelsnr = {"Gamle Oslo": 1, "Grünerløkka": 2, "Sagene": 3, "St. Hanshaugen": 4, "Frogner": 5, "Ullern": 6,
                "Vestre Aker": 7, "Nordre Aker": 8, "Bjerke": 9, "Grorud": 10, "Stovner": 11, "Alna": 12,
                "Østensjø": 13, "Nordstrand": 14, "Søndre Nordstrand": 15, "Sentrum": 16, "Marka": 17}
    bd["nr"] = bd.navn.map(bydelsnr)
    # Sentrum som egen delbydel (1601) med bydelsgrensen
    sentrum = bd[bd.navn == "Sentrum"]
    if len(sentrum) and "1601" not in set(db.kode):
        db = pd.concat([db, gpd.GeoDataFrame({"kode": ["1601"], "navn": ["Sentrum"], "bydel": [16],
                                              "bydelsnavn": ["Sentrum"]}, geometry=sentrum.geometry.values, crs=25833)])
    db = db.reset_index(drop=True)

    def delbydel_for(punkter):
        j = gpd.sjoin(gpd.GeoDataFrame(geometry=punkter, crs=25833), db[["kode", "geometry"]], predicate="within", how="left")
        j = j[~j.index.duplicated()]
        return j["kode"].fillna("1701")  # utenfor alle delbydeler = Marka

    # --- Minste område
    gk_fil = DATA / "grunnkretser.geojson"
    bruk_gk = gk_fil.exists()
    if bruk_gk:
        gk = les_geojson(gk_fil)
        gk["kode"] = gk["kode"].astype(str).str[-4:]
        rp = gk.geometry.representative_point()
        gk["delbydel"] = delbydel_for(rp).values
    pkt = gpd.GeoSeries(gpd.points_from_xy(boliger.x, boliger.y), crs=25833)
    boliger["delbydel"] = delbydel_for(pkt).values
    if bruk_gk:
        j = gpd.sjoin(gpd.GeoDataFrame(geometry=pkt, crs=25833), gk[["kode", "geometry"]], predicate="within", how="left")
        j = j[~j.index.duplicated()]
        boliger["omrade"] = j["kode"].values
    else:
        boliger["omrade"] = boliger.delbydel

    # --- Befolkning per minste område i 13 grupper
    dbbef = {k: np.array(v["a"], dtype=float) for k, v in bef["delbydeler"].items()}
    omrader = {}
    if bruk_gk:
        gk_til_db = dict(zip(gk.kode, gk.delbydel))
        for kode, r in bef["grunnkretser"].items():
            if kode == "9999":
                continue
            fordeling = dbbef.get(gk_til_db.get(kode, ""), dbbef.get("1701"))
            a = np.zeros(13)
            for i, maal in enumerate(GK_TIL_DB):
                sub = fordeling[maal] if fordeling is not None else np.ones(len(maal))
                andel = sub / sub.sum() if sub.sum() > 0 else np.ones(len(maal)) / len(maal)
                a[maal] = r["a"][i] * andel
            omrader[kode] = {"navn": r["navn"], "a": a, "delbydel": gk_til_db.get(kode, "1701")}
    else:
        for kode, v in dbbef.items():
            if kode != "9999":
                omrader[kode] = {"navn": bef["delbydeler"][kode]["navn"], "a": v, "delbydel": kode}

    # --- Nett: noder til lengde/bredde
    x = np.array(nett["x"], dtype=float)
    y = np.array(nett["y"], dtype=float)
    tr = Transformer.from_crs(25833, 4326, always_xy=True)
    lon, lat = tr.transform(x, y)
    tre = cKDTree(np.column_stack([x, y]))

    # --- Etterspørselspunkter: boliger -> nærmeste node, vekt = andel av områdets boenheter
    _, node = tre.query(np.column_stack([boliger.x, boliger.y]))
    boliger["node"] = node
    boliger = boliger[boliger.omrade.isin(omrader.keys())]
    sum_enh = boliger.groupby("omrade").enheter.sum()
    boliger["w"] = boliger.enheter / boliger.omrade.map(sum_enh)
    eps = boliger.groupby(["node", "omrade"], as_index=False).w.sum()

    # Områder med folk, men uten boliger: ett punkt i områdets midte
    uten = [k for k, v in omrader.items() if v["a"].sum() > 0 and k not in sum_enh.index]
    if uten:
        geo = gk.set_index("kode") if bruk_gk else db.set_index("kode")
        ekstra = []
        for k in uten:
            if k in geo.index:
                p = geo.loc[[k]].geometry.representative_point().iloc[0]
                _, n = tre.query([p.x, p.y])
                ekstra.append({"node": int(n), "omrade": k, "w": 1.0})
        eps = pd.concat([eps, pd.DataFrame(ekstra)], ignore_index=True)
        print("Områder uten boliger, plassert i midten:", len(ekstra), "av", len(uten))

    koder = sorted(omrader.keys())
    indeks = {k: i for i, k in enumerate(koder)}
    niva = "grunnkrets" if bruk_gk else "delbydel"
    grunnlag = {
        "kilde": bef["kilde"],
        "aar": bef["aar"],
        "minste_niva": niva,
        "grupper": bef["grupper_delbydel"],
        "omrader": [{"kode": k, "navn": omrader[k]["navn"], "delbydel": omrader[k]["delbydel"],
                     "bydel": int(omrader[k]["delbydel"][:-2] or 0),
                     "a": [round(v, 1) for v in omrader[k]["a"]]} for k in koder],
        "delbydeler": {k: v["navn"] for k, v in bef["delbydeler"].items() if k != "9999"},
        "barnehageandel_1_5": bef["barnehageandel_1_5"],
        "ep_node": eps.node.astype(int).tolist(),
        "ep_omrade": [indeks[k] for k in eps.omrade],
        "ep_vekt": [round(v, 5) for v in eps.w],
    }
    with open(OUT / "dekning_grunnlag.json", "w", encoding="utf-8") as f:
        json.dump(grunnlag, f, ensure_ascii=False, separators=(",", ":"))

    kanter = [v for k in nett["kanter"] for v in k]
    with open(OUT / "dekning_nett.json", "w") as f:
        json.dump({"kilde": nett["kilde"], "lon": [round(v * 1e5) for v in lon], "lat": [round(v * 1e5) for v in lat],
                   "kanter": kanter}, f, separators=(",", ":"))

    # --- Grenser for visning
    def skriv_grenser(gdf, navn, felt):
        g = gdf.to_crs(4326).copy()
        g["geometry"] = g.geometry.simplify(0.00003, preserve_topology=True)
        feats = [{"type": "Feature", "properties": {k: r[k] for k in felt}, "geometry": mapping(r.geometry)}
                 for _, r in g.iterrows()]
        with open(OUT / f"omrader_{navn}.geojson", "w", encoding="utf-8") as f:
            json.dump({"type": "FeatureCollection", "features": feats}, f, ensure_ascii=False, separators=(",", ":"))

    db["kode"] = db["kode"].astype(str)
    skriv_grenser(db, "delbydel", ["kode", "navn"])
    skriv_grenser(bd.assign(kode=bd.nr.astype(str)), "bydel", ["kode", "navn"])
    if bruk_gk:
        gk["navn"] = gk.kode.map(lambda k: bef["grunnkretser"].get(k, {}).get("navn", k))
        skriv_grenser(gk, "grunnkrets", ["kode", "navn"])

    tot = sum(v["a"].sum() for v in omrader.values())
    print(f"Minste nivå: {niva}, {len(koder)} områder, {tot:,.0f} innbyggere, "
          f"{len(eps)} etterspørselspunkter, {len(x)} noder, {len(nett['kanter'])} kanter")


if __name__ == "__main__":
    main()
