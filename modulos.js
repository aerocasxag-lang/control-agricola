// Módulos de registro, cálculos, inventario y costos (funciones puras: sin Firebase ni DOM).

export const num = (v, d = 1) => (v == null || isNaN(v)) ? "—" : Number(v).toLocaleString("es-CO", { maximumFractionDigits: d });
export const pesos = v => (v == null || isNaN(v)) ? "—" : "$" + Math.round(v).toLocaleString("es-CO");
const sumarDias = (s, n) => { const [y, m, d] = s.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10); };
const fmtF = s => { if (!s) return "—"; const [y, m, d] = s.split("-"); return `${+d}/${+m}/${y}`; };

// ---------- Unidades ----------
// Todo se lleva en kg o L (unidad base del producto).
const UNI = { "kg": ["kg", 1], "g": ["kg", .001], "bultos de 50 kg": ["kg", 50], "bultos de 25 kg": ["kg", 25], "L": ["L", 1], "mL": ["L", .001], "cc": ["L", .001] };
export const UNIDADES_COMPRA = ["kg", "bultos de 50 kg", "bultos de 25 kg", "g", "L", "mL"];
export const UNIDADES_DOSIS = ["kg/ha", "g/ha", "L/ha", "mL/ha"];
export function aBase(cant, unidad) {
  const u = UNI[(unidad || "kg").replace("/ha", "")] || UNI.kg;
  return { cant: (Number(cant) || 0) * u[1], base: u[0] };
}

// ---------- Catálogos ----------
export const TIPOS_PROD = ["Fertilizante", "Enmienda", "Semilla", "Herbicida", "Insecticida", "Fungicida", "Biológico", "Coadyuvante", "Otro"];
const FITO = ["Herbicida", "Insecticida", "Fungicida", "Biológico", "Coadyuvante", "Otro"];
export const CAT_DEFECTO = {
  productos: [
    { nombre: "15-15-15", tipo: "Fertilizante", unidad: "kg" }, { nombre: "DAP 18-46-0", tipo: "Fertilizante", unidad: "kg" },
    { nombre: "Urea 46%", tipo: "Fertilizante", unidad: "kg" }, { nombre: "KCl 60%", tipo: "Fertilizante", unidad: "kg" },
    { nombre: "Cal dolomita", tipo: "Enmienda", unidad: "kg" }, { nombre: "Semilla sorgo JJT-18", tipo: "Semilla", unidad: "kg" }],
  equipos: ['Motobomba 2" gasolina', "Tractor", "Guadaña"],
  plagas: [{ nombre: "Cogollero (daño Davis ≥ 3)", umbral: 20 }, { nombre: "Pulgón amarillo (1 o más)", umbral: 20 },
    { nombre: "Hormiga arriera", umbral: 5 }, { nombre: "Otra", umbral: 20 }],
  precioGalon: null
};
// Acepta el catálogo viejo (productos como texto, «motobombas») y lo deja en el formato nuevo.
export function normCat(c) {
  c = c || CAT_DEFECTO;
  const productos = (c.productos || []).map(p => typeof p === "string"
    ? (CAT_DEFECTO.productos.find(d => d.nombre === p) || { nombre: p, tipo: "Otro", unidad: "kg" })
    : { tipo: "Otro", unidad: "kg", ...p });
  if (!productos.some(p => p.tipo === "Semilla")) productos.push(CAT_DEFECTO.productos.find(p => p.tipo === "Semilla"));
  return { productos, equipos: c.equipos || c.motobombas || CAT_DEFECTO.equipos, plagas: c.plagas || CAT_DEFECTO.plagas, precioGalon: c.precioGalon ?? null };
}
export const prodDe = (cat, nombre) => cat.productos.find(p => p.nombre === nombre) || null;
export function prodsTipo(cat, tipos) { const ps = tipos ? cat.productos.filter(p => tipos.includes(p.tipo)) : cat.productos; return (ps.length ? ps : cat.productos).map(p => p.nombre); }

