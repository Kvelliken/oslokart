/* Dekningsgrad: nedslagsfelt langs gangnettet og dekning per område */
(function () {
  "use strict";

  const GRUPPER = ["0 år", "1–5 år", "6–12 år", "13–15 år", "16–19 år", "20–29 år", "30–39 år", "40–49 år",
    "50–59 år", "60–66 år", "67–79 år", "80–89 år", "90 år +"];

  // Forslag til brukerandel (%) per aldersgruppe. Barnehage 1–5 år bruker faktisk andel når valgt.
  const FORSLAG = {
    skole: [0, 0, 100, 100, 90, 0, 0, 0, 0, 0, 0, 0, 0],
    barnehage: [0, 90, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    idrett: [0, 30, 60, 55, 45, 30, 25, 25, 20, 15, 10, 3, 0],
    helse: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 15, 40],
    kultur: [0, 10, 20, 15, 15, 15, 15, 15, 15, 15, 15, 10, 5],
    beredskap: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100]
  };

  const KAPASITET = {
    skole: { felt: "et", tekst: "elevplasser per bruker", forklaring: "Elevtall fra skoleregisteret brukes som kapasitet." },
    barnehage: { felt: "ab", tekst: "barnehageplasser per bruker", forklaring: "Antall barn i barnehagen brukes som kapasitet." }
  };
  const ANLEGG_PER = 1000;

  const LON_M = 1e-5 * 111320 * Math.cos(59.92 * Math.PI / 180);
  const LAT_M = 1e-5 * 111320;

  let api = null;
  let aktiv = false;
  let lasting = null;
  let G = null;          // grunnlag
  let N = null;          // nett
  let geo = {};          // nivå -> GeoJSON
  let flatelag = null;
  let resultat = null;   // siste beregning
  let nettCache = { nokkel: null };
  const ui = {};

  const tilstand = {
    niva: "delbydel",
    maal: "innen",
    avstand: 1000,
    andeler: lesAndeler(),
    faktiskBarnehage: true
  };

  function lesAndeler() {
    try {
      const s = JSON.parse(localStorage.getItem("oslokart.andeler") || "null");
      if (s && typeof s === "object") return Object.assign({}, JSON.parse(JSON.stringify(FORSLAG)), s);
    } catch (e) { /* ingen lagring */ }
    return JSON.parse(JSON.stringify(FORSLAG));
  }
  function lagreAndeler() {
    try { localStorage.setItem("oslokart.andeler", JSON.stringify(tilstand.andeler)); } catch (e) { /* ingen lagring */ }
  }

  // ---------- Lasting ----------
  const hent = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(url); return r.json(); });

  function last() {
    if (lasting) return lasting;
    lasting = Promise.all([hent("data/dekning_grunnlag.json?v=6"), hent("data/dekning_nett.json?v=6")])
      .then(([g, n]) => {
        G = g; N = n;
        byggNett();
        byggOmrader();
        lagAndelTabell();
        ui.status.hidden = true;
        ui.innhold.hidden = false;
        if (G.minste_niva !== "grunnkrets") {
          const o = ui.niva.querySelector('option[value="grunnkrets"]');
          o.disabled = true; o.textContent = "Grunnkrets (mangler grenser)";
        }
        ui.kilde.textContent = `Befolkning: ${G.kilde} Per 1.1.${G.aar.delbydel}. Gangnett: OpenStreetMap-bidragsytere (ODbL). ` +
          `Befolkningen i hvert område er fordelt på boligene etter antall boenheter i matrikkelen. Hver bolig knyttes til nærmeste valgte anlegg langs gangnettet.`;
        return true;
      })
      .catch(() => {
        ui.status.textContent = "Grunnlaget for dekningsgrad er ikke klart ennå. Det bygges av en jobb i repoet og kommer på plass når den er ferdig.";
        lasting = null;
        return false;
      });
    return lasting;
  }

  function hentGeo(niva) {
    if (geo[niva]) return Promise.resolve(geo[niva]);
    return hent(`data/omrader_${niva}.geojson?v=6`).then((g) => (geo[niva] = g));
  }

  // ---------- Nett ----------
  function byggNett() {
    const n = N.lon.length;
    const k = N.kanter;
    const m = k.length / 3;
    const grad = new Int32Array(n + 1);
    for (let i = 0; i < m; i++) { grad[k[3 * i]]++; grad[k[3 * i + 1]]++; }
    const start = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) start[i + 1] = start[i] + grad[i];
    const pos = start.slice(0, n);
    const til = new Int32Array(2 * m);
    const len = new Float32Array(2 * m);
    for (let i = 0; i < m; i++) {
      const a = k[3 * i], b = k[3 * i + 1], l = k[3 * i + 2];
      til[pos[a]] = b; len[pos[a]++] = l;
      til[pos[b]] = a; len[pos[b]++] = l;
    }
    N.n = n; N.start = start; N.til = til; N.len = len;
    // Rutenett for oppslag av nærmeste node
    N.celle = 500;
    N.rute = new Map();
    for (let i = 0; i < n; i++) {
      const key = Math.floor(N.lon[i] / N.celle) * 100000 + Math.floor(N.lat[i] / N.celle);
      let l = N.rute.get(key);
      if (!l) N.rute.set(key, (l = []));
      l.push(i);
    }
  }

  function naermesteNode(lat, lon) {
    const x = Math.round(lon * 1e5), y = Math.round(lat * 1e5);
    const cx = Math.floor(x / N.celle), cy = Math.floor(y / N.celle);
    let best = -1, bestD = Infinity;
    for (let r = 0; r < 6; r++) {
      for (let i = cx - r; i <= cx + r; i++) {
        for (let j = cy - r; j <= cy + r; j++) {
          if (Math.max(Math.abs(i - cx), Math.abs(j - cy)) !== r) continue;
          const l = N.rute.get(i * 100000 + j);
          if (!l) continue;
          for (const v of l) {
            const dx = (N.lon[v] - x) * LON_M, dy = (N.lat[v] - y) * LAT_M;
            const d = dx * dx + dy * dy;
            if (d < bestD) { bestD = d; best = v; }
          }
        }
      }
      if (best >= 0 && r * N.celle * LON_M > Math.sqrt(bestD)) break;
    }
    return { node: best, d: Math.sqrt(bestD) };
  }

  // Dijkstra fra alle valgte anlegg samtidig: nærmeste anlegg og avstand for hver node
  function nedslagsfelt(kilder) {
    const n = N.n;
    const dist = new Float64Array(n).fill(Infinity);
    const eier = new Int32Array(n).fill(-1);
    const hD = [], hN = [];
    const dytt = (d, v) => {
      let i = hD.length; hD.push(d); hN.push(v);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (hD[p] <= d) break;
        hD[i] = hD[p]; hN[i] = hN[p]; i = p;
      }
      hD[i] = d; hN[i] = v;
    };
    const ta = () => {
      const d = hD[0], v = hN[0];
      const ld = hD.pop(), lv = hN.pop();
      if (hD.length) {
        let i = 0;
        const len = hD.length;
        for (;;) {
          let c = 2 * i + 1;
          if (c >= len) break;
          if (c + 1 < len && hD[c + 1] < hD[c]) c++;
          if (hD[c] >= ld) break;
          hD[i] = hD[c]; hN[i] = hN[c]; i = c;
        }
        hD[i] = ld; hN[i] = lv;
      }
      return [d, v];
    };
    kilder.forEach((k, gi) => {
      if (k.d < dist[k.node]) { dist[k.node] = k.d; eier[k.node] = gi; dytt(k.d, k.node); }
    });
    const { start, til, len } = N;
    while (hD.length) {
      const [d, v] = ta();
      if (d > dist[v]) continue;
      const e = eier[v];
      for (let j = start[v]; j < start[v + 1]; j++) {
        const u = til[j], nd = d + len[j];
        if (nd < dist[u]) { dist[u] = nd; eier[u] = e; dytt(nd, u); }
      }
    }
    return { dist, eier };
  }

  // ---------- Områder ----------
  function byggOmrader() {
    G.niva = {
      grunnkrets: (o) => o.kode,
      delbydel: (o) => o.delbydel,
      bydel: (o) => String(o.bydel)
    };
  }

  // ---------- Beregning ----------
  function valgteAnlegg() {
    const anlegg = api.anleggForDekning();
    const hoved = [...new Set(anlegg.map((p) => p.f))];
    return { anlegg, hoved };
  }

  function brukerandeler(f) {
    return tilstand.andeler[f] || FORSLAG[f];
  }

  function beregn() {
    if (!G || !N || !aktiv) return;
    const { anlegg, hoved } = valgteAnlegg();
    resultat = null;
    if (!anlegg.length) {
      visMelding("Velg ett eller flere formål i kartlaget «Formål og anlegg» under for å beregne dekningsgraden.");
      tegnFlater();
      return;
    }
    if (hoved.length > 1) {
      visMelding(`Du har valgt anlegg fra flere hovedformål (${hoved.map((f) => api.FORMAL[f].navn.toLowerCase()).join(", ")}). Velg formål innenfor ett hovedformål, så brukergruppen blir riktig.`);
      tegnFlater();
      return;
    }
    const f = hoved[0];

    // Nedslagsfelt (gjenbrukes til anleggsvalget endres)
    const nokkel = anlegg.map((p) => p.id).sort((a, b) => a - b).join(",");
    if (nettCache.nokkel !== nokkel) {
      const perNode = new Map();
      const grupper = [];
      const anleggGruppe = new Map();
      anlegg.forEach((p) => {
        const s = naermesteNode(p.lat, p.lon);
        if (s.node < 0) return;
        let gi = perNode.get(s.node);
        if (gi === undefined) {
          gi = grupper.length;
          perNode.set(s.node, gi);
          grupper.push({ node: s.node, d: s.d, anlegg: [] });
        }
        grupper[gi].anlegg.push(p);
        grupper[gi].d = Math.min(grupper[gi].d, s.d);
        anleggGruppe.set(p.id, gi);
      });
      const t0 = performance.now();
      const nf = nedslagsfelt(grupper);
      nettCache = { nokkel, grupper, anleggGruppe, ...nf, ms: Math.round(performance.now() - t0) };
    }
    const { grupper, anleggGruppe, dist, eier } = nettCache;

    // Kapasitet per gruppe av anlegg på samme node
    const kap = KAPASITET[f];
    const kapasitet = grupper.map((g) => {
      if (!kap) return g.anlegg.length;
      const v = g.anlegg.map((p) => p.d[kap.felt]);
      return v.some((x) => x == null) ? null : v.reduce((s, x) => s + x, 0);
    });
    const manglerKap = kap ? anlegg.filter((p) => p.d[kap.felt] == null).length : 0;

    // Brukere per minste område
    const andel = brukerandeler(f);
    const bhAndel = G.barnehageandel_1_5 || {};
    const bhOslo = bhAndel["100000"];
    const brukereOmrade = G.omrader.map((o) => {
      let s = 0;
      for (let g = 0; g < 13; g++) {
        let a = andel[g];
        if (f === "barnehage" && g === 1 && tilstand.faktiskBarnehage) {
          const v = bhAndel[o.delbydel] != null ? bhAndel[o.delbydel] : bhOslo;
          if (v != null) a = +v;
        }
        s += o.a[g] * a / 100;
      }
      return s;
    });

    // Brukere per nedslagsfelt
    const ep = G.ep_node.length;
    const brukereGruppe = new Float64Array(grupper.length);
    const epBrukere = new Float64Array(ep);
    for (let i = 0; i < ep; i++) {
      const b = brukereOmrade[G.ep_omrade[i]] * G.ep_vekt[i];
      epBrukere[i] = b;
      const e = eier[G.ep_node[i]];
      if (e >= 0) brukereGruppe[e] += b;
    }
    const forhold = grupper.map((g, i) => (kapasitet[i] == null || brukereGruppe[i] <= 0 ? null
      : kap ? kapasitet[i] / brukereGruppe[i] : kapasitet[i] / brukereGruppe[i] * ANLEGG_PER));

    resultat = { f, anlegg, grupper, anleggGruppe, kapasitet, forhold, brukereGruppe, epBrukere, manglerKap, dist, eier, kap };
    aggreger();
  }

  function aggreger() {
    if (!resultat) return;
    const { epBrukere, forhold } = resultat;
    const { dist, eier } = nettCache;
    const nivaFn = G.niva[tilstand.niva];
    const omr = new Map();
    const tot = { brukere: 0, innen: 0, sumUD: 0, naa: 0 };
    for (let i = 0; i < epBrukere.length; i++) {
      const b = epBrukere[i];
      if (b <= 0) continue;
      const o = G.omrader[G.ep_omrade[i]];
      const k = nivaFn(o);
      let r = omr.get(k);
      if (!r) omr.set(k, (r = { brukere: 0, innen: 0, sumUD: 0, naa: 0, sumUR: 0, kjent: 0 }));
      const n = G.ep_node[i];
      const d = dist[n];
      r.brukere += b; tot.brukere += b;
      if (d <= tilstand.avstand) { r.innen += b; tot.innen += b; }
      if (isFinite(d)) { r.sumUD += b * d; r.naa += b; tot.sumUD += b * d; tot.naa += b; }
      const e = eier[n];
      if (e >= 0 && forhold[e] != null) { r.sumUR += b * forhold[e]; r.kjent += b; }
    }
    omr.forEach((r) => {
      r.v = tilstand.maal === "innen" ? (r.brukere > 0 ? r.innen / r.brukere * 100 : null)
        : tilstand.maal === "avstand" ? (r.naa > 0 ? r.sumUD / r.naa : null)
        : (r.kjent > 0 ? r.sumUR / r.kjent : null);
    });
    resultat.omr = omr;
    resultat.tot = tot;
    resultat.klasser = klasser([...omr.values()].map((r) => r.v).filter((v) => v != null));
    visResultat();
    tegnFlater();
    api.oppdaterTegnforklaring();
  }

  // ---------- Klasser og farger ----------
  function klasser(verdier) {
    const F = api.FARGE;
    const skala = [F.rod, F.gul, F.lysGronn, F.gronn, F.morkGronn];
    if (tilstand.maal === "innen") return { grenser: [50, 70, 85, 95], farger: skala, fmt: (v) => Math.round(v) + " %" };
    if (tilstand.maal === "avstand") return { grenser: [300, 600, 1000, 1500], farger: skala.slice().reverse(), fmt: (v) => api.fmt.format(Math.round(v)) + " m" };
    if (resultat.kap) return { grenser: [0.8, 0.95, 1.05, 1.2], farger: skala, fmt: (v) => v.toFixed(2).replace(".", ",") };
    // Anlegg per 1 000 brukere: kvintiler
    const s = verdier.slice().sort((a, b) => a - b);
    const q = (p) => s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0;
    const rund = (v) => (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10);
    const grenser = [q(0.2), q(0.4), q(0.6), q(0.8)].map(rund);
    return { grenser, farger: skala, fmt: (v) => (v >= 10 ? Math.round(v) : (Math.round(v * 10) / 10)).toString().replace(".", ",") };
  }

  function farge(v) {
    if (v == null) return null;
    const k = resultat.klasser;
    let i = 0;
    while (i < k.grenser.length && v >= k.grenser[i]) i++;
    return k.farger[i];
  }

  function maalTekst() {
    if (tilstand.maal === "innen") return `Andel brukere innen ${api.fmt.format(tilstand.avstand)} m`;
    if (tilstand.maal === "avstand") return "Gjennomsnittlig gangavstand";
    return resultat && resultat.kap ? resultat.kap.tekst.replace(/^./, (c) => c.toUpperCase()) : `Anlegg per ${api.fmt.format(ANLEGG_PER)} brukere`;
  }

  // ---------- Visning ----------
  function tegnFlater() {
    const kart = api.kart;
    if (flatelag) { kart.removeLayer(flatelag); flatelag = null; }
    if (!aktiv || !resultat || !resultat.omr) return;
    const niva = tilstand.niva;
    hentGeo(niva).then((gj) => {
      if (!aktiv || !resultat || niva !== tilstand.niva) return;
      if (flatelag) kart.removeLayer(flatelag);
      flatelag = L.geoJSON(gj, {
        style: (ft) => {
          const r = resultat.omr.get(String(ft.properties.kode));
          const c = r ? farge(r.v) : null;
          return { color: api.FARGE.morkBla, weight: 0.6, opacity: 0.6, fillColor: c || api.FARGE.beige, fillOpacity: c ? 0.7 : 0.4 };
        },
        onEachFeature: (ft, lag) => lag.bindPopup(() => omradePopup(ft.properties), { maxWidth: 320 })
      }).addTo(kart);
      flatelag.bringToBack();
    });
  }

  function omradePopup(p) {
    const r = resultat && resultat.omr.get(String(p.kode));
    const esc = api.esc, fmt = api.fmt;
    const navn = tilstand.niva === "bydel" ? "Bydel " + p.navn : p.navn;
    if (!r) return `<div class="popup"><h3>${esc(navn)}</h3><p>Ingen brukere i området med valgt brukergruppe.</p></div>`;
    const pst = (a, b) => (b > 0 ? Math.round(a / b * 100) + " %" : "–");
    const kapTekst = r.kjent > 0 ? resultat.klasser && tilstand.maal === "kapasitet" ? resultat.klasser.fmt(r.sumUR / r.kjent) : (r.sumUR / r.kjent).toFixed(2).replace(".", ",") : "–";
    return `<div class="popup">
      <h3>${esc(navn)}</h3>
      <p class="under">${{ grunnkrets: "Grunnkrets", delbydel: "Delbydel", bydel: "Bydel" }[tilstand.niva]}</p>
      <dl>
        <dt>Brukere</dt><dd>${fmt.format(Math.round(r.brukere))}</dd>
        <dt>Innen ${fmt.format(tilstand.avstand)} m</dt><dd>${fmt.format(Math.round(r.innen))} (${pst(r.innen, r.brukere)})</dd>
        <dt>Snitt gangavstand</dt><dd>${r.naa > 0 ? fmt.format(Math.round(r.sumUD / r.naa)) + " m" : "–"}</dd>
        <dt>${resultat.kap ? "Plasser per bruker" : "Anlegg per 1 000 brukere"}</dt><dd>${kapTekst}</dd>
      </dl>
    </div>`;
  }

  function visMelding(t) {
    ui.utvalg.textContent = t;
    ui.resultat.innerHTML = "";
    ui.liste.innerHTML = "";
    ui.listeTittel.hidden = true;
    api.oppdaterTegnforklaring();
  }

  function visResultat() {
    const fmt = api.fmt, esc = api.esc;
    const { f, anlegg, tot, manglerKap } = resultat;
    const F = api.FORMAL[f];
    const under = [...new Set(anlegg.map((p) => p.f === "idrett" ? p.t : p.u))];
    ui.utvalg.innerHTML = `Beregnet for <strong>${fmt.format(anlegg.length)}</strong> anlegg: ${esc(F.navn)}` +
      (under.length <= 4 ? ` (${esc(under.join(", "))})` : ` (${under.length} typer)`) + ".";
    const innen = tot.brukere > 0 ? Math.round(tot.innen / tot.brukere * 100) : 0;
    const snitt = tot.naa > 0 ? Math.round(tot.sumUD / tot.naa) : 0;
    ui.resultat.innerHTML = `<div class="nokkeltall">
        <div class="tall"><span>${fmt.format(Math.round(tot.brukere))}</span><small>brukere i Oslo</small></div>
        <div class="tall"><span>${innen} %</span><small>innen ${fmt.format(tilstand.avstand)} m</small></div>
      </div>
      <p class="lagmerknad">Snitt gangavstand ${fmt.format(snitt)} m.${resultat.kap ? " " + resultat.kap.forklaring : ""}${manglerKap ? ` ${fmt.format(manglerKap)} anlegg mangler kapasitetstall, og brukerne deres er holdt utenfor kapasitetsmålet.` : ""}</p>`;
    ui.avstandFelt.hidden = tilstand.maal === "avstand";

    // Lavest dekning
    const navn = {};
    (geo[tilstand.niva] ? geo[tilstand.niva].features : []).forEach((ft) => { navn[String(ft.properties.kode)] = ft.properties.navn; });
    const nivaNavn = (k) => navn[k] || (tilstand.niva === "delbydel" ? G.delbydeler[k] : null) || k;
    const rader = [...resultat.omr.entries()].filter(([, r]) => r.v != null && r.brukere >= 20);
    rader.sort((a, b) => tilstand.maal === "avstand" ? b[1].v - a[1].v : a[1].v - b[1].v);
    ui.listeTittel.hidden = false;
    ui.listeTittel.textContent = tilstand.maal === "avstand" ? "Lengst gangavstand" : "Lavest dekning";
    ui.liste.innerHTML = rader.slice(0, 12).map(([k, r]) =>
      `<li><button type="button" data-omrade="${esc(k)}"><span>${esc(nivaNavn(k))}</span><span class="areal">${resultat.klasser.fmt(r.v)}</span>
        <span class="sted">${fmt.format(Math.round(r.brukere))} brukere</span></button></li>`).join("");
    if (!geo[tilstand.niva]) hentGeo(tilstand.niva).then(() => { if (resultat) visResultat(); });
  }

  function zoomOmrade(kode) {
    if (!flatelag) return;
    flatelag.eachLayer((l) => {
      if (String(l.feature.properties.kode) === kode) {
        api.kart.fitBounds(l.getBounds(), { maxZoom: 15, padding: [30, 30] });
        l.openPopup(l.getBounds().getCenter());
      }
    });
  }

  function lagAndelTabell() {
    const f = resultat ? resultat.f : (valgteAnlegg().hoved[0] || "skole");
    const a = brukerandeler(f);
    ui.andelerTekst.textContent = `Gjelder ${api.FORMAL[f].navn.toLowerCase()}. Andelen av hver aldersgruppe som regnes som brukere. Verdiene er forslag. Juster dem selv; de huskes i nettleseren.`;
    ui.tabell.dataset.formal = f;
    ui.tabell.innerHTML = GRUPPER.map((g, i) => {
      const faktisk = f === "barnehage" && i === 1;
      return `<label class="dk-andel"><span>${g}</span>
        <input type="number" min="0" max="100" step="1" data-gruppe="${i}" value="${a[i]}" ${faktisk && tilstand.faktiskBarnehage ? "disabled" : ""}> %</label>`;
    }).join("") + (f === "barnehage" ? `<label class="avkryss dk-faktisk"><input type="checkbox" id="dk-faktisk" ${tilstand.faktiskBarnehage ? "checked" : ""}>
      Bruk faktisk andel barn i barnehage per delbydel for 1–5 år (Oslo statistikkbank, ${G ? G.aar.barnehage : ""})</label>` : "");
  }

  function tegnforklaring() {
    if (!aktiv || !resultat || !resultat.klasser) return "";
    const k = resultat.klasser;
    const rad = (c, t) => `<div><i style="background:${c}"></i>${api.esc(t)}</div>`;
    const rader = k.farger.map((c, i) => {
      const fra = i === 0 ? null : k.grenser[i - 1], til = i < k.grenser.length ? k.grenser[i] : null;
      const t = fra == null ? `under ${k.fmt(til)}` : til == null ? `${k.fmt(fra)} eller mer` : `${k.fmt(fra)}–${k.fmt(til)}`;
      return rad(c, t);
    });
    return `<p class="tf-tittel">${api.esc(maalTekst())}</p>${rader.join("")}${rad(api.FARGE.beige, "Ingen brukere")}`;
  }

  function punktInfo(p) {
    if (!resultat || !resultat.anleggGruppe) return "";
    const gi = resultat.anleggGruppe.get(p.id);
    if (gi === undefined) return "";
    const fmt = api.fmt;
    const b = resultat.brukereGruppe[gi];
    const g = resultat.grupper[gi];
    const delt = g.anlegg.length > 1 ? ` Deles med ${g.anlegg.length - 1} anlegg på samme sted.` : "";
    const k = resultat.kapasitet[gi], fh = resultat.forhold[gi];
    const kapTekst = resultat.kap ? (k == null ? "Kapasitet mangler." : `Kapasitet ${fmt.format(k)}, ${fh.toFixed(2).replace(".", ",")} plasser per bruker.`) : "";
    return `<p class="merk">Nedslagsfelt: ca. ${fmt.format(Math.round(b))} brukere.${delt} ${kapTekst}</p>`;
  }

  function koble() {
    ui.status = document.getElementById("dk-status");
    ui.innhold = document.getElementById("dk-innhold");
    ui.utvalg = document.getElementById("dk-utvalg");
    ui.niva = document.getElementById("dk-niva");
    ui.maal = document.getElementById("dk-maal");
    ui.avstand = document.getElementById("dk-avstand");
    ui.avstandVerdi = document.getElementById("dk-avstand-verdi");
    ui.avstandFelt = document.getElementById("dk-avstand-felt");
    ui.resultat = document.getElementById("dk-resultat");
    ui.tabell = document.getElementById("dk-andel-tabell");
    ui.andelerTekst = document.getElementById("dk-andeler-tekst");
    ui.liste = document.getElementById("dk-liste");
    ui.listeTittel = document.getElementById("dk-liste-tittel");
    ui.kilde = document.getElementById("dk-kilde");

    ui.niva.addEventListener("change", () => { tilstand.niva = ui.niva.value; aggreger(); });
    ui.maal.addEventListener("change", () => { tilstand.maal = ui.maal.value; aggreger(); });
    let t;
    ui.avstand.addEventListener("input", () => {
      tilstand.avstand = +ui.avstand.value;
      ui.avstandVerdi.textContent = api.fmt.format(tilstand.avstand) + " m";
      clearTimeout(t); t = setTimeout(aggreger, 120);
    });
    ui.tabell.addEventListener("change", (e) => {
      const f = ui.tabell.dataset.formal;
      if (e.target.id === "dk-faktisk") {
        tilstand.faktiskBarnehage = e.target.checked;
        lagAndelTabell();
      } else if (e.target.dataset.gruppe) {
        const v = Math.max(0, Math.min(100, +e.target.value || 0));
        e.target.value = v;
        tilstand.andeler[f] = brukerandeler(f).slice();
        tilstand.andeler[f][+e.target.dataset.gruppe] = v;
        lagreAndeler();
      }
      beregn();
    });
    document.getElementById("dk-tilbakestill").addEventListener("click", () => {
      const f = ui.tabell.dataset.formal;
      tilstand.andeler[f] = FORSLAG[f].slice();
      tilstand.faktiskBarnehage = true;
      lagreAndeler();
      lagAndelTabell();
      beregn();
    });
    ui.liste.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-omrade]");
      if (b) zoomOmrade(b.dataset.omrade);
    });
  }

  let forrigeFormal = null;
  window.Dekning = {
    start(a) { api = a; koble(); },
    modus(paa) {
      aktiv = paa;
      if (!paa) { if (flatelag) { api.kart.removeLayer(flatelag); flatelag = null; } return; }
      last().then((ok) => { if (ok) this.oppdater(); });
    },
    oppdater() {
      if (!aktiv || !G) return;
      beregn();
      const f = resultat ? resultat.f : valgteAnlegg().hoved[0];
      if (f && f !== forrigeFormal) { forrigeFormal = f; lagAndelTabell(); }
    },
    punktInfo,
    tegnforklaring
  };
})();
