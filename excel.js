// Excel (.xlsx) con formato, armado con JSZip (ya cargado con SRI). Sin librerías externas nuevas.
// Celdas: texto, número, null, o { v, s } con estilo: "h" encabezado, "$" pesos, "f" fecha (AAAA-MM-DD), "n" decimal, "t" título, "$b" pesos en negrita, "w" texto largo, "b" negrita.
const ESTILO = { "": 0, h: 1, "$": 2, f: 3, n: 4, t: 5, "$b": 6, w: 7, b: 8 };
const esc = s => String(s).replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
const colL = i => { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const serial = f => { const [y, m, d] = String(f).slice(0, 10).split("-").map(Number); return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 864e5; };

function celda(ref, c) {
  if (c == null || c === "") return "";
  let v = c, s = "";
  if (typeof c === "object" && !Array.isArray(c)) { v = c.v; s = c.s || ""; }
  if (v == null || v === "") return s ? `<c r="${ref}" s="${ESTILO[s] || 0}"/>` : "";
  const st = ESTILO[s] || 0;
  if (s === "f" && /^\d{4}-\d{2}-\d{2}/.test(v)) return `<c r="${ref}" s="${st}"><v>${serial(v)}</v></c>`;
  if (typeof v === "number" && isFinite(v)) return `<c r="${ref}" s="${st}"><v>${v}</v></c>`;
  if (typeof v === "boolean") return `<c r="${ref}" s="${st}" t="inlineStr"><is><t>${v ? "Sí" : "No"}</t></is></c>`;
  return `<c r="${ref}" s="${st}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v).slice(0, 32000))}</t></is></c>`;
}
// hoja: { nombre, filas: [[celdas]], anchos: [n], fijar: filas fijas arriba, filtro: fila del encabezado (1-based) }
function hojaXml(h) {
  const nCols = Math.max(1, ...h.filas.map(f => f.length));
  const cols = (h.anchos || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
  const filas = h.filas.map((f, r) => `<row r="${r + 1}">${f.map((c, i) => celda(colL(i) + (r + 1), c)).join("")}</row>`).join("");
  const panel = h.fijar ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${h.fijar}" topLeftCell="A${h.fijar + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : "";
  const filtro = h.filtro && h.filas.length > h.filtro ? `<autoFilter ref="A${h.filtro}:${colL(nCols - 1)}${h.filas.length}"/>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${panel}${cols ? `<cols>${cols}</cols>` : ""}<sheetData>${filas}</sheetData>${filtro}</worksheet>`;
}
const ESTILOS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="&quot;$&quot;\\ #,##0"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/><numFmt numFmtId="166" formatCode="#,##0.00"/></numFmts>
<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FF13251B"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF13251B"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top style="thin"><color rgb="FF13251B"/></top><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="3" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

export async function libroXlsx(hojas) {
  const z = new JSZip(), nombres = [];
  hojas.forEach((h, i) => {
    let n = String(h.nombre).replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Hoja" + (i + 1);
    while (nombres.includes(n)) n = n.slice(0, 28) + " " + (i + 1);
    nombres.push(n); z.file(`xl/worksheets/sheet${i + 1}.xml`, hojaXml(h));
  });
  z.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`);
  z.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  z.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${nombres.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`);
  z.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  z.file("xl/styles.xml", ESTILOS);
  return z.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", compression: "DEFLATE" });
}
