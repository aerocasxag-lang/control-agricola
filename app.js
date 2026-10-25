// Control Agrícola · AeroCAS — entrega 1-2
// App web offline-first con Firebase (Auth + Firestore con caché local).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, setDoc, updateDoc,
  getDoc, getDocs, onSnapshot, query, where, serverTimestamp, increment }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { areaHa, parseKml, centroide, fechaLocal, diasEntre, horasEntre, comprimirFoto, csvEscape } from "./util.js";

const VERSION = "0.2 · 25-oct-2026";
const ADMIN_UID = "FsBVYYQXT4YMtHDgcgsgoEH9N1m1";
const firebaseConfig = {
  apiKey: "AIzaSyCpf4LRwovuqNdGG5BENvDBS7OHwbIoEQw",
  authDomain: "control-agricola-7d2e0.firebaseapp.com",
  projectId: "control-agricola-7d2e0",
  storageBucket: "control-agricola-7d2e0.firebasestorage.app",
  messagingSenderId: "263176377404",
  appId: "1:263176377404:web:51e305c6eca4c37e94df39"
};

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = initializeFirestore(fb, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

// ---------- Estado ----------
const S = {
  user: null, perfil: null, admin: false,
  lotes: [], catalogos: null, registros: [], pendientesSync: 0,
  loteSel: null, finca: "", gps: null, unsubs: [],
  filtroReg: "todos", seg: "reg", capa: "sat"
};
const CAT_DEFECTO = {
  productos: ["15-15-15", "DAP 18-46-0", "Urea 46%", "KCl 60%", "Cal dolomita"],
  motobombas: ['Motobomba 2" gasolina'],
  plagas: [{ nombre: "Cogollero (daño Davis ≥ 3)", umbral: 20 }, { nombre: "Pulgón amarillo (1 o más)", umbral: 20 },
    { nombre: "Hormiga arriera", umbral: 5 }, { nombre: "Otra", umbral: 20 }]
};
const ESTADOS = { pendiente: "Pendiente", aprobado: "Aprobado", rechazado: "Rechazado", correccion: "Corrección", anulado: "Anulado" };

// ---------- Utilidades de UI ----------
const $ = id => document.getElementById(id);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "html") e.innerHTML = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};
let toastT;
function toast(msg, err = false) {
  const t = $("toast"); t.textContent = msg; t.className = "toast" + (err ? " err" : ""); t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 3800);
}
function abrirModal(titulo, ...contenido) {
  $("mTitulo").textContent = titulo; $("mBody").replaceChildren(...contenido); $("modal").hidden = false;
  $("mBody").scrollTop = 0;
}
function cerrarModal() { $("modal").hidden = true; $("mBody").replaceChildren(); }
$("mCerrar").addEventListener("click", cerrarModal);
$("modal").addEventListener("click", e => { if (e.target.id === "modal") cerrarModal(); });
const num = (v, d = 1) => (v == null || isNaN(v)) ? "—" : Number(v).toLocaleString("es-CO", { maximumFractionDigits: d });
const fmtFecha = s => { if (!s) return "—"; const [y, m, d] = s.split("-"); return `${+d}/${+m}/${y}`; };
const lotePorId = id => S.lotes.find(l => l.id === id);

// ---------- Red ----------
function pintarRed() {
  const n = $("net"), on = navigator.onLine;
  n.className = "net" + (on ? "" : " off");
  n.textContent = on ? (S.pendientesSync ? `Enviando ${S.pendientesSync}…` : "En línea") : `Sin señal${S.pendientesSync ? ` · ${S.pendientesSync} en el celular` : ""}`;
}
addEventListener("online", pintarRed); addEventListener("offline", pintarRed);

// ---------- Sesión ----------
$("fLogin").addEventListener("submit", async e => {
  e.preventDefault(); $("lMsg").textContent = "";
  try { await signInWithEmailAndPassword(auth, $("lEmail").value.trim(), $("lPass").value); }
  catch (err) {
    $("lMsg").textContent = err.code === "auth/network-request-failed" ? "Sin señal. La primera entrada necesita internet."
      : "Correo o contraseña incorrectos.";
  }
});
let salirArmado = false;
$("bSalir").addEventListener("click", async () => {
  if (S.pendientesSync && !salirArmado) {
    salirArmado = true; setTimeout(() => salirArmado = false, 5000);
    toast("Hay registros sin enviar. Si cierras sesión ahora se pueden perder. Toca otra vez para salir igual.", true); return;
  }
  await signOut(auth);
});

onAuthStateChanged(auth, async user => {
  $("cargando").hidden = true;
  S.unsubs.forEach(u => u()); S.unsubs = [];
  if (!user) { S.user = null; $("app").hidden = true; $("login").hidden = false; return; }
  S.user = user; S.admin = user.uid === ADMIN_UID;
  $("login").hidden = true; $("app").hidden = false;
  iniciarMapa(); pintarRed();
  // Perfil
  S.unsubs.push(onSnapshot(doc(db, "usuarios", user.uid), snap => {
    S.perfil = snap.exists() ? snap.data() : null;
    S.admin = user.uid === ADMIN_UID || S.perfil?.rol === "admin";
    if (S.admin && !snap.exists() && !snap.metadata.fromCache) {
      setDoc(doc(db, "usuarios", user.uid), { nombre: "Jorge Andrés Herrera", correo: user.email, rol: "admin", activo: true, creado: serverTimestamp() });
    }
    $("tabPanel").hidden = !S.admin;
    pintarYo(); escucharRegistros();
  }, () => {}));
  // Lotes
  S.unsubs.push(onSnapshot(collection(db, "lotes"), snap => {
    S.lotes = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));
    pintarLotes(); pintarPanel();
    if (S.loteSel) { const l = lotePorId(S.loteSel); if (l) pintarFicha(l); else cerrarFicha(); }
  }, () => {}));
  // Catálogos
  S.unsubs.push(onSnapshot(doc(db, "config", "catalogos"), snap => {
    S.catalogos = snap.exists() ? snap.data() : CAT_DEFECTO;
    if (!snap.exists() && S.admin && !snap.metadata.fromCache) setDoc(doc(db, "config", "catalogos"), CAT_DEFECTO);
  }, () => { S.catalogos = CAT_DEFECTO; }));
  $("version").textContent = "Versión " + VERSION;
});

let unsubReg = null, regModo = null;
function escucharRegistros() {
  const modo = S.admin ? "admin" : "campo";
  if (unsubReg && regModo === modo) return;
  if (unsubReg) unsubReg();
  regModo = modo;
  const q = S.admin ? collection(db, "registros") : query(collection(db, "registros"), where("autorUid", "==", S.user.uid));
  unsubReg = onSnapshot(q, { includeMetadataChanges: true }, snap => {
    S.registros = snap.docs.map(d => ({ id: d.id, _cola: d.metadata.hasPendingWrites, ...d.data() }))
      .sort((a, b) => (b.fechaHecho || "").localeCompare(a.fechaHecho || "") || (b.creadoLocal || "").localeCompare(a.creadoLocal || ""));
    S.pendientesSync = S.registros.filter(r => r._cola).length;
    pintarRed(); pintarRegistros(); pintarPanel(); pintarAlertas();
    if (S.loteSel && S.seg === "reg") pintarSeg();
  }, err => toast("No se pudieron leer los registros (" + err.code + ")", true));
  S.unsubs.push(() => { unsubReg && unsubReg(); unsubReg = null; regModo = null; });
}

