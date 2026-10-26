// Ortomosaicos: lectura de GeoTIFF, reducción, cálculo de vigor (ExG/VARI por celdas) y conversión de coordenadas.
// Requiere la librería global GeoTIFF (geotiff.js 2.1.3) cargada en index.html.

// UTM (WGS84) → lat/lng
export function utmALatLng(E, N, zona, sur) {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const x = E - 500000, y = sur ? N - 10000000 : N;
  const mu = y / k0 / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const s = Math.sin(p1), c = Math.cos(p1), t = Math.tan(p1);
  const N1 = a / Math.sqrt(1 - e2 * s * s), T1 = t * t, C1 = ep2 * c * c, R1 = a * (1 - e2) / Math.pow(1 - e2 * s * s, 1.5), D = x / (N1 * k0);
  const lat = p1 - (N1 * t / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720);
  const lon = (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / c;
  return { lat: lat * 180 / Math.PI, lng: ((zona - 1) * 6 - 180 + 3) + lon * 180 / Math.PI };
}
const mercALatLng = (x, y) => ({ lng: x / 6378137 * 180 / Math.PI, lat: (2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * 180 / Math.PI });

// Devuelve una función (x,y) → {lat,lng} según el sistema de coordenadas del GeoTIFF.
export function convertidor(geoKeys) {
  const p = geoKeys.ProjectedCSTypeGeoKey, g = geoKeys.GeographicTypeGeoKey;
  if (p >= 32601 && p <= 32660) return { nombre: `UTM ${p - 32600}N`, metros: true, f: (x, y) => utmALatLng(x, y, p - 32600, false) };
  if (p >= 32701 && p <= 32760) return { nombre: `UTM ${p - 32700}S`, metros: true, f: (x, y) => utmALatLng(x, y, p - 32700, true) };
  if (p === 3857 || p === 900913) return { nombre: "Web Mercator", metros: true, f: mercALatLng };
  if (!p && (g === 4326 || !g)) return { nombre: "WGS84 (grados)", metros: false, f: (x, y) => ({ lat: y, lng: x }) };
  throw new Error(`sistema de coordenadas no soportado (EPSG ${p || g}). Exporta en WGS84 o UTM.`);
}

function otsu(vals) {
  const hist = new Float64Array(256); let n = 0;
  for (const v of vals) { const k = Math.max(0, Math.min(255, Math.round((v + 1) * 127.5))); hist[k]++; n++; }
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let w0 = 0, s0 = 0, mejor = 0, umbral = 0;
  for (let i = 0; i < 256; i++) {
    w0 += hist[i]; if (!w0) continue; const w1 = n - w0; if (!w1) break;
    s0 += i * hist[i]; const m0 = s0 / w0, m1 = (sum - s0) / w1, v = w0 * w1 * (m0 - m1) ** 2;
    if (v > mejor) { mejor = v; umbral = i; }
  }
  return umbral / 127.5 - 1;
}
function dentro(pt, pol) {
  let c = false;
  for (let i = 0, j = pol.length - 1; i < pol.length; j = i++) {
    const a = pol[i], b = pol[j];
    if ((a.lat > pt.lat) !== (b.lat > pt.lat) && pt.lng < (b.lng - a.lng) * (pt.lat - a.lat) / (b.lat - a.lat) + a.lng) c = !c;
  }
  return c;
}

// Lee un GeoTIFF RGB y devuelve la imagen reducida (WebP) con sus límites y el análisis de vigor.
export async function procesarGeoTiff(file, { maxLado = 4096, celdaM = 5, umbralRel = 0.7, borde = null, paso = () => {} } = {}) {
  paso("Abriendo el GeoTIFF…");
  const tiff = await GeoTIFF.fromBlob(file);
  const img = await tiff.getImage();
  const W = img.getWidth(), H = img.getHeight(), spp = img.getSamplesPerPixel();
  if (spp < 3) throw new Error("el archivo no es RGB (tiene menos de 3 bandas)");
  const conv = convertidor(img.getGeoKeys());
  const [minx, miny, maxx, maxy] = img.getBoundingBox();
  const esc = Math.min(1, maxLado / Math.max(W, H)), tw = Math.round(W * esc), th = Math.round(H * esc);
  paso(`Leyendo ${W}×${H} px y reduciendo a ${tw}×${th}…`);
  const bandas = spp >= 4 ? [0, 1, 2, 3] : [0, 1, 2];
  const ras = await img.readRasters({ width: tw, height: th, interleave: true, samples: bandas, resampleMethod: "nearest" });
  const nb = bandas.length, bits = img.getBitsPerSample ? img.getBitsPerSample(0) : 8, k = bits > 8 ? 1 / 257 : 1;
  const nodata = img.getGDALNoData();

  // Esquinas → lat/lng
  const esq = [conv.f(minx, maxy), conv.f(maxx, maxy), conv.f(minx, miny), conv.f(maxx, miny)];
  const bounds = { n: Math.max(...esq.map(p => p.lat)), s: Math.min(...esq.map(p => p.lat)), e: Math.max(...esq.map(p => p.lng)), w: Math.min(...esq.map(p => p.lng)) };
  const latMed = (bounds.n + bounds.s) / 2;
  const anchoM = conv.metros ? (maxx - minx) : (maxx - minx) * 111320 * Math.cos(latMed * Math.PI / 180);
  const gsd = anchoM / tw; // metros por píxel en la imagen reducida

  paso("Armando la imagen…");
  const cv = document.createElement("canvas"); cv.width = tw; cv.height = th;
  const ctx = cv.getContext("2d"); const id = ctx.createImageData(tw, th); const d = id.data;
  const valido = new Uint8Array(tw * th);
  for (let i = 0, p = 0; i < tw * th; i++, p += nb) {
    const r = ras[p] * k, g = ras[p + 1] * k, b = ras[p + 2] * k;
    let ok = nb === 4 ? ras[p + 3] > 0 : true;
    if (ok && nodata != null && ras[p] === nodata && ras[p + 1] === nodata && ras[p + 2] === nodata) ok = false;
    if (ok && nb === 3 && nodata == null && r === 0 && g === 0 && b === 0) ok = false;
    d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = ok ? 255 : 0; valido[i] = ok ? 1 : 0;
  }
  ctx.putImageData(id, 0, 0);
  let data = cv.toDataURL("image/webp", 0.8);
  if (!data.startsWith("data:image/webp")) data = cv.toDataURL("image/jpeg", 0.8);

  // ---- Vigor por celdas ----
  paso("Calculando el vigor…");
  const exg = new Float32Array(tw * th), vari = new Float32Array(tw * th), muestra = [];
  for (let i = 0; i < tw * th; i++) {
    if (!valido[i]) continue;
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2], s = r + g + b || 1;
    exg[i] = 2 * g / s - r / s - b / s;
    const den = g + r - b; vari[i] = Math.abs(den) > 1 ? Math.max(-1, Math.min(1, (g - r) / den)) : 0;
    if (i % 7 === 0) muestra.push(exg[i]);
  }
  const uExg = Math.max(0.05, otsu(muestra));
  const cp = Math.max(1, Math.round(celdaM / gsd)), nx = Math.ceil(tw / cp), ny = Math.ceil(th / cp);
  const tot = new Uint32Array(nx * ny), val = new Uint32Array(nx * ny), veg = new Uint32Array(nx * ny), vs = new Float64Array(nx * ny);
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const i = y * tw + x, c = Math.floor(y / cp) * nx + Math.floor(x / cp); tot[c]++;
    if (!valido[i]) continue; val[c]++;
    if (exg[i] > uExg) { veg[c]++; vs[c] += vari[i]; }
  }
  const celdas = [];
  for (let cy = 0; cy < ny; cy++) for (let cx = 0; cx < nx; cx++) {
    const c = cy * nx + cx;
    if (!tot[c] || val[c] / tot[c] < 0.8) { celdas.push(null); continue; }
    const centro = { lat: bounds.n - (cy + 0.5) / ny * (bounds.n - bounds.s), lng: bounds.w + (cx + 0.5) / nx * (bounds.e - bounds.w) };
    if (borde && borde.length >= 3 && !dentro(centro, borde)) { celdas.push(null); continue; }
    celdas.push({ cob: 100 * veg[c] / val[c], vari: veg[c] ? vs[c] / veg[c] : 0 });
  }
  const cobs = celdas.filter(Boolean).map(c => c.cob).sort((a, b) => a - b);
  const mediana = cobs.length ? cobs[Math.floor(cobs.length / 2)] : 0, corte = mediana * umbralRel;
  const vc = document.createElement("canvas"); vc.width = nx; vc.height = ny;
  const vx = vc.getContext("2d"), vd = vx.createImageData(nx, ny);
  let debiles = 0;
  celdas.forEach((c, i) => {
    if (!c) return;
    let r, g, b, a = 190;
    if (mediana >= 1 && c.cob < corte) { r = 214; g = 48; b = 39; debiles++; }
    else { const t = Math.max(0, Math.min(1, c.cob / Math.max(mediana * 1.3, 1))); r = Math.round(247 - 200 * t); g = Math.round(232 - 80 * t); b = Math.round(120 - 80 * t); }
    vd.data.set([r, g, b, a], i * 4);
  });
  vx.putImageData(vd, 0, 0);
  const total = cobs.length;
  const vigor = { celdaM, umbralRel, umbralExg: Math.round(uExg * 1000) / 1000, mediana: Math.round(mediana * 10) / 10, corte: Math.round(corte * 10) / 10,
    debiles, total, areaDebilHa: Math.round(debiles * (cp * gsd) ** 2 / 100) / 100, sinCultivo: mediana < 1, png: vc.toDataURL("image/png") };
  return { data, bounds, ancho: tw, alto: th, gsdCm: Math.round(gsd * 1000) / 10, origen: { ancho: W, alto: H, crs: conv.nombre }, vigor };
}

// Parte una cadena larga en trozos que caben en un documento de Firestore.
export function partir(s, tam = 800000) { const out = []; for (let i = 0; i < s.length; i += tam) out.push(s.slice(i, i + tam)); return out; }