// ---------- Tipos de registro ----------
// t: num, time, sel, sino, texto, txt, fotos, seccion, cat (lista del catálogo), prod (producto del catálogo),
//    plaga, dosis (varios productos con dosis por ha), alturas (lista de alturas en cm)
const obs = { k: "obs", l: "Observaciones", t: "texto" }, fotos = { k: "fotos", l: "Fotos", t: "fotos" };
export const TIPOS = {
  riego: { nombre: "Jornada de riego", desc: "Sección, horas de motobomba, gasolina", ico: "💧",
    campos: [{ k: "seccion", l: "Sección regada", t: "seccion" }, { k: "motobomba", l: "Motobomba", t: "cat", cat: "equipos" },
      { k: "horaInicio", l: "Hora de inicio", t: "time", req: true }, { k: "horaFin", l: "Hora final", t: "time", req: true },
      { k: "llego", l: "¿El agua llegó al final de los surcos?", t: "sino", def: true },
      { k: "nivelPozo", l: "Nivel del agua del pozo", t: "sel", ops: ["Normal", "Bajo", "Muy bajo"] },
      { k: "galones", l: "Gasolina tanqueada (galones)", t: "num", step: "0.1" }, obs] },
  fertilizacion: { nombre: "Fertilización", desc: "Producto, cantidad y área abonada", ico: "🌱",
    campos: [{ k: "producto", l: "Producto", t: "prod", tipos: ["Fertilizante", "Enmienda"], req: true },
      { k: "cantidad", l: "Cantidad aplicada", t: "num", step: "0.1", req: true },
      { k: "unidad", l: "Unidad", t: "sel", ops: ["kg", "bultos de 50 kg", "g", "L"] },
      { k: "area", l: "Área abonada (ha)", t: "num", step: "0.01" },
      { k: "metodo", l: "Método", t: "sel", ops: ["En banda", "Al voleo", "Al pie de la planta", "Incorporado"] }, fotos, obs] },
  plaga: { nombre: "Monitoreo de plagas", desc: "Plantas revisadas y afectadas, con umbral", ico: "🐛",
    campos: [{ k: "plaga", l: "Plaga", t: "plaga", req: true }, { k: "seccion", l: "Sección o punto", t: "seccion" },
      { k: "revisadas", l: "Plantas revisadas", t: "num", def: 50, req: true }, { k: "afectadas", l: "Plantas afectadas", t: "num", def: 0, req: true }, fotos, obs] },
  fumigacion: { nombre: "Fumigación", desc: "Productos, dosis, caldo, clima y carencia", ico: "🧪",
    campos: [{ k: "productos", l: "Productos y dosis por hectárea", t: "dosis", tipos: FITO, req: true },
      { k: "objetivo", l: "Plaga, maleza o enfermedad objetivo", t: "txt" },
      { k: "area", l: "Área tratada (ha)", t: "num", step: "0.01", req: true },
      { k: "caldoHa", l: "Caldo (L por ha)", t: "num", step: "0.1" },
      { k: "metodo", l: "Método", t: "sel", ops: ["Bomba de espalda", "Dron", "Tractor"] },
      { k: "horaInicio", l: "Hora de inicio", t: "time", req: true }, { k: "horaFin", l: "Hora final", t: "time", req: true },
      { k: "viento", l: "Viento", t: "sel", ops: ["Calma (menos de 5 km/h)", "Suave (5 a 10 km/h)", "Fuerte (más de 10 km/h)"] },
      { k: "humedad", l: "Humedad relativa (%)", t: "num" },
      { k: "lluvia", l: "¿Llovió en las 6 horas siguientes?", t: "sino", def: false },
      { k: "epp", l: "¿El aplicador usó equipo de protección completo?", t: "sino", def: true },
      { k: "recomendo", l: "Quién recomendó la aplicación", t: "txt" }, fotos, obs] },
  inspeccion: { nombre: "Inspección del cultivo", desc: "Etapa, altura, plantas por metro, sanidad", ico: "🔎",
    campos: [{ k: "seccion", l: "Sección o punto", t: "seccion" },
      { k: "fenologia", l: "Etapa del cultivo", t: "sel", ops: ["Emergencia", "3 a 5 hojas", "Crecimiento (6 hojas o más)", "Embuchamiento", "Floración", "Grano lechoso", "Grano pastoso", "Madurez", "Rebrote"] },
      { k: "alturas", l: "Altura de 10 plantas en cm (separadas por espacio)", t: "alturas" },
      { k: "plantasM", l: "Plantas por metro de surco", t: "num", step: "0.1" },
      { k: "sanitario", l: "Estado sanitario", t: "sel", ops: ["Bueno", "Regular", "Malo"] }, fotos, obs] },
  siembra: { nombre: "Siembra", desc: "Área, semilla, kg/ha, método", ico: "🌾",
    campos: [{ k: "area", l: "Área sembrada (ha)", t: "num", step: "0.01", req: true },
      { k: "semilla", l: "Semilla", t: "prod", tipos: ["Semilla"], req: true },
      { k: "kgSemilla", l: "Semilla usada (kg)", t: "num", step: "0.1", req: true },
      { k: "loteSemilla", l: "Lote de la bolsa (etiqueta)", t: "txt" },
      { k: "metodo", l: "Método", t: "sel", ops: ["A chorrillo en el surco", "Sembradora", "Al voleo"] },
      { k: "tratada", l: "¿La semilla venía tratada?", t: "sino", def: true },
      { k: "germinacion", l: "Germinación en la prueba (%)", t: "num" }, fotos, obs] },
  labor: { nombre: "Labores", desc: "Jornales y horas de tractor", ico: "🧑‍🌾",
    campos: [{ k: "labor", l: "Labor", t: "sel", ops: ["Desyerbe manual", "Arado", "Rastrillo", "Surcado", "Siembra", "Abonada", "Fumigación", "Riego", "Cerca", "Corte y ensilaje", "Otra"] },
      { k: "jornales", l: "Jornales", t: "num", step: "0.5" }, { k: "valorJornal", l: "Valor del jornal ($)", t: "num", step: "1000" },
      { k: "horasTractor", l: "Horas de tractor", t: "num", step: "0.1" }, { k: "valorHoraTractor", l: "Valor de la hora de tractor ($)", t: "num", step: "1000" },
      { k: "otros", l: "Otros costos de la labor ($)", t: "num", step: "1000" }, obs] },
  combustible: { nombre: "Combustible", desc: "Tanqueo de tractor, guadaña u otros", ico: "⛽",
    nota: "La gasolina de la motobomba se anota en la jornada de riego. Aquí va el tanqueo de los demás equipos, o una compra de gasolina para sacar el precio del galón.",
    campos: [{ k: "equipo", l: "Equipo", t: "cat", cat: "equipos" }, { k: "combustible", l: "Combustible", t: "sel", ops: ["Gasolina", "ACPM"] },
      { k: "galones", l: "Galones", t: "num", step: "0.1", req: true }, { k: "valor", l: "Valor total ($)", t: "num", step: "100", req: true },
      { k: "operador", l: "Operador", t: "txt" }, { k: "horometro", l: "Horómetro", t: "num", step: "0.1" }, obs] },
  cosecha: { nombre: "Corte / cosecha", desc: "Área, toneladas de forraje y de silo", ico: "🚜",
    campos: [{ k: "area", l: "Área cosechada (ha)", t: "num", step: "0.01", req: true },
      { k: "tVerde", l: "Forraje verde (t)", t: "num", step: "0.1" }, { k: "tSilo", l: "Silo (t)", t: "num", step: "0.1", req: true },
      { k: "viajes", l: "Viajes", t: "num" }, { k: "ms", l: "Materia seca (%) si se midió", t: "num", step: "0.1" },
      { k: "destino", l: "Destino", t: "sel", ops: ["Venta", "Consumo propio", "Dueño del lote", "Mixto"] },
      { k: "comprador", l: "Comprador", t: "txt" }, { k: "precioT", l: "Precio por tonelada ($)", t: "num", step: "1000" }, fotos, obs] },
  compra: { nombre: "Compra de insumos", desc: "Entra a bodega con su precio", ico: "🧾", sinLote: true,
    campos: [{ k: "proveedor", l: "Proveedor", t: "txt", req: true }, { k: "producto", l: "Producto", t: "prod", req: true },
      { k: "cantidad", l: "Cantidad", t: "num", step: "0.1", req: true }, { k: "unidad", l: "Unidad", t: "sel", ops: UNIDADES_COMPRA },
      { k: "valor", l: "Valor total pagado ($)", t: "num", step: "100", req: true }, { k: "factura", l: "N.º de factura", t: "txt" },
      { k: "fotos", l: "Foto de la factura", t: "fotos" }, obs] }
};
export const ORDEN_TIPOS = ["riego", "fertilizacion", "plaga", "fumigacion", "inspeccion", "siembra", "labor", "combustible", "cosecha", "compra"];

