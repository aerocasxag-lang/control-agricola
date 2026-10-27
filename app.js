// Control Agrícola · AeroCAS — v0.4 (entrega 4: todos los módulos de registro, inventario y costos)
// App web offline-first con Firebase (Auth + Firestore con caché local).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, terminate, clearIndexedDbPersistence, collection, doc, setDoc, updateDoc,
  getDoc, getDocs, onSnapshot, query, where, serverTimestamp, increment, deleteDoc, writeBatch, deleteField }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { areaHa, parseKml, centroide, fechaLocal, diasEntre, comprimirFoto, csvEscape } from "./util.js";
import { TIPOS, ORDEN_TIPOS, CAT_DEFECTO, normCat, prodDe, prodsTipo, derivar, vistaCalculo, revisar, resumen, filasCalculadas, fmtDosis,
  inventario, precioGalon, costos, consumos, pesos, TIPOS_PROD, UNIDADES_DOSIS, esEquipo, CATEGORIAS_GASTO } from "./modulos.js";
import { BASES, ponerBase, baseGuardada, teselasZona, descargarTeselas } from "./mapas.js";
import { procesarGeoTiff, partir } from "./orto.js";
import { CRONO } from "./cronograma.js";
import { SECCIONES, LISTA_BASE, tipoPorSeccion, RUBRO_POR_SECCION } from "./lista.js";

const VERSION = "0.9 · 27-oct-2026";
// Si una librería no cargó (pasa una vez justo después de actualizar), se recarga la página una sola vez.
if (typeof L === "undefined") {
  let ya = false; try { ya = sessionStorage.getItem("recargaLibs") === "1"; sessionStorage.setItem("recargaLibs", "1"); } catch (e) {}
  if (!ya) location.reload();
} else { try { sessionStorage.removeItem("recargaLibs"); } catch (e) {} }
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
  filtroReg: "todos", filtroTipo: "", seg: "reg", base: "sat",
  ortos: [], verOrto: true, verVigor: false, ortoSel: {}, // ortoSel[loteId] = id del ortomosaico elegido
  lista: [], listaCargada: false, vistaGastos: "gastos"
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
  $("mTitulo").textContent = titulo; $("mBody").replaceChildren(...contenido.flat().filter(x => x != null && x !== false)); $("modal").hidden = false;
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
  // Al cerrar sesión se borran del celular los datos guardados para usar sin señal, para que otra persona no los vea.
  try { await terminate(db); await clearIndexedDbPersistence(db); } catch (e) {}
  location.reload();
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
    $("tabPanel").hidden = !S.admin; $("tabGastos").hidden = !S.admin;
    pintarYo(); escucharRegistros(); if (S.admin) escucharLista();
  }, () => {}));
  // Lotes
  S.unsubs.push(onSnapshot(collection(db, "lotes"), snap => {
    S.lotes = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));
    pintarLotes(); pintarPanel(); pintarGastos();
    if (S.loteSel) { const l = lotePorId(S.loteSel); if (l) pintarFicha(l); else cerrarFicha(); }
  }, () => {}));
  // Ortomosaicos (solo la ficha; la imagen se carga aparte)
  S.unsubs.push(onSnapshot(collection(db, "ortos"), snap => {
    S.ortos = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
    if (S.loteSel) { mostrarCapasLote(S.loteSel); if (S.seg !== "reg") pintarSeg(); }
  }, () => {}));
  // Catálogos
  S.unsubs.push(onSnapshot(doc(db, "config", "catalogos"), snap => {
    S.catalogos = normCat(snap.exists() ? snap.data() : CAT_DEFECTO);
    if (!snap.exists() && S.admin && !snap.metadata.fromCache) setDoc(doc(db, "config", "catalogos"), CAT_DEFECTO);
  }, () => { S.catalogos = normCat(CAT_DEFECTO); }));
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
    pintarRed(); pintarRegistros(); pintarPanel(); pintarGastos(); pintarAlertas();
    if (S.loteSel && S.seg === "reg") pintarSeg();
  }, err => toast("No se pudieron leer los registros (" + err.code + ")", true));
  S.unsubs.push(() => { unsubReg && unsubReg(); unsubReg = null; regModo = null; });
}

// ---------- Navegación ----------
document.querySelectorAll("#tabbar button").forEach(b => b.addEventListener("click", () => irA(b.dataset.v)));
function irA(v) {
  document.querySelectorAll("#tabbar button").forEach(x => x.setAttribute("aria-selected", x.dataset.v === v ? "true" : "false"));
  ["mapa", "registros", "gastos", "panel", "yo"].forEach(x => $("v-" + x).hidden = x !== v);
  if (v === "mapa" && mapa) setTimeout(() => mapa.invalidateSize(), 50);
}

