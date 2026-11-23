"""Bygger kartdata for oslokart.

Kobler Oslo kommunes eiendomsoversikt (Excel) mot Kartverkets
Matrikkelen - Eiendomskart Teig og Matrikkelen - Bygning (FGDB, EPSG:25833),
og skriver docs/data/eiendommer.geojson og docs/data/statistikk.json.

Bruk:
  python scripts/bygg_data.py --excel <eiendomsoversikt.xlsx> \
      --teig <..._MatrikkelenEiendomskartTeig_FGDB.gdb> \
      --bygning <..._MatrikkelenBygning_FGDB.gdb> \
      --bydeler data/bydeler.geojson
"""
import argparse
import json
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import pyogrio
from shapely import set_precision
from shapely.geometry import mapping

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "data"

FORVALTER = {
    "Eiendoms- og byfornyelsesetaten": "EBY",
    "Oslobygg KF": "OBF",
    "Boligbygg Oslo KF": "BBY",
    "Oslo Havn KF": "HAV",
}

# Bygningsstatus i matrikkelen
STATUS_EKSISTERER = {"TB", "FA", "MB", "MF", "FS", "IP", "GR"}
STATUS_PLANLAGT = {"RA", "IG", "MT"}

# Små bygg som ikke regnes som utnyttelse når filteret tillater det
SMAABYGG = {172, 181, 182, 183}

BYGGKATEGORI = {
    1: "Bolig",
    2: "Industri og lager",
    3: "Kontor og forretning",
    4: "Samferdsel",
    5: "Hotell og restaurant",
    6: "Kultur og undervisning",
    7: "Helse og omsorg",
    8: "Fengsel og beredskap",
}


