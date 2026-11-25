# Kommunale tomter i Oslo

Kart over eiendommene Oslo kommune eier. Eiendomslisten er koblet mot eiendomsgrenser og bygninger i matrikkelen. Kartet gjør det lett å finne kommunale tomter uten bygninger og å slå opp reguleringen deres i Planinnsyn.

**Se kartet:** https://kvelliken.github.io/oslokart/

Dette er en uoffisiell oversikt laget av åpne data. Den er ikke et produkt fra Oslo kommune. Sjekk alltid regulering i Planinnsyn og eierforhold i Eiendomsregisteret før du bruker opplysningene.

## Hva kartet viser

- **Faner:** «Alle eiendommer» (startvisning), «Ubebygde tomter» og «Dekningsgrad».
- **Ubebygde tomter.** Kommunale eiendommer uten registrerte bygninger. Veigrunn og seksjoner er utelatt. Som standard utelates også Marka, uregistrert grunn og tomter med byggesak under arbeid. Alle tre kan slås på i filteret, og du kan velge å tillate garasjer, uthus og naust.
- **Alle eiendommer.** Alle kommunale eiendommer, farget etter forvalter.
- **Filtre:** forvalter, bydel, minste areal og søk på adresse eller gnr/bnr.
- **Lenker per eiendom** til Planinnsyn, som viser regulering, kommuneplan og pågående saker, og til Eiendomsregisteret.
- **Nedlasting** av utvalget som CSV-fil.
- **Farg etter hovedbruk:** I fanen «Alle eiendommer» kan eiendommene farges etter hvilke bygg som står på tomten (skole, barnehage, idrett, helse og så videre). Popup-vinduet viser byggene på tomten.

### Kartlaget «Formål og anlegg»

Kartlaget viser skoler, barnehager, idrettsanlegg og andre formål som sirkler. Ingen formål er valgt når laget slås på. Du velger det du vil se, eller søker etter en anleggstype (for eksempel «bandy») og huker av treffet. «Velg alle» og «Fjern alle» finnes også. Hvert hovedformål har sin farge, og eiendomsflatene tones ned når laget er slått på.

| Hovedformål | Kilde | Underfilter |
|---|---|---|
| Skole | Udir, Nasjonalt skoleregister (NSR) | Skoletype (barneskole, ungdomsskole, videregående osv.) |
| Barnehage | Udir, Nasjonalt barnehageregister (NBR) | Type (ordinær, familiebarnehage, åpen osv.) |
| Idrett | Anleggsregisteret (idrettsanlegg.no) | Anleggskategori og videre anleggstype |
| Helse og omsorg | Matrikkelen, bygningstype | Sykehjem, helsesenter, annet |
| Kultur og religion | Matrikkelen, bygningstype | Museum og bibliotek, kulturhus, kirke |
| Beredskap | Matrikkelen, bygningstype | Brann og ambulanse, politi, annet |

- **Eierfilter:** kommunal, statlig og privat. Du kan også velge å vise bare anlegg som ligger på kommunal eiendom.
- **Popup:** Skoler viser elevtall, antall ansatte og trinn. Barnehager viser antall barn, ansatte og alder. Idrettsanlegg viser kategori, type, eier, drifter og byggeår. Ligger anlegget på en kommunal eiendom, kan du gå direkte til eiendommen.
- **Anlegg på samme sted:** Når flere anlegg ligger oppå hverandre, viser popup-vinduet en liste.
- **Idrettsanleggene er ikke komplette.** Uttrekket fra Anleggsregisteret dekker ikke alle idrettsanlegg i Oslo. 54 anlegg har en felles standardplassering i registeret og vises ikke i kartet.
- **Helse, kultur og beredskap** bygger på bygningstypen i matrikkelen og gjelder bare bygg på kommunale eiendommer. Bygningstypen kan være utdatert hvis bygget har endret bruk.

### Dekningsgrad – udekket behov