// ---------- Mapa ----------
let mapa = null, grupoLotes = null, grupoClusters = null, marcadorGps = null;
const polis = new Map();
function iniciarMapa() {
  if (mapa) return;
  mapa = L.map("map", { zoomControl: false, attributionControl: true, maxZoom: 21 }).setView([5.33, -72.39], 11);
  S.base = ponerBase(mapa, baseGuardada());
  mapa.createPane("ortos"); mapa.getPane("ortos").style.zIndex = 350;
  mapa.createPane("vigor"); mapa.getPane("vigor").style.zIndex = 360;
  grupoLotes = L.layerGroup().addTo(mapa);
  grupoClusters = L.layerGroup().addTo(mapa);
  mapa.on("zoomend", alternarClusters);
  mapa.on("moveend", () => { try { const c = mapa.getCenter(); localStorage.setItem("ultimaVista", JSON.stringify({ lat: c.lat, lng: c.lng, z: mapa.getZoom() })); } catch (e) {} });
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
    pol.bindTooltip(el("span", {}, l.nombre), { permanent: false, direction: "center" }); // nodo de texto: el nombre nunca se interpreta como HTML
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
$("bCapas").addEventListener("click", abrirCapas);
function abrirCapas() {
  const bases = el("div", { class: "tipos" }, Object.entries(BASES).map(([k, b]) =>
    el("button", { "aria-pressed": S.base === k ? "true" : "false", style: S.base === k ? "border-color:var(--ok);background:var(--ok-bg)" : "",
      onclick: () => { S.base = ponerBase(mapa, k); cerrarModal(); toast("Mapa: " + b.nombre); } },
      el("div", {}, el("b", {}, (S.base === k ? "✓ " : "") + b.nombre), el("span", {}, b.desc)))));
  const chk = (id, txt, val, fn) => { const c = el("input", { type: "checkbox", id }); c.checked = val; c.addEventListener("change", () => fn(c.checked));
    return el("label", { for: id, class: "check-row" }, c, el("span", {}, txt)); };
  abrirModal("Capas del mapa",
    el("h3", {}, "Mapa de fondo"), bases,
    el("h3", {}, "Sobre el lote"),
    chk("cOrto", "Ortomosaico del lote seleccionado", S.verOrto, v => { S.verOrto = v; if (S.loteSel) mostrarCapasLote(S.loteSel); }),
    chk("cVigor", "Mapa de vigor (zonas débiles en rojo)", S.verVigor, v => { S.verVigor = v; if (S.loteSel) mostrarCapasLote(S.loteSel); }),
    el("h3", {}, "Usar sin señal"),
    el("p", { class: "hint" }, "Guarda en el celular el satélite de la zona que estás viendo para abrirlo en la sabana sin datos. Hazlo con wifi antes de salir. Los lotes, registros y ortomosaicos ya abiertos también quedan guardados."),
    el("button", { class: "btn primary", onclick: () => { cerrarModal(); descargarZona(); } }, "Guardar esta zona para usar sin señal"));
}
let descargando = false;
async function descargarZona() {
  if (descargando) return;
  if (!navigator.onLine) { toast("Necesitas señal (mejor wifi) para guardar la zona.", true); return; }
  const b = mapa.getBounds(), z0 = Math.max(12, mapa.getZoom() - 2), z1 = 18;
  const base = BASES[S.base]?.offline && BASES[S.base].capas.length ? BASES[S.base] : BASES.sat;
  const urls = base.capas.flatMap(([u]) => teselasZona(b, z0, z1, u));
  if (urls.length > 6000) { toast(`La zona es muy grande (${urls.length} imágenes). Acércate más al lote y repite.`, true); return; }
  const mb = Math.round(urls.length * 25 / 1024);
  if (!window.confirm(`Se guardarán ${urls.length} imágenes del satélite (unos ${mb} MB) de la zona que ves, del zoom ${z0} al ${z1}. ¿Continuar?`)) return;
  descargando = true; let cancel = false;
  const t = $("toast"); t.className = "toast"; t.hidden = false;
  const r = await descargarTeselas(urls, (h, n) => { t.textContent = `Guardando mapa sin señal… ${Math.round(h / n * 100)} %`; }, () => cancel);
  descargando = false; toast(r.fallas ? `Zona guardada (${r.fallas} imágenes fallaron; repite si hace falta)` : "Zona guardada. Ya puedes verla sin señal.");
}

// ---------- Ortomosaicos y vigor sobre el lote ----------
let capaOrto = null, capaVigor = null, ortoCargado = null;
const cacheImg = new Map();
function ortosDe(loteId) { return S.ortos.filter(o => o.loteId === loteId); }
function ortoElegido(loteId) { const os = ortosDe(loteId); return os.find(o => o.id === S.ortoSel[loteId]) || os[0] || null; }
async function imagenOrto(o) {
  if (cacheImg.has(o.id)) return cacheImg.get(o.id);
  const qs = await getDocs(query(collection(db, "ortoPartes"), where("ortoId", "==", o.id)));
  const partes = qs.docs.map(d => d.data()).sort((a, b) => a.i - b.i);
  if (partes.length < o.partes) throw new Error("faltan partes");
  const url = partes.map(p => p.data).join(""); cacheImg.set(o.id, url); return url;
}
async function mostrarCapasLote(loteId) {
  if (!mapa) return;
  const o = ortoElegido(loteId);
  const quitar = () => { if (capaOrto) { mapa.removeLayer(capaOrto); capaOrto = null; } if (capaVigor) { mapa.removeLayer(capaVigor); capaVigor = null; } ortoCargado = null; };
  if (!o || (!S.verOrto && !S.verVigor)) { quitar(); return; }
  const lim = [[o.bounds.s, o.bounds.w], [o.bounds.n, o.bounds.e]];
  if (ortoCargado !== o.id + S.verOrto + S.verVigor) {
    quitar(); ortoCargado = o.id + S.verOrto + S.verVigor;
    if (S.verVigor && o.vigor?.png) { capaVigor = L.imageOverlay(o.vigor.png, lim, { pane: "vigor", opacity: .8, className: "pixelado", interactive: false }).addTo(mapa); }
    if (S.verOrto) {
      try { const url = await imagenOrto(o); if (ortoCargado === o.id + S.verOrto + S.verVigor) capaOrto = L.imageOverlay(url, lim, { pane: "ortos", interactive: false }).addTo(mapa); }
      catch (e) { toast(navigator.onLine ? "No se pudo cargar el ortomosaico" : "Este ortomosaico no está guardado en el celular. Ábrelo una vez con señal.", true); }
    }
  }
}
function segVuelos(l) {
  const os = ortosDe(l.id), sel = ortoElegido(l.id);
  const lista = os.length ? el("div", { class: "list" }, os.map(o => el("div", { class: "item " + (sel?.id === o.id ? "aprobado" : "") },
    el("div", { class: "top" }, el("span", {}, "Vuelo " + fmtFecha(o.fecha)), el("span", { class: "pill " + (sel?.id === o.id ? "aprobado" : "cola") }, sel?.id === o.id ? "En el mapa" : "")),
    el("div", { class: "meta" }, `${num(o.gsdCm, 1)} cm/px en la app · ${o.origen?.crs || ""} · ${o.nombre || ""}`),
    o.vigor && el("div", { class: "res" }, o.vigor.sinCultivo ? "Sin cultivo visible todavía" : `Cobertura mediana ${num(o.vigor.mediana, 1)} % · ${o.vigor.debiles} celdas débiles (${num(o.vigor.areaDebilHa, 2)} ha)`),
    el("div", { class: "row-btns" },
      el("button", { class: "btn small", onclick: () => { S.ortoSel[l.id] = o.id; S.verOrto = true; mostrarCapasLote(l.id); pintarSeg(); } }, "Ver en el mapa"),
      S.admin && el("button", { class: "btn small", onclick: () => borrarOrto(o) }, "Quitar")))))
    : el("div", { class: "empty" }, "Este lote no tiene ortomosaicos todavía.");
  return el("div", { style: "display:grid;gap:10px" }, lista,
    S.admin ? el("button", { class: "btn primary", onclick: () => formOrto(l) }, "+ Subir ortomosaico (GeoTIFF)") : null,
    el("p", { class: "hint" }, "Para tenerlo sin señal en el campo, ábrelo una vez con señal: queda guardado en el celular."));
}
function segVigor(l) {
  const o = ortoElegido(l.id);
  if (!o) return el("div", { class: "empty" }, "Sube un ortomosaico en «Vuelos» y aquí aparece el mapa de vigor.");
  const v = o.vigor || {};
  const kv = [["Vuelo", fmtFecha(o.fecha)], ["Cobertura verde mediana", num(v.mediana, 1) + " %"], ["Débil si está por debajo de", num(v.corte, 1) + " %"],
    ["Celdas débiles", `${v.debiles} de ${v.total} (celdas de ${v.celdaM} m)`], ["Área débil", num(v.areaDebilHa, 2) + " ha"]];
  return el("div", { style: "display:grid;gap:10px" },
    v.sinCultivo ? el("div", { class: "calc warn" }, el("b", {}, "Sin cultivo visible"), el("span", {}, "Casi no hay verde en la imagen. Si el cultivo tiene menos de 10 días, vuela de nuevo en una semana.")) : null,
    el("dl", { class: "kv" }, kv.flatMap(([a, b]) => [el("dt", {}, a), el("dd", {}, b)])),
    el("div", { class: "leyenda" }, el("span", { class: "sw", style: "background:#D63027" }), "Débil", el("span", { class: "sw", style: "background:#F7E878" }), "Poca cobertura", el("span", { class: "sw", style: "background:#2F9828" }), "Buena cobertura"),
    el("button", { class: "btn " + (S.verVigor ? "" : "primary"), onclick: () => { S.verVigor = !S.verVigor; mostrarCapasLote(l.id); pintarSeg(); } }, S.verVigor ? "Ocultar vigor del mapa" : "Ver vigor en el mapa"),
    el("p", { class: "hint" }, "Una celda débil es una alerta para ir a mirar: falta de agua, mala germinación, plaga o encharcamiento. La causa se confirma en el campo y se anota como registro."));
}
function formOrto(l) {
  const f = el("input", { type: "file", id: "oArchivo", accept: ".tif,.tiff,image/tiff" });
  const fecha = el("input", { type: "date", id: "oFecha", max: fechaLocal() }); fecha.value = fechaLocal();
  const estado = el("p", { class: "hint", "aria-live": "polite" }, "Exporta el ortomosaico como GeoTIFF RGB (WGS84 o UTM), recortado al lote si puedes. La app lo reduce para que pese poco.");
  const b = el("button", { class: "btn primary" }, "Procesar y guardar");
  b.addEventListener("click", async () => {
    const file = f.files[0]; if (!file) { toast("Elige el archivo GeoTIFF", true); return; }
    if (!navigator.onLine) { toast("Necesitas señal para subir el ortomosaico.", true); return; }
    b.disabled = true;
    try {
      const r = await procesarGeoTiff(file, { borde: l.borde, paso: t => estado.textContent = t });
      const ref = doc(collection(db, "ortos")), partes = partir(r.data);
      estado.textContent = `Guardando (${partes.length} parte(s), ${Math.round(r.data.length / 1024)} KB)…`;
      for (let i = 0; i < partes.length; i++) await setDoc(doc(db, "ortoPartes", `${ref.id}_${i}`), { ortoId: ref.id, i, data: partes[i] });
      await setDoc(ref, { loteId: l.id, fecha: fecha.value, nombre: file.name, bounds: r.bounds, ancho: r.ancho, alto: r.alto, gsdCm: r.gsdCm, origen: r.origen,
        vigor: r.vigor, partes: partes.length, creado: serverTimestamp(), autorUid: S.user.uid });
      cacheImg.set(ref.id, r.data); S.ortoSel[l.id] = ref.id; S.verOrto = true;
      cerrarModal(); toast("Ortomosaico guardado"); S.seg = "vue"; pintarFicha(l); mapa.flyToBounds([[r.bounds.s, r.bounds.w], [r.bounds.n, r.bounds.e]], { paddingBottomRight: [0, 280] });
    } catch (e) { b.disabled = false; estado.textContent = "No se pudo: " + (e.message || e.code || e); }
  });
  abrirModal("Subir ortomosaico", el("p", { class: "hint" }, l.nombre), el("label", { for: "oFecha" }, "Fecha del vuelo", fecha), el("label", { for: "oArchivo" }, "Archivo GeoTIFF", f), estado, b);
}
function borrarOrto(o) {
  if (!window.confirm(`¿Quitar el ortomosaico del ${fmtFecha(o.fecha)}? Se borra de la app; tu archivo original no se toca.`)) return;
  for (let i = 0; i < (o.partes || 0); i++) deleteDoc(doc(db, "ortoPartes", `${o.id}_${i}`)).catch(() => {});
  deleteDoc(doc(db, "ortos", o.id)).catch(e => toast("No se pudo quitar (" + e.code + ")", true));
  cacheImg.delete(o.id); toast("Ortomosaico quitado");
}
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
  pintarFicha(lotePorId(id)); mostrarCapasLote(id);
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
    ["Secciones de riego", l.secciones || "—"], ["Corte previsto", l.fechaCorte ? `${fmtFecha(l.fechaCorte)} (${diasEntre(fechaLocal(), l.fechaCorte) >= 0 ? "faltan " + diasEntre(fechaLocal(), l.fechaCorte) + " días" : "ya pasó"})` : "Sin fecha"]];
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
  } else if (S.seg === "age") body.replaceChildren(segAgenda(l));
  else if (S.seg === "vue") body.replaceChildren(segVuelos(l));
  else body.replaceChildren(segVigor(l));
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
    S.admin && el("button", { class: "btn primary", onclick: () => formLote(null) }, "+ Nuevo lote"),
    S.admin && el("p", { class: "hint" }, "Para un lote nuevo puedes importar un KML/KMZ, dibujar el borde sobre el satélite o caminarlo con el GPS del celular."));
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
    el("div", { class: "grid2" }, inp("loCorte", "Corte previsto", v.fechaCorte, "date"), el("span")),
    el("label", { for: "loBorde" }, "Borde del lote (KML o KMZ)", archivo), info,
    el("button", { class: "btn primary", onclick: () => {
      const nombre = $("loNombre").value.trim(); if (!nombre) { toast("Falta el nombre", true); return; }
      const datos = { nombre, finca: $("loFinca").value.trim(), municipio: $("loMun").value.trim(), area_ha: parseFloat($("loArea").value) || null,
        secciones: parseInt($("loSecc").value) || null, ciclo: sel.value, fechaSiembra: $("loSiembra").value || null, fechaCorte: $("loCorte").value || null, borde, actualizado: serverTimestamp() };
      const ref = l ? doc(db, "lotes", l.id) : doc(collection(db, "lotes"));
      setDoc(ref, l ? datos : { ...datos, creado: serverTimestamp(), archivado: false }, { merge: true }).catch(e => toast("No se guardó: " + e.code, true));
      cerrarModal(); toast(l ? "Lote actualizado" : "Lote creado"); pintarLotes.ajustado = false;
    } }, l ? "Guardar cambios" : "Crear lote"));
}

// ---------- Registros: menú y formularios ----------
const catActual = () => S.catalogos || normCat(CAT_DEFECTO);
function elegirTipo(loteId) {
  const lotes = lotesVisibles();
  if (!lotes.length) { toast(S.admin ? "Primero crea un lote." : "No hay lotes creados.", true); return; }
  if (!loteId && lotes.length === 1) loteId = lotes[0].id;
  if (!loteId) {
    abrirModal("¿En qué lote?", el("div", { class: "tipos" }, lotes.map(l => el("button", { onclick: () => elegirTipo(l.id) }, el("div", {}, el("b", {}, l.nombre), el("span", {}, [l.finca, l.ciclo].filter(Boolean).join(" · ")))))),
      el("button", { class: "btn", onclick: () => formRegistro("compra", null) }, "🧾 Compra de insumos (no va a un lote)"));
    return;
  }
  const l = lotePorId(loteId);
  abrirModal(`Registrar en ${l.nombre}`, el("div", { class: "tipos" }, ORDEN_TIPOS.map(k => { const t = TIPOS[k];
    return el("button", { onclick: () => formRegistro(k, t.sinLote ? null : loteId) }, el("span", { style: "font-size:1.6rem", "aria-hidden": "true" }, t.ico), el("div", {}, el("b", {}, t.nombre), el("span", {}, t.desc))); })));
}
$("bRegistrar").addEventListener("click", () => elegirTipo(null));
$("bNuevo").addEventListener("click", () => elegirTipo(S.loteSel));

