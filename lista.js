// Lista de compras del proyecto: ítems base y a qué registro va cada uno.
// tipo: "compra" (entra a bodega), "gasto" (costo del proyecto), "labor" o "combustible" (van a un lote),
// null = no se registra desde la lista (p. ej. la gasolina de riego se anota en cada jornada de riego).
const R = "Riego (tubos, llaves, accesorios)", C = "Cerca", EQ = "Equipos y herramientas", TR = "Transporte y fletes",
  SV = "Servicios (análisis de suelo, asistencia técnica, maquinaria)", MO = "Mano de obra contratada";
const g = (cat, desc) => ({ tipo: "gasto", pre: { categoria: cat, descripcion: desc } });
const c = producto => ({ tipo: "compra", pre: { producto } });

export const SECCIONES = [
  ["cerca", "Cerca para el ganado"], ["semilla", "Semilla y suelo"], ["abono", "Fertilizantes"], ["fito", "Programa fitosanitario"],
  ["riego", "Riego por surcos"], ["cosecha", "Cosecha y ensilaje"], ["jornales", "Mano de obra y tractor"], ["otros", "Otros"]
];

export const LISTA_BASE = [
  ["cerca", "Alambre galvanizado", "2 rollos de 1.000 m · 3 hilos", 0, 0, g(C, "Alambre galvanizado")],
  ["cerca", "Palos (línea y anclaje)", "46 und · cada 12 m", 0, 0, g(C, "Palos para la cerca")],
  ["cerca", "Aisladores de línea", "126 und", 0, 0, g(C, "Aisladores de línea")],
  ["cerca", "Mazorcas (aisladores de esquina)", "12 und", 0, 0, g(C, "Mazorcas")],
  ["cerca", "Tensores", "12 und · uno por hilo en cada tramo", 0, 0, g(C, "Tensores")],
  ["cerca", "Impulsor / energizador", "1 und", 0, 0, g(C, "Impulsor de cerca eléctrica")],
  ["cerca", "Varillas de polo a tierra + cable", "1 juego", 0, 0, g(C, "Polo a tierra")],
  ["cerca", "Puerta, grapas y alambre de amarre", "global", 0, 0, g(C, "Puerta, grapas y amarre")],
  ["cerca", "Mano de obra de construcción", "540 m lineales", 0, 0, g(MO, "Construcción de la cerca")],
  ["semilla", "Semilla AGROSAVIA JJT-18", "21 kg · $999.000 (ya comprada)", 0, 1, c("Semilla JJT-18")],
  ["semilla", "Tratamiento de semilla", "solo si no viene tratada", 1, 0, c("")],
  ["semilla", "Análisis de suelo (laboratorio)", "muestras del 21-oct", 0, 0, g(SV, "Análisis de suelo")],
  ["semilla", "Cal agrícola", "según pH y aluminio del análisis", 1, 0, c("Cal agrícola")],
  ["abono", "Abono de siembra 15-15-15 o DAP", "fuente por decidir · 3 aplicaciones (0, 15, 30 días)", 1, 0, c("")],
  ["abono", "Urea", "cobertera corte 1 + rebrote", 1, 0, c("Urea")],
  ["abono", "Cloruro de potasio (KCl)", "cobertera corte 1 + rebrote", 1, 0, c("KCl")],
  ["fito", "Cebo para hormiga arriera", "día −25", 0, 0, c("")],
  ["fito", "Glifosato", "desecación del pasto, día −20", 0, 0, c("Glifosato")],
  ["fito", "Atrazina", "1,2–1,5 kg/ha · 1 aplicación · ≈ 3,3 kg", 1, 0, c("Atrazina 90 WG")],
  ["fito", "Halosulfurón", "150 g/ha dirigido al coquito", 0, 0, c("Halosulfurón")],
  ["fito", "2,4-D amina", "hoja ancha, con bomba de espalda", 0, 0, c("2,4-D amina")],
  ["fito", "Bt (Bacillus thuringiensis)", "cogollero al 20 % de daño", 0, 0, c("Bt")],
  ["fito", "Spinetoram", "cogollero al 35 % de daño", 0, 0, c("Spinetoram")],
  ["fito", "Sulfoxaflor o flupiradifurona", "pulgón amarillo", 0, 0, c("")],
  ["fito", "Fungicida estrobilurina + triazol", "45 días y 30 días del rebrote (+1 de reserva)", 0, 0, c("")],
  ["fito", "Trichogramma y Telenomus", "5 liberaciones corte 1 + 3 en rebrote", 0, 0, c("Trichogramma")],
  ["fito", "Coadyuvante / regulador de pH", "para las mezclas", 0, 0, c("Coadyuvante")],
  ["fito", "EPP", "guantes de nitrilo, careta, overol, botas", 0, 0, g(EQ, "EPP para aplicaciones")],
  ["fito", "Bomba de espalda", "para 2,4-D y aplicaciones dirigidas", 0, 0, g(EQ, "Bomba de espalda")],
  ["riego", "Motobomba Barnes 2\" a gasolina", "$1.650.000 (ya comprada)", 0, 1, c("Motobomba Barnes HG 2 65 HF")],
  ["riego", "Línea principal 2\" (manguera o tubo)", "metros según recorrido bomba → cabecera", 1, 0, g(R, "Línea principal 2\"")],
  ["riego", "Manguera de succión 2\" + pichancha", "1 juego", 0, 0, g(R, "Manguera de succión 2\" y pichancha")],
  ["riego", "Acoples, uniones, adaptadores y abrazaderas 2\"", "global", 0, 0, g(R, "Acoples y accesorios 2\"")],
  ["riego", "Llaves de paso", "4 und · una por sección", 0, 0, g(R, "Llaves de paso")],
  ["riego", "Tomas o sifones a surcos", "según surcos por tanda (≈ 5)", 1, 0, g(R, "Tomas o sifones")],
  ["riego", "Gasolina y aceite", "se anota en cada jornada de riego", 0, 0, { tipo: null }],
  ["riego", "Repuestos motobomba", "bujía, filtro de aire, aceite", 0, 0, g(EQ, "Repuestos de la motobomba")],
  ["riego", "Mano de obra de instalación", "1 jornal", 0, 0, g(MO, "Instalación del riego")],
  ["cosecha", "Servicio de picado", "contratar · se cobra por ha", 0, 0, g(SV, "Servicio de picado")],
  ["cosecha", "Plástico de ensilaje", "corte 1 + rebrote", 1, 0, g("Otros", "Plástico de ensilaje")],
  ["cosecha", "Inoculante", "corte 1 + rebrote", 0, 0, c("Inoculante")],
  ["cosecha", "Transporte al comprador", "por definir", 0, 0, g(TR, "Transporte del silo")],
  ["jornales", "ACPM para el tractor", "arada, pulidas y surcado", 0, 0, { tipo: "combustible", pre: { combustible: "ACPM" } }],
  ["jornales", "Mantenimiento del tractor", "global", 0, 0, g(SV, "Mantenimiento del tractor")],
  ["jornales", "Jornales de siembra", "personas por definir", 0, 0, { tipo: "labor", pre: { labor: "Siembra" } }],
  ["jornales", "Jornales de fumigación y cal", "según aplicaciones", 0, 0, { tipo: "labor", pre: { labor: "Fumigación" } }],
  ["jornales", "Desyerbe manual", "25 y 35 días", 0, 0, { tipo: "labor", pre: { labor: "Desyerbe manual" } }],
  ["jornales", "Operario de riego", "abrir y cerrar surcos", 0, 0, { tipo: "labor", pre: { labor: "Riego" } }]
].map(([seccion, nombre, detalle, confirmar, comprado, reg], i) => ({
  seccion, nombre, detalle, confirmar: !!confirmar, comprado: !!comprado, orden: i, tipo: reg.tipo, pre: reg.pre || {}
}));

// Qué registro sugiere la lista para un ítem nuevo según su sección.
export function tipoPorSeccion(sec) {
  return { semilla: "compra", abono: "compra", fito: "compra" }[sec] || "gasto";
}
export const RUBRO_POR_SECCION = { cerca: C, riego: R, cosecha: SV, jornales: MO, otros: "Otros", fito: EQ, semilla: SV, abono: "Otros" };