// ---------- Cálculos por registro ----------
export function horasEntre(a, b) {
  if (!a || !b) return null;
  const m = s => { const [h, mi] = s.split(":").map(Number); return h * 60 + mi; };
  const d = m(b) - m(a); return d > 0 ? Math.round(d / 60 * 100) / 100 : null;
}
export function parseAlturas(s) { return String(s || "").split(/[\s;]+/).map(x => parseFloat(x.replace(",", "."))).filter(x => isFinite(x) && x > 0); }

// Agrega los campos calculados al registro (se guardan con él).
export function derivar(tipo, d, cat, fechaHecho) {
  const r1 = (x, n = 2) => x == null || !isFinite(x) ? null : Math.round(x * 10 ** n) / 10 ** n;
  if (tipo === "riego") d.horas = horasEntre(d.horaInicio, d.horaFin);
  if (tipo === "plaga") { const p = cat.plagas.find(p => p.nombre === d.plaga); d.umbral = p?.umbral ?? 20; d.pct = d.revisadas > 0 ? r1(d.afectadas / d.revisadas * 100, 1) : null; d.sobreUmbral = d.pct != null && d.pct >= d.umbral; }
  if (tipo === "fertilizacion") { const b = aBase(d.cantidad, d.unidad); d.cantBase = r1(b.cant, 3); d.base = b.base; d.dosisHa = d.area > 0 ? r1(b.cant / d.area, 1) : null; }
  if (tipo === "fumigacion") {
    d.horas = horasEntre(d.horaInicio, d.horaFin);
    let car = 0, sinCar = [];
    for (const p of d.productos || []) { const c = prodDe(cat, p.producto); if (c?.carencia != null && c.carencia !== "") car = Math.max(car, Number(c.carencia)); else sinCar.push(p.producto); }
    d.carencia = car; d.sinCarencia = sinCar; d.fechaLibre = fechaHecho ? sumarDias(fechaHecho, car) : null;
  }
  if (tipo === "inspeccion") { const a = parseAlturas(d.alturas); d.nAlturas = a.length; d.alturaProm = a.length ? r1(a.reduce((s, x) => s + x, 0) / a.length, 1) : null; }
  if (tipo === "siembra") d.kgHa = d.area > 0 ? r1(d.kgSemilla / d.area, 1) : null;
  if (tipo === "labor") d.total = Math.round((d.jornales || 0) * (d.valorJornal || 0) + (d.horasTractor || 0) * (d.valorHoraTractor || 0) + (d.otros || 0));
  if (tipo === "combustible") d.precioGal = d.galones > 0 ? Math.round(d.valor / d.galones) : null;
  if (tipo === "cosecha") { d.tSiloHa = d.area > 0 ? r1(d.tSilo / d.area, 1) : null; d.ingreso = d.precioT ? Math.round(d.tSilo * d.precioT) : null; }
  if (tipo === "compra") { const b = aBase(d.cantidad, d.unidad); d.cantBase = r1(b.cant, 3); d.base = b.base; d.precioUnit = b.cant > 0 ? Math.round(d.valor / b.cant) : null; }
  return d;
}