function selectOtro(id, ops, valor, etiqueta = "Escribe el nombre") {
  const s = el("select", { id }, ops.map(o => el("option", { value: o }, o)), el("option", { value: "__otro" }, "Otro…"));
  if (valor) { if (!ops.includes(valor)) s.prepend(el("option", { value: valor }, valor)); s.value = valor; }
  s.addEventListener("change", () => { if (s.value !== "__otro") return; const o = window.prompt(etiqueta); if (o && o.trim()) { s.prepend(el("option", { value: o.trim() }, o.trim())); s.value = o.trim(); } else s.selectedIndex = 0; s.dispatchEvent(new Event("input", { bubbles: true })); });
  return s;
}
// Varios productos con su dosis por hectárea (mezcla de tanque)
function ctrlDosis(id, campo, cat, previos) {
  const ops = prodsTipo(cat, campo.tipos), filas = el("div", { class: "dosis", id });
  const fila = (p = {}) => {
    const u = el("select", { "aria-label": "Unidad de la dosis" }, UNIDADES_DOSIS.map(x => el("option", { value: x }, x))); u.value = p.unidad || "L/ha";
    const s = selectOtro(null, ["", ...ops], p.producto, "Nombre del producto"); s.setAttribute("aria-label", "Producto");
    if (!p.producto) s.value = "";
    s.querySelector('option[value=""]').textContent = "Producto…";
    s.addEventListener("change", () => { const pr = prodDe(cat, s.value); if (pr && !p.unidad) u.value = pr.unidad === "L" ? "L/ha" : "kg/ha"; });
    const n = el("input", { type: "number", inputmode: "decimal", step: "0.01", min: "0", "aria-label": "Dosis por hectárea", placeholder: "Dosis" }); n.value = p.dosis ?? "";
    const f = el("div", { class: "dosis-fila" }, s, n, u,
      el("button", { type: "button", class: "btn small", "aria-label": "Quitar producto", onclick: () => { f.remove(); filas.dispatchEvent(new Event("input", { bubbles: true })); } }, "×"));
    f.leer = () => s.value && s.value !== "__otro" && Number(n.value) > 0 ? { producto: s.value, dosis: Number(n.value), unidad: u.value } : null;
    filas.append(f);
  };
  (previos?.length ? previos : [{}]).forEach(p => fila(p));
  const cont = el("div", { style: "display:grid;gap:8px" }, filas,
    el("button", { type: "button", class: "btn small", onclick: () => { if (filas.children.length < 6) fila(); } }, "+ Otro producto en la mezcla"));
  cont.valor = () => [...filas.children].map(f => f.leer()).filter(Boolean);
  return cont;
}

