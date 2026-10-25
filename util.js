// Funciones puras (sin Firebase ni DOM, salvo comprimirFoto).

// Área de un polígono {lat,lng}[] en hectáreas (proyección local; error < 0,5 % en lotes pequeños).
export function areaHa(pts) {
  if (!pts || pts.length < 3) return 0;
  const lat0 = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110574;
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += (p.lng * kx) * (q.lat * ky) - (q.lng * kx) * (p.lat * ky);
  }
  return Math.abs(a) / 2 / 10000;
}

export function centroide(pts) {
  return { lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length };
}

// Lee el primer polígono de un KML y devuelve {lat,lng}[] sin repetir el punto de cierre.
export function parseKml(texto) {
  const poly = texto.match(/<Polygon[\s\S]*?<\/Polygon>/i);
  const zona = poly ? poly[0] : texto;
  const m = zona.match(/<coordinates>([\s\S]*?)<\/coordinates>/i);
  if (!m) throw new Error("no encontré coordenadas en el archivo");
  const pts = m[1].trim().split(/\s+/).map(t => { const [lng, lat] = t.split(",").map(Number); return { lat, lng }; })
    .filter(p => isFinite(p.lat) && isFinite(p.lng));
  if (pts.length > 1) { const a = pts[0], b = pts[pts.length - 1]; if (a.lat === b.lat && a.lng === b.lng) pts.pop(); }
  if (pts.length < 3) throw new Error("el borde tiene menos de 3 puntos");
  return pts;
}

export function fechaLocal(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function diasEntre(a, b) {
  if (!a || !b) return 0;
  const n = s => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d) / 864e5; };
  return n(b) - n(a);
}
// Horas entre "HH:MM"; null si falta algo o si el final no es posterior al inicio.
export function horasEntre(ini, fin) {
  if (!ini || !fin) return null;
  const m = s => { const [h, mi] = s.split(":").map(Number); return h * 60 + mi; };
  const d = m(fin) - m(ini);
  return d > 0 ? Math.round(d / 60 * 100) / 100 : null;
}
export function csvEscape(v) {
  v = v == null ? "" : String(v);
  if (typeof v === "string" && /^\d+\.\d+$/.test(v)) v = v.replace(".", ",");
  return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

// Reduce una foto a máx. `lado` px y la comprime en JPEG hasta quedar bajo `maxBytes` (aprox.).
export async function comprimirFoto(file, lado = 1280, maxBytes = 150000) {
  const bmp = await createImageBitmap(file);
  let w = bmp.width, h = bmp.height, esc = Math.min(1, lado / Math.max(w, h));
  let out = null;
  for (let intento = 0; intento < 6; intento++) {
    const c = document.createElement("canvas"); c.width = Math.round(w * esc); c.height = Math.round(h * esc);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    for (const q of [0.75, 0.6, 0.45]) {
      out = c.toDataURL("image/jpeg", q);
      if (out.length * 0.75 <= maxBytes) return out;
    }
    esc *= 0.8;
  }
  return out;
}