def les_excel(sti):
    d = pd.read_excel(sti, sheet_name=0).replace(r"^\s*$", pd.NA, regex=True)
    d.columns = ["eiendom", "adresse", "bydel", "forvalter", "bruksnavn", "areal"]
    d["forvalter"] = d["forvalter"].str.replace("Oslo havn KF", "Oslo Havn KF")
    p = d["eiendom"].str.extract(r"^(\d{4})-(\d+)/(\d+)/(\d+)/(\d+)$").astype(int)
    d[["knr", "gnr", "bnr", "fnr", "snr"]] = p
    d["veg"] = d["bruksnavn"].fillna("").str.contains("veigrunn", case=False)
    return d


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--excel", required=True)
    ap.add_argument("--teig", required=True)
    ap.add_argument("--bygning", required=True)
    ap.add_argument("--bydeler", default=str(ROOT / "data" / "bydeler.geojson"))
    ap.add_argument("--toleranse", type=float, default=0.5, help="forenkling i meter")
    a = ap.parse_args()

    ex = les_excel(a.excel)
    n_excel = len(ex)
    n_seksjoner = int((ex.snr > 0).sum())

    me = pyogrio.read_dataframe(a.teig, layer="matrikkelenhet", read_geometry=False)
    for c in ["gardsnummer", "bruksnummer", "festenummer", "seksjonsnummer"]:
        me[c] = pd.to_numeric(me[c], errors="coerce").fillna(0).astype(int)
    me = me.rename(columns={"gardsnummer": "gnr", "bruksnummer": "bnr",
                            "festenummer": "fnr", "seksjonsnummer": "snr"})
    flagg = (me.groupby(["gnr", "bnr", "fnr", "snr"])
               .agg(forurenset=("hargrunnforurensing", "max"),
                    kulturminne=("harkulturminne", "max"),
                    mtype=("matrikkelenhetstype", "first"))
               .reset_index())

    teig = pyogrio.read_dataframe(
        a.teig, layer="teig",
        columns=["teigid", "teigmedflerematrikkelenheter", "lagretberegnetareal"])
    teig = teig.rename(columns={"teigid": "teig_fk"})

    nok = ["gnr", "bnr", "fnr", "snr"]

    # Seksjoner samles per hovedeiendom og kobles mot hovedeiendommens teig.
    # Hvis kommunen også eier hele hovedeiendommen, tas seksjonene ikke med separat.
    grunn = ex[ex.snr == 0]
    seks = ex[ex.snr > 0]
    hele = set(zip(grunn.gnr, grunn.bnr, grunn.fnr))
    seks = seks[[(g, b, f) not in hele for g, b, f in zip(seks.gnr, seks.bnr, seks.fnr)]]
    sg = (seks.sort_values("snr").groupby(["gnr", "bnr", "fnr"])
              .agg(adresse=("adresse", "first"), bydel=("bydel", "first"),
                   forvalter=("forvalter", "first"), knr=("knr", "first"),
                   snrs=("snr", lambda s: ", ".join(map(str, s))), antall=("snr", "size"))
              .reset_index())
    sg["eiendom"] = [f"0301-{g}/{b}/{f}/s" for g, b, f in zip(sg.gnr, sg.bnr, sg.fnr)]
    sg["bruksnavn"] = ["Seksjon " + s if n == 1 else f"{n} seksjoner ({s})"
                       for s, n in zip(sg.snrs, sg.antall)]
    sg["areal"] = np.nan
    sg["veg"] = False
    sg["snr"] = 1
    ex = pd.concat([grunn, sg[ex.columns]], ignore_index=True)

    me_k = me[nok + ["teig_fk"]].copy()
    ex_k = ex[["eiendom"] + nok].copy()
    ex_k.loc[ex_k.snr > 0, "snr"] = 0
    kobl = ex_k.merge(me_k, on=nok, how="left")
    uten_teig = kobl[kobl.teig_fk.isna()].eiendom.unique()
    kobl = kobl.dropna(subset=["teig_fk"])
    tg = teig.merge(kobl[["eiendom", "teig_fk"]], on="teig_fk")

    # Bygninger: tell per teig, aggreger per eiendom
    byg = pyogrio.read_dataframe(
        a.bygning, layer="bygning",
        columns=["bygningstype", "bygningsstatus", "bygningsnummer"])
    byg["bygningstype"] = pd.to_numeric(byg["bygningstype"], errors="coerce").fillna(999).astype(int)
    byg = byg.to_crs(teig.crs)
    unike_teiger = tg.drop_duplicates("teig_fk")[["teig_fk", "geometry"]]
    sj = gpd.sjoin(byg, unike_teiger, predicate="within", how="inner")
    sj = sj.merge(tg[["teig_fk", "eiendom"]], on="teig_fk")
    sj = sj.drop_duplicates(["eiendom", "bygningsnummer"])
    eks = sj[sj.bygningsstatus.isin(STATUS_EKSISTERER)]
    pl = sj[sj.bygningsstatus.isin(STATUS_PLANLAGT)]
    n_bygg = eks.groupby("eiendom").size()
    n_store = eks[~eks.bygningstype.isin(SMAABYGG)].groupby("eiendom").size()
    n_planl = pl.groupby("eiendom").size()
    eks_store = eks[~eks.bygningstype.isin(SMAABYGG)].copy()
    eks_store["kat"] = (eks_store.bygningstype // 100).map(BYGGKATEGORI).fillna("Annet")
    hovedkat = eks_store.groupby("eiendom")["kat"].agg(lambda s: s.value_counts().index[0])

    # Slå sammen teiger per eiendom
    tg["delt"] = tg["teigmedflerematrikkelenheter"].astype(int)
    geo = tg.dissolve(by="eiendom", aggfunc={"delt": "max"}).reset_index()
    geo["areal_beregnet"] = geo.geometry.area.round(0)

    d = ex.merge(geo[["eiendom", "geometry", "delt", "areal_beregnet"]], on="eiendom", how="inner")
    d["snr_k"] = np.where(d.snr > 0, 0, d.snr)
    d = d.merge(flagg.rename(columns={"snr": "snr_k"}), on=["gnr", "bnr", "fnr", "snr_k"], how="left")
    d = gpd.GeoDataFrame(d, geometry="geometry", crs=teig.crs)
    d["n_bygg"] = d.eiendom.map(n_bygg).fillna(0).astype(int)
    d["n_store"] = d.eiendom.map(n_store).fillna(0).astype(int)
    d["n_planl"] = d.eiendom.map(n_planl).fillna(0).astype(int)
    d["hovedkat"] = d.eiendom.map(hovedkat)

    # Bydel: fra Excel, ellers beregnet fra bydelsgrenser
    rp = d.geometry.representative_point()
    bd = gpd.read_file(a.bydeler).to_crs(teig.crs)[["name", "geometry"]]
    bj = gpd.sjoin(gpd.GeoDataFrame(geometry=rp, crs=teig.crs), bd, predicate="within", how="left")
    bj = bj[~bj.index.duplicated()]
    d["bydel_ber"] = d.bydel.isna()
    d["bydel"] = d.bydel.fillna(bj["name"].replace({"St.Hanshaugen": "St. Hanshaugen"})).fillna("Marka")

    # Punkt for Planinnsyn (UTM32)
    rp32 = gpd.GeoSeries(rp, crs=teig.crs).to_crs(25832)
    d["pe"] = rp32.x.round(0).astype(int)
    d["pn"] = rp32.y.round(0).astype(int)

    # Forenkle og skriv
    d["geometry"] = d.geometry.simplify(a.toleranse, preserve_topology=True)
    d = d.to_crs(4326)
    d["geometry"] = set_precision(d.geometry.values, 1e-6)

    feats = []
    for i, r in enumerate(d.itertuples()):
        areal = r.areal if pd.notna(r.areal) else r.areal_beregnet
        props = {
            "i": i,
            "e": r.eiendom.replace("0301-", ""),
            "a": None if pd.isna(r.adresse) else r.adresse,
            "b": r.bydel,
            "bb": int(r.bydel_ber),
            "f": FORVALTER.get(r.forvalter, r.forvalter),
            "n": None if pd.isna(r.bruksnavn) else r.bruksnavn,
            "m2": int(round(float(areal))),
            "v": int(r.veg),
            "s": int(r.snr > 0),
            "nb": r.n_bygg,
            "ns": r.n_store,
            "np": r.n_planl,
            "k": None if pd.isna(r.hovedkat) else r.hovedkat,
            "fu": int(r.forurenset or 0),
            "km": int(r.kulturminne or 0),
            "dt": int(r.delt),
            "pe": int(r.pe),
            "pn": int(r.pn),
        }
        feats.append({"type": "Feature", "properties": props, "geometry": mapping(r.geometry)})

    OUT.mkdir(parents=True, exist_ok=True)
    with open(OUT / "eiendommer.geojson", "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": feats}, f,
                  ensure_ascii=False, separators=(",", ":"))

    ubebygd = d[(d.n_bygg == 0) & (~d.veg) & (d.snr == 0)]
    stat = {
        "kilde_excel": Path(a.excel).name,
        "eiendommer_i_excel": int(n_excel),
        "seksjoner_i_excel": n_seksjoner,
        "kartobjekter": int(len(d)),
                "uten_teig": int(len(uten_teig)),
        "uten_teig_forvalter": {k: int(v) for k, v in ex[ex.eiendom.isin(uten_teig)].forvalter.value_counts().items()},
        "uten_teig_eksempler": [str(x) for x in list(uten_teig)[:20]],
        "ubebygde_ikke_veg": int(len(ubebygd)),
        "ubebygde_ikke_veg_m2": int(ubebygd.areal_beregnet.sum()),
        "med_planlagte_bygg": int((d.n_planl > 0).sum()),
    }
    with open(OUT / "statistikk.json", "w", encoding="utf-8") as f:
        json.dump(stat, f, ensure_ascii=False, indent=2)
    print(json.dumps(stat, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
