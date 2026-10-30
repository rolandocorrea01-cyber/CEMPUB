/* Navegador del Cementerio Municipal de Santiago — ArcGIS Maps SDK for JavaScript.
   Lee directamente las capas PRIVADAS de ArcGIS Online (requiere iniciar sesión con la cuenta dueña de los datos).
   Configuración: IDs de los ítems en ArcGIS Online (ver ARCGIS\07_registrar_navegador.py). */
const CFG = {
  portal: "https://www.arcgis.com",
  appId: "xz7ckchCnVlB9VI9",
  capas: "5f3a599d110d48e3819935028fa6683f",   // Cementerio_Municipal_Santiago
  rutas: "595c1dc04f674e44b6bffd47e5e8b3dc",   // Cementerio_Rutas
  orto: "993629f2be5a4c3bb726b4459c51fea8",    // Cementerio_Municipal_Ortofoto
  L: { registros: 0, finca: 2, tumbas: 3 },
  R: { accesos: 0, tramo: 1, rutas: 2 }
};

require([
  "esri/identity/OAuthInfo", "esri/identity/IdentityManager", "esri/Map", "esri/views/MapView",
  "esri/layers/FeatureLayer", "esri/layers/TileLayer", "esri/layers/GraphicsLayer", "esri/Graphic",
  "esri/geometry/support/webMercatorUtils", "esri/geometry/Polyline", "esri/geometry/Circle"
], function (OAuthInfo, IdentityManager, ArcMap, MapView, FeatureLayer, TileLayer, GraphicsLayer, Graphic, wmu, Polyline, Circle) {

  const $ = s => document.querySelector(s);
  const ESTADO = { I: ["Identificado", "s-I", "var(--ok)"], D: ["Por definir", "s-D", "var(--def)"], S: ["Sin nombre", "s-S", "var(--sn)"] };
  const COD = { "IDENTIFICADO": "I", "POR DEFINIR": "D", "SIN NOMBRE": "S" };
  const COL = { I: [46, 155, 58], D: [227, 154, 0], S: [215, 38, 61] };
  const AMBAR = [255, 176, 0], BORDE = [42, 29, 0];
  const norm = s => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v, d) => (v == null ? "—" : Number(v).toFixed(d));

  // ---------- inicio de sesión (ArcGIS Online)
  const info = new OAuthInfo({ appId: CFG.appId, portalUrl: CFG.portal, popup: false, flowType: "authorization-code" });
  IdentityManager.registerOAuthInfos([info]);
  const sharing = CFG.portal + "/sharing";
  const destino = () => { try { return sessionStorage.getItem("nav-destino") || ""; } catch (e) { return ""; } };
  if (/^#(p|t)-/.test(location.hash)) { try { sessionStorage.setItem("nav-destino", location.hash); } catch (e) {} }

  IdentityManager.checkSignInStatus(sharing).then(iniciar).catch(() => {
    $("#carga").hidden = true; $("#entrar").hidden = false;
    $("#btnEntrar").onclick = () => IdentityManager.getCredential(sharing);
  });

  async function iniciar() {
    $("#entrar").hidden = true; $("#carga").hidden = false;

    const orto = new TileLayer({ portalItem: { id: CFG.orto } });
    const finca = new FeatureLayer({ portalItem: { id: CFG.capas }, layerId: CFG.L.finca, popupEnabled: false,
      renderer: { type: "simple", symbol: { type: "simple-line", color: [255, 255, 255, 0.75], width: 0.8 } } });
    const tumbas = new FeatureLayer({ portalItem: { id: CFG.capas }, layerId: CFG.L.tumbas, popupEnabled: false, outFields: ["ID_POLIGONO"],
      renderer: { type: "simple", symbol: { type: "simple-fill", color: [255, 255, 255, 0.04], outline: { color: [255, 255, 255, 0.8], width: 0.6 } } } });
    const registros = new FeatureLayer({ portalItem: { id: CFG.capas }, layerId: CFG.L.registros, popupEnabled: false, minScale: 1500,
      outFields: ["ID_PUNTO", "ESTADO_NOMBRE"],
      renderer: { type: "unique-value", field: "ESTADO_NOMBRE", uniqueValueInfos: Object.entries(COD).map(([v, k]) => ({
        value: v, symbol: { type: "simple-marker", size: 8, color: COL[k], outline: { color: [0, 0, 0], width: 0.8 } } })) } });
    const accesos = new FeatureLayer({ portalItem: { id: CFG.rutas }, layerId: CFG.R.accesos, popupEnabled: false, outFields: ["*"],
      renderer: { type: "unique-value", field: "TIPO", uniqueValueInfos: [
        { value: "ENTRADA", symbol: { type: "simple-marker", style: "square", size: 13, color: [198, 40, 40], outline: { color: "white", width: 2 } } },
        { value: "ADMINISTRACION", symbol: { type: "simple-marker", style: "circle", size: 12, color: [46, 125, 50], outline: { color: "white", width: 2 } } }] },
      labelingInfo: [{ labelExpressionInfo: { expression: "$feature.NOMBRE" }, labelPlacement: "above-right",
        symbol: { type: "text", color: "white", haloColor: "black", haloSize: 1.5, font: { size: 11, weight: "bold", family: "Arial" } } }] });
    const rutasL = new FeatureLayer({ portalItem: { id: CFG.rutas }, layerId: CFG.R.rutas, visible: false });
    const tramoL = new FeatureLayer({ portalItem: { id: CFG.rutas }, layerId: CFG.R.tramo, visible: false });
    const capaRuta = new GraphicsLayer({ title: "Ruta" });

    const map = new ArcMap({ basemap: "satellite", layers: [orto, finca, tumbas, capaRuta, registros, accesos] });
    const view = new MapView({ container: "map", map, constraints: { maxZoom: 23, minZoom: 15, rotationEnabled: false },
      ui: { components: ["zoom"] }, popupEnabled: false, highlightOptions: { color: AMBAR } });

    // registros (todos, con paginación) para buscar sin acentos y armar la ficha
    const reg = [], porT = {};
    let off = 0;
    while (true) {
      const r = await registros.queryFeatures({ where: "1=1", outFields: ["OBJECTID", "ID_PUNTO", "NIVEL", "NOMBRE", "ESTADO_NOMBRE", "ID_POLIGONO", "X_UTM", "Y_UTM"],
        returnGeometry: true, outSpatialReference: { wkid: 4326 }, start: off, num: 1000, orderByFields: ["ID_PUNTO"] });
      r.features.forEach(f => {
        const a = f.attributes;
        const x = { oid: a.OBJECTID, p: a.ID_PUNTO, v: a.NIVEL || 0, n: a.NOMBRE || "Sin Nombre", s: COD[a.ESTADO_NOMBRE] || "S", t: a.ID_POLIGONO || "",
          u: [a.X_UTM, a.Y_UTM], c: [f.geometry.y, f.geometry.x], nn: norm(a.NOMBRE) };
        reg.push(x); (porT[x.t] = porT[x.t] || []).push(x);
      });
      if (!r.exceededTransferLimit && r.features.length < 1000) break;
      off += r.features.length;
    }
    Object.values(porT).forEach(a => a.sort((x, y) => x.v - y.v || x.p - y.p));
    const ent = {};
    (await accesos.queryFeatures({ where: "1=1", outFields: ["NOMBRE", "TIPO"], returnGeometry: true })).features
      .forEach(f => { ent[f.attributes.NOMBRE.replace(/^Entrada /, "")] = f; });
    const idsT = (await tumbas.queryFeatures({ where: "1=1", outFields: ["ID_POLIGONO"], returnGeometry: false, num: 5000 }))
      .features.map(f => f.attributes.ID_POLIGONO).filter(Boolean);

    await view.when();
    const ext = await tumbas.queryExtent();
    await view.goTo(ext.extent.expand(1.15), { animate: false });

    // ---------- mi ubicación (opcional): punto azul que sigue a la persona; no se guarda ni se envía a ningún servidor
    const capaYo = new GraphicsLayer({ title: "Mi ubicación" }); map.add(capaYo);
    const zonaCem = ext.extent.clone().expand(1.6);
    const btnYo = document.createElement("button");
    btnYo.id = "btnYo"; btnYo.type = "button"; btnYo.title = "Mostrar mi ubicación"; btnYo.setAttribute("aria-pressed", "false");
    btnYo.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>';
    view.ui.add(btnYo, "top-left");
    const aviso = $("#aviso");
    const avisar = (t, ms) => { aviso.textContent = t; aviso.hidden = !t; clearTimeout(avisar.t); if (t && ms) avisar.t = setTimeout(() => { aviso.hidden = true; }, ms); };
    let vigia = null, primera = true;
    const distM = (a, b) => { const R = 6371000, r = Math.PI / 180, dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r;
      const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
    function apagarYo() {
      if (vigia != null) navigator.geolocation.clearWatch(vigia); vigia = null; capaYo.removeAll();
      btnYo.classList.remove("activo"); btnYo.setAttribute("aria-pressed", "false"); btnYo.title = "Mostrar mi ubicación"; avisar("");
    }
    btnYo.onclick = () => {
      if (vigia != null) { apagarYo(); return; }
      if (!("geolocation" in navigator)) { avisar("Este navegador no permite usar la ubicación.", 5000); return; }
      primera = true; btnYo.classList.add("activo"); btnYo.setAttribute("aria-pressed", "true"); btnYo.title = "Ocultar mi ubicación";
      avisar("Buscando su ubicación…");
      vigia = navigator.geolocation.watchPosition(pos => {
        const { latitude: la, longitude: lo, accuracy: acc } = pos.coords;
        const pt = wmu.geographicToWebMercator({ type: "point", x: lo, y: la, spatialReference: { wkid: 4326 } });
        capaYo.removeAll();
        capaYo.addMany([
          new Graphic({ geometry: new Circle({ center: { type: "point", x: lo, y: la, spatialReference: { wkid: 4326 } }, radius: Math.min(acc, 60), radiusUnit: "meters", geodesic: true }),
            symbol: { type: "simple-fill", color: [30, 136, 229, 0.15], outline: { color: [30, 136, 229, 0.6], width: 1 } } }),
          new Graphic({ geometry: pt, symbol: { type: "simple-marker", size: 15, color: [30, 136, 229], outline: { color: "white", width: 3 } } })]);
        const dentro = zonaCem.contains(pt);
        if (primera) {
          primera = false;
          if (dentro) { view.goTo({ target: pt, zoom: Math.max(view.zoom, 20) }, { duration: 600 }).catch(() => {}); }
          else {
            const cerca = Object.entries(ent).filter(([k]) => k !== "Administración")
              .map(([k, f]) => { const g = wmu.webMercatorToGeographic(f.geometry); return [k, distM([la, lo], [g.y, g.x])]; }).sort((a, b) => a[1] - b[1])[0];
            avisar(cerca ? `Está a ${cerca[1] >= 1000 ? (cerca[1] / 1000).toFixed(1) + " km" : Math.round(cerca[1]) + " m"} de la entrada ${cerca[0]}. Use “Ir a la entrada” en la ficha para llegar.` : "Está fuera del cementerio.", 9000);
            return;
          }
        }
        avisar(dentro ? `Ubicación aproximada (±${Math.round(acc)} m)` : "", dentro ? 0 : 1);
      }, err => {
        apagarYo();
        avisar(err.code === 1 ? "No se dio permiso para usar la ubicación. Puede activarlo en la configuración del navegador." : "No se pudo obtener la ubicación. Intente de nuevo al aire libre.", 7000);
      }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    };
    $("#carga").hidden = true;

    // ---------- búsqueda
    function buscar(q) {
      const s = norm(q); if (!s) return [];
      const out = [];
      if (/^\d+$/.test(s)) {
        reg.filter(r => String(r.p) === s).forEach(r => out.push({ r }));
        reg.filter(r => String(r.p).startsWith(s) && String(r.p) !== s).slice(0, 15).forEach(r => out.push({ r }));
      }
      idsT.filter(t => norm(t).startsWith(s)).slice(0, 8).forEach(t => out.push({ t }));
      if (s.length >= 2) { const pal = s.split(/\s+/); reg.filter(r => pal.every(w => r.nn.includes(w))).slice(0, 40).forEach(r => out.push({ r })); }
      const v = new Set();
      return out.filter(o => { const k = o.r ? "p" + o.r.p : "t" + o.t; if (v.has(k)) return false; v.add(k); return true; }).slice(0, 40);
    }
    function pintarRes() {
      const q = $("#q").value; $("#limpiar").hidden = !q;
      if (!q.trim()) { $("#res").hidden = true; return; }
      const L = buscar(q);
      $("#res").innerHTML = L.length ? L.map((o, i) => o.t
        ? `<button class="r" data-i="${i}"><span class="dot" style="background:var(--cipres)"></span><span class="tx"><b>Tumba ${esc(o.t)}</b><small>${(porT[o.t] || []).length} registros</small></span></button>`
        : `<button class="r" data-i="${i}"><span class="dot ${ESTADO[o.r.s][1]}"></span><span class="tx"><b>${esc(o.r.n)}</b><small>Punto ${o.r.p} · Tumba ${esc(o.r.t || "—")} · Nivel ${o.r.v}</small></span></button>`).join("")
        : `<div class="vacio">Sin resultados para “${esc(q)}”. Pruebe con parte del apellido, el número de punto o el código de la tumba.</div>`;
      $("#res").hidden = false;
      $("#res").querySelectorAll(".r").forEach(b => b.onclick = () => { const o = L[+b.dataset.i]; $("#res").hidden = true; elegir(o.t ? { t: o.t } : { p: o.r.p }); });
    }
    $("#q").addEventListener("input", pintarRes);
    $("#q").addEventListener("keydown", e => { if (e.key === "Enter") { const b = $("#res .r"); if (b) b.click(); } if (e.key === "Escape") limpiar(); });
    $("#limpiar").onclick = () => { $("#q").value = ""; pintarRes(); limpiar(); $("#q").focus(); };

    // tocar una tumba o un punto en el mapa
    view.on("click", async ev => {
      const h = await view.hitTest(ev, { include: [registros, tumbas] });
      const g = h.results.find(r => r.graphic && r.graphic.layer === registros) || h.results.find(r => r.graphic && r.graphic.layer === tumbas);
      if (!g) return;
      if (g.graphic.layer === registros) elegir({ p: g.graphic.attributes.ID_PUNTO }); else elegir({ t: g.graphic.attributes.ID_POLIGONO });
    });

    // ---------- ruta resaltada
    function limpiar() {
      capaRuta.removeAll(); $("#ficha").classList.add("oculta");
      try { history.replaceState(null, "", location.pathname); sessionStorage.removeItem("nav-destino"); } catch (e) {}
    }
    const linea = (paths, color, width, style, cap) => new Graphic({ geometry: new Polyline({ paths, spatialReference: view.spatialReference }),
      symbol: { type: "simple-line", color, width, style: style || "solid", cap: cap || "round", join: "round" } });

    async function elegir({ t, p }) {
      let punto = null;
      if (p != null) { punto = reg.find(r => r.p === +p); if (!punto) return; t = punto.t; }
      limpiar();
      const w = `ID_POLIGONO = '${String(t).replace(/'/g, "''")}'`;
      const [qt, qr, qk] = await Promise.all([
        tumbas.queryFeatures({ where: w, returnGeometry: true, outSpatialReference: view.spatialReference }),
        rutasL.queryFeatures({ where: w, outFields: ["*"], returnGeometry: true, outSpatialReference: view.spatialReference }),
        tramoL.queryFeatures({ where: w, returnGeometry: true, outSpatialReference: view.spatialReference })]);
      const T = qt.features[0], R = qr.features[0], K = qk.features[0];
      const extra = [];
      if (R) {
        const ruta = R.geometry.paths[0], arco = K ? K.geometry.paths[0] : [];
        let fin = ruta.length;
        if (arco.length) {   // la ruta guardada incluye el arco: se corta donde empieza para dibujar el arco aparte
          let best = 0, bd = Infinity;
          ruta.forEach((v, i) => { const d = Math.hypot(v[0] - arco[0][0], v[1] - arco[0][1]); if (d < bd) { bd = d; best = i; } });
          fin = best + 1;
        }
        const pas = [ruta.slice(0, fin)];
        capaRuta.addMany([linea(pas, BORDE.concat(0.65), 9), linea(pas, AMBAR, 5.5), linea(pas, [255, 243, 207], 1.6, "dash")]);
        if (arco.length) {
          capaRuta.addMany([linea([arco], BORDE.concat(0.35), 7, "dot"), linea([arco], AMBAR, 5, "dot"),
            new Graphic({ geometry: { type: "point", x: arco[0][0], y: arco[0][1], spatialReference: view.spatialReference },
              symbol: { type: "simple-marker", size: 10, color: [255, 243, 207], outline: { color: BORDE, width: 2 } } })]);
        }
        const e = ent[R.attributes.ENTRADA];
        if (e) capaRuta.addMany([
          new Graphic({ geometry: e.geometry, symbol: { type: "simple-marker", style: "square", size: 30, color: AMBAR.concat(0.35), outline: { color: AMBAR, width: 1 } } }),
          new Graphic({ geometry: e.geometry, symbol: { type: "simple-marker", style: "square", size: 17, color: AMBAR, outline: { color: BORDE, width: 2 } } })]);
        extra.push(R.geometry);
      }
      if (T) { capaRuta.add(new Graphic({ geometry: T.geometry, symbol: { type: "simple-fill", color: AMBAR.concat(0.5), outline: { color: AMBAR, width: 3 } } })); extra.push(T.geometry); }
      if (punto) {
        const g = wmu.geographicToWebMercator({ type: "point", x: punto.c[1], y: punto.c[0], spatialReference: { wkid: 4326 } });
        capaRuta.add(new Graphic({ geometry: g, symbol: { type: "simple-marker", size: 14, color: COL[punto.s], outline: { color: "white", width: 3 } } }));
        if (!extra.length) extra.push(g);
      }
      // encuadre: de la entrada a la tumba, dejando libre el espacio de la ficha
      const ancho = innerWidth >= 860;
      view.padding = { top: ancho ? 30 : 80, left: 30, right: ancho ? 420 : 30, bottom: ancho ? 30 : Math.round(innerHeight * 0.58) + 10 };
      let ex = null;
      extra.forEach(g => { const e = g.extent || (g.x != null ? { xmin: g.x - 8, ymin: g.y - 8, xmax: g.x + 8, ymax: g.y + 8 } : null); if (!e) return;
        ex = ex ? { xmin: Math.min(ex.xmin, e.xmin), ymin: Math.min(ex.ymin, e.ymin), xmax: Math.max(ex.xmax, e.xmax), ymax: Math.max(ex.ymax, e.ymax) }
                : { xmin: e.xmin, ymin: e.ymin, xmax: e.xmax, ymax: e.ymax }; });
      if (ex) {
        const mx = (ex.xmax - ex.xmin) * 0.12 + 4, my = (ex.ymax - ex.ymin) * 0.12 + 4;
        view.goTo({ type: "extent", xmin: ex.xmin - mx, ymin: ex.ymin - my, xmax: ex.xmax + mx, ymax: ex.ymax + my, spatialReference: view.spatialReference },
                  { duration: 800 }).catch(() => {});
      }
      try { ficha(t, punto, R ? R.attributes : null); }
      catch (err) { console.error(err); $("#fc").innerHTML = `<div class="vacio">No se pudo armar la ficha de ${esc(t || "")}.</div>`; $("#ficha").classList.remove("oculta"); }
      try { history.replaceState(null, "", punto ? `#p-${punto.p}` : `#t-${t}`); } catch (e) {}
    }

    // ---------- ficha
    function ficha(t, punto, A) {
      const regs = t ? (porT[t] || []) : [punto];
      const p0 = punto || regs[0];
      const pasos = A ? A.INDICACIONES.replace(/\.$/, "").split(/;\s*/) : [];
      const otra = A ? Object.keys(A).filter(k => /^DIST_(?!M$|ADMIN)(.+)_M$/.test(k)).map(k => [k.replace(/^DIST_|_M$/g, ""), A[k]])
        .filter(([k]) => norm(k) !== norm(A.ENTRADA)) : [];
      const cap = s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
      $("#fc").innerHTML = `
        <div class="cab"><div><h2>${t ? "Tumba" : "Registro"}</h2><div class="id">${esc(t || "Punto " + punto.p)}</div></div>
          <button class="cerrar" type="button" id="cerrar">Cerrar</button></div>
        ${A ? `<div class="ruta">
          <div class="linea1"><span class="ent">Entrada ${esc(A.ENTRADA)}</span><span class="cif">${num(A.DIST_M, 0)} m · ~${A.MIN_A_PIE} min a pie</span></div>
          <ol>${pasos.map(x => `<li>${esc(x.charAt(0).toUpperCase() + x.slice(1))}</li>`).join("")}</ol>
          <div class="leyenda-ruta"><span><i class="l1"></i>por el pasillo</span><span><i class="l2"></i>entre tumbas</span></div>
          <a class="ir" href="https://www.google.com/maps/dir/?api=1&destination=${num(A.ENT_LAT, 7)},${num(A.ENT_LON, 7)}" target="_blank" rel="noopener">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M3 11 21 3l-8 18-2-8-8-2Z"/></svg>
            Ir a la entrada ${esc(A.ENTRADA)} desde mi ubicación</a>
          ${otra.length ? `<div class="otra">Por la otra entrada: ${otra.map(([k, v]) => `${esc(cap(k))} ${num(v, 0)} m`).join(" · ")}</div>` : ""}
        </div>` : (t ? `<div class="vacio">Esta tumba todavía no tiene ruta calculada.</div>` : "")}
        <div class="dif"><h3>${regs.length === 1 ? "Registro" : "Difuntos en esta tumba (" + regs.length + ")"}</h3>
          ${regs.map(r => `<div class="d${punto && r.p === punto.p ? " sel" : ""}">
            <button class="foto" type="button" data-oid="${r.oid}" data-n="${esc(r.n)}" aria-label="Foto de ${esc(r.n)}"></button>
            <div style="min-width:0"><div class="nom">${esc(r.n)}</div>
              <div class="meta"><span class="pill" style="background:${ESTADO[r.s][2]}">${ESTADO[r.s][0]}</span>Punto ${r.p} · Nivel ${r.v}</div></div></div>`).join("")}
        </div>
        <div><h3>Ubicación${punto ? " del punto " + punto.p : ""}</h3>
          <dl class="datos"><dt>UTM 17N</dt><dd>E ${num(p0.u[0], 2)} · N ${num(p0.u[1], 2)}</dd>
            <dt>Lat / Lon</dt><dd>${num(p0.c[0], 6)}, ${num(p0.c[1], 6)}</dd></dl></div>`;
      $("#ficha").classList.remove("oculta"); $("#cerrar").onclick = limpiar; $("#fc").scrollTop = 0;
      fotos(regs);
    }

    async function fotos(regs) {
      const botones = [...document.querySelectorAll("#fc .foto[data-oid]")];
      try {
        const ids = regs.map(r => r.oid);
        const res = await registros.queryAttachments({ objectIds: ids, attachmentTypes: ["image/jpeg", "image/png"] });
        const cred = IdentityManager.findCredential(registros.url);
        botones.forEach(b => {
          const a = (res[b.dataset.oid] || [])[0];
          if (!a) { b.classList.add("sin"); b.textContent = "Sin foto"; return; }
          const src = a.url + (cred ? (a.url.includes("?") ? "&" : "?") + "token=" + cred.token : "");
          b.innerHTML = `<img alt="" loading="lazy" src="${src}">`;
          b.onclick = () => { $("#lbi").src = src; $("#lbt").textContent = b.dataset.n; $("#lb").hidden = false; $("#lbx").focus(); };
        });
      } catch (e) { botones.forEach(b => { b.classList.add("sin"); b.textContent = "Sin foto"; }); }
    }
    $("#lbx").onclick = () => { $("#lb").hidden = true; };
    $("#lb").addEventListener("click", e => { if (e.target.id === "lb") $("#lb").hidden = true; });
    document.addEventListener("keydown", e => { if (e.key === "Escape") $("#lb").hidden = true; });

    // enlace directo: #p-651 o #t-B632 (también desde Field Maps)
    function desdeHash(h) { if (/^#p-\d+$/.test(h)) elegir({ p: +h.slice(3) }); else if (/^#t-[\w-]+$/.test(h)) elegir({ t: h.slice(3) }); }
    desdeHash(/^#(p|t)-/.test(location.hash) ? location.hash : destino());
    addEventListener("hashchange", () => desdeHash(location.hash));
  }
});
