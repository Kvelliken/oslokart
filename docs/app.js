/* Kommunale tomter i Oslo – kartlogikk */
(function () {
  "use strict";

  // ---------- Farger (Oslobyggs designsystem) ----------
  const FARGE = {
    gul: "#f9c66b", morkBla: "#2a2859", bla: "#6fe9ff", lysBla: "#b3f5ff", rod: "#ff8274",
    morkGronn: "#034b45", gronn: "#4ef8b6", lysGronn: "#c7f6c9", beige: "#f8f0dd",
    morkBeige: "#d0bfae", svart: "#000000", hvit: "#ffffff"
  };

  const FORVALTER = {
    OBF: { navn: "Oslobygg KF", farge: FARGE.gul },
    EBY: { navn: "Eiendoms- og byfornyelsesetaten", farge: FARGE.morkBla },
    BBY: { navn: "Boligbygg Oslo KF", farge: FARGE.rod },
    HAV: { navn: "Oslo Havn KF", farge: FARGE.gronn }
  };
  const FORVALTER_REKKEFOLGE = ["OBF", "EBY", "BBY", "HAV"];

  // Hovedformål: samme farge på sirkler (anlegg) og på eiendommer farget etter hovedbruk
  const FORMAL = {
    skole: { navn: "Skole", farge: FARGE.gul, kilde: "Udir, Nasjonalt skoleregister" },
    barnehage: { navn: "Barnehage", farge: FARGE.rod, kilde: "Udir, Nasjonalt barnehageregister" },
    idrett: { navn: "Idrett", farge: FARGE.gronn, kilde: "Anleggsregisteret (idrettsanlegg.no)",
      merknad: "Anleggsregisteret er ikke en komplett liste over idrettsanlegg i Oslo." },
    helse: { navn: "Helse og omsorg", farge: FARGE.bla, kilde: "Kartverket, matrikkelen",
      merknad: "Bygningstype i matrikkelen. Bare bygg på kommunal eiendom." },
    kultur: { navn: "Kultur og religion", farge: FARGE.morkGronn, kilde: "Kartverket, matrikkelen",
      merknad: "Bygningstype i matrikkelen. Bare bygg på kommunal eiendom." },
    beredskap: { navn: "Beredskap", farge: FARGE.morkBla, kilde: "Kartverket, matrikkelen",
      merknad: "Bygningstype i matrikkelen. Bare bygg på kommunal eiendom." }
  };
  const FORMAL_REKKEFOLGE = ["skole", "barnehage", "idrett", "helse", "kultur", "beredskap"];
  // Tegnes nedenfra og opp, så skoler og barnehager havner øverst
  const TEGNEREKKEFOLGE = ["idrett", "kultur", "beredskap", "helse", "barnehage", "skole"];

  const HOVEDBRUK = {
    skole: { navn: "Skole", farge: FARGE.gul },
    barnehage: { navn: "Barnehage", farge: FARGE.rod },
    idrett: { navn: "Idrett", farge: FARGE.gronn },
    helse: { navn: "Helse og omsorg", farge: FARGE.bla },
    kultur: { navn: "Kultur og religion", farge: FARGE.morkGronn },
    beredskap: { navn: "Beredskap", farge: FARGE.morkBla },
    bolig: { navn: "Bolig", farge: FARGE.morkBeige },
    naering: { navn: "Næring, lager, samferdsel", farge: FARGE.lysBla },
    annet: { navn: "Annet", farge: FARGE.lysGronn },
    ingen: { navn: "Ingen bygg", farge: FARGE.beige }
  };

  const EIER = { K: "Oslo kommune", S: "Staten", P: "Privat og andre eiere" };
  const navnForm = (t) => (t || "").toLowerCase().replace(/(^|[\s-])\S/g, (s) => s.toUpperCase())
    .replace(/ (Kommune|Kf|As|Og|I)\b/g, (m) => (m === " Kf" || m === " As" ? m.toUpperCase() : m.toLowerCase()));

  const tilstand = {
    modus: "alle",
    sok: "",
    bydel: "",
    minareal: 0,
    forvaltere: new Set(FORVALTER_REKKEFOLGE),
    smaabygg: false,
    planlagt: false,
    marka: false,
    uregistrert: false,
    fargelegging: "forvalter",
    // Kartlaget «Formål og anlegg»
    formal: false,
    valgt: new Set(),           // valgte blader: "skole|Barneskole", "idrett|Fotballanlegg|Fotballbane grus"
    eiere: new Set(["K", "S", "P"]),
    kunKommunal: false
  };

  let data = [];
  let eiendomPerNokkel = new Map();
  let utvalg = [];
  const lagPerId = new Map();
  let punkter = [];
  let synligePunkter = [];
  const hentet = {};
  let utenPlassering = 0;

  // ---------- Hjelpere ----------
  const fmt = new Intl.NumberFormat("nb-NO");
  const m2 = (v) => fmt.format(Math.round(v)) + " m²";
  const arealKort = (v) => v >= 1e6 ? fmt.format(Math.round(v / 1e5) / 10) + " km²"
    : v >= 1e4 ? fmt.format(Math.round(v / 1000)) + " daa"
    : m2(v);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const dato = (iso) => { if (!iso) return ""; const [y, m, d] = iso.split("-"); return `${d}.${m}.${y}`; };

  function erUregistrert(p) {
    const n = (p.n || "").toLowerCase();
    return n.includes("uregistrert") || n.includes("ikke målt");
  }

  function erUbebygd(p) {
    if (p.v || p.s) return false;
    const bygg = tilstand.smaabygg ? p.ns : p.nb;
    if (bygg > 0) return false;
    if (!tilstand.planlagt && p.np > 0) return false;
    if (!tilstand.marka && p.b === "Marka") return false;
    if (!tilstand.uregistrert && erUregistrert(p)) return false;
    return true;
  }

  function treffSok(tekster, gnr) {
    const q = tilstand.sok;
    if (!q) return true;
    if (tekster.some((t) => (t || "").toLowerCase().includes(q))) return true;
    if (gnr) {
      const k = q.replace(/\s/g, "");
      if ((gnr + "/").startsWith(k + "/") || gnr.startsWith(k)) return true;
    }
    return false;
  }

  function passerFellesFilter(p) {
    if (!tilstand.forvaltere.has(p.f)) return false;
    if (tilstand.bydel && p.b !== tilstand.bydel) return false;
    if (p.m2 < tilstand.minareal) return false;
    return treffSok([p.a, p.n], p.e);
  }

  const MERKNAD = /areal|merkn|ajourf|k-bild|ikke målt|veigrunn|uregistrert|rettighet/i;
  const erMerknad = (n) => !!n && MERKNAD.test(n);
  const tittel = (p) => p.a || (p.n && !erMerknad(p.n) ? p.n : "Gnr/bnr " + visningsnavn(p));

  function planinnsynLenke(p) {
    return `https://od2.pbe.oslo.kommune.no/kart/?mode=regv2,no_historisk_flyfoto,situasjon,text1&north=${p.pn}&east=${p.pe}`;
  }

  function eiendomsregisterLenke(p) {
    const deler = p.e.split("/");
    const [g, b, f] = deler;
    const s = deler[3] === "s" ? "0" : deler[3];
    return `https://eiendomsregisteret.kartverket.no/eiendom/0301/${g}/${b}/${f}/${s}`;
  }

  function visningsnavn(p) {
    const deler = p.e.split("/");
    if (deler[3] === "s") return `${deler[0]}/${deler[1]}` + (deler[2] !== "0" ? `/${deler[2]}` : "");
    let t = `${deler[0]}/${deler[1]}`;
    if (deler[2] !== "0") t += `/${deler[2]}`;
    if (deler[3] !== "0") t += `/${deler[3]}`;
    return t;
  }

  // ---------- Kart ----------
  const kart = L.map("kart", { preferCanvas: true, zoomControl: true, attributionControl: true })
    .setView([59.92, 10.76], 11);
  L.tileLayer("https://cache.kartverket.no/v1/wmts/1.0.0/topograatone/default/webmercator/{z}/{y}/{x}.png", {
    maxZoom: 19, maxNativeZoom: 18,
    attribution: '&copy; <a href="https://www.kartverket.no/">Kartverket</a>'
  }).addTo(kart);
  kart.attributionControl.setPrefix(false);
  kart.createPane("punkter");
  kart.getPane("punkter").style.zIndex = 450;

  const renderer = L.canvas({ padding: 0.5, tolerance: 4 });
  const punktRenderer = L.canvas({ padding: 0.5, tolerance: 3, pane: "punkter" });
  let bakgrunnslag = null;
  let hovedlag = null;
  let punktlag = null;

  function flatefarge(p) {
    if (tilstand.modus === "alle" && tilstand.fargelegging === "hovedbruk") return HOVEDBRUK[p.hb || "ingen"].farge;
    return FORVALTER[p.f].farge;
  }

  function stilHoved(feature) {
    const p = feature.properties;
    const nedtonet = tilstand.formal;
    const hb = tilstand.modus === "alle" && tilstand.fargelegging === "hovedbruk";
    return {
      renderer,
      color: tilstand.modus === "tomter" || hb ? FARGE.svart : flatefarge(p),
      weight: nedtonet ? 0.5 : tilstand.modus === "tomter" ? 1.2 : 0.8,
      opacity: nedtonet ? 0.5 : 1,
      fillColor: flatefarge(p),
      fillOpacity: nedtonet ? 0.3 : 0.7
    };
  }

  function stilBakgrunn() {
    return { color: FARGE.morkBeige, weight: 0.6, opacity: 1, fillColor: FARGE.morkBeige, fillOpacity: tilstand.formal ? 0.12 : 0.25 };
  }

  function eiendomPopup(p) {
    const forv = FORVALTER[p.f] ? FORVALTER[p.f].navn : p.f;
    const byggTekst = p.nb === 0 ? "Ingen registrerte"
      : `${p.nb}` + (p.nb !== p.ns ? ` (herav ${p.nb - p.ns} garasje/uthus/naust)` : "");
    const merknader = [];
    if (p.np > 0) merknader.push(`${p.np} bygg med rammetillatelse eller igangsetting registrert.`);
    if (p.fu) merknader.push("Registrert grunnforurensning i matrikkelen.");
    if (p.km) merknader.push("Registrert kulturminne i matrikkelen.");
    if (p.dt) merknader.push("Teigen deles med andre matrikkelenheter, så areal og bygg kan gjelde flere eiendommer.");
    if (p.s) merknader.push("Kommunen eier seksjoner i eiendommen, ikke hele eiendommen.");
    const byggliste = (p.bt || []).length
      ? `<p class="mellomtittel">Bygg på tomten</p><ul class="bygg">${p.bt.map(([n, a]) => `<li>${a} × ${esc(n)}</li>`).join("")}</ul>` : "";
    return `<div class="popup">
      <h3>${esc(tittel(p))}</h3>
      <p class="under">Gnr/bnr ${esc(visningsnavn(p))}${p.n && tittel(p) !== p.n ? " · " + esc(p.n) : ""}</p>
      <dl>
        <dt>Bydel</dt><dd>${esc(p.b)}${p.bb ? " (beregnet)" : ""}</dd>
        <dt>Forvalter</dt><dd>${esc(forv)}</dd>
        <dt>Areal</dt><dd>${m2(p.m2)}</dd>
        <dt>Bygninger</dt><dd>${byggTekst}</dd>
        ${p.hb ? `<dt>Hovedbruk</dt><dd>${esc(HOVEDBRUK[p.hb].navn)}</dd>` : ""}
      </dl>
      ${byggliste}
      ${merknader.map((m) => `<p class="merk">${esc(m)}</p>`).join("")}
      ${tilstand.modus === "tomter" ? `<div class="tomt-info" data-e="${esc(p.e)}"${tomtCache.has(p.e) ? "" : " data-venter"}>${tomtCache.get(p.e) || '<p class="lagmerknad">Beregner brukbarhet og gangavstand …</p>'}</div>` : ""}
      <div class="lenker">
        <a href="${planinnsynLenke(p)}" target="_blank" rel="noopener">Se regulering i Planinnsyn</a>
        <a href="${eiendomsregisterLenke(p)}" target="_blank" rel="noopener">Se eiendommen i Eiendomsregisteret</a>
      </div>
    </div>`;
  }

  // Alle eiendomsflatene lages én gang. Ved filterendring legges de til, fjernes eller får ny stil,
  // i stedet for å bygges på nytt (det var det som gjorde faner og filtre trege).
  const flategruppe = L.featureGroup();
  const stilNokkel = new Map();
  let flaterLaget = false;

  function lagFlater() {
    L.geoJSON({ type: "FeatureCollection", features: data }, {
      style: () => ({ renderer }),
      onEachFeature: (f, lag) => {
        lagPerId.set(f.properties.i, lag);
        lag.bindPopup(() => eiendomPopup(f.properties), { maxWidth: 340, maxHeight: 520, autoPanPadding: [20, 20] });
      }
    });
    flategruppe.addTo(kart);
    flaterLaget = true;
  }

  function tegnFlater() {
    if (!flaterLaget) lagFlater();
    const ids = new Set(utvalg.map((f) => f.properties.i));
    const fram = [];
    data.forEach((f) => {
      const p = f.properties;
      const lag = lagPerId.get(p.i);
      let stil = null, type = "";
      if (ids.has(p.i)) { stil = stilHoved(f); type = "h"; } else if (tilstand.modus === "tomter" && tilstand.forvaltere.has(p.f)) { stil = stilBakgrunn(); type = "b"; }
      if (!stil) {
        if (flategruppe.hasLayer(lag)) flategruppe.removeLayer(lag);
        stilNokkel.delete(p.i);
        return;
      }
      const nokkel = type + stil.color + stil.weight + stil.opacity + stil.fillColor + stil.fillOpacity;
      if (stilNokkel.get(p.i) !== nokkel) {
        lag.setStyle(stil);
        if (stilNokkel.get(p.i) !== undefined && type === "h" && stilNokkel.get(p.i)[0] !== "h") fram.push(lag);
        stilNokkel.set(p.i, nokkel);
      }
      if (!flategruppe.hasLayer(lag)) { flategruppe.addLayer(lag); if (type === "h") fram.push(lag); }
    });
    if (tilstand.modus === "tomter") fram.forEach((l) => l.bringToFront());
  }

  // ---------- Tomteboksen: brukbarhet og gangavstand ----------
  const GANG_M_PER_MIN = 5000 / 60;            // 5 km/t
  const GANGTIDER = [5, 10, 15];               // minutter
  const SOK_MAKS = 5000;                       // lengste gangavstand det søkes etter anlegg (m)
  const ALDER = [["0–5 år", [0, 1]], ["6–15 år", [2, 3]], ["16–66 år", [4, 5, 6, 7, 8, 9]], ["67 år +", [10, 11, 12]]];
  const NAERMESTE = [
    ["barneskole", "Barneskole", (p) => p.f === "skole" && p.u !== "Spesialskole" && p.d.gf && p.d.gf <= 7],
    ["ungdomsskole", "Ungdomsskole", (p) => p.f === "skole" && p.u !== "Spesialskole" && p.d.gf && p.d.gf <= 10 && p.d.gt >= 8],
    ["barnehage", "Barnehage", (p) => p.f === "barnehage" && p.u !== "Åpen barnehage"],
    ["idrettshall", "Idrettshall", (p) => p.f === "idrett" && p.t === "Idrettshall"],
    ["fotballbane", "Fotballbane", (p) => p.f === "idrett" && p.u === "Fotballanlegg" && /^Fotballbane/.test(p.t)],
    ["svomming", "Svømmeanlegg", (p) => p.f === "idrett" && p.u === "Svømme- og stupeanlegg"]
  ];
  let tomtForm = null;
  const tomtCache = new Map();   // ferdig HTML per eiendom, så boksen kan tegnes på nytt uten ny beregning
  let maalCache = null;
  const lastTomtForm = () => tomtForm || (tomtForm = hentJson("data/tomt_form.json?v=13").catch(() => null));

  function brukbarhetHtml(p, tf) {
    const t = tf && tf.tomter[p.e];
    if (!t) return "";
    const andel = p.m2 > 0 ? Math.min(100, Math.round(t.k / p.m2 * 100)) : 0;
    const form = t.b < 10 ? "Smal stripe, lite egnet for bygg"
      : andel < 50 ? "Uregelmessig, store deler er smalere enn " + tf.kjerne_bredde + " m"
      : t.w > 0 && t.l / t.w > 3 ? "Langstrakt"
      : "Kompakt";
    const gr = t.g != null ? tf.grupper[t.g] : null;
    const nabo = gr && gr[0] > 1
      ? `Grenser til ${fmt.format(gr[0] - 1)} ${gr[0] === 2 ? "annen ubebygd kommunal tomt" : "andre ubebygde kommunale tomter"}, til sammen ${arealKort(gr[1])}.`
      : "Grenser ikke til andre ubebygde kommunale tomter.";
    return `<p class="mellomtittel">Brukbarhet</p>
      <dl>
        <dt>Form</dt><dd>${form}</dd>
        <dt>Bredde</dt><dd>Inntil ${fmt.format(t.b)} m</dd>
        <dt>Ytre mål</dt><dd>Ca. ${fmt.format(t.l)} × ${fmt.format(t.w)} m</dd>
        <dt>Minst ${tf.kjerne_bredde} m bred</dt><dd>${m2(t.k)} (${andel} %)</dd>
      </dl>
      <p class="lagmerknad">${esc(nabo)} Bredden er den største sirkelen som får plass i tomten.</p>`;
  }

  // Punkter på tomtegrensen (høyst ca. 60) som startpunkter for gangberegningen
  function grensepunkter(g) {
    const flater = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    const alle = [];
    flater.forEach((f) => f[0].forEach(([lon, lat]) => alle.push({ lat, lon })));
    const steg = Math.max(1, Math.floor(alle.length / 60));
    const ut = alle.filter((_, i) => i % steg === 0);
    ut.push(midtpunkt(g));
    return ut;
  }

  function maalForAnlegg() {
    if (maalCache) return maalCache;
    maalCache = {};
    NAERMESTE.forEach(([k, , test]) => { maalCache[k] = punkter.filter(test); });
    return maalCache;
  }

  const minutter = (m) => Math.max(1, Math.ceil(m / GANG_M_PER_MIN));
  const avstandTekst = (m) => (m < 1000 ? `${fmt.format(Math.round(m / 10) * 10)} m` : `${fmt.format(Math.round(m / 100) / 10)} km`);

  function gangHtml(r) {
    const linjer = NAERMESTE.map(([k, navn]) => {
      const b = r.naermest[k];
      return `<dt>${navn}</dt><dd>${b ? `${avstandTekst(b.d)}, ${minutter(b.d)} min<br><span class="under">${esc(b.p.n)}</span>` : `Over ${avstandTekst(SOK_MAKS)}`}</dd>`;
    }).join("");
    const sum = (arr, idx) => idx.reduce((s, g) => s + arr[g], 0);
    const rund = (x) => fmt.format(Math.round(x / 10) * 10);
    const tabell = `<table class="tomt-personer"><thead><tr><th></th>${GANGTIDER.map((m) => `<th>${m} min</th>`).join("")}</tr></thead><tbody>
      <tr class="sum"><th>Alle</th>${r.personer.map((p) => `<td>${rund(p.reduce((s, x) => s + x, 0))}</td>`).join("")}</tr>
      ${ALDER.map(([navn, idx]) => `<tr><th>${navn}</th>${r.personer.map((p) => `<td>${rund(sum(p, idx))}</td>`).join("")}</tr>`).join("")}
      </tbody></table>`;
    return `<p class="mellomtittel">Nærmeste tilbud, gange</p><dl class="tomt-naermest">${linjer}</dl>
      <p class="mellomtittel">Personer innen gangavstand</p>${tabell}
      <p class="lagmerknad">Gange fra tomtegrensen langs gangnettet (OpenStreetMap), 5 km/t: 5 min ≈ 420 m, 10 min ≈ 830 m, 15 min = 1,25 km. Bosatte ${esc(r.aar)}, avrundet til nærmeste 10.</p>`;
  }

  function fyllTomtInfo(el, popup) {
    const p = eiendomPerNokkel.get(el.dataset.e);
    if (!p) return;
    const f = data[p.i];
    // Boksens innhold lages av eiendomPopup; update() tegner den på nytt med resultatet fra hurtigbufferen
    Promise.all([
      lastTomtForm(),
      window.Dekning ? window.Dekning.gangFraTomt(grensepunkter(f.geometry), maalForAnlegg(),
        GANGTIDER.map((m) => m * GANG_M_PER_MIN), SOK_MAKS) : Promise.resolve(null)
    ]).then(([tf, r]) => {
      tomtCache.set(p.e, brukbarhetHtml(p, tf) + (r ? gangHtml(r) : '<p class="lagmerknad">Gangavstand kunne ikke beregnes.</p>'));
      if (popup && popup.isOpen()) popup.update();
    });
  }

  kart.on("popupopen", (e) => {
    const el = e.popup.getElement() && e.popup.getElement().querySelector(".tomt-info[data-venter]");
    if (el) fyllTomtInfo(el, e.popup);
  });

  // ---------- Kartlag: formål og anlegg ----------
  function lagPunkter(sett) {
    const ut = [];
    (sett.skoler || []).forEach((p) => ut.push({ f: "skole", u: p.u, ei: p.ei, lat: p.lat, lon: p.lon, n: p.n, b: p.b, e: p.e, d: p }));
    (sett.barnehager || []).forEach((p) => ut.push({ f: "barnehage", u: p.u, ei: p.ei, lat: p.lat, lon: p.lon, n: p.n, b: p.b, e: p.e, d: p }));
    (sett.idrett || []).filter((p) => !p.up).forEach((p) => ut.push({ f: "idrett", u: p.u, t: p.t, ei: p.ei, lat: p.lat, lon: p.lon, n: p.n, b: p.b, e: p.e, d: p }));
    (sett.bygg || []).forEach((p) => {
      const eiendom = eiendomPerNokkel.get(p.e);
      ut.push({
        f: p.f, u: p.u, t: p.t, ei: "K", lat: p.lat, lon: p.lon,
        n: eiendom ? tittel(eiendom) : p.t, b: eiendom ? eiendom.b : "", e: p.e, d: p
      });
    });
    ut.forEach((p, i) => { p.id = i; });
    return ut;
  }

  function bladNokkel(p) {
    return p.f === "idrett" ? p.f + "|" + p.u + "|" + p.t : p.f + "|" + p.u;
  }

  let alleBlader = [];
  const bladerUnder = (nokkel) => alleBlader.filter((b) => b === nokkel || b.startsWith(nokkel + "|"));

  function punktNokler(p) {
    const k = [p.f, p.f + "|" + p.u];
    if (p.f === "idrett") k.push(p.f + "|" + p.u + "|" + p.t);
    return k;
  }

  // Filtre utenom formålsvalget (brukes også til tellingene)
  function passerPunktGrunnfilter(p) {
    if (!tilstand.eiere.has(p.ei)) return false;
    if (tilstand.kunKommunal && !p.e) return false;
    if (tilstand.bydel && p.b !== tilstand.bydel) return false;
    return treffSok([p.n, p.d.a, p.u, p.t]);
  }

  function radius() {
    const z = kart.getZoom();
    return z <= 11 ? 3.5 : z <= 13 ? 5 : z <= 15 ? 6.5 : 8;
  }

  function tegnPunkter() {
    if (punktlag) { kart.removeLayer(punktlag); punktlag = null; }
    if (!tilstand.formal || tilstand.modus === "skolekap") { synligePunkter = []; return; }
    synligePunkter = punkter.filter((p) => tilstand.valgt.has(bladNokkel(p)) && passerPunktGrunnfilter(p));
    const r = radius();
    punktlag = L.layerGroup();
    TEGNEREKKEFOLGE.forEach((f) => {
      synligePunkter.filter((p) => p.f === f).forEach((p) => {
        L.circleMarker([p.lat, p.lon], {
          renderer: punktRenderer, pane: "punkter", radius: r,
          color: FARGE.svart, weight: 1, fillColor: FORMAL[p.f].farge, fillOpacity: 1
        }).on("click", (e) => visPunktPopup(e.latlng, p)).addTo(punktlag);
      });
    });
    punktlag.addTo(kart);
  }

  function naerePunkter(latlng, p0) {
    const c = kart.latLngToContainerPoint(latlng);
    const grense = radius() + 3;
    const naere = synligePunkter.filter((p) => kart.latLngToContainerPoint([p.lat, p.lon]).distanceTo(c) <= grense);
    if (!naere.includes(p0)) naere.unshift(p0);
    return naere;
  }

  function eierTekst(p) {
    if (p.f === "idrett") return p.d.eier ? esc(navnForm(p.d.eier)) : EIER[p.ei];
    return EIER[p.ei];
  }

  function trinn(d) {
    const deler = [];
    if (d.gf) deler.push(`${d.gf}.–${d.gt}. trinn`);
    if (d.vf) deler.push(`Vg${d.vf}–Vg${d.vt}`);
    return deler.join(", ");
  }

  function eiendomLinje(p) {
    if (!p.e) return `<p class="merk">Ligger ikke på en eiendom i kommunens eiendomsoversikt.</p>`;
    const e = eiendomPerNokkel.get(p.e);
    if (!e) return "";
    return `<p class="eiendom">Kommunal eiendom: <button type="button" class="lenkeknapp" data-eiendom="${esc(p.e)}">${esc(tittel(e))}</button> (${esc(FORVALTER[e.f].navn)})</p>`;
  }

  function punktDetaljer(p) {
    const d = p.d;
    const F = FORMAL[p.f];
    let rader = "";
    let under = esc(p.u);
    if (p.f === "skole") {
      rader = `<dt>Elever</dt><dd>${d.et != null ? fmt.format(d.et) : p.u.startsWith("Videregående") ? "Ikke i skoleregisteret" : "Ikke oppgitt"}</dd>
        ${d.aa != null ? `<dt>Ansatte</dt><dd>${fmt.format(d.aa)}</dd>` : ""}
        ${trinn(d) ? `<dt>Trinn</dt><dd>${trinn(d)}</dd>` : ""}
        <dt>Eier</dt><dd>${eierTekst(p)}</dd>`;
    } else if (p.f === "barnehage") {
      rader = `<dt>Barn</dt><dd>${d.ab != null ? fmt.format(d.ab) : "Ikke oppgitt"}</dd>
        ${d.aa != null ? `<dt>Ansatte</dt><dd>${fmt.format(d.aa)}</dd>` : ""}
        ${d.af != null ? `<dt>Alder</dt><dd>${d.af}–${d.at} år</dd>` : ""}
        <dt>Eier</dt><dd>${eierTekst(p)}</dd>`;
    } else if (p.f === "idrett") {
      under = esc(p.t);
      rader = `<dt>Kategori</dt><dd>${esc(p.u)}</dd>
        ${d.kl ? `<dt>Klasse</dt><dd>${esc(d.kl)}</dd>` : ""}
        <dt>Eier</dt><dd>${eierTekst(p)}</dd>
        ${d.dr ? `<dt>Drifter</dt><dd>${esc(navnForm(d.dr))}</dd>` : ""}
        ${d.by ? `<dt>Bygget</dt><dd>${d.by}</dd>` : ""}
        ${d.ob && d.ob !== d.by ? `<dt>Sist ombygd</dt><dd>${d.ob}</dd>` : ""}
        <dt>Anleggsnummer</dt><dd>${d.nr}</dd>`;
    } else {
      under = esc(d.t);
      rader = `<dt>Kategori</dt><dd>${esc(p.u)}</dd><dt>Antall bygg</dt><dd>${d.n}</dd>`;
    }
    const adresse = d.a ? `<dt>Adresse</dt><dd>${esc(d.a)}</dd>` : "";
    const plassering = d.kp ? '<p class="merk">Plassert etter adressen i Kartverkets adresseregister, fordi skoleregisteret mangler koordinat.</p>' : "";
    const nett = d.w ? `<div class="lenker"><a href="${esc(d.w)}" target="_blank" rel="noopener">Nettside</a></div>` : "";
    const kilde = `${F.kilde}${hentet[p.f] ? ", hentet " + dato(hentet[p.f]) : ""}.${F.merknad ? " " + F.merknad : ""}`;
    return `<h3><span class="sirkel" style="background:${F.farge}"></span>${esc(p.n)}</h3>
      <p class="under">${under}</p>
      <dl>${rader}${adresse}${p.b ? `<dt>Bydel</dt><dd>${esc(p.b)}</dd>` : ""}</dl>
      ${plassering}
      ${eiendomLinje(p)}
      ${window.Dekning && tilstand.modus === "dekning" ? window.Dekning.punktInfo(p) : ""}
      ${nett}
      <p class="kilde">Kilde: ${esc(kilde)}</p>`;
  }

  function visPunktPopup(latlng, p0) {
    const naere = naerePunkter(latlng, p0);
    const el = document.createElement("div");
    el.className = "popup";
    const visListe = () => {
      el.innerHTML = `<h3>${naere.length} anlegg her</h3><ul class="anleggsliste">${naere.map((p, i) =>
        `<li><button type="button" class="lenkeknapp" data-indeks="${i}"><span class="sirkel" style="background:${FORMAL[p.f].farge}"></span>${esc(p.n)}</button> <span class="under">${esc(p.f === "idrett" ? p.t : p.u)}</span></li>`).join("")}</ul>`;
    };
    const visEn = (p, medTilbake) => {
      el.innerHTML = (medTilbake ? `<button type="button" class="lenkeknapp tilbake" data-tilbake="1">Tilbake til listen</button>` : "") + punktDetaljer(p);
    };
    if (naere.length > 1) visListe(); else visEn(p0, false);
    L.DomEvent.disableClickPropagation(el);
    el.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      e.stopPropagation();
      // Bytt innhold etter at klikket er ferdig behandlet, så popupen ikke lukkes
      setTimeout(() => {
        if (b.dataset.indeks) visEn(naere[+b.dataset.indeks], true);
        else if (b.dataset.tilbake) visListe();
        else if (b.dataset.eiendom) visEiendom(b.dataset.eiendom);
      }, 0);
    });
    L.popup({ maxWidth: 340, maxHeight: 420 }).setLatLng(latlng).setContent(el).openOn(kart);
  }

  function visEiendom(nokkel) {
    const p = eiendomPerNokkel.get(nokkel);
    if (!p) return;
    const lag = lagPerId.get(p.i);
    if (lag && flategruppe.hasLayer(lag)) {
      kart.fitBounds(lag.getBounds(), { maxZoom: 17, padding: [40, 40] });
      lag.openPopup(lag.getBounds().getCenter());
      return;
    }
    const f = data[p.i];
    const midl = L.geoJSON(f, { style: { color: FARGE.svart, weight: 2, fillColor: flatefarge(p), fillOpacity: 0.5 } }).addTo(kart);
    kart.fitBounds(midl.getBounds(), { maxZoom: 17, padding: [40, 40] });
    L.popup({ maxWidth: 340 }).setLatLng(midl.getBounds().getCenter()).setContent(eiendomPopup(p)).openOn(kart);
    kart.once("popupclose", () => kart.removeLayer(midl));
  }

  // Formålstreet i panelet
  function byggTre() {
    const tre = {};
    punkter.forEach((p) => {
      const f = (tre[p.f] = tre[p.f] || {});
      const u = (f[p.u] = f[p.u] || {});
      if (p.f === "idrett") u[p.t] = true;
    });
    return tre;
  }

  function radHtml(nokkel, tekst, farge, harBarn, niva) {
    const id = "fm-" + nokkel.replace(/[^a-zA-Z0-9]/g, "_") + "-" + Math.random().toString(36).slice(2, 7);
    return `<div class="tre-rad niva-${niva}" data-rad="${esc(nokkel)}">
      ${harBarn ? `<button type="button" class="utvid" aria-expanded="false" aria-controls="${id}" title="Vis underkategorier"><span aria-hidden="true">›</span><span class="skjult-tekst">Vis underkategorier for ${esc(tekst)}</span></button>` : `<span class="utvid-plass"></span>`}
      <label class="avkryss"><input type="checkbox" data-nokkel="${esc(nokkel)}">
        ${farge ? `<span class="sirkel" style="background:${farge}"></span>` : ""}<span class="tre-tekst">${esc(tekst)}</span> <span class="antall" data-antall="${esc(nokkel)}"></span></label>
    </div>${harBarn ? `<div class="tre-barn" id="${id}" data-barn-for="${esc(nokkel)}" hidden>` : ""}`;
  }

  function lagKartlagPanel() {
    const rot = document.getElementById("kartlag");
    const tre = byggTre();
    const tilgjengelig = FORMAL_REKKEFOLGE.filter((f) => tre[f]);
    const mangler = FORMAL_REKKEFOLGE.filter((f) => !tre[f]);
    let html = `<label class="avkryss lagvalg"><input type="checkbox" id="lag-formal"> <span>Formål og anlegg</span></label>
      <div id="formal-innhold" class="lag-innhold" hidden>
      <fieldset class="felt"><legend>Eier</legend><div class="valg">
        ${Object.entries(EIER).map(([k, v]) => `<label class="avkryss"><input type="checkbox" data-eier="${k}" checked> ${v}</label>`).join("")}
      </div>
      <label class="avkryss"><input type="checkbox" id="kun-kommunal"> Bare anlegg på kommunal eiendom</label></fieldset>
      <fieldset class="felt"><legend>Formål</legend>
      <label class="felt formal-sok"><span>Finn formål eller anleggstype</span>
        <input type="search" id="formal-sok" placeholder="F.eks. bandy, sykehjem, barneskole" autocomplete="off"></label>
      <div class="velg-knapper"><button type="button" class="lenkeknapp" id="velg-alle">Velg alle</button>
        <button type="button" class="lenkeknapp" id="velg-ingen">Fjern alle</button></div>
      <p class="lagmerknad" id="formal-tomt">Ingen formål er valgt. Velg formål under for å vise dem i kartet.</p>
      <div class="tre">`;
    tilgjengelig.forEach((f) => {
      const under = Object.keys(tre[f]).sort((a, b) => a.localeCompare(b, "nb"));
      html += radHtml(f, FORMAL[f].navn, FORMAL[f].farge, under.length > 0, 1);
      under.forEach((u) => {
        const typer = f === "idrett" ? Object.keys(tre[f][u]).sort((a, b) => a.localeCompare(b, "nb")) : [];
        html += radHtml(f + "|" + u, u, null, typer.length > 1, 2);
        if (typer.length > 1) {
          typer.forEach((t) => { html += radHtml(f + "|" + u + "|" + t, t, null, false, 3); });
          html += "</div>";
        }
      });
      if (under.length) html += "</div>";
      if (f === "idrett") html += `<p class="lagmerknad">${esc(FORMAL[f].merknad)}${utenPlassering ? ` ${fmt.format(utenPlassering)} anlegg mangler presis plassering og vises ikke.` : ""}</p>`;
    });
    html += `</div></fieldset>
      <p class="lagmerknad">Skoler og barnehager: Udir${hentet.skole ? ", hentet " + dato(hentet.skole) : ""}. Helse, kultur og beredskap: bygningstype i matrikkelen, bare bygg på kommunal eiendom.</p>
      ${mangler.length ? `<p class="lagmerknad">Mangler data for: ${mangler.map((f) => FORMAL[f].navn.toLowerCase()).join(", ")}. ${mangler.some((f) => f === "skole" || f === "barnehage") ? "Udir-dataene hentes av en ukentlig jobb i repoet." : ""}</p>` : ""}
      <button type="button" id="last-ned-anlegg" class="lenkeknapp">Last ned anleggene som CSV</button>
      </div>`;
    rot.innerHTML = html;
    alleBlader = [...new Set(punkter.map(bladNokkel))];
    oppdaterAvkrysning();

    document.getElementById("lag-formal").addEventListener("change", (e) => {
      tilstand.formal = e.target.checked;
      document.getElementById("formal-innhold").hidden = !tilstand.formal;
      oppdater();
    });
    rot.addEventListener("click", (e) => {
      const b = e.target.closest("button.utvid");
      if (!b) return;
      const apen = b.getAttribute("aria-expanded") === "true";
      b.setAttribute("aria-expanded", String(!apen));
      document.getElementById(b.getAttribute("aria-controls")).hidden = apen;
    });
    rot.addEventListener("change", (e) => {
      const t = e.target;
      if (t.dataset.nokkel) {
        const blader = bladerUnder(t.dataset.nokkel);
        const alleValgt = blader.every((b) => tilstand.valgt.has(b));
        blader.forEach((b) => (alleValgt ? tilstand.valgt.delete(b) : tilstand.valgt.add(b)));
        oppdaterAvkrysning();
        oppdaterPunkter();
      } else if (t.dataset.eier) {
        if (t.checked) tilstand.eiere.add(t.dataset.eier); else tilstand.eiere.delete(t.dataset.eier);
        oppdaterPunkter();
      } else if (t.id === "kun-kommunal") {
        tilstand.kunKommunal = t.checked;
        oppdaterPunkter();
      }
    });
    document.getElementById("last-ned-anlegg").addEventListener("click", lastNedAnleggCsv);
    document.getElementById("velg-alle").addEventListener("click", () => {
      alleBlader.forEach((b) => tilstand.valgt.add(b)); oppdaterAvkrysning(); oppdaterPunkter();
    });
    document.getElementById("velg-ingen").addEventListener("click", () => {
      tilstand.valgt.clear(); oppdaterAvkrysning(); oppdaterPunkter();
    });
    let ts;
    document.getElementById("formal-sok").addEventListener("input", (e) => {
      clearTimeout(ts);
      ts = setTimeout(() => sokITre(e.target.value.trim().toLowerCase()), 150);
    });
  }

  // Avkrysning: huket av når alle blader under er valgt, delvis når noen er valgt
  function oppdaterAvkrysning() {
    document.querySelectorAll("#kartlag input[data-nokkel]").forEach((el) => {
      const blader = bladerUnder(el.dataset.nokkel);
      const n = blader.filter((b) => tilstand.valgt.has(b)).length;
      el.checked = n > 0 && n === blader.length;
      el.indeterminate = n > 0 && n < blader.length;
    });
    const tomt = document.getElementById("formal-tomt");
    if (tomt) tomt.hidden = tilstand.valgt.size > 0;
  }

  // Søk i formålstreet: viser treff, deres overordnede og underordnede rader
  function sokITre(q) {
    const rader = [...document.querySelectorAll("#kartlag .tre-rad")];
    const beholdere = [...document.querySelectorAll("#kartlag .tre-barn")];
    if (!q) {
      rader.forEach((r) => { r.hidden = false; });
      beholdere.forEach((b) => {
        const knapp = document.querySelector(`[aria-controls="${b.id}"]`);
        b.hidden = !knapp || knapp.getAttribute("aria-expanded") !== "true";
      });
      return;
    }
    const treff = rader.filter((r) => r.querySelector(".tre-tekst").textContent.toLowerCase().includes(q)).map((r) => r.dataset.rad);
    const synlig = (k) => treff.some((t) => t === k || t.startsWith(k + "|") || k.startsWith(t + "|"));
    rader.forEach((r) => { r.hidden = !synlig(r.dataset.rad); });
    beholdere.forEach((b) => {
      const k = b.dataset.barnFor;
      b.hidden = !treff.some((t) => t.startsWith(k + "|"));
    });
  }

  function oppdaterAntall() {
    if (!tilstand.formal) return;
    const teller = new Map();
    punkter.forEach((p) => {
      if (!passerPunktGrunnfilter(p)) return;
      punktNokler(p).forEach((k) => teller.set(k, (teller.get(k) || 0) + 1));
    });
    document.querySelectorAll("[data-antall]").forEach((el) => {
      el.textContent = "(" + fmt.format(teller.get(el.dataset.antall) || 0) + ")";
    });
  }

  function oppdaterPunkter() {
    tegnPunkter();
    oppdaterAntall();
    if (window.Dekning) window.Dekning.oppdater();
    lagTegnforklaring();
  }

  // Anlegg som inngår i dekningsberegningen: formålsvalg og eierfilter, men ikke bydel eller søk
  function anleggForDekning() {
    return punkter.filter((p) => tilstand.valgt.has(bladNokkel(p)) && tilstand.eiere.has(p.ei) && (!tilstand.kunKommunal || p.e));
  }

  // ---------- Panel ----------
  function oppdaterTall() {
    const n = utvalg.length;
    const sum = utvalg.reduce((s, f) => s + f.properties.m2, 0);
    document.getElementById("tall-antall").textContent = fmt.format(n);
    document.getElementById("tall-antall-tekst").textContent =
      tilstand.modus === "tomter" ? (n === 1 ? "ubebygd tomt" : "ubebygde tomter") : (n === 1 ? "eiendom" : "eiendommer");
    document.getElementById("tall-areal").textContent = arealKort(sum);
  }

  function oppdaterListe() {
    const ol = document.getElementById("toppliste");
    const topp = [...utvalg].sort((a, b) => b.properties.m2 - a.properties.m2).slice(0, 25);
    if (!topp.length) {
      ol.innerHTML = '<li class="tom">Ingen eiendommer passer filteret.</li>';
      return;
    }
    ol.innerHTML = topp.map((f) => {
      const p = f.properties;
      return `<li><button type="button" data-id="${p.i}">
        <span>${esc(tittel(p))}</span>
        <span class="areal">${m2(p.m2)}</span>
        <span class="sted">${esc(p.b)} · ${esc(FORVALTER[p.f].navn)}</span>
      </button></li>`;
    }).join("");
  }

  function velg(id) {
    const lag = lagPerId.get(id);
    if (!lag || !flategruppe.hasLayer(lag)) return;
    kart.fitBounds(lag.getBounds(), { maxZoom: 17, padding: [40, 40] });
    lag.openPopup(lag.getBounds().getCenter());
    if (window.matchMedia("(max-width: 800px)").matches) document.getElementById("panel").classList.remove("apen");
  }

  function oppdater() {
    const egenFane = tilstand.modus === "dekning" || tilstand.modus === "skolekap";
    utvalg = egenFane ? [] : data.filter((f) => {
      const p = f.properties;
      if (!passerFellesFilter(p)) return false;
      return tilstand.modus === "tomter" ? erUbebygd(p) : true;
    });
    tegnFlater();
    oppdaterTall();
    oppdaterListe();
    document.querySelectorAll(".kun-tomter").forEach((el) => { el.hidden = tilstand.modus !== "tomter"; });
    document.querySelectorAll(".kun-alle").forEach((el) => { el.hidden = tilstand.modus !== "alle"; });
    document.querySelectorAll(".kun-eiendom").forEach((el) => { el.hidden = egenFane; });
    document.querySelectorAll(".kun-dekning").forEach((el) => { el.hidden = tilstand.modus !== "dekning"; });
    document.querySelectorAll(".kun-skolekap").forEach((el) => { el.hidden = tilstand.modus !== "skolekap"; });
    document.getElementById("kartlag-seksjon").hidden = tilstand.modus === "skolekap";
    if (tilstand.modus === "dekning" && !tilstand.formal) {
      const k = document.getElementById("lag-formal");
      if (k) { k.checked = true; tilstand.formal = true; document.getElementById("formal-innhold").hidden = false; }
    }
    plasserKartlag();
    if (window.Dekning) window.Dekning.modus(tilstand.modus === "dekning");
    if (window.Skolekap) window.Skolekap.modus(tilstand.modus === "skolekap");
    oppdaterPunkter();
  }

  function plasserKartlag() {
    const seksjon = document.getElementById("kartlag-seksjon");
    const maal = tilstand.modus === "dekning" ? document.getElementById("dk-tilbud-slot")
      : document.querySelector(".liste.kun-eiendom");
    if (tilstand.modus === "dekning") { if (seksjon.parentNode !== maal) maal.appendChild(seksjon); } else if (seksjon.nextElementSibling !== maal) maal.parentNode.insertBefore(seksjon, maal);
  }

  function lagTegnforklaring() {
    const el = document.getElementById("tegnforklaring");
    const rute = (farge, tekst, ramme) => `<div><i style="background:${farge}${ramme ? ";border-color:" + ramme : ""}"></i>${esc(tekst)}</div>`;
    const sirkel = (farge, tekst) => `<div><i class="rund" style="background:${farge}"></i>${esc(tekst)}</div>`;
    let html = "";
    if (tilstand.modus === "alle" && tilstand.fargelegging === "hovedbruk") {
      html += `<p class="tf-tittel">Eiendommer etter hovedbruk</p>` +
        Object.values(HOVEDBRUK).map((h) => rute(h.farge, h.navn)).join("");
    } else if (tilstand.modus === "alle" || tilstand.modus === "tomter") {
      html += `<p class="tf-tittel">Eiendommer etter forvalter</p>` +
        FORVALTER_REKKEFOLGE.map((k) => rute(FORVALTER[k].farge, FORVALTER[k].navn)).join("");
      if (tilstand.modus === "tomter") html += rute(FARGE.morkBeige, "Annen kommunal eiendom", FARGE.morkBeige);
    }
    if (tilstand.formal) {
      const vist = new Set(synligePunkter.map((p) => p.f));
      const formal = FORMAL_REKKEFOLGE.filter((f) => vist.has(f));
      if (formal.length) html += `<p class="tf-tittel">Formål og anlegg</p>` + formal.map((f) => sirkel(FORMAL[f].farge, FORMAL[f].navn)).join("");
    }
    if (window.Dekning && tilstand.modus === "dekning") html = window.Dekning.tegnforklaring() + html;
    if (window.Skolekap && tilstand.modus === "skolekap") html = window.Skolekap.tegnforklaring();
    el.innerHTML = html;
    el.hidden = !html;
  }

  function csv(hode, rader, filnavn) {
    const tekst = [hode, ...rader].map((r) => r.map((v) => {
      const s = v == null ? "" : String(v);
      return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(";")).join("\r\n");
    const blob = new Blob(["﻿" + tekst], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filnavn;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  function lastNedCsv() {
    const hode = ["gnr_bnr", "adresse", "bruksnavn", "bydel", "forvalter", "areal_m2", "hovedbruk", "bygg", "bygg_utenom_smaabygg", "bygg_under_arbeid", "grunnforurensning", "kulturminne", "planinnsyn", "eiendomsregisteret"];
    const rader = utvalg.map((f) => {
      const p = f.properties;
      return [visningsnavn(p), p.a, p.n, p.b, FORVALTER[p.f].navn, p.m2, p.hb ? HOVEDBRUK[p.hb].navn : "", p.nb, p.ns, p.np, p.fu ? "ja" : "", p.km ? "ja" : "", planinnsynLenke(p), eiendomsregisterLenke(p)];
    });
    csv(hode, rader, tilstand.modus === "tomter" ? "ubebygde-kommunale-tomter.csv" : "kommunale-eiendommer.csv");
  }

  function lastNedAnleggCsv() {
    const hode = ["formal", "underkategori", "type", "navn", "adresse", "bydel", "eier", "elever", "barn", "kommunal_eiendom", "breddegrad", "lengdegrad", "kilde"];
    const rader = synligePunkter.map((p) => [FORMAL[p.f].navn, p.u, p.t || "", p.n, p.d.a, p.b, p.f === "idrett" ? p.d.eier : EIER[p.ei],
      p.d.et, p.d.ab, p.e || "", p.lat, p.lon, FORMAL[p.f].kilde]);
    csv(hode, rader, "formal-og-anlegg.csv");
  }

  function koble() {
    const forv = document.getElementById("forvaltere");
    forv.innerHTML = FORVALTER_REKKEFOLGE.map((k) =>
      `<label class="avkryss"><input type="checkbox" value="${k}" checked><span class="prikk" style="background:${FORVALTER[k].farge}"></span>${FORVALTER[k].navn}</label>`).join("");
    forv.addEventListener("change", (e) => {
      if (e.target.checked) tilstand.forvaltere.add(e.target.value); else tilstand.forvaltere.delete(e.target.value);
      oppdater();
    });

    const bydeler = [...new Set(data.map((f) => f.properties.b))].sort((a, b) => a.localeCompare(b, "nb"));
    const sel = document.getElementById("bydel");
    sel.insertAdjacentHTML("beforeend", bydeler.map((b) => `<option>${esc(b)}</option>`).join(""));
    sel.addEventListener("change", () => { tilstand.bydel = sel.value; oppdater(); });

    document.getElementById("minareal").addEventListener("change", (e) => { tilstand.minareal = +e.target.value; oppdater(); });
    document.getElementById("fargelegging").addEventListener("change", (e) => { tilstand.fargelegging = e.target.value; oppdater(); });

    let t;
    document.getElementById("sok").addEventListener("input", (e) => {
      clearTimeout(t);
      t = setTimeout(() => { tilstand.sok = e.target.value.trim().toLowerCase(); oppdater(); }, 200);
    });

    ["smaabygg", "planlagt", "marka", "uregistrert"].forEach((id) => {
      document.getElementById(id).addEventListener("change", (e) => { tilstand[id] = e.target.checked; oppdater(); });
    });

    const faner = {
      alle: document.getElementById("fane-alle"), tomter: document.getElementById("fane-tomter"),
      dekning: document.getElementById("fane-dekning"), skolekap: document.getElementById("fane-skolekap")
    };
    Object.entries(faner).forEach(([modus, knapp]) => {
      knapp.addEventListener("click", () => {
        if (tilstand.modus === modus) return;
        tilstand.modus = modus;
        Object.entries(faner).forEach(([m, k]) => { k.classList.toggle("aktiv", m === modus); k.setAttribute("aria-selected", m === modus); });
        if (modus === "alle" && tilstand.minareal === 1000) { tilstand.minareal = 0; document.getElementById("minareal").value = "0"; }
        if (modus === "tomter" && tilstand.minareal === 0) { tilstand.minareal = 1000; document.getElementById("minareal").value = "1000"; }
        document.getElementById("panel-innhold").scrollTop = 0;
        requestAnimationFrame(() => setTimeout(oppdater, 0));
      });
    });

    document.getElementById("toppliste").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-id]");
      if (b) velg(+b.dataset.id);
    });
    document.getElementById("last-ned").addEventListener("click", lastNedCsv);
    document.getElementById("vis-panel").addEventListener("click", () => document.getElementById("panel").classList.toggle("apen"));

    const rulle = document.getElementById("panel-innhold");
    const holdIRo = (el) => {
      if (!el || !rulle.contains(el)) return;
      const for0 = el.getBoundingClientRect().top;
      const juster = () => {
        if (!el.isConnected || !el.offsetParent) return;
        const d = el.getBoundingClientRect().top - for0;
        if (Math.abs(d) > 1) rulle.scrollTop += d;
      };
      requestAnimationFrame(() => { juster(); requestAnimationFrame(juster); });
      setTimeout(juster, 150);
    };
    rulle.addEventListener("change", (e) => holdIRo(e.target), true);
    rulle.addEventListener("click", (e) => { const t = e.target.closest("button, label, summary"); if (t && !t.hasAttribute("data-rull")) holdIRo(t); }, true);

    let forrigeRadius = radius();
    kart.on("zoomend", () => {
      if (tilstand.formal && radius() !== forrigeRadius) { forrigeRadius = radius(); tegnPunkter(); }
    });
  }

  // Omtrentlig midtpunkt: snitt av ytterringen i den største flaten
  function midtpunkt(g) {
    const flater = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    let ring = flater[0][0];
    flater.forEach((f) => { if (f[0].length > ring.length) ring = f[0]; });
    let x = 0, y = 0;
    ring.forEach(([a, b]) => { x += a; y += b; });
    return { lon: x / ring.length, lat: y / ring.length };
  }

  const hentJson = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(url); return r.json(); });

  hentJson("data/eiendommer.geojson")
    .then((gj) => {
      data = gj.features;
      eiendomPerNokkel = new Map(data.map((f) => [f.properties.e, f.properties]));
      return Promise.allSettled(["skoler", "barnehager", "idrett", "bygg_formal"].map((n) => hentJson(`data/${n}.json?v=13`)));
    })
    .then(([sk, bh, id, by]) => {
      const verdi = (r) => (r.status === "fulfilled" ? r.value : null);
      const s = verdi(sk), b = verdi(bh), i = verdi(id), g = verdi(by);
      if (s) hentet.skole = s.hentet;
      if (b) hentet.barnehage = b.hentet;
      if (i) utenPlassering = i.poster.filter((p) => p.up).length;
      punkter = lagPunkter({
        skoler: s && s.poster, barnehager: b && b.poster, idrett: i && i.poster, bygg: g && g.poster
      });
      koble();
      lagKartlagPanel();
      // Felles grensesnitt for tilleggsmoduler (dekningsgrad og senere kartlag)
      window.Oslokart = {
        kart, tilstand, FORMAL, FARGE, esc, fmt, punkter,
        anleggForDekning, punktPopup: (p) => visPunktPopup(L.latLng(p.lat, p.lon), p),
        oppdaterTegnforklaring: lagTegnforklaring,
        FORVALTER, tittel, visEiendom,
        // Ubebygde kommunale tomter (filtrene fra fanen «Ubebygde tomter») som kandidater
        tomtKandidater: (minAreal) => data.filter((f) => {
          const p = f.properties;
          return erUbebygd(p) && p.b !== "Marka" && p.m2 >= minAreal && tilstand.forvaltere.has(p.f);
        }).map((f) => ({ p: f.properties, ...midtpunkt(f.geometry) }))
      };
      if (window.Dekning) window.Dekning.start(window.Oslokart);
      if (window.Skolekap) window.Skolekap.start(window.Oslokart);
      oppdater();
      const ledig = window.requestIdleCallback || ((f) => setTimeout(f, 1500));
      ledig(() => {
        if (window.Dekning) window.Dekning.forhaand();
        if (window.Skolekap) window.Skolekap.forhaand();
        lastTomtForm();
      });
    })
    .catch(() => {
      document.getElementById("toppliste").innerHTML = '<li class="tom">Klarte ikke å laste dataene.</li>';
    });
})();
