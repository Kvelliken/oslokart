"""Felles stedsoppslag: hvilken kommunal eiendom og bydel et punkt ligger i."""
import json
import math

import numpy as np
import shapely
from shapely.geometry import Point, shape
from shapely.strtree import STRtree

# Enkel lokal projeksjon rundt Oslo (meter), godt nok for avstander på noen titalls meter
KX = 111320 * math.cos(math.radians(59.92))
KY = 110950


def _meter(geom):
    return shapely.transform(geom, lambda c: np.column_stack([c[:, 0] * KX, c[:, 1] * KY]))


class Stedsoppslag:
    def __init__(self, eiendommer_geojson, bydeler_geojson, maks_avstand=25):
        gj = json.load(open(eiendommer_geojson, encoding="utf-8"))
        self.props = [f["properties"] for f in gj["features"]]
        self.geoms = [_meter(shape(f["geometry"])) for f in gj["features"]]
        self.tre = STRtree(self.geoms)
        bd = json.load(open(bydeler_geojson, encoding="utf-8"))
        self.bydeler = [(f["properties"]["name"].replace("St.Hanshaugen", "St. Hanshaugen"), _meter(shape(f["geometry"])))
                        for f in bd["features"]]
        self.maks = maks_avstand

    def _rangering(self, i):
        p = self.props[i]
        # Foretrekk eiendommer som ikke er veigrunn og ikke seksjoner, deretter minste flate
        return (p["v"], p["s"], self.geoms[i].area)

    def eiendom(self, lon, lat):
        pt = _meter(Point(lon, lat))
        treff = [i for i in self.tre.query(pt, predicate="intersects")]
        if not treff:
            naer = self.tre.query(pt.buffer(self.maks))
            treff = [i for i in naer if self.geoms[i].distance(pt) <= self.maks]
            if not treff:
                return None
            treff.sort(key=lambda i: (self.props[i]["v"], self.geoms[i].distance(pt)))
            return self.props[treff[0]]
        treff.sort(key=self._rangering)
        return self.props[treff[0]]

    def bydel(self, lon, lat):
        pt = _meter(Point(lon, lat))
        for navn, g in self.bydeler:
            if g.contains(pt):
                return navn
        return "Marka"

    def slaa_opp(self, lon, lat):
        p = self.eiendom(lon, lat)
        bydel = p["b"] if p and not p.get("bb") else self.bydel(lon, lat)
        return {"e": p["e"] if p else None, "b": bydel}