Fanen finner områder der brukerne bor for langt fra et tilbud, eller der tilbudet er fullt, og foreslår hvor et nytt tilbud gir nytte for flest. Arbeidet følger fire steg:

1. **Tilbud:** Velg tilbudet i kartlaget «Formål og anlegg», for eksempel barnehage eller bandybane.
2. **Brukere og gangavstand:**
   - **Befolkning:** i dag eller framskrevet til 2030, 2035, 2040 eller 2050. Framskrivingen er mellomalternativet i BEF038, og endringen per delbydel og aldersgruppe er fordelt på grunnkretsene.
   - **Brukerandel per aldersgruppe:** kan justeres i panelet.
   - **Akseptabel gangavstand:** standardverdi per formål.
   - **Marka:** er utelatt med mindre du velger det.
3. **Udekket behov:**
   - **Kart:** Varmekartet viser antall udekkede brukere per rute på 250 × 250 m. Listen summerer per delbydel, bydel eller grunnkrets.
   - **For langt unna:** Brukere regnes som udekket når gangavstanden til nærmeste tilbud er lengre enn grensen.
   - **Fullt tilbud:** For barnehage og skole regnes også brukere som udekket når nærmeste tilbud har færre plasser enn brukere. Overskuddet fordeles på alle brukerne i nedslagsfeltet.
4. **Forslag til plassering:** Valget gjøres steg for steg, med en «grådig» algoritme:
   1. Finn stedet med flest udekkede brukere innen gangavstanden.
   2. Regn disse brukerne som dekket.
   3. Finn det neste beste stedet.

   Kandidater kan være alle ruter i byggesonen eller kommunens ubebygde tomter. For tomtene gjelder filtrene i fanen «Ubebygde tomter». Du kan også sette en grense for hvor mange brukere hvert nytt tilbud kan ta.

**Beregning:**
- **Befolkningen:** fra Oslo statistikkbank (BEF003, BEF002), fordelt på boligene etter antall boenheter i matrikkelen.
- **Gangavstandene:** regnes langs gangnettet fra OpenStreetMap, direkte i nettleseren.
- **Oppdatering:** Grunnlaget bygges på nytt hver måned av `.github/workflows/dekning.yml`, med skriptene `hent_befolkning.py`, `hent_gangnett.py` og `bygg_dekning.py`.
- **Grunnkretsgrensene** kommer fra Kartverket. Hver grunnkrets knyttes til delbydelen den overlapper mest. Marka- og Sentrum-kretsene legges til Marka og Sentrum ut fra kretsnummer og navn.

**Forbehold:**
- **Nærmeste tilbud:** Modellen antar at alle bruker nærmeste tilbud. Det overdriver kapasitetsproblemet der tilbud ligger tett med ujevn størrelse.
- **Gangnettet** tar ikke hensyn til stigning.
- **Ruter:** Brukerne i en rute regnes fra rutens midtpunkt.
- **Videregående skoler** mangler elevtall i skoleregisteret.

### Skolekapasitet – fyllingsgrad per barneskolekrets

Fanen farger de 105 barneskolekretsene etter hvor fulle skolene er, i dag eller framskrevet til 2030, 2035, 2040 eller 2050.

- **Kapasitet:** legges inn per krets i nettleseren, i listen eller i kretsens popup. Tallene lagres bare i nettleseren (localStorage) og publiseres aldri. Med «Last ned CSV» og «Last inn CSV» kan de tas vare på og deles. Filen trenger kolonnene `krets` (eller `skole`) og `kapasitet`. Kolonnen `elever_i_dag_overstyrt` er valgfri.
- **Elever i dag:** elevtallet i Udirs skoleregister. For skoler med både barne- og ungdomstrinn anslås barnetrinnet ut fra antall trinn (merket med *). Elevtallet kan overstyres per krets.
- **Framskriving:** dagens elevtall ganget med endringen i antall barn 6–12 år som bor i kretsen. Barna fordeles på kretsene etter boligene, med samme befolkningsgrunnlag og framskriving som i Dekningsgrad.
- **Farger:** grønn, gul og rød etter fyllingsgrad (elever delt på kapasitet). Grensene kan justeres. Fra og med siste grense er kretsen mørk blå (overfylt).