// Lo que se muestra mientras se llena el formulario: {cls, titulo, valor, texto}
export function vistaCalculo(tipo, d) {
  if (tipo === "riego") return { cls: d.horas == null ? "" : "ok", titulo: "Tiempo de motobomba", valor: d.horas == null ? "—" : num(d.horas, 2) + " h" };
  if (tipo === "plaga") return { cls: d.pct == null ? "" : d.sobreUmbral ? "crit" : d.pct >= d.umbral * .75 ? "warn" : "ok", titulo: `Afectación (umbral ${d.umbral} %)`,
    valor: d.pct == null ? "—" : num(d.pct, 1) + " %", texto: d.pct == null ? "" : d.sobreUmbral ? "Sobre el umbral: avisar al administrador." : "Bajo el umbral: seguir monitoreando." };
  if (tipo === "fertilizacion") return { cls: d.dosisHa ? "ok" : "", titulo: "Dosis por hectárea", valor: d.dosisHa ? `${num(d.dosisHa, 1)} ${d.base}/ha` : "—", texto: d.cantBase ? `Total: ${num(d.cantBase, 1)} ${d.base}` : "" };
  if (tipo === "fumigacion") return { cls: d.horas == null ? "" : "ok", titulo: "Carencia", valor: d.carencia ? `${d.carencia} días` : "Sin carencia",
    texto: [d.fechaLibre && d.carencia ? `No cortar antes del ${fmtF(d.fechaLibre)}` : "", d.horas != null ? `Duración: ${num(d.horas, 2)} h` : ""].filter(Boolean).join(" · ") };
  if (tipo === "inspeccion") return { cls: d.alturaProm ? "ok" : "", titulo: "Altura promedio", valor: d.alturaProm ? num(d.alturaProm, 1) + " cm" : "—", texto: d.nAlturas ? `${d.nAlturas} plantas medidas${d.nAlturas < 10 ? " (lo ideal son 10)" : ""}` : "" };
  if (tipo === "siembra") return { cls: d.kgHa ? "ok" : "", titulo: "Semilla por hectárea", valor: d.kgHa ? num(d.kgHa, 1) + " kg/ha" : "—" };
  if (tipo === "labor") return { cls: d.total ? "ok" : "", titulo: "Costo de la labor", valor: pesos(d.total) };
  if (tipo === "combustible") return { cls: d.precioGal ? "ok" : "", titulo: "Precio del galón", valor: pesos(d.precioGal) };
  if (tipo === "cosecha") return { cls: d.tSiloHa ? "ok" : "", titulo: "Silo por hectárea", valor: d.tSiloHa ? num(d.tSiloHa, 1) + " t/ha" : "—", texto: d.ingreso ? "Ingreso: " + pesos(d.ingreso) : "" };
  if (tipo === "compra") return { cls: d.precioUnit ? "ok" : "", titulo: "Precio por unidad", valor: d.precioUnit ? `${pesos(d.precioUnit)} por ${d.base}` : "—" };
  return null;
}

