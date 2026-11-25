/* Skolekapasitet: fyllingsgrad per barneskolekrets, med kapasitet lagt inn i nettleseren */
(function () {
  "use strict";

  const LAGER = "oslokart.skolekapasitet";
  const BARN = 2;              // aldersgruppen 6–12 år i befolkningsgrunnlaget
  const STANDARD_TERSKLER = [85, 95, 100];

  let api = null;
  let aktiv = false;
  let lasting = null;
  let kretser = [];            // [{k, s, o, geo, ringer, boks, skoler, udir, anslatt, barn: {aar: n}}]
  let kretslag = null;
  let skolelag = null;
  let befolkning = null;       // {aar: [...], basis}
  let hentetUdir = "";
  const ui = {};
  const lagPerKrets = new Map();

  const tilstand = Object.assign({ kap: {}, elever: {}, terskler: STANDARD_TERSKLER.slice() }, lesLager());
  let aar = "";
  let sortering = "fylling";
  let visSkoler = true;
  let rekkefolge = null;       // fast rekkefølge mens man skriver inn tall

  function lesLager() {
    try {
      const l = JSON.parse(localStorage.getItem(LAGER) || "null");
      if (l && typeof l === "object") return { kap: l.kap || {}, elever: l.elever || {}, terskler: Array.isArray(l.terskler) && l.terskler.length === 3 ? l.terskler : STANDARD_TERSKLER.slice() };
    } catch (e) { /* ingen lagring */ }
    return {};
  }
  function lagre() {
    try { localStorage.setItem(LAGER, JSON.stringify(tilstand)); } catch (e) { /* ingen lagring */ }
  }

  // ---------- Data ----------
  const hent = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(url); return r.json(); });

  function last() {
    if (lasting) return lasting;
    lasting = Promise.all([hent("data/skolekretser.geojson?v=11"), hent("data/skoler.json?v=11")])
      .then(([gj, sk]) => {
        hentetUdir = sk.hentet;
        const perOrgnr = new Map();
        sk.poster.forEach((p) => perOrgnr.set(p.o, p));
        (sk.uten_plassering || []).forEach((p) => perOrgnr.set(p.o, p));
        kretser = gj.features.map((f) => {
          const p = f.properties;
          const skoler = p.o.map((o) => perOrgnr.get(o)).filter(Boolean);
          const flater = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
          let boks = [Infinity, Infinity, -Infinity, -Infinity];
          flater.forEach((fl) => fl[0].forEach(([x, y]) => {
            boks = [Math.min(boks[0], x), Math.min(boks[1], y), Math.max(boks[2], x), Math.max(boks[3], y)];
          }));
          // Elever på barnetrinnet: hele elevtallet for rene barneskoler, ellers andel av trinnene 1–7
          let udir = null, anslatt = false;
          if (skoler.length && skoler.every((s) => s.et != null)) {
            udir = skoler.reduce((sum, s) => {
              const fra = s.gf || 1, til = s.gt || 7;
              if (til <= 7) return sum + s.et;
              anslatt = true;
              const barnetrinn = Math.max(0, Math.min(7, til) - fra + 1);
              return sum + s.et * barnetrinn / (til - fra + 1);
            }, 0);
            udir = Math.round(udir);
          }
          return { k: p.k, s: p.s, geo: f, flater, boks, skoler, udir, anslatt, barn: {} };
        });
        tegnSkoler();
        return true;
      })
      .catch(() => {
        ui.status.textContent = "Klarte ikke å laste skolekretsene.";
        ui.status.hidden = false;
        lasting = null;
        return false;
      });
    return lasting;
  }

  // Barn 6–12 år bosatt i hver krets, i dag og framskrevet (samme befolkningsgrunnlag som Dekningsgrad)
  function lastBefolkning() {
    if (!window.Dekning || !window.Dekning.grunnlag) return Promise.resolve(false);
    return window.Dekning.grunnlag().then((g) => {
      if (!g || befolkning) return !!g;
      const { G, N } = g;
      const fr = G.framskriving || { aar: [], faktor: {} };
      const aarListe = fr.aar.map(String);
      const sum = kretser.map(() => ({ "": 0 }));
      const nKrets = kretser.length;
      let utenfor = 0;
      for (let i = 0; i < G.ep_node.length; i++) {
        const o = G.omrader[G.ep_omrade[i]];
        const b = o.a[BARN] * G.ep_vekt[i];
        if (b <= 0) continue;
        const node = G.ep_node[i];
        const x = N.lon[node] / 1e5, y = N.lat[node] / 1e5;
        let treff = -1;
        for (let k = 0; k < nKrets && treff < 0; k++) {
          const kr = kretser[k], bx = kr.boks;
          if (x < bx[0] || x > bx[2] || y < bx[1] || y > bx[3]) continue;
          if (inni(kr.flater, x, y)) treff = k;
        }
        if (treff < 0) { utenfor += b; continue; }
        const s = sum[treff];
        s[""] += b;
        aarListe.forEach((a) => {
          const f = fr.faktor[a] && fr.faktor[a][o.delbydel];
          s[a] = (s[a] || 0) + b * (f ? f[BARN] : 1);
        });
      }
      kretser.forEach((kr, k) => { kr.barn = sum[k]; });
      befolkning = { aar: aarListe, basis: G.aar.delbydel, utenfor };
      ui.aar.innerHTML = `<option value="">I dag</option>` + aarListe.map((a) => `<option value="${a}">Framskrevet ${a}</option>`).join("");
      ui.aar.value = aar;
      ui.aar.disabled = false;
      return true;
    });
  }

  function inni(flater, x, y) {
    let inne = false;
    for (const fl of flater) {
      let iRing = false;
      fl.forEach((ring, r) => {
        let c = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi, yi] = ring[i], [xj, yj] = ring[j];
          if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
        }
        if (r === 0) iRing = c; else if (c) iRing = false;
      });
      if (iRing) inne = true;
    }
    return inne;
  }

  // ---------- Beregning ----------
  function eleverIDag(kr) {
    const egen = tilstand.elever[kr.k];
    return egen != null ? egen : kr.udir;
  }

  function verdier(kr) {
    const idag = eleverIDag(kr);
    let elever = idag;
    if (idag != null && aar) {
      const b0 = kr.barn[""], b1 = kr.barn[aar];
      elever = b0 > 0 && b1 != null ? idag * b1 / b0 : idag;
    }
    const kap = tilstand.kap[kr.k];
    const fylling = elever != null && kap > 0 ? elever / kap * 100 : null;
    return { idag, elever, kap: kap > 0 ? kap : null, fylling };
  }

  function klasse(fylling) {
    if (fylling == null) return 4;
    const t = tilstand.terskler;
    return fylling < t[0] ? 0 : fylling < t[1] ? 1 : fylling < t[2] ? 2 : 3;
  }

  function farger() {
    const F = api.FARGE;
    return [F.gronn, F.gul, F.rod, F.morkBla, F.beige];
  }

  function klasseTekster() {
    const [a, b, c] = tilstand.terskler;
    return [`Under ${a} %`, `${a}–${b} %`, `${b}–${c} %`, `${c} % eller mer`, "Kapasitet ikke lagt inn"];
  }

  // ---------- Kart ----------
  function stil(kr) {
    const v = verdier(kr);
    const kl = klasse(v.fylling);
    return { color: api.FARGE.morkBla, weight: 1, opacity: 0.9, fillColor: farger()[kl], fillOpacity: kl === 4 ? 0.35 : 0.6 };
  }

  function tegnKretser() {
    if (!kretslag) {
      kretslag = L.featureGroup();
      kretser.forEach((kr) => {
        const lag = L.geoJSON(kr.geo, { style: () => stil(kr) });
        lag.bindPopup(() => popup(kr), { maxWidth: 320 });
        lag.bindTooltip(kr.k, { sticky: true });
        lag.on("mouseover", () => lag.setStyle({ weight: 3 }));
        lag.on("mouseout", () => lag.setStyle({ weight: 1 }));
        lagPerKrets.set(kr.k, lag);
        kretslag.addLayer(lag);
      });
    }
    kretser.forEach((kr) => lagPerKrets.get(kr.k).setStyle(stil(kr)));
    if (aktiv && !api.kart.hasLayer(kretslag)) kretslag.addTo(api.kart);
  }

  function tegnSkoler() {
    if (skolelag) api.kart.removeLayer(skolelag);
    skolelag = L.layerGroup();
    kretser.forEach((kr) => kr.skoler.filter((s) => s.lat).forEach((s) => {
      L.circleMarker([s.lat, s.lon], {
        radius: 4, color: api.FARGE.svart, weight: 1, fillColor: api.FARGE.hvit, fillOpacity: 1, interactive: false
      }).addTo(skolelag);
    }));
    if (aktiv && visSkoler) skolelag.addTo(api.kart);
  }

  const tall = (n) => (n == null ? "–" : api.fmt.format(Math.round(n)));

  function popup(kr) {
    const esc = api.esc, v = verdier(kr);
    const egen = tilstand.elever[kr.k] != null;
    const kilde = egen ? "lagt inn av deg" : kr.udir == null ? "mangler i Udir" : kr.anslatt ? "anslått barnetrinn ut fra Udir" : `Udir, ${dato(hentetUdir)}`;
    const barn = befolkning ? `<dt>Barn 6–12 år bosatt</dt><dd>${tall(kr.barn[""])}${aar ? ` → ${tall(kr.barn[aar])} i ${aar}` : ""}</dd>` : "";
    return `<div class="popup sk-popup" data-krets="${esc(kr.k)}">
      <h3>${esc(kr.k)}</h3>
      <p class="under">${esc(kr.s.join(", "))}</p>
      <dl>
        <dt>Elever i dag</dt><dd>${tall(v.idag)} <span class="sk-kilde">(${esc(kilde)})</span></dd>
        ${aar ? `<dt>Elever ${aar}</dt><dd>${tall(v.elever)}</dd>` : ""}
        ${barn}
        <dt>Kapasitet</dt><dd>${tall(v.kap)}</dd>
        <dt>Fyllingsgrad</dt><dd>${v.fylling == null ? "–" : Math.round(v.fylling) + " %"}</dd>
      </dl>
      <label class="felt"><span>Kapasitet (elever)</span><input type="number" min="0" step="1" data-sk-kap value="${v.kap == null ? "" : v.kap}"></label>
      <label class="felt"><span>Elever i dag på barnetrinnet (overstyr Udir)</span><input type="number" min="0" step="1" data-sk-elever value="${egen ? tilstand.elever[kr.k] : ""}" placeholder="${kr.udir == null ? "" : kr.udir}"></label>
    </div>`;
  }

  const dato = (iso) => { if (!iso) return ""; const [y, m, d] = iso.split("-"); return `${d}.${m}.${y}`; };

  // ---------- Panel ----------
  function sorter() {
    const mapV = new Map(kretser.map((kr) => [kr.k, verdier(kr)]));
    const liste = [...kretser];
    if (sortering === "navn") liste.sort((a, b) => a.k.localeCompare(b.k, "nb"));
    else liste.sort((a, b) => {
      const fa = mapV.get(a.k).fylling, fb = mapV.get(b.k).fylling;
      if (fa == null && fb == null) return a.k.localeCompare(b.k, "nb");
      if (fa == null) return 1;
      if (fb == null) return -1;
      return fb - fa;
    });
    rekkefolge = liste.map((kr) => kr.k);
  }

  function radHtml(kr) {
    const v = verdier(kr), kl = klasse(v.fylling), esc = api.esc;
    return `<li data-krets="${esc(kr.k)}">
      <button type="button" class="sk-navn" data-vis="${esc(kr.k)}"><span class="prikk" style="background:${farger()[kl]}"></span>${esc(kr.k)}</button>
      <span class="sk-elever" title="Elever ${aar || "i dag"}">${tall(v.elever)}${!aar && kr.anslatt && tilstand.elever[kr.k] == null ? "*" : ""}</span>
      <input type="number" min="0" step="1" inputmode="numeric" aria-label="Kapasitet ${esc(kr.k)}" data-kap="${esc(kr.k)}" value="${v.kap == null ? "" : v.kap}" placeholder="–">
      <span class="sk-fylling">${v.fylling == null ? "" : Math.round(v.fylling) + " %"}</span>
    </li>`;
  }

  function tegnListe() {
    if (!rekkefolge) sorter();
    const perNavn = new Map(kretser.map((kr) => [kr.k, kr]));
    ui.liste.innerHTML = rekkefolge.map((k) => radHtml(perNavn.get(k))).join("");
  }

  // Oppdaterer en rad på plass, uten å flytte den (unngår at listen hopper mens man skriver)
  function oppdaterRad(kr) {
    const li = ui.liste.querySelector(`li[data-krets="${CSS.escape(kr.k)}"]`);
    if (!li) return;
    const v = verdier(kr);
    li.querySelector(".prikk").style.background = farger()[klasse(v.fylling)];
    li.querySelector(".sk-elever").textContent = tall(v.elever) + (!aar && kr.anslatt && tilstand.elever[kr.k] == null ? "*" : "");
    li.querySelector(".sk-fylling").textContent = v.fylling == null ? "" : Math.round(v.fylling) + " %";
    const inp = li.querySelector("[data-kap]");
    if (document.activeElement !== inp) inp.value = v.kap == null ? "" : v.kap;
  }

  function oppsummer() {
    let elever = 0, kap = 0, medKap = 0;
    const antall = [0, 0, 0, 0, 0];
    kretser.forEach((kr) => {
      const v = verdier(kr);
      antall[klasse(v.fylling)]++;
      if (v.fylling != null) { medKap++; elever += v.elever; kap += v.kap; }
    });
    const fmt = api.fmt;
    // Samme oppsett med og uten kapasitet, så listen under ikke flytter seg når første tall skrives inn
    ui.tall.innerHTML = `<div class="tall"><span>${medKap ? Math.round(elever / kap * 100) + " %" : "–"}</span>
        <small>samlet fyllingsgrad ${aar || "i dag"}</small><small class="sk-detalj">${medKap ? `${fmt.format(medKap)} av ${fmt.format(kretser.length)} kretser` : "ingen kapasitet ennå"}</small></div>
      <div class="tall"><span>${medKap ? fmt.format(antall[2] + antall[3]) : "–"}</span>
        <small>kretser på ${tilstand.terskler[1]} % eller mer</small><small class="sk-detalj">${medKap ? `av ${fmt.format(medKap)} med kapasitet` : "ingen kapasitet ennå"}</small></div>`;
    api.oppdaterTegnforklaring();
  }

  function oppdaterAlt(nySortering) {
    if (!kretser.length) return;
    if (nySortering) sorter();
    tegnKretser();
    tegnListe();
    oppsummer();
  }

  function oppdaterKrets(kr) {
    const lag = lagPerKrets.get(kr.k);
    if (lag) lag.setStyle(stil(kr));
    oppdaterRad(kr);
    oppsummer();
  }

  function visKrets(navn) {
    const lag = lagPerKrets.get(navn);
    if (!lag) return;
    api.kart.fitBounds(lag.getBounds(), { maxZoom: 15, padding: [30, 30] });
    lag.openPopup(lag.getBounds().getCenter());
  }

  // ---------- CSV ----------
  function lastNed() {
    const hode = ["krets", "skole", "kapasitet", "elever_i_dag_overstyrt", "elever_i_dag", "kilde_elevtall"];
    if (aar) hode.push(`elever_${aar}`);
    hode.push(`fyllingsgrad_${aar || "i_dag"}`);
    const rader = [...kretser].sort((a, b) => a.k.localeCompare(b.k, "nb")).map((kr) => {
      const v = verdier(kr);
      const kilde = tilstand.elever[kr.k] != null ? "egen" : kr.udir == null ? "" : kr.anslatt ? "Udir (anslått barnetrinn)" : "Udir";
      const rad = [kr.k, kr.s.join(", "), v.kap == null ? "" : v.kap, tilstand.elever[kr.k] == null ? "" : tilstand.elever[kr.k],
        v.idag == null ? "" : v.idag, kilde];
      if (aar) rad.push(v.elever == null ? "" : Math.round(v.elever));
      rad.push(v.fylling == null ? "" : String(Math.round(v.fylling * 10) / 10).replace(".", ","));
      return rad;
    });
    const tekst = [hode, ...rader].map((r) => r.map((x) => {
      const s = String(x);
      return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + tekst], { type: "text/csv;charset=utf-8" }));
    a.download = "skolekapasitet.csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  function parseCsv(tekst) {
    tekst = tekst.replace(/^﻿/, "");
    const forste = tekst.split(/\r?\n/, 1)[0];
    const skille = (forste.match(/;/g) || []).length >= (forste.match(/,/g) || []).length ? ";" : (forste.includes("\t") ? "\t" : ",");
    const rader = [];
    let rad = [], felt = "", sitat = false;
    for (let i = 0; i < tekst.length; i++) {
      const c = tekst[i];
      if (sitat) {
        if (c === '"' && tekst[i + 1] === '"') { felt += '"'; i++; } else if (c === '"') sitat = false; else felt += c;
      } else if (c === '"') sitat = true;
      else if (c === skille) { rad.push(felt); felt = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && tekst[i + 1] === "\n") i++;
        rad.push(felt); felt = "";
        if (rad.some((x) => x.trim())) rader.push(rad);
        rad = [];
      } else felt += c;
    }
    rad.push(felt);
    if (rad.some((x) => x.trim())) rader.push(rad);
    return rader;
  }

  const tallFra = (s) => {
    const t = String(s || "").replace(/[\s ]/g, "").replace(",", ".");
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : NaN;
  };
  const nokkel = (s) => String(s || "").toLowerCase().replace(/\s+skole\b/g, "").replace(/\s+/g, " ").trim();

  function lesInn(fil) {
    const r = new FileReader();
    r.onload = () => {
      const rader = parseCsv(String(r.result));
      if (rader.length < 2) { ui.filStatus.textContent = "Fant ingen rader i filen."; return; }
      const hode = rader[0].map((h) => h.trim().toLowerCase());
      const kol = (...navn) => hode.findIndex((h) => navn.some((n) => h === n || h.startsWith(n)));
      const iKrets = kol("krets", "skolekrets", "skretsnavn"), iSkole = kol("skole"), iKap = kol("kapasitet", "kap");
      const iElev = kol("elever_i_dag_overstyrt", "elever_overstyrt");
      if (iKap < 0 || (iKrets < 0 && iSkole < 0)) {
        ui.filStatus.textContent = "Filen må ha en kolonne «kapasitet» og en kolonne «krets» eller «skole».";
        return;
      }
      const perKrets = new Map(kretser.map((kr) => [nokkel(kr.k), kr]));
      const perSkole = new Map();
      kretser.forEach((kr) => kr.s.forEach((s) => perSkole.set(nokkel(s), kr)));
      let ok = 0;
      const ukjent = [], feil = [];
      rader.slice(1).forEach((rad) => {
        const kr = (iKrets >= 0 && perKrets.get(nokkel(rad[iKrets]))) || (iSkole >= 0 && perSkole.get(nokkel(rad[iSkole])));
        const navn = (iKrets >= 0 ? rad[iKrets] : rad[iSkole]) || "";
        if (!kr) { if (navn.trim()) ukjent.push(navn.trim()); return; }
        const kap = tallFra(rad[iKap]);
        if (Number.isNaN(kap)) { feil.push(navn.trim()); return; }
        if (kap == null) delete tilstand.kap[kr.k]; else tilstand.kap[kr.k] = kap;
        if (iElev >= 0) {
          const e = tallFra(rad[iElev]);
          if (e == null) delete tilstand.elever[kr.k]; else if (!Number.isNaN(e)) tilstand.elever[kr.k] = e;
        }
        ok++;
      });
      lagre();
      oppdaterAlt(true);
      ui.filStatus.textContent = `Leste inn ${api.fmt.format(ok)} kretser.` +
        (ukjent.length ? ` Fant ikke ${ukjent.length}: ${ukjent.slice(0, 5).join(", ")}${ukjent.length > 5 ? " …" : ""}.` : "") +
        (feil.length ? ` Ugyldig kapasitet for ${feil.join(", ")}.` : "");
    };
    r.readAsText(fil, "utf-8");
  }

  // ---------- Terskler ----------
  function settTerskler() {
    const t = ui.terskler.map((el) => +el.value);
    if (t.some((x) => !Number.isFinite(x) || x <= 0) || !(t[0] < t[1] && t[1] < t[2])) {
      ui.terskelFeil.textContent = "Grensene må øke fra grønn til gul til rød.";
      return;
    }
    ui.terskelFeil.textContent = "";
    tilstand.terskler = t;
    lagre();
    oppdaterAlt(true);
  }

  // ---------- Tegnforklaring ----------
  function tegnforklaring() {
    if (!aktiv || !kretser.length) return "";
    const esc = api.esc, f = farger(), tekster = klasseTekster();
    return `<p class="tf-tittel">Fyllingsgrad ${aar ? aar : "i dag"}</p>` +
      f.map((c, i) => `<div><i style="background:${c}"></i>${esc(tekster[i])}</div>`).join("") +
      (visSkoler ? '<div><i class="rund" style="background:#fff"></i>Skole</div>' : "");
  }

  // ---------- Kobling ----------
  function koble() {
    const $ = (id) => document.getElementById(id);
    Object.assign(ui, {
      status: $("sk-status"), innhold: $("sk-innhold"), aar: $("sk-aar"), sortering: $("sk-sortering"),
      tall: $("sk-tall"), liste: $("sk-liste"), fil: $("sk-fil"), filStatus: $("sk-fil-status"),
      terskler: [$("sk-t1"), $("sk-t2"), $("sk-t3")], terskelFeil: $("sk-terskel-feil"), kilde: $("sk-kilde")
    });
    ui.terskler.forEach((el, i) => { el.value = tilstand.terskler[i]; el.addEventListener("change", settTerskler); });
    ui.aar.addEventListener("change", () => { aar = ui.aar.value; oppdaterAlt(true); });
    ui.sortering.addEventListener("change", () => { sortering = ui.sortering.value; oppdaterAlt(true); });
    $("sk-vis-skoler").addEventListener("change", (e) => {
      visSkoler = e.target.checked;
      if (skolelag) { if (visSkoler && aktiv) skolelag.addTo(api.kart); else api.kart.removeLayer(skolelag); }
      api.oppdaterTegnforklaring();
    });
    $("sk-last-ned").addEventListener("click", lastNed);
    $("sk-last-inn").addEventListener("click", () => ui.fil.click());
    ui.fil.addEventListener("change", () => { if (ui.fil.files[0]) lesInn(ui.fil.files[0]); ui.fil.value = ""; });
    $("sk-nullstill").addEventListener("click", () => {
      if (!window.confirm("Fjerne all kapasitet og alle overstyrte elevtall som er lagret i denne nettleseren?")) return;
      tilstand.kap = {};
      tilstand.elever = {};
      lagre();
      oppdaterAlt(true);
      ui.filStatus.textContent = "All kapasitet er fjernet.";
    });

    const settVerdi = (felt, navn, verdi) => {
      const kr = kretser.find((k) => k.k === navn);
      if (!kr) return;
      const n = tallFra(verdi);
      if (n == null) delete tilstand[felt][navn];
      else if (!Number.isNaN(n)) tilstand[felt][navn] = n;
      lagre();
      oppdaterKrets(kr);
    };
    ui.liste.addEventListener("input", (e) => {
      const el = e.target.closest("[data-kap]");
      if (el) settVerdi("kap", el.dataset.kap, el.value);
    });
    // Enter hopper til neste krets, så det går raskt å skrive inn mange tall
    ui.liste.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || !e.target.matches("[data-kap]")) return;
      e.preventDefault();
      const neste = e.target.closest("li").nextElementSibling;
      if (neste) neste.querySelector("[data-kap]").focus();
    });
    ui.liste.addEventListener("click", (e) => {
      const b = e.target.closest("[data-vis]");
      if (b) visKrets(b.dataset.vis);
    });
    // Feltene i kretsens popup
    api.kart.on("popupopen", (e) => {
      const el = e.popup.getElement();
      const boks = el && el.querySelector(".sk-popup");
      if (!boks) return;
      const navn = boks.dataset.krets;
      L.DomEvent.disableClickPropagation(boks);
      boks.querySelector("[data-sk-kap]").addEventListener("change", (ev) => { settVerdi("kap", navn, ev.target.value); e.popup.setContent(popup(kretser.find((k) => k.k === navn))); });
      boks.querySelector("[data-sk-elever]").addEventListener("change", (ev) => { settVerdi("elever", navn, ev.target.value); e.popup.setContent(popup(kretser.find((k) => k.k === navn))); });
    });
  }

  window.Skolekap = {
    start(a) { api = a; koble(); },
    modus(paa) {
      aktiv = paa;
      if (!paa) {
        if (kretslag) api.kart.removeLayer(kretslag);
        if (skolelag) api.kart.removeLayer(skolelag);
        return;
      }
      last().then((ok) => {
        if (!ok || !aktiv) return;
        ui.status.hidden = true;
        ui.innhold.hidden = false;
        if (skolelag && visSkoler) skolelag.addTo(api.kart);
        oppdaterAlt(!rekkefolge);
        lastBefolkning().then((ok2) => {
          ui.kilde.textContent = `Skolekretser: Plan- og bygningsetaten, Oslo kommune (barneskolekretser, juni 2026). ` +
            `Elevtall: Udir, Nasjonalt skoleregister (hentet ${dato(hentetUdir)}). For skoler med både barne- og ungdomstrinn er elevene på barnetrinnet anslått ut fra antall trinn (*). ` +
            (ok2 ? `Framskriving: dagens elevtall ganget med endringen i antall barn 6–12 år bosatt i kretsen (Oslo kommune, befolkningsframskriving, mellomalternativet).` : "Framskrivingen kunne ikke lastes.") +
            " Kapasitet og overstyrte elevtall lagres bare i denne nettleseren.";
          if (ok2 && aktiv) oppdaterAlt(false);
        });
      });
    },
    forhaand() { last(); },
    tegnforklaring
  };
})();