function formRegistro(tipo, loteId, previo = null, opts = {}) {
  const T = TIPOS[tipo], l = T.sinLote ? null : lotePorId(loteId), cat = catActual();
  if (!T.sinLote && !l) { toast("Lote no encontrado", true); return; }
  const val = previo ? { ...previo.datos } : { ...(opts.inicial || {}) };
  const fotos = [], ctrls = {}, partes = [];
  const fecha = el("input", { type: "date", id: "rFecha", max: fechaLocal() }); fecha.value = previo?.fechaHecho || fechaLocal();
  const just = el("input", { type: "text", id: "rJust", placeholder: "¿Por qué se anota días después?" }); just.value = previo?.justificacion || "";
  const lJust = el("label", { for: "rJust" }, "Justificación", just);
  if (T.nota) partes.push(el("p", { class: "hint" }, T.nota));
  partes.push(el("label", { for: "rFecha" }, tipo === "compra" ? "Fecha de la compra" : "Fecha de la labor", fecha), lJust);
  const calc = el("div", { class: "calc", "aria-live": "polite" }), avisosBox = el("div", { class: "avisos", "aria-live": "polite" });
  for (const c of T.campos) {
    const id = "c_" + c.k; let ctrl;
    const etiqueta = c.l + (c.req ? " *" : "");
    if (c.t === "texto") { ctrl = el("textarea", { id, rows: 3 }); ctrl.value = val[c.k] ?? ""; }
    else if (c.t === "txt") {
      ctrl = el("input", { id, type: "text", placeholder: c.ph || null, list: c.sug ? id + "_sug" : null }); ctrl.value = val[c.k] ?? "";
      if (c.sug) partes.push(el("datalist", { id: id + "_sug" }, c.sug.map(o => el("option", { value: o }))));
    }
    else if (c.t === "alturas") { ctrl = el("input", { id, type: "text", inputmode: "decimal", placeholder: "Ej.: 45 52 48 50 47 …" }); ctrl.value = val[c.k] ?? ""; }
    else if (c.t === "num") { ctrl = el("input", { id, type: "number", inputmode: "decimal", step: c.step || "1", min: "0" }); ctrl.value = val[c.k] ?? c.def ?? ""; }
    else if (c.t === "time") { ctrl = el("input", { id, type: "time" }); ctrl.value = val[c.k] ?? ""; }
    else if (c.t === "sel") { ctrl = el("select", { id }, c.ops.map(o => el("option", { value: o }, o))); if (val[c.k]) ctrl.value = val[c.k]; }
    else if (c.t === "cat") ctrl = selectOtro(id, cat[c.cat] || [], val[c.k]);
    else if (c.t === "prod") {
      ctrl = selectOtro(id, [...prodsTipo(cat, c.tipos), ...(c.conEquipos ? cat.equipos : [])], val[c.k], "Nombre del producto (pídele al administrador que lo agregue al catálogo)");
      if (c.conEquipos) ctrl.addEventListener("change", () => { const u = $("c_unidad"); if (u && cat.equipos.includes(ctrl.value)) { u.value = "unidad"; $("c_cantidad").value ||= 1; } });
    }
    else if (c.t === "plaga") { ctrl = el("select", { id }, cat.plagas.map(p => el("option", { value: p.nombre }, p.nombre))); if (val[c.k]) ctrl.value = val[c.k]; }
    else if (c.t === "seccion") { const n = l?.secciones || 0; ctrl = el("select", { id }, el("option", { value: "Todo el lote" }, "Todo el lote"), Array.from({ length: n }, (_, i) => el("option", { value: String(i + 1) }, "Sección " + (i + 1)))); if (val[c.k]) ctrl.value = val[c.k]; }
    else if (c.t === "dosis") { ctrl = ctrlDosis(id, c, cat, val[c.k]); partes.push(el("div", { style: "display:grid;gap:6px" }, el("span", { class: "hint" }, etiqueta), ctrl)); ctrls[c.k] = ctrl; continue; }
    else if (c.t === "sino") {
      let v = val[c.k] ?? c.def ?? true;
      const bSi = el("button", { type: "button", "aria-pressed": v ? "true" : "false" }, "Sí"), bNo = el("button", { type: "button", "aria-pressed": v ? "false" : "true" }, "No");
      ctrl = el("div", { class: "sino", id, role: "group", "aria-label": c.l }, bSi, bNo); ctrl.valor = () => v;
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
    if ((c.t === "texto" || c.t === "txt") && Dictado) { partes.push(el("div", { class: "con-mic" }, el("label", { for: id }, etiqueta, ctrl), botonDictar(ctrl))); }
    else partes.push(el("label", { for: id }, etiqueta, ctrl));
    if (c.ayuda) partes.push(el("p", { class: "hint", style: "margin-top:-8px" }, c.ayuda));
  }
  partes.push(calc, avisosBox);
  const leer = () => {
    const d = {};
    for (const c of T.campos) { const x = ctrls[c.k]; if (!x || c.t === "fotos") continue;
      if (c.t === "sino" || c.t === "dosis") d[c.k] = x.valor(); else if (c.t === "num") d[c.k] = x.value === "" ? null : Number(x.value); else d[c.k] = x.value; }
    return derivar(tipo, d, cat, fecha.value);
  };
  const pintarCalc = () => {
    const d = leer(), v = vistaCalculo(tipo, d);
    calc.hidden = !v;
    if (v) { calc.className = "calc " + (v.cls || ""); calc.replaceChildren(el("span", { class: "hint" }, v.titulo), el("b", {}, v.valor), v.texto ? el("span", {}, v.texto) : null); }
    const av = revisar(tipo, d, cat, l);
    avisosBox.replaceChildren(...av.map(a => el("div", { class: "aviso " + (a.nivel === "bloquea" ? "crit" : "warn") }, a.t)));
    lJust.hidden = diasEntre(fecha.value, fechaLocal()) <= 3;
  };
  const cont = el("div", { style: "display:grid;gap:14px" }, ...partes);
  cont.addEventListener("input", pintarCalc); cont.addEventListener("change", pintarCalc); cont.addEventListener("click", () => setTimeout(pintarCalc, 0));
  const bGuardar = el("button", { class: "btn primary", type: "button" }, previo ? "Guardar corrección" : "Guardar registro");
  bGuardar.addEventListener("click", () => {
    const d = leer();
    for (const c of T.campos) { const v = d[c.k]; if (c.req && (v == null || v === "" || (Array.isArray(v) && !v.length))) { toast(`Falta: ${c.l}`, true); return; } }
    if (!fecha.value) { toast("Falta la fecha", true); return; }
    if (diasEntre(fecha.value, fechaLocal()) > 3 && !just.value.trim()) { toast("La labor tiene más de 3 días: escribe la justificación.", true); return; }
    const bloq = revisar(tipo, d, cat, l).find(a => a.nivel === "bloquea"); if (bloq) { toast(bloq.t, true); return; }
    const nuevoId = guardarRegistro({ tipo, loteId: l?.id || null, datos: d, fechaHecho: fecha.value, justificacion: just.value.trim(), fotos }, previo);
    cerrarModal();
    if (nuevoId && opts.alGuardar) opts.alGuardar(nuevoId);
  });
  abrirModal((previo ? "Corregir · " : "") + T.nombre, el("p", { class: "hint" }, l ? `${l.nombre} · ${l.ciclo || ""}` : "Bodega (no va a un lote)"), cont, bGuardar);
  pintarCalc();
}

// Dictado por voz (Chrome en Android y en el computador; necesita señal).
const Dictado = window.SpeechRecognition || window.webkitSpeechRecognition;
function botonDictar(campo) {
  const b = el("button", { type: "button", class: "mic", "aria-label": "Dictar con la voz", title: "Dictar con la voz" }, "🎤");
  let rec = null;
  b.addEventListener("click", () => {
    if (rec) { rec.stop(); return; }
    if (!navigator.onLine) { toast("El dictado necesita señal. Escribe la nota o díctala con el teclado del celular.", true); return; }
    rec = new Dictado(); rec.lang = "es-CO"; rec.interimResults = false; rec.continuous = false;
    const antes = campo.value;
    rec.onresult = e => { const t = [...e.results].map(r => r[0].transcript).join(" ").trim(); campo.value = (antes ? antes + " " : "") + t; campo.dispatchEvent(new Event("input", { bubbles: true })); };
    rec.onerror = e => toast(e.error === "not-allowed" ? "Permite el micrófono para dictar." : "No se entendió. Intenta otra vez.", true);
    rec.onend = () => { rec = null; b.classList.remove("on"); };
    b.classList.add("on"); rec.start();
  });
  return b;
}

// El registro de siembra aprobado pone la fecha de siembra y el área sembrada en el lote.
function aplicarSiembra(r) {
  if (!S.admin || r.tipo !== "siembra" || !r.loteId) return;
  const l = lotePorId(r.loteId); if (!l) return;
  const cambios = { fechaSiembra: r.fechaHecho, area_ha: r.datos?.area || l.area_ha || null, actualizado: serverTimestamp() };
  updateDoc(doc(db, "lotes", r.loteId), cambios).then(() => toast(`Lote actualizado: siembra ${fmtFecha(r.fechaHecho)}, ${num(cambios.area_ha, 2)} ha`)).catch(() => {});
}

function guardarRegistro({ tipo, loteId, datos, fechaHecho, justificacion, fotos }, previo) {
  const l = loteId ? lotePorId(loteId) : null, nombre = S.perfil?.nombre || S.user.email;
  const fotoIds = (previo?.fotos || []).slice();
  for (const b64 of fotos) {
    const fr = doc(collection(db, "fotos")); fotoIds.push(fr.id);
    setDoc(fr, { autorUid: S.user.uid, data: b64, creado: serverTimestamp() }).catch(e => toast("Una foto no se pudo guardar (" + e.code + ")", true));
  }
  if (previo) {
    const cambios = { datos, fechaHecho, justificacion, fotos: fotoIds, version: increment(1), editadoEn: serverTimestamp(), editadoPor: S.user.uid,
      estado: S.admin ? "aprobado" : "pendiente" };
    updateDoc(doc(db, "registros", previo.id), cambios).catch(e => toast("No se guardó la corrección (" + e.code + ")", true));
    auditar(previo.id, S.admin ? "editar" : "corregir", { datos: previo.datos, estado: previo.estado }, { datos, estado: cambios.estado });
    if (S.admin) aplicarSiembra({ ...previo, datos, fechaHecho });
    toast("Corrección guardada");
    return;
  }
  const ref = doc(collection(db, "registros"));
  const reg = { tipo, loteId: l?.id || null, loteNombre: l?.nombre || "Bodega", finca: l?.finca || "", ciclo: l?.ciclo || "", fechaHecho, justificacion, datos, fotos: fotoIds,
    autorUid: S.user.uid, autorNombre: nombre, estado: S.admin ? "aprobado" : "pendiente", autoaprobado: S.admin, version: 1,
    creadoLocal: new Date().toISOString(), creado: serverTimestamp(), gps: S.gps || null };
  setDoc(ref, reg).catch(e => toast("El servidor rechazó el registro (" + e.code + ")", true));
  auditar(ref.id, "crear", null, { datos, estado: reg.estado });
  if (S.admin) aplicarSiembra(reg);
  toast(navigator.onLine ? "Registro guardado" : "Guardado en el celular. Se envía cuando haya señal.");
  return ref.id;
}
function auditar(registroId, accion, antes, despues, motivo = "") {
  setDoc(doc(collection(db, "auditoria")), { registroId, accion, motivo, uid: S.user.uid, nombre: S.perfil?.nombre || S.user.email,
    fecha: serverTimestamp(), fechaLocal: new Date().toISOString(), antes: antes ? JSON.stringify(antes) : "", despues: despues ? JSON.stringify(despues) : "" })
    .catch(() => {});
}

// ---------- Lista de registros ----------
function itemRegistro(r) {
  const T = TIPOS[r.tipo];
  return el("button", { class: "item " + r.estado, onclick: () => detalleRegistro(r.id) },
    el("div", { class: "top" }, el("span", {}, (T ? T.ico + " " + T.nombre : r.tipo)), el("span", { class: "pill " + (r._cola ? "cola" : r.estado) }, r._cola ? "En el celular" : ESTADOS[r.estado])),
    el("div", { class: "res" }, resumen(r)),
    el("div", { class: "meta" }, [fmtFecha(r.fechaHecho), r.loteNombre, r.autorNombre].filter(Boolean).join(" · ")));
}
const FILTROS = [["todos", "Todos"], ["pendiente", "Pendientes"], ["correccion", "Corrección"], ["aprobado", "Aprobados"], ["rechazado", "Rechazados"], ["anulado", "Anulados"]];
function pintarRegistros() {
  const porTipo = S.registros.filter(r => !S.filtroTipo || r.tipo === S.filtroTipo);
  const selTipo = el("select", { "aria-label": "Tipo de registro", onchange: e => { S.filtroTipo = e.target.value; pintarRegistros(); } },
    el("option", { value: "" }, "Todos los tipos"), ORDEN_TIPOS.map(k => el("option", { value: k }, TIPOS[k].nombre)));
  selTipo.value = S.filtroTipo;
  $("regFiltros").replaceChildren(selTipo, ...FILTROS.map(([k, t]) => {
    const n = k === "todos" ? porTipo.length : porTipo.filter(r => r.estado === k).length;
    return el("button", { "aria-pressed": S.filtroReg === k ? "true" : "false", onclick: () => { S.filtroReg = k; pintarRegistros(); } }, `${t} (${n})`);
  }));
  const lista = porTipo.filter(r => S.filtroReg === "todos" || r.estado === S.filtroReg);
  $("regLista").replaceChildren(lista.length ? el("div", { class: "list" }, lista.map(itemRegistro)) : el("div", { class: "empty" }, "No hay registros aquí."));
  const nPend = S.admin ? S.registros.filter(r => r.estado === "pendiente").length : S.registros.filter(r => r.estado === "correccion").length;
  $("regBadge").hidden = !nPend; $("regBadge").textContent = nPend;
}

async function detalleRegistro(id) {
  const r = S.registros.find(x => x.id === id); if (!r) return;
  const T = TIPOS[r.tipo] || { campos: [] }, d = r.datos || {};
  const filas = [[r.loteId ? "Lote" : "Destino", r.loteId ? `${r.loteNombre} · ${r.ciclo || ""}` : "Bodega"], ["Fecha", fmtFecha(r.fechaHecho)], ["Registrado por", r.autorNombre],
    ["Registrado el", r.creadoLocal ? new Date(r.creadoLocal).toLocaleString("es-CO") : "—"]];
  if (r.justificacion) filas.push(["Justificación", r.justificacion]);
  for (const c of T.campos) {
    if (c.t === "fotos") continue; let v = d[c.k];
    if (c.t === "dosis") v = fmtDosis(v);
    if (v == null || v === "") continue; if (typeof v === "boolean") v = v ? "Sí" : "No";
    if (c.t === "num" && /\(\$\)/.test(c.l)) v = pesos(v);
    filas.push([c.l, String(v)]);
  }
  filas.push(...filasCalculadas(r));
  if (r.gps) filas.push(["Ubicación al registrar", `${r.gps.lat.toFixed(5)}, ${r.gps.lng.toFixed(5)} (±${r.gps.prec} m)`]);
  if (r.motivo) filas.push(["Motivo del administrador", r.motivo]);
  const fotosBox = el("div", { class: "fotos" });
  const acciones = el("div", { style: "display:grid;gap:10px" });
  const historial = el("div", { class: "audit" });
  abrirModal(T.nombre || "Registro", el("span", { class: "pill " + (r._cola ? "cola" : r.estado) }, r._cola ? "En el celular, sin enviar" : ESTADOS[r.estado] + (r.autoaprobado ? " (autoaprobado)" : "")),
    el("dl", { class: "kv" }, filas.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)])), fotosBox, acciones, historial);
  for (const fid of r.fotos || []) {
    getDoc(doc(db, "fotos", fid)).then(s => { if (s.exists()) { const img = el("img", { src: s.data().data, alt: "Evidencia" }); img.onclick = () => img.classList.toggle("big"); fotosBox.append(img); } }).catch(() => {});
  }
  const motivoInp = el("input", { id: "aMotivo", type: "text", placeholder: "Motivo (obligatorio para rechazar, corregir o anular)" });
  const cambiar = (estado, accion, pideMotivo) => () => {
    const motivo = motivoInp.value.trim(); if (pideMotivo && !motivo) { toast("Escribe el motivo", true); motivoInp.focus(); return; }
    updateDoc(doc(db, "registros", r.id), { estado, motivo: motivo || r.motivo || "", revisadoPor: S.user.uid, revisadoEn: serverTimestamp() }).catch(e => toast("No se pudo (" + e.code + ")", true));
    auditar(r.id, accion, { estado: r.estado }, { estado }, motivo); cerrarModal(); toast("Registro " + ESTADOS[estado].toLowerCase());
    if (estado === "aprobado") aplicarSiembra(r);
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

// ---------- Agenda: cronograma por días desde la siembra ----------
const sumarDias = (f, n) => { const [y, m, d] = f.split("-").map(Number); const t = new Date(y, m - 1, d + n); return fechaLocal(t); };
function fechaCorte1(l) {
  const c = S.registros.filter(r => r.loteId === l.id && r.tipo === "cosecha" && vigente(r)).map(r => r.fechaHecho).sort()[0];
  return { fecha: c || l.fechaCorte || (l.fechaSiembra ? sumarDias(l.fechaSiembra, 95) : null), real: !!c };
}
function agenda(l) {
  if (!l?.fechaSiembra) return null;
  const hoy = fechaLocal(), corte = fechaCorte1(l), marcas = l.crono || {};
  return CRONO.map(it => {
    const base = it.base === "corte" ? corte.fecha : l.fechaSiembra;
    const fecha = sumarDias(base, it.dia), fin = sumarDias(fecha, Math.max(0, (it.dur || 1) - 1));
    const m = marcas[it.id];
    const estado = m ? m.estado : fin < hoy ? "atrasada" : fecha <= hoy ? "hoy" : diasEntre(hoy, fecha) <= 7 ? "pronto" : "futura";
    return { ...it, fecha, fin, marca: m || null, estado, estimada: it.base === "corte" && !corte.real };
  });
}
const etiquetaDia = it => it.base === "corte" ? `Corte ${it.dia >= 0 ? "+" : ""}${it.dia}` : it.dia < 0 ? `Día ${it.dia}` : `Día ${it.dia}`;
const ESTADO_AG = { hecha: "Hecha", omitida: "No fue necesaria", noaplica: "No aplica", atrasada: "Atrasada", hoy: "Hoy", pronto: "Próxima", futura: "" };
function filaAgenda(l, it) {
  const cls = it.estado === "atrasada" && it.tipo !== "cond" ? "rechazado" : it.estado === "hoy" ? "pendiente" : it.marca ? "aprobado" : "";
  return el("button", { class: "item ag " + cls, onclick: () => detalleAgenda(l.id, it.id) },
    el("div", { class: "top" }, el("span", {}, it.act),
      it.tipo !== "labor" ? el("span", { class: "pill " + (it.tipo === "fija" ? "aprobado" : "correccion") }, it.tipo === "fija" ? "Fija" : "Si hay umbral") : null),
    el("div", { class: "meta" }, [`${etiquetaDia(it)} · ${fmtFecha(it.fecha)}${it.fin !== it.fecha ? " a " + fmtFecha(it.fin) : ""}${it.estimada ? " (estimada)" : ""}`,
      ESTADO_AG[it.estado]].filter(Boolean).join(" · ")));
}
function segAgenda(l) {
  const ag = agenda(l);
  if (!ag) return el("div", { class: "empty" }, S.admin ? "Pon la fecha de siembra (real o prevista) en «Editar» y aquí aparece qué toca cada día." : "El administrador aún no ha puesto la fecha de siembra.");
  const hoy = fechaLocal(), dds = diasEntre(l.fechaSiembra, hoy), corte = fechaCorte1(l);
  const enRebrote = corte.real && hoy >= corte.fecha;
  const cab = enRebrote ? `Rebrote: día ${diasEntre(corte.fecha, hoy)} desde el corte 1` : dds >= 0 ? `Hoy es el día ${dds} desde la siembra` : `Faltan ${-dds} días para la siembra`;
  const atras = ag.filter(i => i.estado === "atrasada"), ahora = ag.filter(i => i.estado === "hoy" || i.estado === "pronto");
  const resto = ag.filter(i => i.estado === "futura"), hechas = ag.filter(i => i.marca);
  const grupo = (t, its, abierto, nota) => its.length ? el("details", { class: "ag-grupo", open: abierto ? true : null },
    el("summary", {}, `${t} (${its.length})`), nota ? el("p", { class: "hint" }, nota) : null, el("div", { class: "list" }, its.map(i => filaAgenda(l, i)))) : null;
  return el("div", { style: "display:grid;gap:10px" },
    el("div", { class: "calc ok" }, el("b", {}, cab), el("span", {}, `Siembra: ${fmtFecha(l.fechaSiembra)} · Corte 1: ${fmtFecha(corte.fecha)}${corte.real ? "" : " (previsto)"}`)),
    grupo("Atrasadas", atras, true, "Márcalas como hechas, o «no aplica» si no tocaba. Las condicionales solo se hacen si el monitoreo pasó el umbral."),
    S.admin && atras.some(i => i.base === "siembra" && i.dia < 0) ? el("button", { class: "btn small", onclick: () => {
      const pre = atras.filter(i => i.base === "siembra" && i.dia < 0);
      if (!confirmar(`¿Marcar como hechas las ${pre.length} labores de antes de la siembra que siguen pendientes? Luego puedes cambiar cualquiera.`)) return;
      const cambios = {}; for (const i of pre) cambios["crono." + i.id] = { estado: "hecha", fecha: fechaLocal(), uid: S.user.uid, registroId: null };
      updateDoc(doc(db, "lotes", l.id), cambios).then(() => toast("Labores de presiembra marcadas")).catch(e => toast("No se guardó (" + e.code + ")", true));
    } }, "Ya hice todo lo de antes de la siembra") : null,
    grupo("Hoy y próximos 7 días", ahora, true),
    !atras.length && !ahora.length ? el("div", { class: "empty" }, "Nada pendiente para esta semana.") : null,
    grupo("Más adelante", resto, false), grupo("Hechas o descartadas", hechas, false),
    el("p", { class: "hint" }, "Las fechas salen de la fecha de siembra del lote. Las del rebrote se cuentan desde el registro de corte 1; mientras no exista, desde el corte previsto."));
}
function detalleAgenda(loteId, id) {
  const l = lotePorId(loteId), it = agenda(l)?.find(x => x.id === id); if (!it) return;
  const marcar = (estado, registroId = null) => {
    updateDoc(doc(db, "lotes", l.id), { ["crono." + it.id]: { estado, fecha: fechaLocal(), uid: S.user.uid, registroId } }).catch(e => toast("No se guardó (" + e.code + ")", true));
  };
  const reg = (tipo, txt) => el("button", { class: "btn primary", onclick: () => { cerrarModal();
    formRegistro(tipo, l.id, null, { inicial: inicialAgenda(tipo, it), alGuardar: rid => { if (S.admin && (it.tipo !== "cond" || tipo === "fumigacion")) marcar("hecha", rid); } }); } }, txt);
  const botones = [];
  if (it.tipo === "cond") { botones.push(reg("plaga", "Registrar el monitoreo"), reg("fumigacion", "Pasó el umbral: registrar la aplicación")); }
  else if (it.reg) botones.push(reg(it.reg, /parasitoide/i.test(it.act) ? "Registrar la liberación" : "Registrar " + TIPOS[it.reg].nombre.toLowerCase()));
  if (S.admin) {
    if (it.marca) botones.push(el("button", { class: "btn", onclick: () => { updateDoc(doc(db, "lotes", l.id), { ["crono." + it.id]: deleteField() }).catch(() => {}); cerrarModal(); } }, "Volver a pendiente"));
    else botones.push(el("div", { class: "row-btns" },
      el("button", { class: "btn ok", onclick: () => { marcar("hecha"); cerrarModal(); toast("Marcada como hecha"); } }, "Marcar hecha"),
      el("button", { class: "btn", onclick: () => { marcar(it.tipo === "cond" ? "omitida" : "noaplica"); cerrarModal(); } }, it.tipo === "cond" ? "No fue necesaria" : "No aplica")));
  }
  const filas = [["Cuándo", `${etiquetaDia(it)} · ${fmtFecha(it.fecha)}${it.fin !== it.fecha ? " a " + fmtFecha(it.fin) : ""}${it.estimada ? " (estimada)" : ""}`], ["Fase", it.fase],
    ["Tipo", it.tipo === "fija" ? "Fija: se hace sí o sí" : it.tipo === "cond" ? "Condicional: solo si el monitoreo pasa el umbral" : "Labor"], ["Quién o con qué", it.resp || "—"]];
  if (it.marca) filas.push(["Estado", `${ESTADO_AG[it.marca.estado]} (${fmtFecha(it.marca.fecha)})`]);
  const r = it.marca?.registroId && S.registros.find(x => x.id === it.marca.registroId);
  abrirModal(it.act, el("dl", { class: "kv" }, filas.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)])),
    it.obj ? el("p", { class: "hint", style: "font-size:.95rem;color:var(--fg)" }, it.obj) : null, r ? itemRegistro(r) : null, ...botones);
}
function inicialAgenda(tipo, it) {
  const obs = `Agenda: ${it.act} (${etiquetaDia(it)})`, ini = { obs };
  if (tipo === "labor") { const a = it.act.toLowerCase(); ini.labor = /desyerbe|maleza|escapes/.test(a) ? "Desyerbe manual" : /arada/.test(a) ? "Arado" : /pulida/.test(a) ? "Rastrillo" : /surcado/.test(a) ? "Surcado" : /silo|picadora/.test(a) ? "Corte y ensilaje" : /instalaci/.test(a) ? "Riego" : "Otra"; }
  if (tipo === "plaga") { const p = (catActual().plagas || []).find(x => it.act.toLowerCase().includes(x.nombre.toLowerCase().split(" ")[0])); if (p) ini.plaga = p.nombre; }
  return ini;
}
function alertasAgenda() {
  const out = [], hoy = fechaLocal();
  for (const l of lotesVisibles()) {
    const ag = agenda(l); if (!ag) continue;
    const ir = () => { irA("mapa"); seleccionarLote(l.id); S.seg = "age"; pintarFicha(l); };
    for (const it of ag) {
      if (it.estado === "hoy") out.push({ t: `${l.nombre}: ${it.tipo === "cond" ? "revisar umbral — " : "hoy toca "}${it.act} (${etiquetaDia(it)})`, go: ir });
      else if (it.estado === "atrasada" && it.tipo !== "cond" && it.reg !== null && diasEntre(it.fin, hoy) <= 10) out.push({ t: `${l.nombre}: atrasada — ${it.act} (${fmtFecha(it.fecha)})`, go: ir });
    }
  }
  return out;
}

