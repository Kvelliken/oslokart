"""Henter kjørenettet i Oslo fra OpenStreetMap med kjøretid per strekning.

Skriver data/kjorenett_raa.json (noder i EPSG:25833 og kanter med kjøretid i sekunder).
Kjøretiden regnes fra fartsgrensen i OSM. Der den mangler, brukes snittet for veitypen i
området, ellers verdiene i FART under. Nettet gjøres urettet (utrykningskjøretøy kan i
praksis kjøre mot enveiskjøring), og raskeste retning brukes.
Området er bydelene pluss en buffer, så ruter via nabokommunene kommer med.
Kjøres av GitHub Actions (.github/workflows/dekning.yml).

Kartdata (c) OpenStreetMap-bidragsytere, ODbL.
"""
import json
from pathlib import Path

import geopandas as gpd
import osmnx as ox

ROOT = Path(__file__).resolve().parents[1]
BUFFER_M = 3000
FART = {"motorway": 90, "motorway_link": 60, "trunk": 70, "trunk_link": 50, "primary": 60, "primary_link": 40,
        "secondary": 50, "secondary_link": 40, "tertiary": 50, "tertiary_link": 30, "unclassified": 40,
        "residential": 30, "living_street": 10, "service": 20, "road": 30}


def main():
    ox.settings.use_cache = True
    ox.settings.log_console = False
    bydeler = gpd.read_file(ROOT / "data" / "bydeler.geojson").to_crs(25833)
    omrade = bydeler.geometry.make_valid().buffer(0).union_all().buffer(BUFFER_M)
    omrade_wgs = gpd.GeoSeries([omrade], crs=25833).to_crs(4326).iloc[0]

    G = ox.graph_from_polygon(omrade_wgs, network_type="drive", simplify=True, retain_all=False)
    G = ox.add_edge_speeds(G, hwy_speeds=FART, fallback=30)
    G = ox.add_edge_travel_times(G)
    G = ox.project_graph(G, to_crs="EPSG:25833")
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
        tid = max(1, round(d.get("travel_time", 1)))
        if (a, b) not in beste or tid < beste[(a, b)]:
            beste[(a, b)] = tid
    kanter = [[a, b, t] for (a, b), t in beste.items()]
    data = {"kilde": "OpenStreetMap-bidragsytere (ODbL)", "crs": "EPSG:25833", "enhet": "sekunder",
            "x": xs, "y": ys, "kanter": kanter}
    with open(ROOT / "data" / "kjorenett_raa.json", "w") as f:
        json.dump(data, f, separators=(",", ":"))
    print("Skrev", len(xs), "noder og", len(kanter), "kanter")


if __name__ == "__main__":
    main()