// Avisos que no bloquean (nivel warn) y errores que sí (nivel bloquea).
export function revisar(tipo, d, cat, lote) {
  const out = [], w = t => out.push({ nivel: "warn", t }), b = t => out.push({ nivel: "bloquea", t });
  if (tipo === "plaga" && d.afectadas > d.revisadas) b("Las plantas afectadas no pueden ser más que las revisadas.");
  if ((tipo === "riego" || tipo === "fumigacion") && d.horaInicio && d.horaFin && d.horas == null) b("La hora final debe ser después de la de inicio.");
  if (tipo === "fumigacion") {
    if (!(d.productos || []).length) b("Agrega al menos un producto con su dosis.");
    if (d.metodo === "Dron" && (d.productos || []).some(p => /2[,.]?\s?4[\s-]?d/i.test(p.producto))) w("El 2,4-D va dirigido con bomba de espalda, nunca con dron, por la deriva.");
    if (/Fuerte/.test(d.viento || "")) w("Con viento fuerte hay deriva: mejor aplazar la aplicación.");
    if (d.lluvia) w("Llovió poco después: revisa si hay que repetir la aplicación.");
    if (d.epp === false) w("El aplicador no tenía equipo de protección completo.");
    if (d.sinCarencia?.length) w(`Sin carencia en el catálogo: ${d.sinCarencia.join(", ")}. Pídele al administrador que la anote.`);
    if (lote?.fechaCorte && d.fechaLibre && d.carencia && d.fechaLibre > lote.fechaCorte) w(`La carencia termina el ${fmtF(d.fechaLibre)}, después del corte previsto (${fmtF(lote.fechaCorte)}).`);
  }
  if (tipo === "siembra" && d.kgHa && (d.kgHa < 5 || d.kgHa > 15)) w(`${num(d.kgHa, 1)} kg/ha se sale de lo normal para sorgo (7 a 12). Revisa el área y los kilos.`);
  if (tipo === "cosecha" && d.tVerde && d.tSilo > d.tVerde) b("El silo no puede pesar más que el forraje verde.");
  if (tipo === "compra" || tipo === "fertilizacion") {
    const p = prodDe(cat, d.producto);
    if (p && d.base && p.unidad && p.unidad !== d.base) w(`${p.nombre} se lleva en ${p.unidad} en el catálogo y aquí va en ${d.base}: no se podrá descontar del inventario.`);
  }
  return out;
}