// ---------- Alertas ----------
const vigente = r => r.estado !== "anulado" && r.estado !== "rechazado";
function alertas() {
  const out = [], hoy = fechaLocal(), hace15 = (() => { const t = new Date(); t.setDate(t.getDate() - 15); return fechaLocal(t); })();
  if (S.admin) {
    const pend = S.registros.filter(r => r.estado === "pendiente");
    const viejos = pend.filter(r => r.creadoLocal && (Date.now() - Date.parse(r.creadoLocal)) > 2 * 864e5).length;
    if (pend.length) out.push({ t: `${pend.length} registro(s) esperan tu revisión${viejos ? ` (${viejos} con más de 2 días)` : ""}`, go: () => { S.filtroReg = "pendiente"; S.filtroTipo = ""; irA("registros"); pintarRegistros(); } });
  } else { const n = S.registros.filter(r => r.estado === "correccion").length; if (n) out.push({ t: `${n} registro(s) para corregir`, go: () => { S.filtroReg = "correccion"; irA("registros"); pintarRegistros(); } }); }
  for (const r of S.registros) {
    if (!vigente(r)) continue;
    if (r.tipo === "fumigacion" && r.datos?.carencia > 0 && r.datos.fechaLibre >= hoy)
      out.push({ t: `${r.loteNombre}: carencia activa hasta el ${fmtFecha(r.datos.fechaLibre)} (${fmtDosis(r.datos.productos)}). No cortar ni dar al ganado.`, go: () => detalleRegistro(r.id) });
    if (r.fechaHecho < hace15) continue;
    if (r.tipo === "plaga" && r.datos?.sobreUmbral) out.push({ t: `${r.loteNombre}: ${r.datos.plaga} en ${num(r.datos.pct, 1)} % (${fmtFecha(r.fechaHecho)})`, go: () => detalleRegistro(r.id) });
    if (r.tipo === "riego" && r.datos?.llego === false) out.push({ t: `${r.loteNombre}: el agua no llegó al final en la sección ${r.datos.seccion} (${fmtFecha(r.fechaHecho)})`, go: () => detalleRegistro(r.id) });
  }
  if (S.admin) {
    for (const l of lotesVisibles()) {
      if (!l.fechaSiembra || l.fechaSiembra > hoy) continue;
      const ult = S.registros.filter(r => r.loteId === l.id && r.tipo === "plaga" && vigente(r)).map(r => r.fechaHecho).sort().pop();
      const dias = ult ? diasEntre(ult, hoy) : null;
      if (dias == null || dias > 4) out.push({ t: `${l.nombre}: monitoreo de plagas atrasado (${ult ? `último hace ${dias} días` : "ninguno desde la siembra"}; va cada 4 días)`, go: () => formRegistro("plaga", l.id) });
    }
    const inv = inventario(S.registros.filter(r => r.estado === "aprobado"), catActual());
    for (const f of Object.values(inv)) if (f.bajo) out.push({ t: `Bodega: ${f.producto} por debajo del mínimo (quedan ${num(f.saldo, 1)} ${f.base})`, go: () => irA("panel") });
  }
  out.push(...alertasAgenda());
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
$("panelCiclo").addEventListener("change", pintarPanel);
const millones = v => !v ? "$0" : Math.abs(v) >= 1e6 ? "$" + num(v / 1e6, 1) + " M" : "$" + num(v / 1e3, 0) + " mil";
function pintarPanel() {
  if (!S.admin) return;
  const sel = $("panelLote"), selC = $("panelCiclo"), prev = sel.value, prevC = selC.value, cat = catActual();
  sel.replaceChildren(el("option", { value: "" }, "Todos los lotes"), ...S.lotes.map(l => el("option", { value: l.id }, l.nombre))); sel.value = prev;
  const ciclos = [...new Set(S.registros.map(r => r.ciclo).filter(Boolean))];
  selC.replaceChildren(el("option", { value: "" }, "Todos los ciclos"), ...ciclos.map(c => el("option", { value: c }, c))); selC.value = ciclos.includes(prevC) ? prevC : "";
  const todosAp = S.registros.filter(r => r.estado === "aprobado");
  const ap = todosAp.filter(r => r.tipo !== "compra" && r.tipo !== "gasto" && (!sel.value || r.loteId === sel.value) && (!selC.value || r.ciclo === selC.value));
  // Equipos (motobomba, etc.) son del proyecto: cuentan sin filtro de ciclo y cuando se ven todos los lotes o hay uno solo.
  const unLote = S.lotes.filter(l => !l.archivado).length <= 1, conEquipos = !selC.value && (!sel.value || unLote);
  if (conEquipos) ap.push(...todosAp.filter(r => (r.tipo === "compra" && esEquipo(r.datos)) || r.tipo === "gasto"));
  const de = t => ap.filter(r => r.tipo === t && r.tipo !== "compra" && r.tipo !== "gasto"), suma = (rs, k) => rs.reduce((s, r) => s + (Number(r.datos?.[k]) || 0), 0);
  const inv = inventario(todosAp, cat), pGal = precioGalon(todosAp, cat), cs = costos(ap, inv, pGal);
  const areaLotes = S.lotes.filter(l => !l.archivado && (!sel.value || l.id === sel.value)).reduce((s, l) => s + (l.area_ha || 0), 0);
  const areaSemb = suma(de("siembra"), "area") || areaLotes, areaCos = suma(de("cosecha"), "area"), tSilo = suma(de("cosecha"), "tSilo");
  const horas = suma(de("riego"), "horas");
  const sobre = de("plaga").filter(r => r.datos?.sobreUmbral).length, pend = S.registros.filter(r => r.estado === "pendiente").length;
  const kpi = (v, t, alerta) => el("div", { class: "kpi" + (alerta ? " alerta" : "") }, el("b", {}, v), el("span", {}, t));
  $("kpis").replaceChildren(
    kpi(num(areaSemb, 2), "Hectáreas sembradas"), kpi(num(areaCos, 2), "Hectáreas cosechadas"),
    kpi(millones(cs.total), "Costo acumulado"), kpi(areaSemb ? millones(cs.total / areaSemb) : "—", "Costo por hectárea"),
    kpi(num(tSilo, 1), "Toneladas de silo"), kpi(tSilo ? millones(cs.total / tSilo) : "—", "Costo por tonelada de silo"),
    kpi(num(horas, 1), "Horas de motobomba"), kpi(num(cs.galRiego + cs.galComb, 1), "Galones de combustible"),
    kpi(sobre, "Monitoreos sobre el umbral", sobre > 0), kpi(pend, "Por revisar", pend > 0));
  const tabla = (cab, filas) => el("table", { class: "t" }, el("thead", {}, el("tr", {}, cab.map((c, i) => el("th", { class: i ? "n" : "" }, c)))),
    el("tbody", {}, filas.map(f => el("tr", { class: f.cls || "" }, f.c.map((x, i) => el("td", { class: i ? "n" : "" }, x))))));
  // Costos por rubro
  const rubros = [["Insumos aplicados", cs.insumos], ["Labores (jornales y tractor)", cs.labores], ["Aplicaciones (gasolina del dron y la camioneta, o fumigadores)", cs.aplicaciones],
    ["Combustible de equipos", cs.combustible], [`Gasolina de riego (${num(cs.galRiego, 1)} gal)`, cs.gasolinaRiego], [conEquipos ? "Equipos y herramientas (motobomba, etc.)" : "Equipos (solo sin filtro de ciclo)", cs.equipos],
    [conEquipos ? "Gastos del proyecto (tubos, cerca, transporte…)" : "Gastos del proyecto (solo sin filtro de ciclo)", cs.gastos]];
  const cardCostos = el("div", { class: "card" }, el("h3", {}, "Costos por rubro"),
    tabla(["Rubro", "Valor"], [...rubros.map(([a, b]) => ({ c: [a, pesos(b)] })), { c: [el("b", {}, "Total"), el("b", {}, pesos(cs.total))] }, { c: ["Por hectárea sembrada", areaSemb ? pesos(cs.total / areaSemb) : "—"] }]),
    cs.sinPrecio.size ? el("p", { class: "hint" }, `Sin precio todavía: ${[...cs.sinPrecio].join(", ")}. Registra la compra${cs.sinPrecio.has("gasolina de riego") ? " (o el precio del galón en Catálogos)" : ""} para que sumen.`) : null,
    el("p", { class: "hint" }, "Los insumos se valoran al costo promedio de sus compras y cuentan cuando se aplican. Lo demás (tubos, cerca, análisis de suelo, asistencia técnica) se agrega en la pestaña Gastos."));
  // Inventario
  const filasInv = Object.values(inv).sort((a, b) => a.producto.localeCompare(b.producto)).map(f => ({ cls: f.bajo || f.saldo < 0 ? "fila-alerta" : "",
    c: [f.producto + (f.mezcla ? " ⚠ unidades mezcladas" : ""), `${num(f.comprado, 1)} ${f.base}`, `${num(f.aplicado, 1)} ${f.base}`, `${num(f.saldo, 1)} ${f.base}`, f.costoProm != null ? pesos(f.costoProm) : "—"] }));
  const cardInv = el("div", { class: "card" }, el("h3", {}, "Bodega e inventario"),
    filasInv.length ? el("div", { class: "scroll-x" }, tabla(["Producto", "Comprado", "Aplicado", "Saldo", "$ / unidad"], filasInv)) : el("p", { class: "hint" }, "Aún no hay compras ni aplicaciones aprobadas."),
    el("p", { class: "hint" }, "Saldo negativo = se aplicó más de lo que se registró como comprado. Los equipos (compras en «unidad») no entran a la bodega: suman en Costos."),
    el("button", { class: "btn", onclick: () => formRegistro("compra", null) }, "+ Registrar compra"));
  // Fertilizante por hectárea
  const porProd = {};
  for (const r of de("fertilizacion")) { const k = r.datos.producto, b = r.datos.base || "kg"; porProd[k] ||= { b, cant: 0 }; porProd[k].cant += r.datos.cantBase ?? consumos(r)[0].cant; }
  const cardFert = el("div", { class: "card" }, el("h3", {}, "Fertilizante aplicado"),
    Object.keys(porProd).length ? tabla(["Producto", "Total", "Por ha"], Object.entries(porProd).map(([k, v]) => ({ c: [k, `${num(v.cant, 1)} ${v.b}`, areaSemb ? `${num(v.cant / areaSemb, 1)} ${v.b}/ha` : "—"] }))) : el("p", { class: "hint" }, "Sin fertilizaciones aprobadas."));
  // Aplicaciones fitosanitarias
  const fums = de("fumigacion").sort((a, b) => b.fechaHecho.localeCompare(a.fechaHecho));
  const cardFum = el("div", { class: "card" }, el("h3", {}, "Aplicaciones fitosanitarias"),
    fums.length ? el("div", { class: "list" }, fums.map(itemRegistro)) : el("p", { class: "hint" }, "Sin fumigaciones aprobadas."));
  // Incidencia de plagas
  const porPlaga = {};
  for (const r of de("plaga").sort((a, b) => a.fechaHecho.localeCompare(b.fechaHecho))) { const p = porPlaga[r.datos.plaga] ||= { n: 0, max: 0 }; p.n++; p.max = Math.max(p.max, r.datos.pct || 0); p.ult = r; }
  const cardPlagas = el("div", { class: "card" }, el("h3", {}, "Incidencia de plagas"),
    Object.keys(porPlaga).length ? tabla(["Plaga", "Último", "Máximo", "Umbral"], Object.entries(porPlaga).map(([k, p]) => ({ cls: p.ult.datos.sobreUmbral ? "fila-alerta" : "",
      c: [`${k} (${p.n})`, `${num(p.ult.datos.pct, 1)} % · ${fmtFecha(p.ult.fechaHecho)}`, num(p.max, 1) + " %", p.ult.datos.umbral + " %"] }))) : el("p", { class: "hint" }, "Sin monitoreos aprobados."));
  $("panelExtra").replaceChildren(cardCostos, cardInv, cardFert, cardFum, cardPlagas,
    el("div", { class: "card" }, el("h3", {}, "Exportar"), el("p", { class: "hint" }, "Todos los registros aprobados en CSV (se abre en Excel), con el costo de cada uno."), el("button", { class: "btn", onclick: exportarCsv }, "Descargar CSV")),
    el("p", { class: "hint" }, "Solo cuentan los registros aprobados."));
}
// ---------- Gastos (costo total del proyecto) ----------
S.filtroGasto = "";
function pintarGastos() {
  if (!S.admin) return;
  const hechos = S.lista.filter(i => i.comprado).length;
  const selector = el("div", { class: "seg seg-gastos", role: "tablist" },
    el("button", { role: "tab", "aria-selected": S.vistaGastos === "gastos" ? "true" : "false", onclick: () => { S.vistaGastos = "gastos"; pintarGastos(); } }, "Gastos"),
    el("button", { role: "tab", "aria-selected": S.vistaGastos === "lista" ? "true" : "false", onclick: () => { S.vistaGastos = "lista"; pintarGastos(); } },
      "Lista de compras" + (S.lista.length ? ` · ${hechos}/${S.lista.length}` : "")));
  if (S.vistaGastos === "lista") { $("gastosBody").replaceChildren(selector, ...pintarLista()); return; }
  const cat = catActual(), todosAp = S.registros.filter(r => r.estado === "aprobado");
  const inv = inventario(todosAp, cat), cs = costos(todosAp.filter(r => r.tipo !== "compra" || esEquipo(r.datos)), inv, precioGalon(todosAp, cat));
  const area = S.lotes.filter(l => !l.archivado).reduce((s, l) => s + (l.area_ha || 0), 0);
  const filas = [["Insumos aplicados (abono, semilla, agroquímicos)", cs.insumos], ["Labores (jornales y tractor)", cs.labores], ["Aplicaciones (dron, camioneta, fumigadores)", cs.aplicaciones],
    ["Combustible de equipos", cs.combustible], ["Gasolina de riego", cs.gasolinaRiego], ["Equipos y herramientas", cs.equipos],
    ...Object.entries(cs.porCategoria).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v])].filter(([, v]) => v > 0);
  const bodega = Object.values(inv).reduce((s, f) => s + (f.costoProm != null ? Math.max(f.saldo, 0) * f.costoProm : 0), 0);
  // Lista: gastos, equipos y compras de bodega
  const movs = S.registros.filter(r => (r.tipo === "gasto" || r.tipo === "compra") && r.estado !== "anulado" && r.estado !== "rechazado")
    .filter(r => !S.filtroGasto || (S.filtroGasto === "bodega" ? r.tipo === "compra" : r.datos?.categoria === S.filtroGasto));
  const cats = [...new Set(S.registros.filter(r => r.tipo === "gasto").map(r => r.datos?.categoria).filter(Boolean))];
  const chip = (k, t) => el("button", { "aria-pressed": S.filtroGasto === k ? "true" : "false", onclick: () => { S.filtroGasto = k; pintarGastos(); } }, t);
  $("gastosBody").replaceChildren(selector,
    el("div", { class: "total-proyecto" }, el("span", {}, "Total gastado en el proyecto"), el("b", {}, pesos(cs.total + bodega)),
      el("span", {}, bodega > 0 ? `Incluye ${pesos(bodega)} en insumos que siguen en bodega. Costo de lo ya usado: ${pesos(cs.total)}.` : "Todo lo comprado ya se usó o es equipo."),
      el("span", {}, area ? `${pesos((cs.total + bodega) / area)} por hectárea sembrada (${num(area, 2)} ha)` : "Falta el área sembrada para sacar el valor por hectárea")),
    el("div", { class: "row-btns" },
      el("button", { class: "btn primary", onclick: () => formRegistro("gasto", null) }, "+ Agregar gasto"),
      el("button", { class: "btn", onclick: () => formRegistro("compra", null) }, "+ Compra de insumos")),
    el("div", { class: "card" }, el("h3", {}, "En qué se ha ido la plata"),
      filas.length ? el("table", { class: "t" }, el("tbody", {}, filas.map(([k, v]) => el("tr", {}, el("td", {}, k), el("td", { class: "n" }, pesos(v)))),
        el("tr", {}, el("td", {}, el("b", {}, "Costo de lo ya usado")), el("td", { class: "n" }, el("b", {}, pesos(cs.total))))))
        : el("p", { class: "hint" }, "Aún no hay gastos aprobados."),
      bodega > 0 ? el("table", { class: "t" }, el("tbody", {}, el("tr", {}, el("td", {}, "Insumos en bodega (comprados, sin aplicar)"), el("td", { class: "n" }, pesos(bodega))),
        el("tr", {}, el("td", {}, el("b", {}, "Total gastado")), el("td", { class: "n" }, el("b", {}, pesos(cs.total + bodega)))))) : null,
      cs.sinPrecio.size ? el("p", { class: "hint" }, `Aplicado sin precio de compra: ${[...cs.sinPrecio].join(", ")}.`) : null),
    el("div", { class: "chips" }, chip("", "Todos"), chip("bodega", "Compras de bodega"), cats.map(c => chip(c, c.replace(/ \(.*/, "")))),
    movs.length ? el("div", { class: "list" }, movs.map(itemRegistro)) : el("div", { class: "empty" }, "No hay gastos aquí todavía. Agrega el primero con el botón de arriba."),
    el("p", { class: "hint" }, "Solo suman los gastos aprobados. Lo que registra el administrador se aprueba solo."));
}