**Kilde og bygging:** Grensene er barneskolekretsene fra Plan- og bygningsetatens skolekart (juni 2026). `scripts/bygg_skolekretser.py` tar bare med geometri, kretsnavn og skolenavn, og kobler skolene til Udir på navn. Ungdomsskolekretser er ikke med.

**Forbehold:** Elevene på en skole bor ikke nødvendigvis i kretsen (skolebytte, privatskoler, spesialskoler). Framskrivingen er fordelt fra delbydel til krets og er usikker for små kretser.

## Kilder

| Data | Kilde | Lisens |
|---|---|---|
| Eiendomsoversikt, oktober 2026 | [Oslo kommune, Eiendoms- og byfornyelsesetaten](https://www.oslo.kommune.no/plan-bygg-og-eiendom/kart-og-eiendomsinformasjon/kommunal-eiendom/eiendomsoversikt) | Offentlig publisert |
| Matrikkelen – Eiendomskart Teig, 0301 Oslo | Kartverket via Geonorge | CC BY 4.0 |
| Matrikkelen – Bygning, 0301 Oslo | Kartverket via Geonorge | CC BY 4.0 |
| Bakgrunnskart (topografisk gråtone) | Kartverket | CC BY 4.0 |
| Skoler (navn, elevtall, trinn) | [Udir, Nasjonalt skoleregister](https://data-nsr.udir.no/swagger/index.html) | NLOD |
| Barnehager (navn, antall barn) | [Udir, Nasjonalt barnehageregister](https://data-nbr.udir.no/swagger/index.html) | NLOD |
| Idrettsanlegg, uttrekk for Oslo | Anleggsregisteret (idrettsanlegg.no) | Ikke komplett |
| Befolkning per grunnkrets og delbydel | Oslo kommune, statistikkbanken (grunnlag fra SSB) | Åpne data |
| Gangnett | OpenStreetMap-bidragsytere | ODbL |
| Grunnkretsgrenser, Oslo | Kartverket via Geonorge | CC BY 4.0 |
| Delbydelsgrenser | Oslo kommune, [bydelsfakta](https://github.com/oslokommune/bydelsfakta) | MIT |
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

Skriptet skriver `docs/data/eiendommer.geojson`, `docs/data/bygg_formal.json` og `docs/data/statistikk.json`. Siden publiseres fra mappen `docs/` med GitHub Pages.

**Idrettsanlegg:** Legg et nytt uttrekk i `data/idrettsanlegg.xlsx` og kjør `python scripts/bygg_idrett.py`.

**Skoler og barnehager** hentes automatisk hver mandag av GitHub Actions (`.github/workflows/udir.yml`). Du kan også kjøre jobben selv under *Actions → Hent skoler og barnehager fra Udir → Run workflow*, eller lokalt med `python scripts/hent_udir.py`.

## Mappestruktur

```
docs/                 nettsiden (GitHub Pages)
  index.html, app.js, style.css
  data/               eiendommer.geojson, statistikk.json
  vendor/leaflet/     Leaflet 1.9.4
  data/               skoler.json, barnehager.json, idrett.json, bygg_formal.json
scripts/bygg_data.py  kobling og bearbeiding av eiendommer og bygg
scripts/bygg_idrett.py  idrettsanlegg
scripts/hent_udir.py  skoler og barnehager fra Udir (kjøres av GitHub Actions)
scripts/geo.py, ns3457.py  felles oppslag og bygningstyper
data/                 eiendomsoversikt og idrettsanlegg (Excel), bydelsgrenser
```
