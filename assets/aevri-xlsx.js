/* Minimal XLSX reader and writer for VET and VSS (plain ES module, no dependencies, ADR-001).
   Writer: stored (uncompressed) ZIP, inline strings, numbers, a bold header row, frozen first row, column widths.
   Reader: stored and deflated entries (DecompressionStream 'deflate-raw'), shared and inline strings, numbers,
   booleans, formulas' cached values. Enough for list exchange with Excel, LibreOffice and Google Sheets; no styles,
   dates stay serial numbers. Loaded lazily (VET NF-3). */

const enc = new TextEncoder();
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); // characters XML 1.0 does not allow

/** "A", "B", ... "AA" for a 0-based column. */
export function colName(i) { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
function colIndex(ref) { let n = 0; for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }

function zip(files) { // files: [{ name, data: Uint8Array }]
  const parts = [], central = [];
  let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), n = f.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, n, true); lh.setUint32(22, n, true); lh.setUint16(26, name.length, true);
    parts.push(new Uint8Array(lh.buffer), name, f.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, n, true); ch.setUint32(24, n, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), name);
    off += 30 + name.length + n;
  }
  const size = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, size, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** A cell: a finite number stays a number; everything else is an inline string (no formulas are ever written, NF-7). */
function cellXml(v, ref, bold) {
  const s = bold ? ' s="1"' : '';
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
  if (typeof v === 'boolean') return `<c r="${ref}"${s} t="b"><v>${v ? 1 : 0}</v></c>`;
  const str = String(v).slice(0, 32767); // the Excel cell limit
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(str)}</t></is></c>`;
}

/** sheets: [{ name, rows: any[][], widths?: number[] }]; the first row is the header (bold, frozen). Returns a Blob. */
export function writeXlsx(sheets) {
  const used = new Set();
  const names = sheets.map((sh, i) => {
    let n = String(sh.name || 'Sheet' + (i + 1)).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet' + (i + 1);
    while (used.has(n.toLowerCase())) n = n.slice(0, 28) + ' ' + (i + 1);
    used.add(n.toLowerCase()); return n;
  });
  const files = [];
  const add = (name, xml) => files.push({ name, data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + xml) });
  add('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>');
  add('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  add('xl/workbook.xml', '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
    + names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>');
  add('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  add('xl/styles.xml', '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
    + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs>'
    + '<cellXfs count="2"><xf fontId="0"/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>');
  sheets.forEach((sh, i) => {
    const rows = sh.rows || [];
    const width = Math.max(1, ...rows.map((r) => r.length));
    const widths = sh.widths || Array.from({ length: width }, (_, c) => Math.min(60, Math.max(8, ...rows.slice(0, 200).map((r) => String(r[c] ?? '').length + 2))));
    const cols = '<cols>' + widths.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>';
    const data = rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((v, ci) => cellXml(v, colName(ci) + (ri + 1), ri === 0 && sh.header !== false)).join('') + '</row>').join('');
    const freeze = sh.header === false ? '' : '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
    add(`xl/worksheets/sheet${i + 1}.xml`, `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${freeze}${cols}<sheetData>${data}</sheetData></worksheet>`);
  });
  return zip(files);
}

async function unzip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf);
  let e = u8.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('not-zip');
  const count = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  const out = new Map(), dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('bad-zip');
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), loc = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (!/\.(xml|rels)$/i.test(name)) continue; // images and binaries are not needed
    const start = loc + 30 + dv.getUint16(loc + 26, true) + dv.getUint16(loc + 28, true);
    const raw = u8.subarray(start, start + csize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) {
      if (typeof DecompressionStream === 'undefined') throw new Error('no-inflate');
      data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    } else throw new Error('zip-method');
    out.set(name.replace(/^\//, ''), dec.decode(data));
  }
  return out;
}

const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
const kids = (el, name) => [...el.getElementsByTagName('*')].filter((x) => x.localName === name);
const textOf = (el) => kids(el, 't').map((x) => x.textContent).join('');

/** Reads an .xlsx (ArrayBuffer) into [{ name, rows: string|number|boolean[][] }]; empty cells are ''. Limits protect the page. */
export async function readXlsx(buf, { maxRows = 20000, maxCols = 200 } = {}) {
  const files = await unzip(buf);
  const wb = files.get('xl/workbook.xml');
  if (!wb) throw new Error('not-xlsx');
  const rels = new Map();
  const relXml = files.get('xl/_rels/workbook.xml.rels');
  if (relXml) for (const r of kids(xml(relXml), 'Relationship')) rels.set(r.getAttribute('Id'), r.getAttribute('Target'));
  const shared = files.has('xl/sharedStrings.xml') ? kids(xml(files.get('xl/sharedStrings.xml')), 'si').map(textOf) : [];
  const sheets = [];
  for (const s of kids(xml(wb), 'sheet')) {
    const rid = s.getAttribute('r:id') || [...s.attributes].find((a) => a.localName === 'id')?.value;
    let target = rels.get(rid) || '';
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    const src = files.get(target);
    if (!src) continue;
    const rows = [];
    for (const r of kids(xml(src), 'row')) {
      const ri = (parseInt(r.getAttribute('r'), 10) || rows.length + 1) - 1;
      if (ri >= maxRows) break;
      const row = [];
      for (const c of kids(r, 'c')) {
        const ci = c.getAttribute('r') ? colIndex(c.getAttribute('r')) : row.length;
        if (ci >= maxCols) continue;
        const ty = c.getAttribute('t'), v = kids(c, 'v')[0]?.textContent ?? '';
        let val;
        if (ty === 's') val = shared[parseInt(v, 10)] ?? '';
        else if (ty === 'inlineStr') val = textOf(c);
        else if (ty === 'str' || ty === 'e') val = v;
        else if (ty === 'b') val = v === '1';
        else val = v === '' ? '' : Number(v);
        while (row.length < ci) row.push('');
        row[ci] = val;
      }
      while (rows.length < ri) rows.push([]);
      rows[ri] = row;
    }
    sheets.push({ name: s.getAttribute('name') || '', rows });
  }
  return sheets;
}