// ---------- Lista de compras (vinculada a los registros) ----------
let unsubLista = null;
function escucharLista() {
  if (unsubLista) return;
  unsubLista = onSnapshot(collection(db, "lista"), snap => {
    S.lista = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
    S.listaCargada = !snap.metadata.fromCache || S.lista.length > 0;
    pintarGastos();
  }, err => { S.listaCargada = true; if (err.code === "permission-denied") S.listaSinPermiso = true; pintarGastos(); });
  S.unsubs.push(() => { unsubLista && unsubLista(); unsubLista = null; });
}
const NOMBRE_SEC = Object.fromEntries(SECCIONES);
const VERBO = { compra: "Registrar la compra", gasto: "Registrar el gasto", labor: "Registrar la labor", combustible: "Registrar el combustible" };
const regDe = it => it.registroId ? S.registros.find(r => r.id === it.registroId) : null;
function valorReg(r) {
  if (!r || r.estado === "anulado" || r.estado === "rechazado") return 0;
  if (r.tipo === "labor") return costos([r], {}, 0).total;
  return Number(r.datos?.valor) || 0;
}
function guardarItem(id, cambios) {
  return updateDoc(doc(db, "lista", id), { ...cambios, actualizado: serverTimestamp(), actualizadoPor: S.user.uid })
    .catch(e => toast("No se guardó en la lista (" + e.code + ")", true));
}
function pintarLista() {
  if (S.listaSinPermiso) return [el("div", { class: "calc warn" }, el("b", {}, "Falta publicar las reglas nuevas"),
    el("span", {}, "La base de datos todavía no deja guardar la lista. Hay que publicar el archivo firestore.rules de la versión 0.8 en Firebase."))];
  if (!S.lista.length) {
    if (!S.listaCargada) return [el("div", { class: "empty" }, "Cargando la lista…")];
    return [el("div", { class: "card" }, el("h3", {}, "Lista de compras del proyecto"),
      el("p", { class: "hint" }, `Carga los ${LISTA_BASE.length} ítems de la plantilla (cerca, semilla, abono, fitosanitario, riego, cosecha y mano de obra). La semilla y la motobomba quedan marcadas como compradas. Después puedes agregar, editar o quitar ítems.`),
      el("button", { class: "btn primary", onclick: cargarListaBase }, "Cargar la lista del proyecto"))];
  }
  const total = S.lista.length, hechos = S.lista.filter(i => i.comprado).length;
  const gastado = S.lista.reduce((s, i) => s + valorReg(regDe(i)), 0);
  const secs = [...SECCIONES.map(([k]) => k), ...new Set(S.lista.map(i => i.seccion).filter(k => !NOMBRE_SEC[k]))];
  const out = [el("div", { class: "total-proyecto" }, el("span", {}, "Avance de compras"), el("b", {}, `${hechos} de ${total}`),
    el("div", { class: "barra" }, el("i", { style: `width:${Math.round(100 * hechos / total)}%` })),
    el("span", {}, gastado ? `${pesos(gastado)} registrados desde la lista. Toca un ítem para registrar su compra o vincularlo.` : "Toca un ítem para registrar su compra; el valor pasa a Gastos y a la bodega.")),
    el("p", { class: "hint" }, "La lista es la misma en todos tus equipos. Lo marcado como «confirmar» depende del análisis de suelo o de una medida en el lote.")];
  for (const k of secs) {
    const its = S.lista.filter(i => i.seccion === k); if (!its.length) continue;
    const n = its.filter(i => i.comprado).length;
    const abierta = S.secAbierta?.[k] ?? n < its.length;
    const det = el("details", { class: "lista-sec", open: abierta ? true : null },
      el("summary", {}, el("span", { class: "lista-tit" }, NOMBRE_SEC[k] || k), el("span", { class: "lista-cnt" + (n === its.length ? " ok" : "") }, `${n} / ${its.length}`),
        el("span", { class: "barra fina" }, el("i", { style: `width:${Math.round(100 * n / its.length)}%` }))),
      el("ul", { class: "lista-items" }, its.map(filaLista)));
    det.addEventListener("toggle", () => { (S.secAbierta ||= {})[k] = det.open; });
    out.push(det);
  }
  out.push(el("div", { class: "row-btns" }, el("button", { class: "btn primary", onclick: () => formItem(null) }, "+ Agregar ítem")));
  return out;
}
function filaLista(it) {
  const r = regDe(it), cb = el("input", { type: "checkbox", "aria-label": "Comprado: " + it.nombre });
  cb.checked = !!it.comprado;
  cb.addEventListener("change", () => guardarItem(it.id, { comprado: cb.checked }));
  const estado = r ? (r.estado === "anulado" || r.estado === "rechazado" ? `⚠ registro ${ESTADOS[r.estado].toLowerCase()}` : `✓ ${pesos(valorReg(r))} · ${fmtFecha(r.fechaHecho)}`) : it.registroId ? "Registro no encontrado" : "";
  return el("li", { class: it.comprado ? "hecho" : "" }, cb,
    el("button", { class: "lista-txt", type: "button", onclick: () => detalleItem(it.id) },
      el("span", { class: "lista-nom" }, it.nombre, it.confirmar ? el("span", { class: "tag-conf" }, "confirmar") : null),
      el("span", { class: "lista-det" }, it.detalle || ""),
      estado ? el("span", { class: "lista-reg" + (r && r.estado !== "anulado" && r.estado !== "rechazado" ? "" : " mal") }, estado) : null));
}
async function cargarListaBase() {
  if (S.lista.length) return;
  if (!navigator.onLine) { toast("Necesitas señal para cargar la lista la primera vez.", true); return; }
  try {
    const b = writeBatch(db);
    for (const it of LISTA_BASE) b.set(doc(collection(db, "lista")), { ...it, registroId: null, actualizado: serverTimestamp(), actualizadoPor: S.user.uid });
    await b.commit(); toast("Lista cargada");
  } catch (e) { if (e.code === "permission-denied") { S.listaSinPermiso = true; pintarGastos(); } else toast("No se pudo cargar (" + e.code + ")", true); }
}
function conLote(fn) {
  const ls = lotesVisibles();
  if (ls.length === 1) return fn(ls[0].id);
  if (!ls.length) { toast("Primero crea un lote.", true); return; }
  abrirModal("¿En qué lote?", el("div", { class: "tipos" }, ls.map(l => el("button", { onclick: () => fn(l.id) }, el("b", {}, l.nombre)))));
}
function registrarDesdeLista(it) {
  const T = TIPOS[it.tipo]; if (!T) return;
  const ini = { ...(it.pre || {}) };
  if (it.tipo === "gasto" && !ini.descripcion) ini.descripcion = it.nombre;
  if (it.tipo === "compra" && !ini.producto) delete ini.producto;
  const obs = it.detalle ? `Lista de compras: ${it.nombre} (${it.detalle})` : `Lista de compras: ${it.nombre}`;
  if (T.campos.some(c => c.k === "obs")) ini.obs = obs;
  const opts = { inicial: ini, alGuardar: id => guardarItem(it.id, { registroId: id, comprado: true }) };
  if (T.sinLote) formRegistro(it.tipo, null, null, opts); else conLote(lid => formRegistro(it.tipo, lid, null, opts));
}
function detalleItem(id) {
  const it = S.lista.find(i => i.id === id); if (!it) return;
  const r = regDe(it), partes = [];
  partes.push(el("dl", { class: "kv" }, el("dt", {}, "Sección"), el("dd", {}, NOMBRE_SEC[it.seccion] || it.seccion), el("dt", {}, "Cantidad o nota"), el("dd", {}, it.detalle || "—"),
    el("dt", {}, "Estado"), el("dd", {}, it.comprado ? "Comprado" : "Por comprar"), el("dt", {}, "Va a"), el("dd", {}, it.tipo ? TIPOS[it.tipo].nombre : "Se anota en la jornada de riego o de combustible")));
  if (r) {
    partes.push(el("div", { class: "card" }, el("h3", {}, "Registro vinculado"), itemRegistro(r),
      el("button", { class: "btn small", onclick: () => { guardarItem(it.id, { registroId: null }); cerrarModal(); toast("Registro desvinculado (el registro no se borra)"); } }, "Desvincular")));
  } else {
    if (it.registroId) partes.push(el("p", { class: "hint" }, "El registro vinculado no aparece (quizá no ha sincronizado)."));
    if (it.tipo) partes.push(el("button", { class: "btn primary", onclick: () => { cerrarModal(); registrarDesdeLista(it); } }, VERBO[it.tipo]));
    partes.push(el("button", { class: "btn", onclick: () => vincularRegistro(it) }, "Vincular a un registro ya hecho"));
  }
  partes.push(el("div", { class: "row-btns" },
    el("button", { class: "btn", onclick: () => { guardarItem(it.id, { comprado: !it.comprado }); cerrarModal(); } }, it.comprado ? "Marcar por comprar" : "Marcar comprado"),
    el("button", { class: "btn", onclick: () => formItem(it) }, "Editar"),
    el("button", { class: "btn danger", onclick: () => { if (!confirmar(`¿Quitar «${it.nombre}» de la lista? Los registros no se borran.`)) return; deleteDoc(doc(db, "lista", it.id)).catch(e => toast("No se pudo (" + e.code + ")", true)); cerrarModal(); } }, "Quitar")));
  abrirModal(it.nombre, ...partes);
}
function vincularRegistro(it) {
  const usados = new Set(S.lista.map(i => i.registroId).filter(Boolean));
  const tipos = it.tipo ? [it.tipo] : ["compra", "gasto", "combustible", "labor"];
  const cands = S.registros.filter(r => tipos.includes(r.tipo) && vigente(r) && !usados.has(r.id));
  abrirModal("Vincular · " + it.nombre, cands.length ? el("div", { class: "list" }, cands.slice(0, 60).map(r => {
    const b = itemRegistro(r); b.onclick = null;
    b.addEventListener("click", ev => { ev.stopImmediatePropagation(); guardarItem(it.id, { registroId: r.id, comprado: true }); cerrarModal(); toast("Vinculado"); }, true);
    return b;
  })) : el("div", { class: "empty" }, `No hay registros de ${tipos.map(t => TIPOS[t].nombre.toLowerCase()).join(", ")} sin vincular.`));
}
function formItem(it) {
  const v = it || { seccion: "otros", nombre: "", detalle: "", confirmar: false };
  const n = el("input", { id: "liNom", type: "text", maxlength: "120" }); n.value = v.nombre;
  const d = el("input", { id: "liDet", type: "text", maxlength: "200", placeholder: "Ej.: 4 und · una por sección" }); d.value = v.detalle || "";
  const s = el("select", { id: "liSec" }, SECCIONES.map(([k, t]) => el("option", { value: k }, t))); s.value = NOMBRE_SEC[v.seccion] ? v.seccion : "otros";
  const t = el("select", { id: "liTipo" }, el("option", { value: "compra" }, "Compra de insumos (entra a bodega)"), el("option", { value: "gasto" }, "Gasto del proyecto"),
    el("option", { value: "labor" }, "Labor (jornales o tractor)"), el("option", { value: "combustible" }, "Combustible"), el("option", { value: "" }, "No se registra desde la lista"));
  t.value = it ? (it.tipo || "") : tipoPorSeccion(s.value);
  if (!it) s.addEventListener("change", () => { t.value = tipoPorSeccion(s.value); });
  const cf = el("input", { type: "checkbox", id: "liConf" }); cf.checked = !!v.confirmar;
  abrirModal(it ? "Editar ítem" : "Nuevo ítem", el("label", { for: "liNom" }, "Qué hay que comprar", n), el("label", { for: "liDet" }, "Cantidad o nota", d),
    el("div", { class: "grid2" }, el("label", { for: "liSec" }, "Sección", s), el("label", { for: "liTipo" }, "Se registra como", t)),
    el("label", { for: "liConf", class: "check-row" }, cf, el("span", {}, "Por confirmar (depende de una medida o del análisis)")),
    el("button", { class: "btn primary", onclick: () => {
      const nombre = n.value.trim(); if (!nombre) { toast("Escribe qué hay que comprar", true); return; }
      const tipo = t.value || null;
      const pre = tipo === "gasto" ? { categoria: RUBRO_POR_SECCION[s.value] || "Otros", descripcion: nombre } : tipo === "compra" ? { producto: nombre } : tipo === "combustible" ? { combustible: "ACPM" } : {};
      const datos = { nombre, detalle: d.value.trim(), seccion: s.value, confirmar: cf.checked, tipo };
      if (it) { if (it.tipo !== tipo || it.nombre !== nombre) datos.pre = pre; guardarItem(it.id, datos); }
      else setDoc(doc(collection(db, "lista")), { ...datos, pre, comprado: false, registroId: null, orden: Math.max(0, ...S.lista.map(i => i.orden ?? 0)) + 1,
        actualizado: serverTimestamp(), actualizadoPor: S.user.uid }).catch(e => toast("No se guardó (" + e.code + ")", true));
      cerrarModal(); toast(it ? "Ítem actualizado" : "Ítem agregado");
    } }, it ? "Guardar" : "Agregar a la lista"));
}

