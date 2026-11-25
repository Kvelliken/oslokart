"""Henter skoler (NSR) og barnehager (NBR) i Oslo fra Utdanningsdirektoratet.

Skriver docs/data/skoler.json og docs/data/barnehager.json.
Kjøres ukentlig av GitHub Actions (.github/workflows/udir.yml), men kan også
kjøres lokalt:  python scripts/hent_udir.py

Kilde: Udir, Nasjonalt skoleregister og Nasjonalt barnehageregister (NLOD).
"""
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path
import re
from urllib.parse import quote
from urllib.request import Request, urlopen

from geo import Stedsoppslag

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "data"
KOMMUNE = "0301"
NSR = "https://data-nsr.udir.no/v4"
NBR = "https://data-nbr.udir.no/v4"


def hent(url, forsok=4):
    for i in range(forsok):
        try:
            req = Request(url, headers={"Accept": "application/json", "User-Agent": "oslokart (github.com/Kvelliken/oslokart)"})
            with urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001
            if i == forsok - 1:
                raise
            print(f"  feil ({e}), prøver igjen: {url}", file=sys.stderr)
            time.sleep(2 * (i + 1))


def detaljer(base, orgnr):
    return [d for d in ThreadPoolExecutor(max_workers=6).map(lambda o: hent(f"{base}/enhet/{o}"), orgnr) if d]


# Grov avgrensning av Oslo; utelukker f.eks. norske skoler i utlandet registrert i Oslo
OSLO_BOKS = (59.80, 60.15, 10.45, 10.98)


def koordinat(d):
    k = d.get("Koordinat") or {}
    lat, lon = k.get("Breddegrad"), k.get("Lengdegrad")
    if not lat or not lon:
        return None, None
    s, n, v, o = OSLO_BOKS
    if not (s <= lat <= n and v <= lon <= o):
        return None, None
    return round(lat, 6), round(lon, 6)


OSLO_KOMMUNE = "958935420"
ADRESSER = "https://ws.geonorge.no/adresser/v1/sok"


def adressepunkt(d):
    """Koordinat fra Kartverkets adresseregister når NSR mangler koordinat.
    Prøver hele adressen først, deretter uten husnummerintervall («160-162» → «160»)."""
    a = adresse(d)
    if not a:
        return None, None
    postnr = ((d.get("Beliggenhetsadresse") or {}).get("Postnummer") or "").strip()
    forsok = [a]
    kort = re.sub(r"(\d+)\s*-\s*\d+\w*", r"\1", a)
    if kort != a:
        forsok.append(kort)
    for tekst in forsok:
        for medPost in ([True, False] if postnr else [False]):
            url = (f"{ADRESSER}?sok={quote(tekst)}&kommunenummer={KOMMUNE}&treffPerSide=1&utkoordsys=4258"
                   + (f"&postnummer={postnr}" if medPost else ""))
            try:
                treff = hent(url, forsok=2).get("adresser") or []
            except Exception as e:  # noqa: BLE001
                print(f"  adresseoppslag feilet for {a}: {e}", file=sys.stderr)
                return None, None
            if treff:
                pkt = treff[0]["representasjonspunkt"]
                s, n, v, o = OSLO_BOKS
                if s <= pkt["lat"] <= n and v <= pkt["lon"] <= o:
                    return round(pkt["lat"], 6), round(pkt["lon"], 6)
    return None, None


def relasjon(d, typeid):
    for r in d.get("ForeldreRelasjoner") or []:
        if (r.get("Relasjonstype") or {}).get("Id") == typeid:
            return (r.get("Enhet") or {}).get("Organisasjonsnummer")
    return None


def er_skole_i_oslo(d):
    """Utelukker eksamenskontorer o.l. (primær næringskode utenfor 85.1-85.3) og
    enheter uten skoletrinn, som norske skoler i utlandet med administrativ adresse i Oslo."""
    koder = sorted(d.get("Naeringskoder") or [], key=lambda k: k.get("Prioritet") or 9)
    if koder and (koder[0].get("Kode") or "")[:4] not in ("85.1", "85.2", "85.3"):
        return False
    har_trinn = d.get("SkoletrinnGSFra") or d.get("SkoletrinnVGSFra")
    return bool(har_trinn or d.get("ErSpesialskole") or d.get("Elevtall"))


def adresse(d):
    a = d.get("Beliggenhetsadresse") or {}
    return (a.get("Adresse") or "").strip() or None


def nettside(d):
    w = (d.get("Internettadresse") or "").strip()
    if not w:
        return None
    return w if w.startswith("http") else "https://" + w


def skoletype(d):
    if d.get("ErSpesialskole"):
        return "Spesialskole"
    gf, gt = d.get("SkoletrinnGSFra"), d.get("SkoletrinnGSTil")
    vf = d.get("SkoletrinnVGSFra")
    if gf and vf:
        return "Grunnskole og videregående"
    if gf:
        if gt and gt <= 7:
            return "Barneskole"
        if gf >= 8:
            return "Ungdomsskole"
        return "Barne- og ungdomsskole"
    if vf or d.get("ErVideregaaendeSkole"):
        return "Videregående skole"
    if d.get("ErGrunnskole"):
        return "Barne- og ungdomsskole"
    return "Annen skole"


