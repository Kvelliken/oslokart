"""Henter gangnettet i Oslo fra OpenStreetMap og lagrer det kompakt.

Skriver data/gangnett_raa.json (noder i EPSG:25833 og kanter med lengde i meter).
Området er bydelene (byggesonen) pluss en buffer, så Marka ikke tar med hele stinettet.
Kjøres av GitHub Actions (.github/workflows/dekning.yml).

Kartdata (c) OpenStreetMap-bidragsytere, ODbL.
"""
import json
from pathlib import Path

import geopandas as gpd
import osmnx as ox

ROOT = Path(__file__).resolve().parents[1]
BUFFER_M = 1000


def main():
    ox.settings.use_cache = True
    ox.settings.log_console = False
    bydeler = gpd.read_file(ROOT / "data" / "bydeler.geojson").to_crs(25833)
    omrade = bydeler.geometry.make_valid().buffer(0).union_all().buffer(BUFFER_M)
    omrade_wgs = gpd.GeoSeries([omrade], crs=25833).to_crs(4326).iloc[0]

    G = ox.graph_from_polygon(omrade_wgs, network_type="walk", simplify=True, retain_all=False)
    G = ox.project_graph(G, to_crs="EPSG:25833")
    G = ox.convert.to_undirected(G)
    print("Noder:", G.number_of_nodes(), "kanter:", G.number_of_edges())

    nodeid = {}
    xs, ys = [], []
    for i, (n, d) in enumerate(G.nodes(data=True)):
        nodeid[n] = i
        xs.append(round(d["x"]))
        ys.append(round(d["y"]))
    beste = {}
    for u, v, d in G.edges(data=True):
        a, b = sorted((nodeid[u], nodeid[v]))
        if a == b:
            continue
        lengde = max(1, round(d.get("length", 1)))
        if (a, b) not in beste or lengde < beste[(a, b)]:
            beste[(a, b)] = lengde
    kanter = [[a, b, l] for (a, b), l in beste.items()]

    data = {"kilde": "OpenStreetMap-bidragsytere (ODbL)", "crs": "EPSG:25833",
            "x": xs, "y": ys, "kanter": kanter}
    with open(ROOT / "data" / "gangnett_raa.json", "w") as f:
        json.dump(data, f, separators=(",", ":"))
    print("Skrev", len(xs), "noder og", len(kanter), "kanter")


if __name__ == "__main__":
    main()