function exportarCsv() {
  const todosAp = S.registros.filter(r => r.estado === "aprobado"), cat = catActual();
  const inv = inventario(todosAp, cat), pGal = precioGalon(todosAp, cat);
  const claves = []; for (const r of todosAp) for (const k of Object.keys(r.datos || {})) if (!claves.includes(k) && k !== "sinCarencia") claves.push(k);
  const cols = ["fechaHecho", "tipo", "loteNombre", "ciclo", "autorNombre", "resumen", "costo", ...claves];
  const valor = (r, c) => {
    if (c === "resumen") return resumen(r);
    if (c === "tipo") return TIPOS[r.tipo]?.nombre || r.tipo;
    if (c === "costo") return r.tipo === "compra" ? (r.datos?.valor ?? "") : Math.round(costos([r], inv, pGal).total);
    const v = r[c] ?? r.datos?.[c];
    if (Array.isArray(v)) return c === "productos" ? fmtDosis(v) : v.join(" ");
    if (typeof v === "number") return String(v).replace(".", ",");
    if (typeof v === "boolean") return v ? "Sí" : "No";
    return v ?? "";
  };
  const filas = todosAp.map(r => cols.map(c => csvEscape(valor(r, c))).join(";"));
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
    el("div", { class: "card" }, el("h3", {}, "Catálogos"), el("p", { class: "hint" }, "Productos con tipo, unidad, carencia y mínimo en bodega; equipos; plagas con su umbral; precio del galón."), el("button", { class: "btn", onclick: formCatalogos }, "Editar catálogos")));
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
  const cat = catActual();
  const ta = (id, label, val, rows = 6) => { const t = el("textarea", { id, rows, spellcheck: "false" }); t.value = val; return el("label", { for: id }, label, t); };
  const pg = el("input", { id: "cGal", type: "number", inputmode: "numeric", step: "100", min: "0" }); pg.value = cat.precioGalon ?? "";
  abrirModal("Catálogos",
    ta("cProd", "Productos: nombre; tipo; unidad (kg o L); carencia en días; mínimo en bodega", cat.productos.map(p => [p.nombre, p.tipo, p.unidad, p.carencia ?? "", p.min ?? ""].join("; ").replace(/(; )+$/, "")).join("\n"), 9),
    el("p", { class: "hint" }, `Tipos: ${TIPOS_PROD.join(", ")}. La carencia sale de la etiqueta y es obligatoria en herbicidas, insecticidas y fungicidas. Ejemplo: «Atrazina 90 WG; Herbicida; kg; 30; 2».`),
    ta("cEq", "Equipos y motobombas (uno por línea)", cat.equipos.join("\n"), 4),
    ta("cPlag", "Plagas: nombre; umbral % (una por línea)", cat.plagas.map(p => `${p.nombre}; ${p.umbral}`).join("\n"), 5),
    el("label", { for: "cGal" }, "Precio de referencia del galón de gasolina ($), mientras no haya registros de combustible", pg),
    el("button", { class: "btn primary", onclick: () => {
      const lineas = id => $(id).value.split("\n").map(s => s.trim()).filter(Boolean);
      const nOrNull = x => x == null || String(x).trim() === "" || isNaN(parseFloat(String(x).replace(",", "."))) ? null : parseFloat(String(x).replace(",", "."));
      const productos = lineas("cProd").map(s => { const [n, t = "", u = "", c, m] = s.split(";").map(x => x.trim());
        const tipo = TIPOS_PROD.find(x => x.toLowerCase() === t.toLowerCase()) || "Otro";
        return { nombre: n, tipo, unidad: /^l/i.test(u) ? "L" : "kg", carencia: nOrNull(c), min: nOrNull(m) }; });
      const plagas = lineas("cPlag").map(s => { const [nombre, u] = s.split(";"); return { nombre: nombre.trim(), umbral: parseFloat(u) || 20 }; });
      setDoc(doc(db, "config", "catalogos"), { productos, equipos: lineas("cEq"), plagas, precioGalon: nOrNull(pg.value) }).catch(e => toast("No se guardó: " + e.code, true));
      cerrarModal(); toast("Catálogos guardados");
    } }, "Guardar"));
}

// ---------- Service worker (trabajo sin conexión) ----------
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
