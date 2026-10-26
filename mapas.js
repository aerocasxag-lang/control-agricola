// Mapas base, selector de capas y descarga de zonas para trabajar sin señal.

export const BASES = {
  sat: { nombre: "Satélite", desc: "Imágenes Esri. Se puede guardar para usar sin señal.", offline: true,
    capas: [["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxNativeZoom: 18, attribution: "Imágenes © Esri" }]] },
  satNom: { nombre: "Satélite con nombres", desc: "Satélite con veredas, ríos y vías.", offline: true,
    capas: [["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxNativeZoom: 18, attribution: "Imágenes © Esri" }],
      ["https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", { maxNativeZoom: 18 }]] },
  topo: { nombre: "Topográfico", desc: "Curvas de nivel y relieve (OpenTopoMap). Solo con señal o zonas ya vistas.", offline: false,
    capas: [["https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", { maxNativeZoom: 17, subdomains: "abc", attribution: "© OpenStreetMap · SRTM · OpenTopoMap" }]] },
  calles: { nombre: "Calles", desc: "Vías y poblados (OpenStreetMap). Solo con señal o zonas ya vistas.", offline: false,
    capas: [["https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxNativeZoom: 19, attribution: "© OpenStreetMap" }]] },
  ninguno: { nombre: "Sin fondo", desc: "Solo tus lotes y ortomosaicos. Gasta menos datos.", offline: true, capas: [] }
};

let grupoBase = null;
export function ponerBase(mapa, id) {
  if (!BASES[id]) id = "sat";
  if (grupoBase) mapa.removeLayer(grupoBase);
  grupoBase = L.layerGroup(BASES[id].capas.map(([u, o]) => L.tileLayer(u, { maxZoom: 21, ...o }))).addTo(mapa);
  grupoBase.eachLayer(l => l.bringToBack());
  try { localStorage.setItem("mapaBase", id); } catch (e) {}
  return id;
}
export function baseGuardada() { try { return localStorage.getItem("mapaBase") || "sat"; } catch (e) { return "sat"; } }

// ---- Teselas de una zona ----
const lon2x = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z); };
export function teselasZona(b, zMin, zMax, plantilla) {
  const out = [];
  for (let z = zMin; z <= zMax; z++) {
    const x1 = lon2x(b.getWest(), z), x2 = lon2x(b.getEast(), z), y1 = lat2y(b.getNorth(), z), y2 = lat2y(b.getSouth(), z);
    for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++)
      out.push(plantilla.replace("{z}", z).replace("{x}", x).replace("{y}", y));
  }
  return out;
}
export async function descargarTeselas(urls, progreso, cancelado) {
  let hechas = 0, fallas = 0, i = 0;
  const trabajador = async () => {
    while (i < urls.length && !cancelado()) {
      const u = urls[i++];
      try { await fetch(u, { mode: "no-cors" }); } catch (e) { fallas++; }
      hechas++; if (hechas % 10 === 0 || hechas === urls.length) progreso(hechas, urls.length, fallas);
    }
  };
  await Promise.all(Array.from({ length: 6 }, trabajador));
  return { hechas, fallas };
}
