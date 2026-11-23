# Kommunale tomter i Oslo

Kart over eiendommene Oslo kommune eier. Eiendomslisten er koblet mot eiendomsgrenser og bygninger i matrikkelen. Kartet gjør det lett å finne kommunale tomter uten bygninger og å slå opp reguleringen deres i Planinnsyn.

**Se kartet:** https://kvelliken.github.io/oslokart/

Dette er en uoffisiell oversikt laget av åpne data. Den er ikke et produkt fra Oslo kommune. Sjekk alltid regulering i Planinnsyn og eierforhold i Eiendomsregisteret før du bruker opplysningene.

## Hva kartet viser

- **Ubebygde tomter.** Kommunale eiendommer uten registrerte bygninger. Veigrunn og seksjoner er utelatt. Som standard utelates også Marka, uregistrert grunn og tomter med byggesak under arbeid. Alle tre kan slås på i filteret, og du kan velge å tillate garasjer, uthus og naust.
- **Alle eiendommer.** Alle kommunale eiendommer, farget etter forvalter.
- **Filtre:** forvalter, bydel, minste areal og søk på adresse eller gnr/bnr.
- **Lenker per eiendom** til Planinnsyn, som viser regulering, kommuneplan og pågående saker, og til Eiendomsregisteret.
- **Nedlasting** av utvalget som CSV-fil.

## Kilder

| Data | Kilde | Lisens |
|---|---|---|
| Eiendomsoversikt, oktober 2026 | [Oslo kommune, Eiendoms- og byfornyelsesetaten](https://www.oslo.kommune.no/plan-bygg-og-eiendom/kart-og-eiendomsinformasjon/kommunal-eiendom/eiendomsoversikt) | Offentlig publisert |
| Matrikkelen – Eiendomskart Teig, 0301 Oslo | Kartverket via Geonorge | CC BY 4.0 |
| Matrikkelen – Bygning, 0301 Oslo | Kartverket via Geonorge | CC BY 4.0 |
| Bakgrunnskart (topografisk gråtone) | Kartverket | CC BY 4.0 |
| Bydelsgrenser (forenklede) | Oslo kommune, [bydelsfakta](https://github.com/oslokommune/bydelsfakta) | MIT |
| Kartbibliotek | [Leaflet 1.9.4](https://leafletjs.com/) | BSD-2 |

## Metode

1. **Eiendomslisten** leses fra Excel-filen. Matrikkelnummer på formen `0301-gnr/bnr/fnr/snr` splittes opp.
2. **Kobling mot teig:** Hver eiendom kobles mot én eller flere teiger via tabellen `matrikkelenhet` i Teig-filen. Eiendommer med flere teiger slås sammen.
3. **Seksjoner:** Kommunale seksjoner samles per hovedeiendom og vises med hovedeiendommens teig. Hvis kommunen også eier hele hovedeiendommen, vises bare den.
4. **Bygninger:** Bygningspunkter som ligger inne i teigen telles per eiendom.
   - **Eksisterende bygg:** status TB, FA, MB, MF, FS, IP og GR.
   - **Byggesak under arbeid:** status RA, IG og MT.
   - **Småbygg:** bygningstype 172 og 181–183, det vil si koier, garasjer, uthus, anneks og naust.
5. **Bydel** hentes fra Excel-filen. Mangler den, beregnes den fra bydelsgrensene og merkes «beregnet». Eiendommer utenfor alle bydelsgrensene får bydel «Marka».
6. **Geometrien** forenkles med 0,5 m toleranse og lagres i WGS84 med seks desimaler.

Gjeldende tall står i `docs/data/statistikk.json`. Av 6 927 rader i eiendomslisten ble 6 391 kartobjekter. 392 seksjoner er samlet per hovedeiendom. 236 eiendommer har ingen teig i matrikkelen, for eksempel ikke målte eiendommer og vannrettigheter, og vises derfor ikke.

## Kjente begrensninger

- **Bygninger** er bare de som er registrert i matrikkelen. Konstruksjoner som ikke er registrert, kommer ikke med. Det gjelder for eksempel idrettsanlegg og parkeringsplasser.
- **Delte teiger:** Noen teiger deles av flere matrikkelenheter. Da kan samme flate og areal vises for flere eiendommer, og samlet areal i panelet blir for høyt.
- **Regulering** er ikke koblet inn som data. Planinnsyn har ingen åpen nedlasting, så kartet lenker til Planinnsyn for hver eiendom.
- **Utenbys eiendommer:** De 162 eiendommene Oslo kommune eier i andre kommuner er ikke med.
- **Skrift:** Siden bruker Oslo Sans hvis skriften er installert på maskinen, og ellers Arial.

## Oppdatere dataene

```bash
pip install -r requirements.txt

# Last ned fra kartkatalog.geonorge.no (Oslo 0301, EPSG:25833, FGDB):
#   Matrikkelen - Eiendomskart Teig og Matrikkelen - Bygning
# og pakk ut under data/raw/

python scripts/bygg_data.py \
  --excel data/eiendomsoversikt-oktober-2026.xlsx \
  --teig data/raw/Basisdata_0301_Oslo_25833_MatrikkelenEiendomskartTeig_FGDB.gdb \
  --bygning data/raw/Basisdata_0301_Oslo_25833_MatrikkelenBygning_FGDB.gdb
```

Skriptet skriver `docs/data/eiendommer.geojson` og `docs/data/statistikk.json`. Siden publiseres fra mappen `docs/` med GitHub Pages.

## Mappestruktur

```
docs/                 nettsiden (GitHub Pages)
  index.html, app.js, style.css
  data/               eiendommer.geojson, statistikk.json
  vendor/leaflet/     Leaflet 1.9.4
scripts/bygg_data.py  kobling og bearbeiding
data/                 eiendomsoversikt (Excel) og bydelsgrenser
```