// ---------- Texto corto y filas de detalle ----------
export const fmtDosis = ps => (ps || []).map(p => `${p.producto} ${num(p.dosis, 2)} ${p.unidad}`).join(" + ");
export function resumen(r) {
  const d = r.datos || {};
  switch (r.tipo) {
    case "riego": return `Sección ${d.seccion || "—"} · ${num(d.horas, 2)} h${d.galones ? ` · ${num(d.galones, 1)} gal` : ""}${d.llego === false ? " · agua no llegó al final" : ""}`;
    case "fertilizacion": return `${d.producto} · ${num(d.cantidad, 1)} ${d.unidad || ""}${d.area ? ` en ${num(d.area, 2)} ha` : ""}${d.dosisHa ? ` (${num(d.dosisHa, 0)} ${d.base}/ha)` : ""}`;
    case "plaga": return `${d.plaga} · ${num(d.pct, 1)} %${d.sobreUmbral ? " · sobre el umbral" : ""}`;
    case "fumigacion": return `${fmtDosis(d.productos)} · ${num(d.area, 2)} ha · ${d.metodo || ""}${d.carencia ? ` · carencia hasta ${fmtF(d.fechaLibre)}` : ""}`;
    case "inspeccion": return [d.fenologia, d.alturaProm ? num(d.alturaProm, 0) + " cm" : null, d.plantasM ? num(d.plantasM, 1) + " pl/m" : null, d.sanitario].filter(Boolean).join(" · ");
    case "siembra": return `${num(d.area, 2)} ha · ${num(d.kgSemilla, 1)} kg de ${d.semilla}${d.kgHa ? ` (${num(d.kgHa, 1)} kg/ha)` : ""}`;
    case "labor": return `${d.labor || "Labor"} · ${pesos(d.total)}${d.jornales ? ` · ${num(d.jornales, 1)} jornales` : ""}${d.horasTractor ? ` · ${num(d.horasTractor, 1)} h tractor` : ""}`;
    case "combustible": return `${d.equipo || "Equipo"} · ${num(d.galones, 1)} gal ${d.combustible || ""} · ${pesos(d.valor)}`;
    case "cosecha": return `${num(d.area, 2)} ha · ${num(d.tSilo, 1)} t de silo${d.tSiloHa ? ` (${num(d.tSiloHa, 1)} t/ha)` : ""}${d.destino ? " · " + d.destino : ""}`;
    case "compra": return `${d.producto} · ${num(d.cantidad, 1)} ${d.unidad || ""} · ${pesos(d.valor)}${d.proveedor ? " · " + d.proveedor : ""}`;
  }
  return "";
}
export function filasCalculadas(r) {
  const d = r.datos || {}, f = [];
  const add = (k, v) => { if (v != null && v !== "" && v !== "—") f.push([k, v]); };
  if (r.tipo === "riego") add("Tiempo de motobomba", num(d.horas, 2) + " h");
  if (r.tipo === "plaga") add("Afectación", `${num(d.pct, 1)} % (umbral ${d.umbral} %)`);
  if (r.tipo === "fertilizacion" && d.dosisHa) add("Dosis por hectárea", `${num(d.dosisHa, 1)} ${d.base}/ha`);
  if (r.tipo === "fumigacion") { add("Duración", d.horas != null ? num(d.horas, 2) + " h" : null); add("Carencia", d.carencia ? `${d.carencia} días, hasta el ${fmtF(d.fechaLibre)}` : "Sin carencia"); }
  if (r.tipo === "inspeccion" && d.alturaProm) add("Altura promedio", `${num(d.alturaProm, 1)} cm (${d.nAlturas} plantas)`);
  if (r.tipo === "siembra" && d.kgHa) add("Semilla por hectárea", num(d.kgHa, 1) + " kg/ha");
  if (r.tipo === "labor") add("Costo de la labor", pesos(d.total));
  if (r.tipo === "combustible") add("Precio del galón", pesos(d.precioGal));
  if (r.tipo === "cosecha") { add("Silo por hectárea", d.tSiloHa ? num(d.tSiloHa, 1) + " t/ha" : null); add("Ingreso", d.ingreso ? pesos(d.ingreso) : null); }
  if (r.tipo === "compra") add("Precio por unidad", d.precioUnit ? `${pesos(d.precioUnit)} por ${d.base}` : null);
  return f;
}