// ---------- Navegación ----------
document.querySelectorAll("#tabbar button").forEach(b => b.addEventListener("click", () => irA(b.dataset.v)));
function irA(v) {
  document.querySelectorAll("#tabbar button").forEach(x => x.setAttribute("aria-selected", x.dataset.v === v ? "true" : "false"));
  ["mapa", "registros", "panel", "yo"].forEach(x => $("v-" + x).hidden = x !== v);
  if (v === "mapa" && mapa) setTimeout(() => mapa.invalidateSize(), 50);
}

// ---------- Mapa ----------
let mapa = null, capaSat = null, grupoLotes = null, grupoClusters = null, marcadorGps = null;
const polis = new Map();
function iniciarMapa() {
  if (mapa) return;
  mapa = L.map("map", { zoomControl: false, attributionControl: true }).setView([5.33, -72.39], 11);
  capaSat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 20, maxNativeZoom: 18, attribution: "Imágenes © Esri" }).addTo(mapa);
  grupoLotes = L.layerGroup().addTo(mapa);
  grupoClusters = L.layerGroup().addTo(mapa);
  mapa.on("zoomend", alternarClusters);
  mapa.on("click", e => { if (midiendo) agregarPuntoMedida(e.latlng); });
  if ("geolocation" in navigator) {
    navigator.geolocation.watchPosition(p => {
      S.gps = { lat: p.coords.latitude, lng: p.coords.longitude, prec: Math.round(p.coords.accuracy) };
      const ll = [S.gps.lat, S.gps.lng];
      if (!marcadorGps) marcadorGps = L.marker(ll, { icon: L.divIcon({ className: "", html: '<div class="gps-dot"></div>', iconSize: [18, 18] }), interactive: false }).addTo(mapa);
      else marcadorGps.setLatLng(ll);
    }, () => {}, { enableHighAccuracy: true, maximumAge: 15000 });
  }
}
function lotesVisibles() { return S.lotes.filter(l => !l.archivado && (!S.finca || l.finca === S.finca)); }
function pintarLotes() {
  if (!mapa) return;
  grupoLotes.clearLayers(); polis.clear();
  const vis = lotesVisibles(); const bounds = [];
  for (const l of vis) {
    if (!l.borde?.length) continue;
    const ll = l.borde.map(p => [p.lat, p.lng]);
    const pol = L.polygon(ll, estiloLote(l.id === S.loteSel)).addTo(grupoLotes);
    pol.on("click", ev => { if (midiendo) { agregarPuntoMedida(ev.latlng); return; } L.DomEvent.stopPropagation(ev); seleccionarLote(l.id); });
    pol.bindTooltip(l.nombre, { permanent: false, direction: "center" });
    polis.set(l.id, pol); bounds.push(...ll);
  }
  alternarClusters();
  if (bounds.length && !pintarLotes.ajustado) { mapa.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 }); pintarLotes.ajustado = true; }
  // Selector de finca
  const fincas = [...new Set(S.lotes.map(l => l.finca).filter(Boolean))];
  $("bFinca").hidden = fincas.length < 2 && !S.finca;
  $("fincaNombre").textContent = S.finca || (fincas.length === 1 ? fincas[0] : "Todas las fincas");
}
const estiloLote = sel => sel ? { color: "#3DDC84", weight: 3, fillColor: "#3DDC84", fillOpacity: .12 } : { color: "#ffffff", weight: 2, fillColor: "#ffffff", fillOpacity: .12 };
function alternarClusters() {
  if (!mapa) return;
  grupoClusters.clearLayers();
  const lejos = mapa.getZoom() < 14;
  if (lejos) mapa.removeLayer(grupoLotes); else if (!mapa.hasLayer(grupoLotes)) grupoLotes.addTo(mapa);
  if (!lejos) return;
  const porFinca = {};
  for (const l of lotesVisibles()) {
    if (!l.borde?.length) continue;
    const f = l.finca || "Sin finca"; (porFinca[f] ||= []).push(centroide(l.borde));
  }
  for (const [f, cs] of Object.entries(porFinca)) {
    const lat = cs.reduce((s, c) => s + c.lat, 0) / cs.length, lng = cs.reduce((s, c) => s + c.lng, 0) / cs.length;
    const m = L.marker([lat, lng], { icon: L.divIcon({ className: "", html: `<div style="display:flex;align-items:center;gap:8px"><div class="cluster">${cs.length}</div><span class="cluster-lbl"></span></div>`, iconSize: [46, 46], iconAnchor: [23, 23] }) });
    m.on("add", () => { const s = m.getElement()?.querySelector(".cluster-lbl"); if (s) s.textContent = f; });
    m.on("click", () => mapa.flyTo([lat, lng], 16));
    m.addTo(grupoClusters);
  }
}
$("bCapas").addEventListener("click", () => {
  if (mapa.hasLayer(capaSat)) { mapa.removeLayer(capaSat); toast("Sin fondo satelital"); $("bCapas").classList.add("on"); }
  else { capaSat.addTo(mapa); toast("Fondo satelital"); $("bCapas").classList.remove("on"); }
});
$("bGps").addEventListener("click", () => {
  if (!S.gps) { toast("Esperando señal GPS. Revisa que la ubicación esté activada.", true); return; }
  mapa.flyTo([S.gps.lat, S.gps.lng], Math.max(mapa.getZoom(), 17));
});
$("bFinca").addEventListener("click", () => {
  const fincas = [...new Set(S.lotes.map(l => l.finca).filter(Boolean))];
  abrirModal("Finca", el("div", { class: "tipos" },
    el("button", { onclick: () => { S.finca = ""; cerrarModal(); pintarLotes(); } }, el("b", {}, "Todas las fincas")),
    fincas.map(f => el("button", { onclick: () => { S.finca = f; cerrarModal(); pintarLotes.ajustado = false; pintarLotes(); } }, el("b", {}, f)))));
});

// Medir
let midiendo = false, ptsMedida = [], capaMedida = null;
$("bMedir").addEventListener("click", () => midiendo ? terminarMedida() : empezarMedida());
$("bMedirFin").addEventListener("click", () => terminarMedida());
function empezarMedida() { midiendo = true; ptsMedida = []; $("bMedir").classList.add("on"); $("measure").hidden = false; $("mapBottom").hidden = true; $("measureTxt").textContent = "Toca el mapa para medir"; }
function agregarPuntoMedida(ll) {
  ptsMedida.push(ll); if (capaMedida) mapa.removeLayer(capaMedida);
  capaMedida = (ptsMedida.length >= 3 ? L.polygon(ptsMedida, { color: "#E0A33A", weight: 2 }) : L.polyline(ptsMedida, { color: "#E0A33A", weight: 3 })).addTo(mapa);
  let d = 0; for (let i = 1; i < ptsMedida.length; i++) d += mapa.distance(ptsMedida[i - 1], ptsMedida[i]);
  const a = ptsMedida.length >= 3 ? areaHa(ptsMedida.map(p => ({ lat: p.lat, lng: p.lng }))) : null;
  $("measureTxt").textContent = `${num(d, 0)} m` + (a != null ? ` · ${num(a, 2)} ha` : "");
}
function terminarMedida() { midiendo = false; $("bMedir").classList.remove("on"); $("measure").hidden = true; $("mapBottom").hidden = !!S.loteSel; if (capaMedida) { mapa.removeLayer(capaMedida); capaMedida = null; } }