def skole_eier(d):
    """K = Oslo kommune, S = staten, P = privat og andre eiere (f.eks. andre fylkeskommuner)."""
    kat = {k.get("Navn", "").lower() for k in d.get("Skolekategorier") or []}
    eier = relasjon(d, "1")
    if eier == OSLO_KOMMUNE:
        return "K"
    if "statlig" in kat:
        return "S"
    if eier is None and not d.get("ErPrivatskole") and "privat eiet" not in kat:
        return "K"
    return "P"


def hent_skoler(sted):
    liste = hent(f"{NSR}/enheter/kommune/{KOMMUNE}")["EnhetListe"]
    valgt = [e["Organisasjonsnummer"] for e in liste
             if e.get("ErAktiv") and e.get("ErSkole")
             and (e.get("ErGrunnopplaering") or e.get("ErGrunnskole") or e.get("ErVideregaaendeSkole") or e.get("ErSpesialskole"))]
    print(f"NSR: {len(liste)} enheter i Oslo, {len(valgt)} aktive skoler i grunnopplæringen")
    ut = []
    uten = []
    for d in detaljer(NSR, valgt):
        lat, lon = koordinat(d)
        if not er_skole_i_oslo(d):
            continue
        fra_adresse = False
        if lat is None:
            lat, lon = adressepunkt(d)
            fra_adresse = lat is not None
            if fra_adresse:
                print(f"  Plassert etter adressen: {d.get('Navn')} ({adresse(d)})")
        if lat is None:
            # Verken koordinat i NSR eller treff på adressen: vises ikke i kartet, men elevtallet trengs i Skolekapasitet
            if d.get("SkoletrinnGSFra"):
                uten.append({"o": d["Organisasjonsnummer"], "n": d.get("Navn") or d.get("FulltNavn"),
                             "a": adresse(d), "u": skoletype(d), "ei": skole_eier(d), "et": d.get("Elevtall"),
                             "gf": d.get("SkoletrinnGSFra"), "gt": d.get("SkoletrinnGSTil")})
            continue
        ut.append({
            "o": d["Organisasjonsnummer"],
            "n": d.get("Navn") or d.get("FulltNavn"),
            "a": adresse(d),
            "lat": lat, "lon": lon,
            "u": skoletype(d),
            "ei": skole_eier(d),
            "et": d.get("Elevtall"),
            "aa": d.get("AntallAnsatte"),
            "gf": d.get("SkoletrinnGSFra"), "gt": d.get("SkoletrinnGSTil"),
            "vf": d.get("SkoletrinnVGSFra"), "vt": d.get("SkoletrinnVGSTil"),
            "w": nettside(d),
            **({"kp": 1} if fra_adresse else {}),
            **sted.slaa_opp(lon, lat),
        })
    uten.sort(key=lambda p: p["n"] or "")
    if uten:
        print("Skoler uten plassering (verken i NSR eller adresseregisteret):", ", ".join(p["n"] for p in uten))
    return ut, uten


def barnehage_eier(d):
    kat = {k.get("Navn", "").lower() for k in d.get("Barnehagekategorier") or []}
    eier = relasjon(d, "1")
    if eier == OSLO_KOMMUNE:
        return "K"
    if "statlig barnehage" in kat:
        return "S"
    if eier is None and not d.get("ErPrivatBarnehage") and "privat barnehage" not in kat:
        return "K"
    return "P"


def barnehagetype(d):
    kat = [k.get("Navn", "") for k in d.get("Barnehagekategorier") or []]
    for t in ["Familiebarnehage", "Åpen barnehage", "Kombinert barnehage", "Ordinær barnehage"]:
        if t in kat:
            return t
    return "Ordinær barnehage"


def hent_barnehager(sted):
    liste = hent(f"{NBR}/enheter/kommune/{KOMMUNE}")["EnhetListe"]
    valgt = [e["Organisasjonsnummer"] for e in liste
             if e.get("ErAktiv") and e.get("ErBarnehage") and not e.get("ErInaktivIBasil")]
    print(f"NBR: {len(liste)} enheter i Oslo, {len(valgt)} aktive barnehager")
    ut = []
    for d in detaljer(NBR, valgt):
        lat, lon = koordinat(d)
        if lat is None:
            continue
        ut.append({
            "o": d["Organisasjonsnummer"],
            "n": d.get("Navn") or d.get("FulltNavn"),
            "a": adresse(d),
            "lat": lat, "lon": lon,
            "u": barnehagetype(d),
            "ei": barnehage_eier(d),
            "ab": d.get("AntallBarn"),
            "aa": d.get("AntallAnsatte"),
            "af": d.get("AlderstrinnFra"), "at": d.get("AlderstrinnTil"),
            "w": nettside(d),
            **sted.slaa_opp(lon, lat),
        })
    return ut


def skriv(navn, poster, kilde, **ekstra):
    poster.sort(key=lambda p: p["n"] or "")
    data = {"kilde": kilde, "hentet": date.today().isoformat(), "antall": len(poster), "poster": poster, **ekstra}
    with open(OUT / navn, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Skrev {navn}: {len(poster)} poster")


def main():
    sted = Stedsoppslag(OUT / "eiendommer.geojson", ROOT / "data" / "bydeler.geojson")
    skoler, uten = hent_skoler(sted)
    skriv("skoler.json", skoler, "Udir, Nasjonalt skoleregister (NLOD)", uten_plassering=uten)
    skriv("barnehager.json", hent_barnehager(sted), "Udir, Nasjonalt barnehageregister (NLOD)")


if __name__ == "__main__":
    main()