// ---------- Inventario y costos ----------
// Lo que un registro saca de bodega: [{producto, cant, base}]
export function consumos(r) {
  const d = r.datos || {};
  if (r.tipo === "fertilizacion") { const b = aBase(d.cantidad, d.unidad); return [{ producto: d.producto, cant: b.cant, base: b.base }]; }
  if (r.tipo === "siembra") return [{ producto: d.semilla, cant: Number(d.kgSemilla) || 0, base: "kg" }];
  if (r.tipo === "fumigacion") return (d.productos || []).map(p => { const b = aBase(p.dosis, p.unidad); return { producto: p.producto, cant: b.cant * (Number(d.area) || 0), base: b.base }; });
  return [];
}
// Inventario con los registros aprobados: comprado, aplicado, saldo y costo promedio por producto.
export function inventario(regs, cat) {
  const inv = {};
  const fila = (n, base) => inv[n] ||= { producto: n, base: prodDe(cat, n)?.unidad || base, comprado: 0, valor: 0, aplicado: 0, min: prodDe(cat, n)?.min ?? null, mezcla: false };
  for (const r of regs) {
    if (r.tipo === "compra") { const d = r.datos || {}, b = aBase(d.cantidad, d.unidad), f = fila(d.producto, b.base); if (b.base !== f.base) { f.mezcla = true; continue; } f.comprado += b.cant; f.valor += Number(d.valor) || 0; }
    for (const c of consumos(r)) { if (!c.producto) continue; const f = fila(c.producto, c.base); if (c.base !== f.base) { f.mezcla = true; continue; } f.aplicado += c.cant; }
  }
  for (const f of Object.values(inv)) { f.saldo = f.comprado - f.aplicado; f.costoProm = f.comprado > 0 ? f.valor / f.comprado : null; f.bajo = f.min != null && f.min !== "" && f.saldo < Number(f.min); }
  return inv;
}
export function precioGalon(regs, cat) {
  const cs = regs.filter(r => r.tipo === "combustible" && (r.datos?.combustible || "Gasolina") === "Gasolina" && r.datos?.galones > 0);
  const g = cs.reduce((s, r) => s + r.datos.galones, 0), v = cs.reduce((s, r) => s + (r.datos.valor || 0), 0);
  return g > 0 ? v / g : (cat.precioGalon || null);
}
// Costos de un grupo de registros (ya filtrados por lote y ciclo); inv y pGal salen de todos los aprobados.
export function costos(regs, inv, pGal) {
  const c = { insumos: 0, combustible: 0, gasolinaRiego: 0, labores: 0, sinPrecio: new Set(), galRiego: 0, galComb: 0 };
  for (const r of regs) {
    for (const x of consumos(r)) { const f = inv[x.producto]; if (f?.costoProm != null) c.insumos += x.cant * f.costoProm; else if (x.producto) c.sinPrecio.add(x.producto); }
    if (r.tipo === "combustible") { c.combustible += r.datos?.valor || 0; c.galComb += r.datos?.galones || 0; }
    if (r.tipo === "riego") c.galRiego += r.datos?.galones || 0;
    if (r.tipo === "labor") c.labores += r.datos?.total || 0;
  }
  c.gasolinaRiego = pGal ? c.galRiego * pGal : 0;
  if (c.galRiego && !pGal) c.sinPrecio.add("gasolina de riego");
  c.total = c.insumos + c.combustible + c.gasolinaRiego + c.labores;
  return c;
}