// ---------- Ficha del lote ----------
function seleccionarLote(id) {
  const prev = S.loteSel; S.loteSel = id;
  if (prev && polis.get(prev)) polis.get(prev).setStyle(estiloLote(false));
  const pol = polis.get(id); if (pol) { pol.setStyle(estiloLote(true)); mapa.flyToBounds(pol.getBounds(), { paddingBottomRight: [0, 280], paddingTopLeft: [20, 80], maxZoom: 18 }); }
  S.seg = "reg"; $("fMas").hidden = true;
  pintarFicha(lotePorId(id));
}
function cerrarFicha() {
  if (S.loteSel && polis.get(S.loteSel)) polis.get(S.loteSel).setStyle(estiloLote(false));
  S.loteSel = null; $("ficha").hidden = true; $("mapBottom").hidden = false;
}
$("fCerrar").addEventListener("click", cerrarFicha);
$("fMasBtn").addEventListener("click", () => { $("fMas").hidden = !$("fMas").hidden; $("fMasBtn").textContent = $("fMas").hidden ? "Más detalles ▾" : "Menos detalles ▴"; });
function pintarFicha(l) {
  if (!l) return;
  $("ficha").hidden = false; $("mapBottom").hidden = true;
  const aBorde = l.borde?.length ? areaHa(l.borde) : null;
  $("fNombre").textContent = l.nombre;
  $("fSub").textContent = [l.area_ha ? num(l.area_ha, 2) + " ha" : (aBorde ? num(aBorde, 2) + " ha (borde)" : null), l.finca].filter(Boolean).join(" · ");
  const dds = l.fechaSiembra ? diasEntre(l.fechaSiembra, fechaLocal()) : null;
  const filas = [["Municipio", l.municipio || "—"], ["Ciclo", l.ciclo || "—"],
    ["Siembra", l.fechaSiembra ? `${fmtFecha(l.fechaSiembra)} (${dds >= 0 ? dds + " días" : "faltan " + -dds + " días"})` : "Sin fecha"],
    ["Área sembrada", l.area_ha ? num(l.area_ha, 2) + " ha" : "Sin registrar"], ["Área del borde", aBorde ? num(aBorde, 2) + " ha" : "Sin borde"],
    ["Secciones de riego", l.secciones || "—"]];
  $("fMas").replaceChildren(...filas.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)]));
  $("fEditar").hidden = !S.admin;
  document.querySelectorAll("#ficha .seg button").forEach(b => b.setAttribute("aria-selected", b.dataset.seg === S.seg ? "true" : "false"));
  pintarSeg();
}
document.querySelectorAll("#ficha .seg button").forEach(b => b.addEventListener("click", () => {
  S.seg = b.dataset.seg; document.querySelectorAll("#ficha .seg button").forEach(x => x.setAttribute("aria-selected", x === b ? "true" : "false")); pintarSeg();
}));
function pintarSeg() {
  const body = $("fSegBody"), l = lotePorId(S.loteSel); if (!l) return;
  if (S.seg === "reg") {
    const regs = S.registros.filter(r => r.loteId === l.id);
    body.replaceChildren(regs.length ? el("div", { class: "list" }, regs.slice(0, 30).map(itemRegistro)) : el("div", { class: "empty" }, "Aún no hay registros en este lote."));
  } else if (S.seg === "vue") body.replaceChildren(el("div", { class: "empty" }, "Aquí van los ortomosaicos del Air 3S por fecha. Llega en la entrega 3 (mapas)."));
  else body.replaceChildren(el("div", { class: "empty" }, "Aquí van las zonas débiles del análisis de vigor RGB. Llega en la entrega 3 (mapas)."));
}
$("fRegistrar").addEventListener("click", () => elegirTipo(S.loteSel));
$("fEditar").addEventListener("click", () => formLote(lotePorId(S.loteSel)));
$("fNotas").addEventListener("click", () => {
  const l = lotePorId(S.loteSel); if (!l) return;
  if (!S.admin) { abrirModal("Etiquetas y notas", el("p", {}, l.notas || "Sin notas.")); return; }
  const ta = el("textarea", { id: "nNotas", rows: 6 }); ta.value = l.notas || "";
  abrirModal("Etiquetas y notas", el("label", { for: "nNotas" }, "Notas del lote (accesos, agua, linderos)", ta),
    el("button", { class: "btn primary", onclick: () => { updateDoc(doc(db, "lotes", l.id), { notas: ta.value.trim() }).catch(e => toast("No se guardó: " + e.code, true)); cerrarModal(); toast("Notas guardadas"); } }, "Guardar"));
});
$("fCompartir").addEventListener("click", async () => {
  const l = lotePorId(S.loteSel); if (!l?.borde?.length) { toast("Este lote no tiene borde todavía.", true); return; }
  const c = centroide(l.borde), url = `https://maps.google.com/?q=${c.lat.toFixed(6)},${c.lng.toFixed(6)}`;
  const texto = `${l.nombre} · ${l.finca || ""} ${l.municipio || ""}\n${url}`;
  try { if (navigator.share) await navigator.share({ title: l.nombre, text: texto }); else { await navigator.clipboard.writeText(texto); toast("Ubicación copiada"); } } catch (e) {}
});
$("fMasAcc").addEventListener("click", () => {
  const l = lotePorId(S.loteSel); if (!l) return;
  abrirModal(l.nombre, el("div", { class: "tipos" },
    el("button", { onclick: () => { descargarKml(l); cerrarModal(); } }, el("div", {}, el("b", {}, "Descargar KML"), el("span", {}, "Borde del lote para Google Earth o el plan de vuelo"))),
    S.admin && el("button", { onclick: () => { if (confirmar("¿Archivar este lote? Deja de verse en el mapa; sus registros se conservan.")) { updateDoc(doc(db, "lotes", l.id), { archivado: true }); cerrarModal(); cerrarFicha(); } } }, el("div", {}, el("b", {}, "Archivar lote"), el("span", {}, "Se oculta del mapa; no se borra nada")))));
});
function confirmar(msg) { return window.confirm(msg); }
function descargarKml(l) {
  if (!l.borde?.length) { toast("Sin borde", true); return; }
  const coords = [...l.borde, l.borde[0]].map(p => `${p.lng},${p.lat},0`).join(" ");
  const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${l.nombre}</name><Placemark><name>${l.nombre}</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>`;
  descargar(`${l.nombre.replace(/[^\w-]+/g, "_")}.kml`, kml, "application/vnd.google-earth.kml+xml");
}
function descargar(nombre, contenido, tipo) {
  const a = el("a", { href: URL.createObjectURL(new Blob([contenido], { type: tipo })), download: nombre }); document.body.append(a); a.click(); a.remove();
}

// Lista de lotes
$("bLista").addEventListener("click", listaLotes); $("bMenuLotes").addEventListener("click", listaLotes);
function listaLotes() {
  const vis = lotesVisibles();
  abrirModal("Lotes", vis.length ? el("div", { class: "list" }, vis.map(l => el("button", { class: "item", onclick: () => { cerrarModal(); irA("mapa"); seleccionarLote(l.id); } },
    el("div", { class: "top" }, el("span", {}, l.nombre), el("span", {}, l.area_ha ? num(l.area_ha, 2) + " ha" : (l.borde?.length ? num(areaHa(l.borde), 2) + " ha" : ""))),
    el("div", { class: "meta" }, [l.finca, l.municipio, l.ciclo].filter(Boolean).join(" · ") || "Sin datos")))) : el("div", { class: "empty" }, S.admin ? "No hay lotes. Créalo en Yo → Lotes." : "El administrador aún no ha creado lotes."),
    S.admin && el("button", { class: "btn primary", onclick: () => formLote(null) }, "+ Nuevo lote"));
}

// ---------- Formulario de lote (admin) ----------
function formLote(l) {
  const v = l || { nombre: "", finca: "El Cedral", municipio: "Tilodirán, Yopal", area_ha: "", secciones: "", ciclo: "Corte 1", fechaSiembra: "", borde: [] };
  let borde = v.borde || [];
  const inp = (id, label, val, type = "text", extra = {}) => { const i = el("input", { id, type, ...extra }); i.value = val ?? ""; return el("label", { for: id }, label, i); };
  const info = el("p", { class: "hint" }, borde.length ? `Borde cargado: ${borde.length} puntos, ${num(areaHa(borde), 2)} ha` : "Sin borde. Importa el KML o KMZ del lote.");
  const archivo = el("input", { type: "file", id: "loBorde", accept: ".kml,.kmz,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz" });
  archivo.addEventListener("change", async () => {
    const f = archivo.files[0]; if (!f) return;
    try {
      let texto;
      if (/\.kmz$/i.test(f.name)) { const z = await JSZip.loadAsync(f); const k = Object.keys(z.files).find(n => /\.kml$/i.test(n)); if (!k) throw new Error("El KMZ no trae un KML"); texto = await z.file(k).async("string"); }
      else texto = await f.text();
      borde = parseKml(texto);
      info.textContent = `Borde cargado: ${borde.length} puntos, ${num(areaHa(borde), 2)} ha`;
    } catch (e) { info.textContent = "No pude leer el archivo: " + e.message; }
  });
  const sel = el("select", { id: "loCiclo" }, ["Corte 1", "Rebrote 1", "Rebrote 2"].map(c => el("option", { value: c }, c))); sel.value = v.ciclo || "Corte 1";
  abrirModal(l ? "Editar lote" : "Nuevo lote",
    inp("loNombre", "Nombre del lote", v.nombre),
    el("div", { class: "grid2" }, inp("loFinca", "Finca", v.finca), inp("loMun", "Municipio", v.municipio)),
    el("div", { class: "grid2" }, inp("loArea", "Área sembrada (ha)", v.area_ha, "number", { step: "0.01", inputmode: "decimal" }), inp("loSecc", "Secciones de riego", v.secciones, "number", { inputmode: "numeric" })),
    el("div", { class: "grid2" }, el("label", { for: "loCiclo" }, "Ciclo actual", sel), inp("loSiembra", "Fecha de siembra", v.fechaSiembra, "date")),
    el("label", { for: "loBorde" }, "Borde del lote (KML o KMZ)", archivo), info,
    el("button", { class: "btn primary", onclick: () => {
      const nombre = $("loNombre").value.trim(); if (!nombre) { toast("Falta el nombre", true); return; }
      const datos = { nombre, finca: $("loFinca").value.trim(), municipio: $("loMun").value.trim(), area_ha: parseFloat($("loArea").value) || null,
        secciones: parseInt($("loSecc").value) || null, ciclo: sel.value, fechaSiembra: $("loSiembra").value || null, borde, actualizado: serverTimestamp() };
      const ref = l ? doc(db, "lotes", l.id) : doc(collection(db, "lotes"));
      setDoc(ref, l ? datos : { ...datos, creado: serverTimestamp(), archivado: false }, { merge: true }).catch(e => toast("No se guardó: " + e.code, true));
      cerrarModal(); toast(l ? "Lote actualizado" : "Lote creado"); pintarLotes.ajustado = false;
    } }, l ? "Guardar cambios" : "Crear lote"));
}

// ---------- Registros: tipos y formularios ----------
const TIPOS = {
  riego: { nombre: "Jornada de riego", desc: "Sección, horas de motobomba, gasolina", ico: "💧",
    campos: [
      { k: "seccion", l: "Sección regada", t: "seccion" },
      { k: "motobomba", l: "Motobomba", t: "cat", cat: "motobombas" },
      { k: "horaInicio", l: "Hora de inicio", t: "time", req: true },
      { k: "horaFin", l: "Hora final", t: "time", req: true },
      { k: "llego", l: "¿El agua llegó al final de los surcos?", t: "sino", def: true },
      { k: "nivelPozo", l: "Nivel del agua del pozo", t: "sel", ops: ["Normal", "Bajo", "Muy bajo"] },
      { k: "galones", l: "Gasolina tanqueada (galones)", t: "num", step: "0.1" },
      { k: "obs", l: "Observaciones", t: "texto" }] },
  fertilizacion: { nombre: "Fertilización", desc: "Producto, cantidad y área abonada", ico: "🌱",
    campos: [
      { k: "producto", l: "Producto", t: "cat", cat: "productos", req: true },
      { k: "cantidad", l: "Cantidad aplicada", t: "num", step: "0.1", req: true },
      { k: "unidad", l: "Unidad", t: "sel", ops: ["kg", "bultos de 50 kg", "L", "g"] },
      { k: "area", l: "Área abonada (ha)", t: "num", step: "0.01" },
      { k: "metodo", l: "Método", t: "sel", ops: ["En banda", "Al voleo", "Al pie de la planta", "Incorporado"] },
      { k: "fotos", l: "Fotos", t: "fotos" },
      { k: "obs", l: "Observaciones", t: "texto" }] },
  plaga: { nombre: "Monitoreo de plagas", desc: "Plantas revisadas y afectadas, con umbral", ico: "🐛",
    campos: [
      { k: "plaga", l: "Plaga", t: "plaga", req: true },
      { k: "seccion", l: "Sección o punto", t: "seccion" },
      { k: "revisadas", l: "Plantas revisadas", t: "num", def: 50, req: true },
      { k: "afectadas", l: "Plantas afectadas", t: "num", def: 0, req: true },
      { k: "fotos", l: "Fotos", t: "fotos" },
      { k: "obs", l: "Observaciones", t: "texto" }] }
};

function elegirTipo(loteId) {
  const lotes = lotesVisibles();
  if (!lotes.length) { toast(S.admin ? "Primero crea un lote." : "No hay lotes creados.", true); return; }
  if (!loteId && lotes.length === 1) loteId = lotes[0].id;
  if (!loteId) {
    abrirModal("¿En qué lote?", el("div", { class: "tipos" }, lotes.map(l => el("button", { onclick: () => elegirTipo(l.id) }, el("div", {}, el("b", {}, l.nombre), el("span", {}, [l.finca, l.ciclo].filter(Boolean).join(" · ")))))));
    return;
  }
  const l = lotePorId(loteId);
  abrirModal(`Registrar en ${l.nombre}`, el("div", { class: "tipos" }, Object.entries(TIPOS).map(([k, t]) =>
    el("button", { onclick: () => formRegistro(k, loteId) }, el("span", { style: "font-size:1.6rem" }, t.ico), el("div", {}, el("b", {}, t.nombre), el("span", {}, t.desc))))),
    el("p", { class: "hint" }, "Siembra, fumigación, combustible, inspección, labores y cosecha llegan en las siguientes entregas."));
}
$("bRegistrar").addEventListener("click", () => elegirTipo(null));
$("bNuevo").addEventListener("click", () => elegirTipo(S.loteSel));

function formRegistro(tipo, loteId, previo = null) {
  const T = TIPOS[tipo], l = lotePorId(loteId), cat = S.catalogos || CAT_DEFECTO;
  const val = previo ? { ...previo.datos } : {};
  const fotos = []; // nuevas, base64
  const ctrls = {};
  const partes = [];
  const fecha = el("input", { type: "date", id: "rFecha", max: fechaLocal() }); fecha.value = previo?.fechaHecho || fechaLocal();
  const just = el("input", { type: "text", id: "rJust", placeholder: "¿Por qué se anota días después?" }); just.value = previo?.justificacion || "";
  const lJust = el("label", { for: "rJust" }, "Justificación", just);
  partes.push(el("label", { for: "rFecha" }, "Fecha de la labor", fecha), lJust);
  const calc = el("div", { class: "calc", "aria-live": "polite" });
  for (const c of T.campos) {
    const id = "c_" + c.k; let ctrl;
    if (c.t === "texto") { ctrl = el("textarea", { id, rows: 3 }); ctrl.value = val[c.k] ?? ""; }
    else if (c.t === "num") { ctrl = el("input", { id, type: "number", inputmode: "decimal", step: c.step || "1", min: "0" }); ctrl.value = val[c.k] ?? c.def ?? ""; }
    else if (c.t === "time") { ctrl = el("input", { id, type: "time" }); ctrl.value = val[c.k] ?? ""; }
    else if (c.t === "sel") { ctrl = el("select", { id }, c.ops.map(o => el("option", { value: o }, o))); if (val[c.k]) ctrl.value = val[c.k]; }
    else if (c.t === "cat") { const ops = cat[c.cat] || []; ctrl = el("select", { id }, ops.map(o => el("option", { value: o }, o)), el("option", { value: "__otro" }, "Otro…")); if (val[c.k]) { if (!ops.includes(val[c.k])) ctrl.prepend(el("option", { value: val[c.k] }, val[c.k])); ctrl.value = val[c.k]; } }
    else if (c.t === "plaga") { ctrl = el("select", { id }, (cat.plagas || []).map(p => el("option", { value: p.nombre }, p.nombre))); if (val[c.k]) ctrl.value = val[c.k]; }
    else if (c.t === "seccion") { const n = l.secciones || 0; ctrl = el("select", { id }, el("option", { value: "Todo el lote" }, "Todo el lote"), Array.from({ length: n }, (_, i) => el("option", { value: String(i + 1) }, "Sección " + (i + 1)))); if (val[c.k]) ctrl.value = val[c.k]; }
    else if (c.t === "sino") {
      let v = val[c.k] ?? c.def ?? true;
      const bSi = el("button", { type: "button", "aria-pressed": v ? "true" : "false" }, "Sí"), bNo = el("button", { type: "button", "aria-pressed": v ? "false" : "true" }, "No");
      ctrl = el("div", { class: "sino", id }, bSi, bNo); ctrl.valor = () => v;
      bSi.onclick = () => { v = true; bSi.setAttribute("aria-pressed", "true"); bNo.setAttribute("aria-pressed", "false"); };
      bNo.onclick = () => { v = false; bNo.setAttribute("aria-pressed", "true"); bSi.setAttribute("aria-pressed", "false"); };
      partes.push(el("div", { style: "display:grid;gap:4px" }, el("span", { class: "hint" }, c.l), ctrl)); ctrls[c.k] = ctrl; continue;
    }
    else if (c.t === "fotos") {
      const prev = el("div", { class: "fotos" });
      const fi = el("input", { id, type: "file", accept: "image/*", capture: "environment" });
      fi.addEventListener("change", async () => {
        const f = fi.files[0]; if (!f) return; if (fotos.length >= 3) { toast("Máximo 3 fotos por registro", true); return; }
        try { const b64 = await comprimirFoto(f, 1280, 150_000); fotos.push(b64); prev.append(el("img", { src: b64, alt: "Foto " + fotos.length })); }
        catch (e) { toast("No pude procesar la foto", true); } fi.value = "";
      });
      partes.push(el("label", { for: id }, c.l + " (máx. 3, se toman con la cámara)", fi), prev); ctrls[c.k] = { fotos }; continue;
    }
    ctrls[c.k] = ctrl;
    partes.push(el("label", { for: id }, c.l + (c.req ? " *" : ""), ctrl));
    if (c.t === "cat") ctrl.addEventListener("change", () => { if (ctrl.value === "__otro") { const o = window.prompt("Escribe el nombre"); if (o) { ctrl.prepend(el("option", { value: o }, o)); ctrl.value = o; } else ctrl.selectedIndex = 0; } });
  }
  if (tipo === "riego" || tipo === "plaga") partes.splice(3, 0, calc);
  const leer = () => {
    const d = {};
    for (const c of T.campos) { const x = ctrls[c.k]; if (!x) continue;
      if (c.t === "sino") d[c.k] = x.valor(); else if (c.t === "fotos") continue; else if (c.t === "num") d[c.k] = x.value === "" ? null : Number(x.value); else d[c.k] = x.value; }
    if (tipo === "riego") d.horas = horasEntre(d.horaInicio, d.horaFin);
    if (tipo === "plaga") { const p = (cat.plagas || []).find(p => p.nombre === d.plaga); d.umbral = p?.umbral ?? 20; d.pct = d.revisadas > 0 ? Math.round((d.afectadas / d.revisadas) * 1000) / 10 : null; d.sobreUmbral = d.pct != null && d.pct >= d.umbral; }
    return d;
  };
  const pintarCalc = () => {
    const d = leer();
    if (tipo === "riego") { calc.className = "calc" + (d.horas == null ? "" : " ok"); calc.replaceChildren(el("span", { class: "hint" }, "Tiempo de motobomba"), el("b", {}, d.horas == null ? "—" : num(d.horas, 2) + " h")); }
    if (tipo === "plaga") { calc.className = "calc " + (d.pct == null ? "" : d.sobreUmbral ? "crit" : d.pct >= d.umbral * 0.75 ? "warn" : "ok");
      calc.replaceChildren(el("span", { class: "hint" }, `Afectación (umbral ${d.umbral} %)`), el("b", {}, d.pct == null ? "—" : num(d.pct, 1) + " %"), el("span", {}, d.pct == null ? "" : d.sobreUmbral ? "Sobre el umbral: avisar al administrador." : "Bajo el umbral: seguir monitoreando.")); }
    lJust.hidden = diasEntre(fecha.value, fechaLocal()) <= 3;
  };
  const cont = el("div", { style: "display:grid;gap:14px" }, ...partes);
  cont.addEventListener("input", pintarCalc); cont.addEventListener("click", () => setTimeout(pintarCalc, 0));
  const bGuardar = el("button", { class: "btn primary", type: "button" }, previo ? "Guardar corrección" : "Guardar registro");
  bGuardar.addEventListener("click", () => {
    const d = leer();
    for (const c of T.campos) if (c.req && (d[c.k] == null || d[c.k] === "")) { toast(`Falta: ${c.l}`, true); return; }
    if (!fecha.value) { toast("Falta la fecha", true); return; }
    if (diasEntre(fecha.value, fechaLocal()) > 3 && !just.value.trim()) { toast("La labor tiene más de 3 días: escribe la justificación.", true); return; }
    if (tipo === "riego" && d.horas == null) { toast("La hora final debe ser después de la de inicio.", true); return; }
    if (tipo === "plaga" && d.afectadas > d.revisadas) { toast("Las afectadas no pueden ser más que las revisadas.", true); return; }
    guardarRegistro({ tipo, loteId, datos: d, fechaHecho: fecha.value, justificacion: just.value.trim(), fotos }, previo);
    cerrarModal();
  });
  abrirModal((previo ? "Corregir · " : "") + T.nombre, el("p", { class: "hint" }, `${l.nombre} · ${l.ciclo || ""}`), cont, bGuardar);
  pintarCalc();
}

function guardarRegistro({ tipo, loteId, datos, fechaHecho, justificacion, fotos }, previo) {
  const l = lotePorId(loteId), nombre = S.perfil?.nombre || S.user.email;
  const fotoIds = (previo?.fotos || []).slice();
  for (const b64 of fotos) {
    const fr = doc(collection(db, "fotos")); fotoIds.push(fr.id);
    setDoc(fr, { autorUid: S.user.uid, data: b64, creado: serverTimestamp() }).catch(e => toast("Una foto no se pudo guardar (" + e.code + ")", true));
  }
  if (previo) {
    const cambios = { datos, fechaHecho, justificacion, fotos: fotoIds, version: increment(1), editadoEn: serverTimestamp(), editadoPor: S.user.uid,
      estado: S.admin && previo.estado === "aprobado" ? "aprobado" : (S.admin ? "aprobado" : "pendiente") };
    updateDoc(doc(db, "registros", previo.id), cambios).catch(e => toast("No se guardó la corrección (" + e.code + ")", true));
    auditar(previo.id, S.admin ? "editar" : "corregir", { datos: previo.datos, estado: previo.estado }, { datos, estado: cambios.estado });
    toast("Corrección guardada");
    return;
  }
  const ref = doc(collection(db, "registros"));
  const reg = { tipo, loteId, loteNombre: l.nombre, finca: l.finca || "", ciclo: l.ciclo || "", fechaHecho, justificacion, datos, fotos: fotoIds,
    autorUid: S.user.uid, autorNombre: nombre, estado: S.admin ? "aprobado" : "pendiente", autoaprobado: S.admin, version: 1,
    creadoLocal: new Date().toISOString(), creado: serverTimestamp(), gps: S.gps || null };
  setDoc(ref, reg).catch(e => toast("El servidor rechazó el registro (" + e.code + ")", true));
  auditar(ref.id, "crear", null, { datos, estado: reg.estado });
  toast(navigator.onLine ? "Registro guardado" : "Guardado en el celular. Se envía cuando haya señal.");
}
function auditar(registroId, accion, antes, despues, motivo = "") {
  setDoc(doc(collection(db, "auditoria")), { registroId, accion, motivo, uid: S.user.uid, nombre: S.perfil?.nombre || S.user.email,
    fecha: serverTimestamp(), fechaLocal: new Date().toISOString(), antes: antes ? JSON.stringify(antes) : "", despues: despues ? JSON.stringify(despues) : "" })
    .catch(() => {});
}

// ---------- Lista de registros ----------
function resumen(r) {
  const d = r.datos || {};
  if (r.tipo === "riego") return `Sección ${d.seccion || "—"} · ${num(d.horas, 2)} h${d.galones ? ` · ${num(d.galones, 1)} gal` : ""}${d.llego === false ? " · agua no llegó al final" : ""}`;
  if (r.tipo === "fertilizacion") return `${d.producto} · ${num(d.cantidad, 1)} ${d.unidad || ""}${d.area ? ` en ${num(d.area, 2)} ha` : ""}`;
  if (r.tipo === "plaga") return `${d.plaga} · ${num(d.pct, 1)} %${d.sobreUmbral ? " · sobre el umbral" : ""}`;
  return "";
}
function itemRegistro(r) {
  return el("button", { class: "item " + r.estado, onclick: () => detalleRegistro(r.id) },
    el("div", { class: "top" }, el("span", {}, TIPOS[r.tipo]?.nombre || r.tipo), el("span", { class: "pill " + (r._cola ? "cola" : r.estado) }, r._cola ? "En el celular" : ESTADOS[r.estado])),
    el("div", { class: "res" }, resumen(r)),
    el("div", { class: "meta" }, [fmtFecha(r.fechaHecho), r.loteNombre, r.autorNombre].filter(Boolean).join(" · ")));
}
const FILTROS = [["todos", "Todos"], ["pendiente", "Pendientes"], ["correccion", "Corrección"], ["aprobado", "Aprobados"], ["rechazado", "Rechazados"], ["anulado", "Anulados"]];
function pintarRegistros() {
  $("regFiltros").replaceChildren(...FILTROS.map(([k, t]) => {
    const n = k === "todos" ? S.registros.length : S.registros.filter(r => r.estado === k).length;
    return el("button", { "aria-pressed": S.filtroReg === k ? "true" : "false", onclick: () => { S.filtroReg = k; pintarRegistros(); } }, `${t} (${n})`);
  }));
  const lista = S.registros.filter(r => S.filtroReg === "todos" || r.estado === S.filtroReg);
  $("regLista").replaceChildren(lista.length ? el("div", { class: "list" }, lista.map(itemRegistro)) : el("div", { class: "empty" }, "No hay registros aquí."));
  const nPend = S.admin ? S.registros.filter(r => r.estado === "pendiente").length : S.registros.filter(r => r.estado === "correccion").length;
  $("regBadge").hidden = !nPend; $("regBadge").textContent = nPend;
}

async function detalleRegistro(id) {
  const r = S.registros.find(x => x.id === id); if (!r) return;
  const T = TIPOS[r.tipo] || { campos: [] }, d = r.datos || {};
  const filas = [["Lote", `${r.loteNombre} · ${r.ciclo || ""}`], ["Fecha de la labor", fmtFecha(r.fechaHecho)], ["Registrado por", r.autorNombre],
    ["Registrado el", r.creadoLocal ? new Date(r.creadoLocal).toLocaleString("es-CO") : "—"]];
  if (r.justificacion) filas.push(["Justificación", r.justificacion]);
  for (const c of T.campos) { if (c.t === "fotos") continue; let v = d[c.k]; if (v == null || v === "") continue; if (typeof v === "boolean") v = v ? "Sí" : "No"; filas.push([c.l, String(v)]); }
  if (r.tipo === "riego") filas.push(["Tiempo de motobomba", num(d.horas, 2) + " h"]);
  if (r.tipo === "plaga") filas.push(["Afectación", `${num(d.pct, 1)} % (umbral ${d.umbral} %)`]);
  if (r.gps) filas.push(["Ubicación al registrar", `${r.gps.lat.toFixed(5)}, ${r.gps.lng.toFixed(5)} (±${r.gps.prec} m)`]);
  if (r.motivo) filas.push(["Motivo del administrador", r.motivo]);
  const fotosBox = el("div", { class: "fotos" });
  const acciones = el("div", { style: "display:grid;gap:10px" });
  const historial = el("div", { class: "audit" });
  abrirModal(TIPOS[r.tipo]?.nombre || "Registro", el("span", { class: "pill " + (r._cola ? "cola" : r.estado) }, r._cola ? "En el celular, sin enviar" : ESTADOS[r.estado] + (r.autoaprobado ? " (autoaprobado)" : "")),
    el("dl", { class: "kv" }, filas.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)])), fotosBox, acciones, historial);
  // Fotos
  for (const fid of r.fotos || []) {
    getDoc(doc(db, "fotos", fid)).then(s => { if (s.exists()) { const img = el("img", { src: s.data().data, alt: "Evidencia" }); img.onclick = () => img.classList.toggle("big"); fotosBox.append(img); } }).catch(() => {});
  }
  // Acciones según rol y estado
  const motivoInp = el("input", { id: "aMotivo", type: "text", placeholder: "Motivo (obligatorio para rechazar, corregir o anular)" });
  const cambiar = (estado, accion, pideMotivo) => () => {
    const motivo = motivoInp.value.trim(); if (pideMotivo && !motivo) { toast("Escribe el motivo", true); motivoInp.focus(); return; }
    updateDoc(doc(db, "registros", r.id), { estado, motivo: motivo || r.motivo || "", revisadoPor: S.user.uid, revisadoEn: serverTimestamp() }).catch(e => toast("No se pudo (" + e.code + ")", true));
    auditar(r.id, accion, { estado: r.estado }, { estado }, motivo); cerrarModal(); toast("Registro " + ESTADOS[estado].toLowerCase());
  };
  if (S.admin) {
    if (r.estado === "pendiente") acciones.append(el("label", { for: "aMotivo" }, "Revisión", motivoInp), el("div", { class: "row-btns" },
      el("button", { class: "btn ok", onclick: cambiar("aprobado", "aprobar", false) }, "Aprobar"),
      el("button", { class: "btn", onclick: cambiar("correccion", "pedir corrección", true) }, "Pedir corrección"),
      el("button", { class: "btn danger", onclick: cambiar("rechazado", "rechazar", true) }, "Rechazar")));
    if (r.estado === "aprobado") acciones.append(el("label", { for: "aMotivo" }, "Cambios sobre un registro aprobado", motivoInp), el("div", { class: "row-btns" },
      el("button", { class: "btn", onclick: () => { cerrarModal(); formRegistro(r.tipo, r.loteId, r); } }, "Editar"),
      el("button", { class: "btn danger", onclick: cambiar("anulado", "anular", true) }, "Anular")));
  } else if (r.autorUid === S.user.uid && (r.estado === "pendiente" || r.estado === "correccion")) {
    acciones.append(el("button", { class: "btn primary", onclick: () => { cerrarModal(); formRegistro(r.tipo, r.loteId, r); } }, r.estado === "correccion" ? "Corregir y reenviar" : "Editar"));
  }
  if (S.admin) {
    try {
      const qs = await getDocs(query(collection(db, "auditoria"), where("registroId", "==", r.id)));
      const evs = qs.docs.map(x => x.data()).sort((a, b) => (a.fechaLocal || "").localeCompare(b.fechaLocal || ""));
      historial.replaceChildren(el("b", {}, "Historial de cambios"), ...evs.map(e => el("div", {}, `${new Date(e.fechaLocal).toLocaleString("es-CO")} · ${e.nombre} · ${e.accion}${e.motivo ? " · " + e.motivo : ""}`)));
    } catch (e) { historial.textContent = "Historial no disponible sin señal."; }
  }
}

// ---------- Alertas ----------
function alertas() {
  const out = [], hace15 = (() => { const t = new Date(); t.setDate(t.getDate() - 15); return fechaLocal(t); })();
  if (S.admin) { const n = S.registros.filter(r => r.estado === "pendiente").length; if (n) out.push({ t: `${n} registro(s) esperan tu revisión`, go: () => { S.filtroReg = "pendiente"; irA("registros"); pintarRegistros(); } }); }
  else { const n = S.registros.filter(r => r.estado === "correccion").length; if (n) out.push({ t: `${n} registro(s) para corregir`, go: () => { S.filtroReg = "correccion"; irA("registros"); pintarRegistros(); } }); }
  for (const r of S.registros) {
    if (r.estado === "anulado" || r.estado === "rechazado" || r.fechaHecho < hace15) continue;
    if (r.tipo === "plaga" && r.datos?.sobreUmbral) out.push({ t: `${r.loteNombre}: ${r.datos.plaga} en ${num(r.datos.pct, 1)} % (${fmtFecha(r.fechaHecho)})`, go: () => detalleRegistro(r.id) });
    if (r.tipo === "riego" && r.datos?.llego === false) out.push({ t: `${r.loteNombre}: el agua no llegó al final en la sección ${r.datos.seccion} (${fmtFecha(r.fechaHecho)})`, go: () => detalleRegistro(r.id) });
  }
  if (S.pendientesSync) out.unshift({ t: `${S.pendientesSync} registro(s) guardados en el celular, sin enviar`, go: () => {} });
  return out;
}
function pintarAlertas() { const n = alertas().length; $("alertBadge").hidden = !n; $("alertBadge").textContent = n; }
$("bAlertas").addEventListener("click", () => {
  const a = alertas();
  abrirModal("Alertas", a.length ? el("div", { class: "tipos" }, a.map(x => el("button", { onclick: () => { cerrarModal(); x.go(); } }, el("div", {}, el("b", { style: "font-size:1rem;font-family:var(--body)" }, x.t))))) : el("div", { class: "empty" }, "Sin alertas."));
});

// ---------- Panel ----------
$("panelLote").addEventListener("change", pintarPanel);
function pintarPanel() {
  if (!S.admin) return;
  const sel = $("panelLote"), prev = sel.value;
  sel.replaceChildren(el("option", { value: "" }, "Todos los lotes"), ...S.lotes.map(l => el("option", { value: l.id }, l.nombre))); sel.value = prev;
  const ap = S.registros.filter(r => r.estado === "aprobado" && (!sel.value || r.loteId === sel.value));
  const riegos = ap.filter(r => r.tipo === "riego"), ferts = ap.filter(r => r.tipo === "fertilizacion"), plagas = ap.filter(r => r.tipo === "plaga");
  const horas = riegos.reduce((s, r) => s + (r.datos?.horas || 0), 0), gal = riegos.reduce((s, r) => s + (r.datos?.galones || 0), 0);
  const area = S.lotes.filter(l => !l.archivado && (!sel.value || l.id === sel.value)).reduce((s, l) => s + (l.area_ha || 0), 0);
  const sobre = plagas.filter(r => r.datos?.sobreUmbral).length;
  const pend = S.registros.filter(r => r.estado === "pendiente").length;
  const kpi = (v, t, alerta) => el("div", { class: "kpi" + (alerta ? " alerta" : "") }, el("b", {}, v), el("span", {}, t));
  $("kpis").replaceChildren(kpi(num(area, 2), "Hectáreas sembradas"), kpi(num(horas, 1), "Horas de motobomba"), kpi(num(gal, 1), "Galones de gasolina (riego)"),
    kpi(ferts.length, "Fertilizaciones"), kpi(plagas.length, "Monitoreos de plagas"), kpi(sobre, "Monitoreos sobre el umbral", sobre > 0), kpi(pend, "Por revisar", pend > 0));
  const porProd = {};
  for (const r of ferts) { const k = `${r.datos.producto} (${r.datos.unidad})`; porProd[k] = (porProd[k] || 0) + (r.datos.cantidad || 0); }
  $("panelExtra").replaceChildren(
    el("div", { class: "card" }, el("h3", {}, "Fertilizante aplicado"), Object.keys(porProd).length ? el("table", { class: "t" }, el("tbody", {}, Object.entries(porProd).map(([k, v]) => el("tr", {}, el("td", {}, k), el("td", { class: "n" }, num(v, 1)))))) : el("p", { class: "hint" }, "Sin fertilizaciones aprobadas.")),
    el("div", { class: "card" }, el("h3", {}, "Exportar"), el("p", { class: "hint" }, "Registros aprobados en CSV, para la plantilla de Excel."), el("button", { class: "btn", onclick: exportarCsv }, "Descargar CSV")),
    el("p", { class: "hint" }, "Solo cuentan los registros aprobados. Costos, rendimiento y más indicadores llegan en la entrega 6."));
}
function exportarCsv() {
  const ap = S.registros.filter(r => r.estado === "aprobado");
  const cols = ["fechaHecho", "tipo", "loteNombre", "ciclo", "autorNombre", "resumen", "seccion", "horas", "galones", "producto", "cantidad", "unidad", "area", "plaga", "revisadas", "afectadas", "pct", "obs"];
  const filas = ap.map(r => cols.map(c => csvEscape(c === "resumen" ? resumen(r) : (r[c] ?? r.datos?.[c] ?? ""))).join(";"));
  descargar(`registros_aprobados_${fechaLocal()}.csv`, "﻿" + cols.join(";") + "\n" + filas.join("\n"), "text/csv");
}

// ---------- Yo ----------
function pintarYo() {
  const p = S.perfil || {};
  $("yoCard").replaceChildren(el("h3", {}, p.nombre || S.user.email), el("dl", { class: "kv" }, el("dt", {}, "Correo"), el("dd", {}, S.user.email), el("dt", {}, "Rol"), el("dd", {}, S.admin ? "Administrador" : "Usuario de campo")));
  if (!S.admin) { $("yoAdmin").replaceChildren(); return; }
  $("yoAdmin").replaceChildren(
    el("div", { class: "card" }, el("h3", {}, "Lotes"), el("div", { class: "row-btns" }, el("button", { class: "btn", onclick: listaLotes }, "Ver lotes"), el("button", { class: "btn primary", onclick: () => formLote(null) }, "+ Nuevo lote"))),
    el("div", { class: "card" }, el("h3", {}, "Usuarios"), el("div", { class: "row-btns" }, el("button", { class: "btn", onclick: listaUsuarios }, "Ver usuarios"), el("button", { class: "btn primary", onclick: formUsuario }, "+ Trabajador"))),
    el("div", { class: "card" }, el("h3", {}, "Catálogos"), el("p", { class: "hint" }, "Productos, motobombas y plagas con su umbral."), el("button", { class: "btn", onclick: formCatalogos }, "Editar catálogos")));
}
async function listaUsuarios() {
  try {
    const qs = await getDocs(collection(db, "usuarios"));
    abrirModal("Usuarios", el("div", { class: "list" }, qs.docs.map(d => { const u = d.data(); return el("div", { class: "item " + (u.activo ? "aprobado" : "anulado") },
      el("div", { class: "top" }, el("span", {}, u.nombre), el("span", { class: "pill " + (u.activo ? "aprobado" : "anulado") }, u.activo ? "Activo" : "Inactivo")),
      el("div", { class: "meta" }, `${u.correo} · ${u.rol === "admin" ? "Administrador" : "Campo"}`),
      d.id !== S.user.uid && el("button", { class: "btn small", onclick: () => { updateDoc(doc(db, "usuarios", d.id), { activo: !u.activo }); cerrarModal(); toast(u.activo ? "Usuario desactivado" : "Usuario activado"); } }, u.activo ? "Desactivar" : "Activar")); })));
  } catch (e) { toast("Necesitas señal para ver los usuarios", true); }
}
function formUsuario() {
  const n = el("input", { id: "uNom", type: "text" }), c = el("input", { id: "uCor", type: "email" }), p = el("input", { id: "uPas", type: "text", minlength: "6" });
  const rol = el("select", { id: "uRol" }, el("option", { value: "campo" }, "Usuario de campo"), el("option", { value: "admin" }, "Administrador"));
  abrirModal("Nuevo usuario", el("label", { for: "uNom" }, "Nombre", n), el("label", { for: "uCor" }, "Correo", c), el("label", { for: "uPas" }, "Contraseña inicial (mínimo 6)", p), el("label", { for: "uRol" }, "Rol", rol),
    el("p", { class: "hint" }, "Necesita señal. Anota la contraseña y entrégasela al trabajador."),
    el("button", { class: "btn primary", onclick: async ev => {
      if (!n.value.trim() || !c.value.trim() || p.value.length < 6) { toast("Completa nombre, correo y una contraseña de 6 o más", true); return; }
      ev.target.disabled = true;
      try {
        const sec = initializeApp(firebaseConfig, "sec-" + Date.now()); const a2 = getAuth(sec);
        const cred = await createUserWithEmailAndPassword(a2, c.value.trim(), p.value); await signOut(a2);
        await setDoc(doc(db, "usuarios", cred.user.uid), { nombre: n.value.trim(), correo: c.value.trim(), rol: rol.value, activo: true, creado: serverTimestamp() });
        cerrarModal(); toast("Usuario creado");
      } catch (e) { ev.target.disabled = false; toast(e.code === "auth/email-already-in-use" ? "Ese correo ya tiene cuenta" : "No se pudo crear (" + e.code + ")", true); }
    } }, "Crear usuario"));
}
function formCatalogos() {
  const cat = S.catalogos || CAT_DEFECTO;
  const ta = (id, label, val) => { const t = el("textarea", { id, rows: 5 }); t.value = val; return el("label", { for: id }, label, t); };
  abrirModal("Catálogos", ta("cProd", "Productos (uno por línea)", (cat.productos || []).join("\n")), ta("cMoto", "Motobombas y equipos (uno por línea)", (cat.motobombas || []).join("\n")),
    ta("cPlag", "Plagas: nombre; umbral % (una por línea)", (cat.plagas || []).map(p => `${p.nombre}; ${p.umbral}`).join("\n")),
    el("button", { class: "btn primary", onclick: () => {
      const lineas = id => $(id).value.split("\n").map(s => s.trim()).filter(Boolean);
      const plagas = lineas("cPlag").map(s => { const [nombre, u] = s.split(";"); return { nombre: nombre.trim(), umbral: parseFloat(u) || 20 }; });
      setDoc(doc(db, "config", "catalogos"), { productos: lineas("cProd"), motobombas: lineas("cMoto"), plagas }).catch(e => toast("No se guardó: " + e.code, true));
      cerrarModal(); toast("Catálogos guardados");
    } }, "Guardar"));
}

// ---------- Service worker (trabajo sin conexión) ----------
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
