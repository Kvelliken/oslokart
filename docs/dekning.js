/* Udekket behov: hvor bor brukerne for langt fra tilbudet, og hvor gir et nytt tilbud mest nytte? */
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
  // Forslag til akseptabel gangavstand (m) per hovedformål
  const AVSTAND = { skole: 1000, barnehage: 600, idrett: 1500, helse: 1000, kultur: 1500, beredskap: 3000 };

  const KAPASITET = {
    skole: { felt: "et", tekst: "elevplasser" },
    barnehage: { felt: "ab", tekst: "barnehageplasser" }
  };

  const LON_M = 1e-5 * 111320 * Math.cos(59.92 * Math.PI / 180);
  const LAT_M = 1e-5 * 111320;

  let api = null;
  let aktiv = false;
  let lasting = null;
  let G = null;
  let N = null;
  const geo = {};
  let rutelag = null;
  let forslagslag = null;
  let markering = null;
  let R = null;
  let nettCache = { nokkel: null };
  let forrigeFormal = null;
  let regnerForslag = 0;
  const ui = {};

  const tilstand = {
    niva: "delbydel",
    avstand: 1000,
    avstandSatt: false,
    aar: "",
    kap: true,
    marka: false,
    kandidat: "rute",
    tomtAreal: 1000,
    antall: 3,
    maks: null,
    andeler: lesAndeler(),
    faktiskBarnehage: true
  };

  function lesAndeler() {
    const s = JSON.parse(JSON.stringify(FORSLAG));
    try {
      const l = JSON.parse(localStorage.getItem("oslokart.andeler") || "null");
      if (l && typeof l === "object") Object.assign(s, l);
    } catch (e) { /* ingen lagring */ }
    return s;
  }
  function lagreAndeler() {
    try { localStorage.setItem("oslokart.andeler", JSON.stringify(tilstand.andeler)); } catch (e) { /* ingen lagring */ }
  }

  // ---------- Lasting ----------
  const hent = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(url); return r.json(); });

  function last() {
    if (lasting) return lasting;
    lasting = Promise.all([hent("data/dekning_grunnlag.json?v=8"), hent("data/dekning_nett.json?v=8")])
      .then(([g, n]) => {
        G = g; N = n;
        byggNett();
        forberedRuter();
        const fr = G.framskriving || { aar: [] };
        ui.aar.innerHTML = `<option value="">I dag (${G.aar.delbydel})</option>` +
          fr.aar.map((a) => `<option value="${a}">Framskrevet ${a}</option>`).join("");
        if (G.minste_niva !== "grunnkrets") ui.niva.querySelector('option[value="grunnkrets"]').remove();
        ui.status.hidden = true;
        ui.innhold.hidden = false;
        ui.kilde.textContent = `Befolkning: ${G.kilde} Framskriving: mellomalternativet, fordelt på grunnkretsene etter endringen i delbydelen. ` +
          "Gangnett: OpenStreetMap-bidragsytere (ODbL). Befolkningen i hvert område er fordelt på boligene etter antall boenheter i matrikkelen. " +
          "Hver bolig knyttes til nærmeste valgte tilbud langs gangnettet. Ruter: 250 × 250 m.";
        lagAndelTabell();
        return true;
      })
      .catch(() => {
        ui.status.textContent = "Grunnlaget for dekningsgrad er ikke klart ennå. Det bygges av en jobb i repoet.";
        lasting = null;
        return false;
      });
    return lasting;
  }

  function hentGeo(niva) {
    if (geo[niva]) return Promise.resolve(geo[niva]);
    return hent(`data/omrader_${niva}.geojson?v=8`).then((g) => (geo[niva] = g));
  }

  // ---------- Nett ----------
  function byggNett() {
    const n = N.lon.length;
    const k = N.kanter;
    const m = k.length / 3;
    const grad = new Int32Array(n);
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
    N.celle = 500;
    N.rute = new Map();
    for (let i = 0; i < n; i++) {
      const key = Math.floor(N.lon[i] / N.celle) * 100000 + Math.floor(N.lat[i] / N.celle);
      let l = N.rute.get(key);
      if (!l) N.rute.set(key, (l = []));
      l.push(i);
    }
    N.wDist = new Float64Array(n);
    N.wStempel = new Int32Array(n);
    N.stempel = 0;
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

  // Binær haug på parallelle tabeller
  const HD = [], HV = [];
  let sisteD = 0;
  function hTom() { HD.length = 0; HV.length = 0; }
  function hDytt(d, v) {
    let i = HD.length; HD.push(d); HV.push(v);
    while (i > 0) { const p = (i - 1) >> 1; if (HD[p] <= d) break; HD[i] = HD[p]; HV[i] = HV[p]; i = p; }
    HD[i] = d; HV[i] = v;
  }
  function hTa() {
    const d = HD[0], v = HV[0];
    const ld = HD.pop(), lv = HV.pop();
    if (HD.length) {
      let i = 0; const len = HD.length;
      for (;;) {
        let c = 2 * i + 1; if (c >= len) break;
        if (c + 1 < len && HD[c + 1] < HD[c]) c++;
        if (HD[c] >= ld) break;
        HD[i] = HD[c]; HV[i] = HV[c]; i = c;
      }
      HD[i] = ld; HV[i] = lv;
    }
    sisteD = d;
    return v;
  }

  // Fra alle eksisterende tilbud samtidig: nærmeste tilbud og avstand for hver node
  function nedslagsfelt(kilder) {
    const n = N.n;
    const dist = new Float64Array(n).fill(Infinity);
    const eier = new Int32Array(n).fill(-1);
    hTom();
    kilder.forEach((k, gi) => { if (k.d < dist[k.node]) { dist[k.node] = k.d; eier[k.node] = gi; hDytt(k.d, k.node); } });
    const { start, til, len } = N;
    while (HD.length) {
      const v = hTa(), d = sisteD;
      if (d > dist[v]) continue;
      const e = eier[v];
      for (let j = start[v]; j < start[v + 1]; j++) {
        const u = til[j], nd = d + len[j];
        if (nd < dist[u]) { dist[u] = nd; eier[u] = e; hDytt(nd, u); }
      }
    }
    return { dist, eier };
  }

  // Avgrenset Dijkstra fra én node; kaller besok(node) for hver node innen maks meter
  function avgrenset(kilde, maks, besok) {
    const { start, til, len, wDist, wStempel } = N;
    const st = ++N.stempel;
    hTom();
    wDist[kilde] = 0; wStempel[kilde] = st; hDytt(0, kilde);
    while (HD.length) {
      const v = hTa(), d = sisteD;
      if (d > wDist[v]) continue;
      besok(v);
      for (let j = start[v]; j < start[v + 1]; j++) {
        const u = til[j], nd = d + len[j];
        if (nd > maks) continue;
        if (wStempel[u] !== st || nd < wDist[u]) { wStempel[u] = st; wDist[u] = nd; hDytt(nd, u); }
      }
    }
  }

  // ---------- Ruter ----------
  function forberedRuter() {
    const C = G.celler;
    const n = C.node.length;
    C.n = n;
    const best = new Float64Array(n), db = new Array(n).fill(null);
    for (let i = 0; i < G.ep_node.length; i++) {
      const c = G.ep_celle[i], w = G.ep_vekt[i];
      if (w > best[c]) { best[c] = w; db[c] = G.omrader[G.ep_omrade[i]].delbydel; }
    }
    C.delbydel = db;
  }

  function cellebokser(c) {
    const C = G.celler;
    return [[C.sw_lat[c] / 1e5, C.sw_lon[c] / 1e5], [C.ne_lat[c] / 1e5, C.ne_lon[c] / 1e5]];
  }

  // ---------- Beregning av udekket behov ----------
  function valgteTilbud() {
    const anlegg = api.anleggForDekning();
    return { anlegg, hoved: [...new Set(anlegg.map((p) => p.f))] };
  }

  const brukerandeler = (f) => tilstand.andeler[f] || FORSLAG[f];

  function beregn() {
    if (!G || !N || !aktiv) return;
    nullstillForslag();
    const { anlegg, hoved } = valgteTilbud();
    R = null;
    if (!anlegg.length) {
      visMelding("Velg tilbudet du vil se på i kartlaget «Formål og anlegg» under, for eksempel Barnehage eller Bandybane.");
      return;
    }
    if (hoved.length > 1) {
      visMelding(`Du har valgt tilbud fra flere hovedformål (${hoved.map((f) => api.FORMAL[f].navn.toLowerCase()).join(", ")}). Velg innenfor ett hovedformål, så brukergruppen blir riktig.`);
      return;
    }
    const f = hoved[0];
    if (f !== forrigeFormal) {
      forrigeFormal = f;
      if (!tilstand.avstandSatt) settAvstand(AVSTAND[f] || 1000);
      lagAndelTabell();
    }
    const kap = KAPASITET[f];
    ui.kapFelt.hidden = !kap;

    const nokkel = anlegg.map((p) => p.id).sort((a, b) => a - b).join(",");
    if (nettCache.nokkel !== nokkel) {
      const perNode = new Map(), grupper = [], anleggGruppe = new Map();
      anlegg.forEach((p) => {
        const s = naermesteNode(p.lat, p.lon);
        if (s.node < 0) return;
        let gi = perNode.get(s.node);
        if (gi === undefined) { gi = grupper.length; perNode.set(s.node, gi); grupper.push({ node: s.node, d: s.d, anlegg: [] }); }
        grupper[gi].anlegg.push(p);
        grupper[gi].d = Math.min(grupper[gi].d, s.d);
        anleggGruppe.set(p.id, gi);
      });
      nettCache = { nokkel, grupper, anleggGruppe, ...nedslagsfelt(grupper) };
    }
    const { grupper, anleggGruppe, dist, eier } = nettCache;

    const andel = brukerandeler(f);
    const bhAndel = G.barnehageandel_1_5 || {};
    const fakt = tilstand.aar && G.framskriving ? G.framskriving.faktor[tilstand.aar] : null;
    const brukereOmrade = G.omrader.map((o) => {
      if (!tilstand.marka && o.delbydel === "1701") return 0;
      const fk = fakt && fakt[o.delbydel];
      let s = 0;
      for (let g = 0; g < 13; g++) {
        let a = andel[g];
        if (f === "barnehage" && g === 1 && tilstand.faktiskBarnehage) {
          const v = bhAndel[o.delbydel] != null ? bhAndel[o.delbydel] : bhAndel["100000"];
          if (v != null) a = +v;
        }
        s += o.a[g] * (fk ? fk[g] : 1) * a / 100;
      }
      return s;
    });

    const ep = G.ep_node.length;
    const epB = new Float64Array(ep);
    const brukereGruppe = new Float64Array(grupper.length);
    for (let i = 0; i < ep; i++) {
      const b = brukereOmrade[G.ep_omrade[i]] * G.ep_vekt[i];
      epB[i] = b;
      const e = eier[G.ep_node[i]];
      if (e >= 0) brukereGruppe[e] += b;
    }
    const kapasitet = grupper.map((g) => {
      if (!kap) return null;
      const v = g.anlegg.map((p) => p.d[kap.felt]);
      return v.some((x) => x == null) ? null : v.reduce((s, x) => s + x, 0);
    });
    const overskudd = grupper.map((g, i) => (kapasitet[i] != null && brukereGruppe[i] > kapasitet[i]
      ? 1 - kapasitet[i] / brukereGruppe[i] : 0));

    const X = tilstand.avstand;
    const brukKap = !!kap && tilstand.kap;
    const epU = new Float64Array(ep);
    const tot = { brukere: 0, avstand: 0, kapasitet: 0 };
    const celleU = new Float64Array(G.celler.n);
    for (let i = 0; i < ep; i++) {
      const b = epB[i];
      if (b <= 0) continue;
      tot.brukere += b;
      const n = G.ep_node[i];
      let u = 0;
      if (!(dist[n] <= X)) { u = b; tot.avstand += b; } else if (brukKap) {
        const e = eier[n];
        if (e >= 0 && overskudd[e] > 0) { u = b * overskudd[e]; tot.kapasitet += u; }
      }
      epU[i] = u;
      celleU[G.ep_celle[i]] += u;
    }

    R = { f, kap, anlegg, grupper, anleggGruppe, kapasitet, brukereGruppe, overskudd, epB, epU, celleU, tot,
      manglerKap: kap ? anlegg.filter((p) => p.d[kap.felt] == null).length : 0 };
    R.klasser = klasser(celleU);
    visResultat();
    tegnRuter();
    oppsummerOmrader();
    api.oppdaterTegnforklaring();
  }

  // ---------- Klasser og farger (antall udekkede brukere per rute) ----------
  function klasser(verdier) {
    const F = api.FARGE;
    const v = Array.from(verdier).filter((x) => x >= 0.5).sort((a, b) => a - b);
    const q = (p) => (v.length ? v[Math.min(v.length - 1, Math.floor(p * v.length))] : 1);
    const rund = (x) => (x >= 20 ? Math.round(x / 5) * 5 : Math.max(2, Math.round(x)));
    let grenser = [q(0.4), q(0.7), q(0.9)].map(rund);
    grenser = grenser.filter((g, i) => i === 0 || g > grenser[i - 1]);
    const farger = [F.morkBeige, F.gul, F.rod, F.morkBla].slice(0, grenser.length + 1);
    return { grenser, farger, min: 0.5 };
  }
  function farge(v) {
    const k = R.klasser;
    let i = 0;
    while (i < k.grenser.length && v >= k.grenser[i]) i++;
    return k.farger[i];
  }

  // ---------- Kart ----------
  function fjernLag() {
    const kart = api.kart;
    [rutelag, forslagslag, markering].forEach((l) => { if (l) kart.removeLayer(l); });
    rutelag = forslagslag = markering = null;
  }

  function tegnRuter() {
    const kart = api.kart;
    if (rutelag) kart.removeLayer(rutelag);
    rutelag = null;
    if (!aktiv || !R) return;
    const rend = L.canvas({ padding: 0.5 });
    rutelag = L.layerGroup();
    const fmt = api.fmt;
    for (let c = 0; c < G.celler.n; c++) {
      const u = R.celleU[c];
      if (u < R.klasser.min) continue;
      L.rectangle(cellebokser(c), { renderer: rend, stroke: false, fillColor: farge(u), fillOpacity: 0.6 })
        .bindTooltip(`${fmt.format(Math.round(u))} udekkede brukere`, { sticky: true }).addTo(rutelag);
    }
    rutelag.addTo(kart);
  }

  // ---------- Panel ----------
  function visMelding(t) {
    fjernLag();
    ui.utvalg.textContent = t;
    ui.resultat.innerHTML = "";
    ui.liste.innerHTML = "";
    ui.finn.disabled = true;
    api.oppdaterTegnforklaring();
  }

  function visResultat() {
    const fmt = api.fmt, esc = api.esc;
    const { f, anlegg, tot, kap } = R;
    const under = [...new Set(anlegg.map((p) => (p.f === "idrett" ? p.t : p.u)))];
    ui.utvalg.innerHTML = `${fmt.format(anlegg.length)} eksisterende tilbud: ${esc(api.FORMAL[f].navn)}` +
      (under.length <= 4 ? ` (${esc(under.join(", "))})` : ` (${under.length} typer)`) +
      ". Endre utvalget i «Formål og anlegg» under.";
    const udekket = tot.avstand + tot.kapasitet;
    const pst = tot.brukere > 0 ? Math.round(udekket / tot.brukere * 100) : 0;
    ui.resultat.innerHTML = `<div class="nokkeltall">
        <div class="tall"><span>${fmt.format(Math.round(udekket))}</span><small>udekkede brukere (${pst} %)</small></div>
        <div class="tall"><span>${fmt.format(Math.round(tot.brukere))}</span><small>brukere${tilstand.aar ? " i " + tilstand.aar : ""}</small></div>
      </div>
      <p class="lagmerknad">${fmt.format(Math.round(tot.avstand))} bor lenger enn ${fmt.format(tilstand.avstand)} m å gå fra nærmeste tilbud.` +
      (kap && tilstand.kap ? ` ${fmt.format(Math.round(tot.kapasitet))} bor nær nok, men i nedslagsfeltet til et tilbud med færre ${kap.tekst} enn brukere.` : "") +
      (R.manglerKap && kap && tilstand.kap ? ` ${fmt.format(R.manglerKap)} tilbud mangler kapasitetstall og regnes som ikke fulle.` : "") +
      " Kartet viser udekkede brukere per rute på 250 × 250 m.</p>";
    ui.finn.disabled = udekket < 1;
  }

  function oppsummerOmrader() {
    if (!R) return;
    const niva = tilstand.niva;
    const fn = { grunnkrets: (o) => o.kode, delbydel: (o) => o.delbydel, bydel: (o) => String(o.bydel) }[niva];
    const sum = new Map();
    for (let i = 0; i < R.epU.length; i++) {
      const b = R.epB[i];
      if (b <= 0) continue;
      const k = fn(G.omrader[G.ep_omrade[i]]);
      let r = sum.get(k);
      if (!r) sum.set(k, (r = { u: 0, b: 0 }));
      r.u += R.epU[i]; r.b += b;
    }
    const gjeldende = R;
    hentGeo(niva).then((gj) => {
      if (R !== gjeldende || niva !== tilstand.niva) return;
      const navn = {};
      gj.features.forEach((ft) => { navn[String(ft.properties.kode)] = ft.properties.navn; });
      const rader = [...sum.entries()].filter(([, r]) => r.u >= 1).sort((a, b) => b[1].u - a[1].u).slice(0, 12);
      const fmt = api.fmt, esc = api.esc;
      ui.liste.innerHTML = rader.length ? rader.map(([k, r]) => `<li><button type="button" data-omrade="${esc(k)}">
          <span>${esc(navn[k] || k)}</span><span class="areal">${fmt.format(Math.round(r.u))}</span>
          <span class="sted">${Math.round(r.u / r.b * 100)} % av ${fmt.format(Math.round(r.b))} brukere er udekket</span></button></li>`).join("")
        : '<li class="tom">Ingen udekkede brukere med disse innstillingene.</li>';
    });
  }

  function visOmrade(kode) {
    hentGeo(tilstand.niva).then((gj) => {
      const ft = gj.features.find((x) => String(x.properties.kode) === kode);
      if (!ft) return;
      if (markering) api.kart.removeLayer(markering);
      markering = L.geoJSON(ft, { style: { color: api.FARGE.svart, weight: 3, fill: false }, interactive: false }).addTo(api.kart);
      api.kart.fitBounds(markering.getBounds(), { maxZoom: 15, padding: [30, 30] });
    });
  }

  // ---------- Forslag til plassering (grådig dekning av udekkede brukere) ----------
  function nullstillForslag() {
    regnerForslag++;
    if (forslagslag) { api.kart.removeLayer(forslagslag); forslagslag = null; }
    if (markering) { api.kart.removeLayer(markering); markering = null; }
    if (ui.forslag) { ui.forslag.innerHTML = ""; ui.forslagStatus.textContent = ""; }
    if (ui.finn) ui.finn.disabled = !R;
  }

  function kandidater() {
    const C = G.celler;
    const ut = [];
    if (tilstand.kandidat === "rute") {
      for (let c = 0; c < C.n; c++) {
        if (!C.kandidat[c]) continue;
        const [[a, b], [d, e]] = cellebokser(c);
        ut.push({ type: "rute", c, node: C.node[c], lat: (a + d) / 2, lon: (b + e) / 2 });
      }
    } else {
      api.tomtKandidater(tilstand.tomtAreal).forEach((t) => {
        const s = naermesteNode(t.lat, t.lon);
        if (s.node >= 0 && s.d <= 300) ut.push({ type: "tomt", p: t.p, node: s.node, lat: t.lat, lon: t.lon });
      });
    }
    return ut;
  }

  function finnForslag() {
    if (!R) return;
    const jobb = ++regnerForslag;
    if (forslagslag) { api.kart.removeLayer(forslagslag); forslagslag = null; }
    if (markering) { api.kart.removeLayer(markering); markering = null; }
    ui.forslag.innerHTML = "";
    const kand = kandidater();
    if (!kand.length) { ui.forslagStatus.textContent = "Ingen kandidater med disse innstillingene."; return; }
    const perNode = new Map();
    kand.forEach((k, i) => { let l = perNode.get(k.node); if (!l) perNode.set(k.node, (l = [])); l.push(i); });

    const C = G.celler;
    const krav = [];
    for (let c = 0; c < C.n; c++) if (R.celleU[c] >= 0.5) krav.push(c);
    const u = new Float64Array(krav.length);
    krav.forEach((c, i) => { u[i] = R.celleU[c]; });
    const X = tilstand.avstand;
    const kravNaar = new Array(krav.length);
    const kandNaar = kand.map(() => []);

    ui.finn.disabled = true;
    ui.forslagStatus.textContent = "Beregner …";
    let i = 0;
    const steg = () => {
      if (jobb !== regnerForslag) return;
      const slutt = performance.now() + 40;
      while (i < krav.length && performance.now() < slutt) {
        const funnet = [];
        avgrenset(C.node[krav[i]], X, (v) => {
          const l = perNode.get(v);
          if (l) for (const k of l) funnet.push(k);
        });
        kravNaar[i] = funnet;
        for (const k of funnet) kandNaar[k].push(i);
        i++;
      }
      if (i < krav.length) {
        ui.forslagStatus.textContent = `Beregner … ${Math.round(i / krav.length * 100)} %`;
        setTimeout(steg, 0);
        return;
      }
      velgGraadig(kand, krav, u, kravNaar, kandNaar);
    };
    setTimeout(steg, 0);
  }

  function velgGraadig(kand, krav, u, kravNaar, kandNaar) {
    const score = new Float64Array(kand.length);
    kandNaar.forEach((l, k) => { let s = 0; for (const d of l) s += u[d]; score[k] = s; });
    const maks = tilstand.maks && tilstand.maks > 0 ? tilstand.maks : Infinity;
    const valgt = [];
    for (let n = 0; n < tilstand.antall; n++) {
      let best = -1, bs = 0;
      for (let k = 0; k < kand.length; k++) {
        const s = Math.min(score[k], maks);
        if (s > bs + 1e-9) { bs = s; best = k; }
      }
      if (best < 0 || bs < 1) break;
      const andel = score[best] > maks ? maks / score[best] : 1;
      const dekket = [];
      for (const d of kandNaar[best]) {
        if (u[d] <= 1e-9) continue;
        const delta = u[d] * andel;
        u[d] -= delta;
        dekket.push(krav[d]);
        for (const k of kravNaar[d]) score[k] -= delta;
      }
      valgt.push({ k: kand[best], nye: bs, dekket });
    }
    ui.finn.disabled = false;
    visForslag(valgt);
  }

  function forslagNavn(v) {
    if (v.k.type === "tomt") return api.tittel(v.k.p);
    const db = G.celler.delbydel[v.k.c] || (v.dekket.length ? G.celler.delbydel[v.dekket[0]] : null);
    return db && G.delbydeler[db] ? `Område ved ${G.delbydeler[db]}` : "Område i byggesonen";
  }

  function visForslag(valgt) {
    const fmt = api.fmt, esc = api.esc, kart = api.kart;
    if (!valgt.length) {
      ui.forslagStatus.textContent = "Fant ingen plassering som dekker udekkede brukere innen gangavstanden.";
      return;
    }
    const sum = valgt.reduce((s, v) => s + v.nye, 0);
    ui.forslagStatus.textContent = `${valgt.length} forslag dekker til sammen ${fmt.format(Math.round(sum))} av ` +
      `${fmt.format(Math.round(R.tot.avstand + R.tot.kapasitet))} udekkede brukere innen ${fmt.format(tilstand.avstand)} m gange.` +
      (tilstand.maks ? ` Hvert nytt tilbud tar høyst ${fmt.format(tilstand.maks)} brukere.` : "") +
      " Klikk på et forslag for å se hvilke ruter det dekker.";
    forslagslag = L.layerGroup().addTo(kart);
    valgt.forEach((v, i) => {
      const ikon = L.divIcon({ className: "", html: `<span class="dk-merke">${i + 1}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] });
      const tekst = `<div class="popup"><h3>Forslag ${i + 1}: ${esc(forslagNavn(v))}</h3>
        <p>Dekker ca. ${fmt.format(Math.round(v.nye))} brukere som i dag er udekket, innen ${fmt.format(tilstand.avstand)} m gange.</p>
        ${v.k.type === "tomt" ? `<p class="under">${esc(api.FORVALTER[v.k.p.f].navn)} · ${fmt.format(v.k.p.m2)} m²</p>
        <div class="lenker"><button type="button" class="lenkeknapp" data-tomt="${esc(v.k.p.e)}">Vis tomten</button></div>` : ""}</div>`;
      L.marker([v.k.lat, v.k.lon], { icon: ikon, zIndexOffset: 1000 }).bindPopup(tekst, { maxWidth: 300 })
        .on("click", () => marker(v)).addTo(forslagslag);
    });
    ui.forslag.innerHTML = valgt.map((v, i) => `<li><button type="button" data-forslag="${i}">
        <span><span class="dk-merke">${i + 1}</span>${esc(forslagNavn(v))}</span><span class="areal">+${fmt.format(Math.round(v.nye))}</span>
        <span class="sted">${v.k.type === "tomt" ? `${esc(api.FORVALTER[v.k.p.f].navn)} · ${fmt.format(v.k.p.m2)} m²` : "Rute på 250 × 250 m"} · nye brukere innen ${fmt.format(tilstand.avstand)} m</span>
      </button></li>`).join("");
    ui.forslag._valgt = valgt;
    api.oppdaterTegnforklaring();
  }

  function marker(v) {
    const kart = api.kart;
    if (markering) kart.removeLayer(markering);
    markering = L.layerGroup(v.dekket.map((c) => L.rectangle(cellebokser(c),
      { color: api.FARGE.morkBla, weight: 2, fill: false, interactive: false }))).addTo(kart);
    return markering;
  }

  // ---------- Brukerandeler ----------
  function lagAndelTabell() {
    const f = R ? R.f : (valgteTilbud().hoved[0] || "skole");
    const a = brukerandeler(f);
    ui.andelerTekst.textContent = `Gjelder ${api.FORMAL[f].navn.toLowerCase()}. Andelen av hver aldersgruppe som regnes som brukere. Verdiene er forslag. Endringer huskes i nettleseren.`;
    ui.tabell.dataset.formal = f;
    ui.tabell.innerHTML = GRUPPER.map((g, i) => {
      const faktisk = f === "barnehage" && i === 1 && tilstand.faktiskBarnehage;
      return `<label class="dk-andel"><span>${g}</span><input type="number" min="0" max="100" step="1" data-gruppe="${i}" value="${a[i]}" ${faktisk ? "disabled" : ""}> %</label>`;
    }).join("") + (f === "barnehage" ? `<label class="avkryss dk-faktisk"><input type="checkbox" id="dk-faktisk" ${tilstand.faktiskBarnehage ? "checked" : ""}>
      Bruk faktisk andel barn 1–5 år i barnehage per delbydel (Oslo statistikkbank, ${G ? G.aar.barnehage : ""})</label>` : "");
  }

  function settAvstand(m) {
    tilstand.avstand = m;
    ui.avstand.value = m;
    ui.avstandVerdi.textContent = api.fmt.format(m) + " m";
  }

  // ---------- Tegnforklaring og anleggspopup ----------
  function tegnforklaring() {
    if (!aktiv || !R) return "";
    const k = R.klasser, fmt = api.fmt;
    const rad = (c, t) => `<div><i style="background:${c}"></i>${api.esc(t)}</div>`;
    const rader = k.farger.map((c, i) => {
      const fra = i === 0 ? 1 : k.grenser[i - 1], til = i < k.grenser.length ? k.grenser[i] : null;
      return rad(c, til == null ? `${fmt.format(fra)} eller flere` : `${fmt.format(fra)}–${fmt.format(Math.max(fra, til - 1))}`);
    });
    return `<p class="tf-tittel">Udekkede brukere per rute</p>${rader.join("")}` +
      (forslagslag ? '<div><span class="dk-merke tf-merke">1</span>Forslag til plassering</div>' : "");
  }

  function punktInfo(p) {
    if (!R || !R.anleggGruppe) return "";
    const gi = R.anleggGruppe.get(p.id);
    if (gi === undefined) return "";
    const fmt = api.fmt;
    const b = R.brukereGruppe[gi], g = R.grupper[gi], k = R.kapasitet[gi];
    const delt = g.anlegg.length > 1 ? ` Deles med ${g.anlegg.length - 1} tilbud på samme sted.` : "";
    const kapTekst = R.kap ? (k == null ? " Kapasitet mangler." : ` Kapasitet ${fmt.format(k)}${R.overskudd[gi] > 0 ? `, ${fmt.format(Math.round(b - k))} flere brukere enn plasser` : ""}.`) : "";
    return `<p class="merk">Nedslagsfelt: ca. ${fmt.format(Math.round(b))} brukere.${delt}${kapTekst}</p>`;
  }

  // ---------- Kobling ----------
  function koble() {
    const $ = (id) => document.getElementById(id);
    Object.assign(ui, {
      status: $("dk-status"), innhold: $("dk-innhold"), utvalg: $("dk-utvalg"), aar: $("dk-aar"),
      avstand: $("dk-avstand"), avstandVerdi: $("dk-avstand-verdi"), tabell: $("dk-andel-tabell"),
      andelerTekst: $("dk-andeler-tekst"), kapFelt: $("dk-kap-felt"), resultat: $("dk-resultat"),
      niva: $("dk-niva"), liste: $("dk-liste"), tomtFelt: $("dk-tomt-felt"), finn: $("dk-finn"),
      forslag: $("dk-forslag"), forslagStatus: $("dk-forslag-status"), kilde: $("dk-kilde")
    });
    ui.aar.addEventListener("change", () => { tilstand.aar = ui.aar.value; beregn(); });
    let t;
    ui.avstand.addEventListener("input", () => {
      tilstand.avstandSatt = true;
      settAvstand(+ui.avstand.value);
      clearTimeout(t); t = setTimeout(beregn, 150);
    });
    $("dk-kap").addEventListener("change", (e) => { tilstand.kap = e.target.checked; beregn(); });
    $("dk-marka").addEventListener("change", (e) => { tilstand.marka = e.target.checked; beregn(); });
    ui.niva.addEventListener("change", () => { tilstand.niva = ui.niva.value; oppsummerOmrader(); });
    ui.liste.addEventListener("click", (e) => { const b = e.target.closest("button[data-omrade]"); if (b) visOmrade(b.dataset.omrade); });
    ui.tabell.addEventListener("change", (e) => {
      const f = ui.tabell.dataset.formal;
      if (e.target.id === "dk-faktisk") { tilstand.faktiskBarnehage = e.target.checked; lagAndelTabell(); } else if (e.target.dataset.gruppe) {
        const v = Math.max(0, Math.min(100, +e.target.value || 0));
        e.target.value = v;
        tilstand.andeler[f] = brukerandeler(f).slice();
        tilstand.andeler[f][+e.target.dataset.gruppe] = v;
        lagreAndeler();
      }
      beregn();
    });
    $("dk-tilbakestill").addEventListener("click", () => {
      const f = ui.tabell.dataset.formal;
      tilstand.andeler[f] = FORSLAG[f].slice();
      tilstand.faktiskBarnehage = true;
      lagreAndeler(); lagAndelTabell(); beregn();
    });
    document.querySelectorAll('input[name="dk-kandidat"]').forEach((r) => r.addEventListener("change", () => {
      tilstand.kandidat = r.value; ui.tomtFelt.hidden = r.value !== "tomt"; nullstillForslag();
    }));
    $("dk-tomt-areal").addEventListener("change", (e) => { tilstand.tomtAreal = +e.target.value; nullstillForslag(); });
    $("dk-antall").addEventListener("change", (e) => { tilstand.antall = +e.target.value; nullstillForslag(); });
    $("dk-maks").addEventListener("change", (e) => { tilstand.maks = +e.target.value || null; nullstillForslag(); });
    ui.finn.addEventListener("click", finnForslag);
    ui.forslag.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-forslag]");
      if (!b) return;
      const v = ui.forslag._valgt[+b.dataset.forslag];
      const m = marker(v);
      const grenser = L.latLngBounds([[v.k.lat, v.k.lon]]);
      m.eachLayer((l) => grenser.extend(l.getBounds()));
      api.kart.fitBounds(grenser, { maxZoom: 16, padding: [30, 30] });
    });
    api.kart.on("popupopen", (e) => {
      const el = e.popup.getElement();
      const b = el && el.querySelector("[data-tomt]");
      if (b) b.addEventListener("click", () => api.visEiendom(b.dataset.tomt));
    });
  }

  window.Dekning = {
    start(a) { api = a; koble(); },
    modus(paa) {
      aktiv = paa;
      if (!paa) { fjernLag(); return; }
      last().then((ok) => { if (ok) this.oppdater(); });
    },
    oppdater() { if (aktiv && G) beregn(); },
    punktInfo,
    tegnforklaring
  };
})();
