"""Brukbarhet for hver kommunale eiendom → docs/data/tomt_form.json.

Regnes fra eiendomsflatene i docs/data/eiendommer.geojson (EUREF89 UTM 33):
- b: bredde, diameteren til den største sirkelen som får plass i tomten (m)
- l, w: ytre mål, sidene i det minste omsluttende rektangelet (m)
- k: areal der tomten er minst 20 m bred (m²), det vil si det som blir igjen
     når alle deler smalere enn 20 m tas bort (morfologisk åpning med radius 10 m)
- g: nummer på gruppen av ubebygde kommunale tomter som grenser mot hverandre
     (bare eiendommer uten bygg, utenom veigrunn og seksjoner, og minst 10 m brede,
     så vei- og grøntstriper ikke binder sammen hele byen). Mangler for andre eiendommer.
Gruppene: grupper[g] = [antall tomter, samlet areal m²].

Bruk: python scripts/bygg_tomtform.py
"""
import json
from pathlib import Path

import geopandas as gpd
import numpy as np
import shapely
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

ROT = Path(__file__).resolve().parent.parent
INN = ROT / "docs" / "data" / "eiendommer.geojson"
UT = ROT / "docs" / "data" / "tomt_form.json"
KJERNE_RADIUS = 10   # deler smalere enn 2 × 10 m regnes ikke som brukbare
NABO_TOLERANSE = 0.5  # m, for å regne to teiger som naboer


def main():
    g = gpd.read_file(INN).to_crs(25833)
    g["geometry"] = shapely.make_valid(g.geometry.values)
    geom = g.geometry.values

    # Bredde: største innskrevne sirkel (største av delene i en multiflate)
    def bredde(x):
        deler = getattr(x, "geoms", [x])
        best = 0.0
        for d in deler:
            if d.geom_type != "Polygon" or d.area < 1:
                continue
            best = max(best, shapely.maximum_inscribed_circle(d, tolerance=0.5).length * 2)
        return best

    b = np.array([bredde(x) for x in geom])
    rekt = shapely.oriented_envelope(geom)
    sider = []
    for r in rekt:
        if r.geom_type != "Polygon":
            sider.append((0.0, 0.0))
            continue
        c = np.asarray(r.exterior.coords)
        s = sorted([np.hypot(*(c[1] - c[0])), np.hypot(*(c[2] - c[1]))])
        sider.append((s[1], s[0]))
    kjerne = shapely.intersection(shapely.buffer(shapely.buffer(geom, -KJERNE_RADIUS), KJERNE_RADIUS), geom)
    k = shapely.area(kjerne)

    # Sammenhengende kommunale eiendommer
    n = len(geom)
    med = np.flatnonzero((g["nb"].values == 0) & (g["v"].values == 0) & (g["s"].values == 0) & (b >= 10))
    tre = shapely.STRtree(geom[med])
    a, bb = tre.query(shapely.buffer(geom[med], NABO_TOLERANSE), predicate="intersects")
    m = len(med)
    graf = coo_matrix((np.ones(len(a)), (a, bb)), shape=(m, m))
    antall_grupper, lokal = connected_components(graf, directed=False)
    gruppe = np.full(n, -1)
    gruppe[med] = lokal
    grupper = []
    for gi in range(antall_grupper):
        idx = med[lokal == gi]
        areal = shapely.union_all(geom[idx]).area if len(idx) > 1 else geom[idx[0]].area
        grupper.append([int(len(idx)), int(round(areal))])

    ut = {}
    for i, e in enumerate(g["e"]):
        ut[e] = {"b": round(float(b[i])), "l": round(sider[i][0]), "w": round(sider[i][1]), "k": int(round(k[i]))}
        if gruppe[i] >= 0:
            ut[e]["g"] = int(gruppe[i])
    UT.write_text(json.dumps({"kjerne_bredde": 2 * KJERNE_RADIUS, "tomter": ut, "grupper": grupper},
                             ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    flere = sum(1 for x in grupper if x[0] > 1)
    print(f"{n} eiendommer, {m} ubebygde i {antall_grupper} grupper ({flere} med flere eiendommer) → "
          f"{UT.relative_to(ROT)} ({UT.stat().st_size // 1024} kB)")


if __name__ == "__main__":
    main()
