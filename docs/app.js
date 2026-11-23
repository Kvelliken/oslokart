/* Kommunale tomter i Oslo – kartlogikk */
(function () {
  "use strict";

  const FARGE = {
    gul: "#f9c66b", morkBla: "#2a2859", rod: "#ff8274", morkGronn: "#034b45",
    gronn: "#4ef8b6", morkBeige: "#d0bfae", svart: "#000000"
  };

  const FORVALTER = {
    OBF: { navn: "Oslobygg KF", farge: FARGE.gul },
    EBY: { navn: "Eiendoms- og byfornyelsesetaten", farge: FARGE.morkBla },
    BBY: { navn: "Boligbygg Oslo KF", farge: FARGE.rod },
    HAV: { navn: "Oslo Havn KF", farge: FARGE.gronn }
  };
  const FORVALTER_REKKEFOLGE = ["OBF", "EBY", "BBY", "HAV"];

  const tilstand = {
    modus: "tomter",
    sok: "",
    bydel: "",
    minareal: 1000,
    forvaltere: new Set(FORVALTER_REKKEFOLGE),
    smaabygg: false,
    planlagt: false,
    marka: false,
    uregistrert: false
  };

  let data = [];
  let utvalg = [];
  const lagPerId = new Map();

  // ---------- Hjelpere ----------
  const fmt = new Intl.NumberFormat("nb-NO");
  const m2 = (v) => fmt.format(Math.round(v)) + " m²";
  const arealKort = (v) => v >= 1e6 ? fmt.format(Math.round(v / 1e5) / 10) + " km²"
    : v >= 1e4 ? fmt.format(Math.round(v / 1000)) + " daa"
    : m2(v);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

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

  function passerFellesFilter(p) {
    if (!tilstand.forvaltere.has(p.f)) return false;
    if (tilstand.bydel && p.b !== tilstand.bydel) return false;
    if (p.m2 < tilstand.minareal) return false;
    if (tilstand.sok) {
      const q = tilstand.sok;
      const adr = (p.a || "").toLowerCase();
      const navn = (p.n || "").toLowerCase();
      if (!(adr.includes(q) || navn.includes(q) || (p.e + "/").startsWith(q.replace(/\s/g, "") + "/") || p.e.startsWith(q.replace(/\s/g, "")))) return false;
    }
    return true;
  }

  const MERKNAD = /areal|merkn|ajourf|k-bild|ikke målt|veigrunn|uregistrert|rettighet/i;
  const erMerknad = (n) => !!n && MERKNAD.test(n);
  const tittel = (p) => p.a || (p.n && !erMerknad(p.n) ? p.n : "Gnr/bnr " + visningsnavn(p));

  function planinnsynLenke(p) {
    const zoom = p.m2 < 5000 ? 8 : p.m2 < 50000 ? 6 : 4;
    return `https://od2.pbe.oslo.kommune.no/kart/#${p.pe},${p.pn},${zoom}`;
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

  const renderer = L.canvas({ padding: 0.5, tolerance: 4 });
  let bakgrunnslag = null;
  let hovedlag = null;

  function stilHoved(feature) {
    const p = feature.properties;
    return {
      renderer,
      color: tilstand.modus === "tomter" ? FARGE.svart : FORVALTER[p.f].farge,
      weight: tilstand.modus === "tomter" ? 1.2 : 0.8,
      fillColor: FORVALTER[p.f].farge,
      fillOpacity: 0.7
    };
  }

  function stilBakgrunn() {
    return { renderer, color: FARGE.morkBeige, weight: 0.6, fillColor: FARGE.morkBeige, fillOpacity: 0.25, interactive: false };
  }

  function popupInnhold(p) {
    const forv = FORVALTER[p.f] ? FORVALTER[p.f].navn : p.f;
    const byggTekst = p.nb === 0 ? "Ingen registrerte"
      : `${p.nb}` + (p.nb !== p.ns ? ` (herav ${p.nb - p.ns} garasje/uthus/naust)` : "");
    const merknader = [];
    if (p.np > 0) merknader.push(`${p.np} bygg med rammetillatelse eller igangsetting registrert.`);
    if (p.fu) merknader.push("Registrert grunnforurensning i matrikkelen.");
    if (p.km) merknader.push("Registrert kulturminne i matrikkelen.");
    if (p.dt) merknader.push("Teigen deles med andre matrikkelenheter, så areal og bygg kan gjelde flere eiendommer.");
    if (p.s) merknader.push("Kommunen eier seksjoner i eiendommen, ikke hele eiendommen.");
    return `<div class="popup">
      <h3>${esc(tittel(p))}</h3>
      <p class="under">Gnr/bnr ${esc(visningsnavn(p))}${p.n && tittel(p) !== p.n ? " · " + esc(p.n) : ""}</p>
      <dl>
        <dt>Bydel</dt><dd>${esc(p.b)}${p.bb ? " (beregnet)" : ""}</dd>
        <dt>Forvalter</dt><dd>${esc(forv)}</dd>
        <dt>Areal</dt><dd>${m2(p.m2)}</dd>
        <dt>Bygninger</dt><dd>${byggTekst}</dd>
        ${p.k ? `<dt>Mest bygg av typen</dt><dd>${esc(p.k)}</dd>` : ""}
      </dl>
      ${merknader.map((m) => `<p class="merk">${esc(m)}</p>`).join("")}
      <div class="lenker">
        <a href="${planinnsynLenke(p)}" target="_blank" rel="noopener">Se regulering i Planinnsyn</a>
        <a href="${eiendomsregisterLenke(p)}" target="_blank" rel="noopener">Se eiendommen i Eiendomsregisteret</a>
      </div>
    </div>`;
  }

  function tegn() {
    if (bakgrunnslag) kart.removeLayer(bakgrunnslag);
    if (hovedlag) kart.removeLayer(hovedlag);
    lagPerId.clear();

    const ids = new Set(utvalg.map((f) => f.properties.i));
    if (tilstand.modus === "tomter") {
      bakgrunnslag = L.geoJSON({ type: "FeatureCollection", features: data }, {
        style: stilBakgrunn,
        filter: (f) => !ids.has(f.properties.i) && tilstand.forvaltere.has(f.properties.f)
      }).addTo(kart);
    } else {
      bakgrunnslag = null;
    }
    hovedlag = L.geoJSON({ type: "FeatureCollection", features: utvalg }, {
      style: stilHoved,
      onEachFeature: (f, lag) => {
        lagPerId.set(f.properties.i, lag);
        lag.bindPopup(() => popupInnhold(f.properties), { maxWidth: 340 });
      }
    }).addTo(kart);
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
    if (!lag) return;
    kart.fitBounds(lag.getBounds(), { maxZoom: 17, padding: [40, 40] });
    lag.openPopup(lag.getBounds().getCenter());
    if (window.matchMedia("(max-width: 800px)").matches) document.getElementById("panel").classList.remove("apen");
  }

  function oppdater() {
    utvalg = data.filter((f) => {
      const p = f.properties;
      if (!passerFellesFilter(p)) return false;
      return tilstand.modus === "tomter" ? erUbebygd(p) : true;
    });
    tegn();
    oppdaterTall();
    oppdaterListe();
    document.querySelectorAll(".kun-tomter").forEach((el) => { el.hidden = tilstand.modus !== "tomter"; });
  }

  function lagTegnforklaring() {
    const el = document.getElementById("tegnforklaring");
    el.innerHTML = FORVALTER_REKKEFOLGE.map((k) =>
      `<div><i style="background:${FORVALTER[k].farge}"></i>${FORVALTER[k].navn}</div>`).join("") +
      `<div class="kun-tomter"><i style="background:${FARGE.morkBeige};border-color:${FARGE.morkBeige}"></i>Annen kommunal eiendom</div>`;
  }

  function lastNedCsv() {
    const hode = ["gnr_bnr", "adresse", "bruksnavn", "bydel", "forvalter", "areal_m2", "bygg", "bygg_utenom_smaabygg", "bygg_under_arbeid", "grunnforurensning", "kulturminne", "planinnsyn", "eiendomsregisteret"];
    const rader = utvalg.map((f) => {
      const p = f.properties;
      return [visningsnavn(p), p.a || "", p.n || "", p.b, FORVALTER[p.f].navn, p.m2, p.nb, p.ns, p.np, p.fu ? "ja" : "", p.km ? "ja" : "", planinnsynLenke(p), eiendomsregisterLenke(p)];
    });
    const csv = [hode, ...rader].map((r) => r.map((v) => {
      const s = String(v);
      return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(";")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = tilstand.modus === "tomter" ? "ubebygde-kommunale-tomter.csv" : "kommunale-eiendommer.csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
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

    let t;
    document.getElementById("sok").addEventListener("input", (e) => {
      clearTimeout(t);
      t = setTimeout(() => { tilstand.sok = e.target.value.trim().toLowerCase(); oppdater(); }, 200);
    });

    ["smaabygg", "planlagt", "marka", "uregistrert"].forEach((id) => {
      document.getElementById(id).addEventListener("change", (e) => { tilstand[id] = e.target.checked; oppdater(); });
    });

    const faner = { tomter: document.getElementById("fane-tomter"), alle: document.getElementById("fane-alle") };
    Object.entries(faner).forEach(([modus, knapp]) => {
      knapp.addEventListener("click", () => {
        tilstand.modus = modus;
        Object.entries(faner).forEach(([m, k]) => { k.classList.toggle("aktiv", m === modus); k.setAttribute("aria-selected", m === modus); });
        if (modus === "alle" && tilstand.minareal === 1000) { tilstand.minareal = 0; document.getElementById("minareal").value = "0"; }
        oppdater();
      });
    });

    document.getElementById("toppliste").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-id]");
      if (b) velg(+b.dataset.id);
    });
    document.getElementById("last-ned").addEventListener("click", lastNedCsv);
    document.getElementById("vis-panel").addEventListener("click", () => document.getElementById("panel").classList.toggle("apen"));
  }

  fetch("data/eiendommer.geojson")
    .then((r) => r.json())
    .then((gj) => {
      data = gj.features;
      lagTegnforklaring();
      koble();
      oppdater();
    })
    .catch(() => {
      document.getElementById("toppliste").innerHTML = '<li class="tom">Klarte ikke å laste dataene.</li>';
    });
})();
