/* VSS core: the document model of the Value System Schema editor, no DOM (TZ VSS v1.0 sections 5-7, 9).
   Format "aevri.vss" 1.0 keeps the legacy structure (schema, nodes, flows, elements, texts) and adds routing_mode,
   integrations and extensions. Legacy files (editor 2.x) are migrated on Open/Merge with a report. */

export const FORMAT = 'aevri.vss';
export const SCHEMA_VERSION = '1.0';
export const APP_VERSION = '3.0';
export const PALETTE = ['#4C6FFF', '#FF6B6B', '#F59F00', '#12B886', '#15AABF', '#845EF7', '#E64980', '#5C940D', '#FCC419', '#364FC7',
  '#20C997', '#FA5252', '#7950F2', '#FD7E14', '#0CA678', '#1C7ED6'];

export function uuidv7() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  let ts = Date.now();
  for (let i = 5; i >= 0; i--) { b[i] = ts % 256; ts = Math.floor(ts / 256); }
  b[6] = (b[6] & 0x0f) | 0x70; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export const newId = (prefix) => prefix + '-' + uuidv7().slice(-12); // readable, unique enough inside one schema

// ---------- creation ----------

export function newNode(name, x = 0, y = 0) {
  return { id: newId('node'), name, position: { x, y }, size: { width: 120, height: 60 }, description: '', bpmn_link: '', link: '', attributes: {} };
}

export function newFlow(f) {
  const flow = { id: newId('flow'), name: f.name || '', description: '', type: 'internal', source_node_id: f.source ?? null, target_node_id: f.target ?? null,
    value: f.value ?? 50, unit: f.unit ?? 'Æ', color: f.color, show_label: false, routing_mode: 'all', element_type_ids: [], attributes: {} };
  autoType(flow);
  return flow;
}

export function newSchema(t) {
  const now = new Date().toISOString();
  const node = newNode(t.mainConverter);
  const doc = {
    format: FORMAT, schemaVersion: SCHEMA_VERSION,
    schema: { id: uuidv7(), title: t.newTitle, description: '', version: '1.0.0', author: '', created_at: now, updated_at: now },
    nodes: [node],
    flows: [newFlow({ name: t.extIn, target: node.id, value: 100, color: PALETTE[0] }), newFlow({ name: t.extOut, source: node.id, value: 100, color: PALETTE[1] })],
    elements: [{ id: newId('elem'), name: t.customerValue, description: '', kind: 'value', sign: 1, quantity: 100, unit: 'Æ', location: 'in_node', node_id: node.id, flow_id: null, attributes: {} }],
    texts: [], integrations: { vet: { bindings: {} } }, extensions: {},
  };
  return doc;
}

/** Flow type follows its ends (FLOW-UI-1); an unbound flow keeps external_out (DEL-2). */
export function autoType(f) {
  if (f.source_node_id && f.target_node_id) f.type = 'internal';
  else if (!f.source_node_id && f.target_node_id) f.type = 'external_in';
  else f.type = 'external_out';
}

/** Random colour not yet used by another flow (GEO-7); generated hues once the palette is used up. */
export function freshColor(doc) {
  const used = new Set(doc.flows.map((f) => String(f.color).toLowerCase()));
  const free = PALETTE.filter((c) => !used.has(c.toLowerCase()));
  if (free.length) return free[Math.floor(Math.random() * free.length)];
  const h = Math.floor(Math.random() * 360);
  return hslHex(h, 62, 55);
}
function hslHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return '#' + [f(0), f(8), f(4)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// ---------- lookups ----------

export const nodeById = (doc, id) => doc.nodes.find((n) => n.id === id) || null;
export const flowById = (doc, id) => doc.flows.find((f) => f.id === id) || null;
export const textById = (doc, id) => doc.texts.find((x) => x.id === id) || null;
export const typesOf = (doc, nodeId) => doc.elements.filter((e) => e.location === 'in_node' && e.node_id === nodeId);

/** Element types a flow may carry (TYPE-4, TYPE-5, TYPE-7). External inputs have no producer: null = not specified. */
export function flowTypes(doc, f) {
  if (!f.source_node_id) return null;
  const all = typesOf(doc, f.source_node_id);
  if (f.routing_mode !== 'selected') return all;
  const set = new Set(f.element_type_ids);
  return all.filter((e) => set.has(e.id));
}

/** Toggle one type on a flow; leaving "all" first materialises the full set (TYPE-5). Empty selection stays empty. */
export function toggleType(doc, f, typeId, on) {
  if (!f.source_node_id) return;
  if (f.routing_mode !== 'selected') { f.routing_mode = 'selected'; f.element_type_ids = typesOf(doc, f.source_node_id).map((e) => e.id); }
  const set = new Set(f.element_type_ids);
  if (on) set.add(typeId); else set.delete(typeId);
  f.element_type_ids = [...set];
}

/** Change a flow end; with "selected" routing keep the intersection with the new source (TYPE-6). Returns removed links. */
export function setEnd(doc, f, end, nodeId) {
  const before = f.routing_mode === 'selected' ? f.element_type_ids.length : 0;
  if (end === 'source') f.source_node_id = nodeId || null; else f.target_node_id = nodeId || null;
  if (f.attributes && f.attributes.is_unbound && (f.source_node_id || f.target_node_id)) delete f.attributes.is_unbound;
  autoType(f);
  if (end === 'source' && f.routing_mode === 'selected') {
    const ok = new Set(f.source_node_id ? typesOf(doc, f.source_node_id).map((e) => e.id) : []);
    f.element_type_ids = f.element_type_ids.filter((id) => ok.has(id));
  }
  return before - (f.routing_mode === 'selected' ? f.element_type_ids.length : 0);
}

// ---------- deletion (DEL-1, DEL-2, TYPE-6) ----------

export function deleteNode(doc, nodeId) {
  const report = { removedFlows: 0, detached: 0, unbound: 0 };
  doc.flows = doc.flows.filter((f) => {
    if (f.source_node_id === nodeId) { report.removedFlows++; return false; } // outgoing, incl. self-loop
    return true;
  });
  for (const f of doc.flows) {
    if (f.target_node_id !== nodeId) continue;
    f.target_node_id = null;
    if (f.source_node_id) { report.detached++; autoType(f); } // A -> B becomes an external output of A
    else { f.attributes = { ...(f.attributes || {}), is_unbound: true }; f.type = 'external_out'; report.unbound++; } // kept, with a warning
  }
  const gone = new Set(typesOf(doc, nodeId).map((e) => e.id));
  doc.elements = doc.elements.filter((e) => !gone.has(e.id));
  for (const f of doc.flows) if (f.routing_mode === 'selected') f.element_type_ids = f.element_type_ids.filter((id) => !gone.has(id));
  doc.nodes = doc.nodes.filter((n) => n.id !== nodeId);
  return report;
}

export function deleteType(doc, typeId) {
  doc.elements = doc.elements.filter((e) => e.id !== typeId);
  for (const f of doc.flows) if (f.routing_mode === 'selected') f.element_type_ids = f.element_type_ids.filter((id) => id !== typeId);
}

// ---------- open / migrate (IO-1, IO-6 ... IO-8, DATA-5, DATA-6) ----------

const KNOWN_ROOT = ['format', 'schemaVersion', 'schema', 'nodes', 'flows', 'elements', 'texts', 'integrations', 'extensions'];
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Checks and migrates a document in separate memory. Throws Error with .report (array of lines) when it cannot be opened.
    opts (the migration wizard, IO-7 / IO-8 / DATA-6): emptyRouting 'all' | 'none', moveTypes true | false, negative 'keep' | 'abs'. */
export function migrate(input, opts = {}) {
  const report = [];
  const fail = (msg) => { const e = new Error('invalid'); e.report = [...report, msg]; throw e; };
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('not-object');
  if (input.format && input.format !== FORMAT) fail('format:' + input.format);
  const legacy = !input.format;
  if (!legacy && Number(String(input.schemaVersion).split('.')[0]) > 1) { const e = new Error('newer'); e.report = report; throw e; }
  const doc = JSON.parse(JSON.stringify(input));
  for (const k of ['nodes', 'flows', 'elements', 'texts']) {
    if (doc[k] === undefined) doc[k] = [];
    if (!Array.isArray(doc[k])) fail('not-array:' + k);
  }
  if (!doc.schema || typeof doc.schema !== 'object') { doc.schema = {}; report.push('schema-added'); }
  const now = new Date().toISOString();
  const s = doc.schema;
  doc.schema = { id: String(s.id || uuidv7()), title: String(s.title ?? ''), description: String(s.description ?? ''), version: String(s.version ?? '1.0.0'),
    author: String(s.author ?? ''), created_at: s.created_at || now, updated_at: s.updated_at || now };
  // unique ids per collection (IO-3: duplicates are ambiguous, stop)
  for (const k of ['nodes', 'flows', 'elements', 'texts']) {
    const seen = new Set();
    for (const o of doc[k]) {
      if (!o || typeof o !== 'object' || o.id === undefined || o.id === null || o.id === '') fail('no-id:' + k);
      o.id = String(o.id);
      if (seen.has(o.id)) fail('duplicate:' + k + ':' + o.id);
      seen.add(o.id);
    }
  }
  const nodeIds = new Set(doc.nodes.map((n) => n.id));
  doc.nodes.forEach((n) => {
    n.name = String(n.name ?? n.id);
    n.position = { x: num(n.position?.x, 0), y: num(n.position?.y, 0) };
    n.size = { width: Math.max(40, num(n.size?.width, 120)), height: Math.max(30, num(n.size?.height, 60)) };
    n.description = String(n.description ?? ''); n.bpmn_link = String(n.bpmn_link ?? ''); n.link = String(n.link ?? '');
    n.attributes = n.attributes && typeof n.attributes === 'object' ? n.attributes : {};
  });
  const flowIds = new Set(doc.flows.map((f) => f.id));
  doc.flows.forEach((f) => {
    for (const end of ['source_node_id', 'target_node_id']) {
      if (f[end] === undefined || f[end] === '') f[end] = null;
      if (f[end] !== null && !nodeIds.has(String(f[end]))) fail('dangling:' + f.id + ':' + end + ':' + f[end]);
      if (f[end] !== null) f[end] = String(f[end]);
    }
    if (!f.source_node_id && !f.target_node_id && !(f.attributes && f.attributes.is_unbound)) { f.attributes = { ...(f.attributes || {}), is_unbound: true }; report.push('unbound:' + f.id); }
    f.name = String(f.name ?? ''); f.description = String(f.description ?? ''); f.unit = String(f.unit ?? 'Æ');
    let v = num(Number(f.value), 0);
    if (v < 0 && opts.negative === 'abs') { v = -v; report.push('negative-fixed:' + f.id); }
    else if (v < 0) report.push('negative-value:' + f.id); // kept as legacy value; width uses the magnitude (GEO-9)
    f.value = v;
    if (!/^#[0-9a-f]{6}$/i.test(String(f.color || ''))) f.color = null;
    f.show_label = f.show_label === true;
    f.attributes = f.attributes && typeof f.attributes === 'object' ? f.attributes : {};
    // routing (IO-7): new files are explicit; legacy missing list = all, non-empty = selected, [] = ambiguous -> all (old behaviour), reported
    if (!legacy && (f.routing_mode === 'all' || f.routing_mode === 'selected')) { if (!Array.isArray(f.element_type_ids)) f.element_type_ids = []; }
    else if (!Array.isArray(f.element_type_ids)) { f.routing_mode = 'all'; f.element_type_ids = []; }
    else if (f.element_type_ids.length) f.routing_mode = 'selected';
    else if (opts.emptyRouting === 'none') { f.routing_mode = 'selected'; report.push('routing-empty-as-none:' + f.id); }
    else { f.routing_mode = 'all'; report.push('routing-empty-as-all:' + f.id); }
    f.element_type_ids = f.element_type_ids.map(String);
    autoType(f);
  });
  doc.elements.forEach((e) => {
    e.name = String(e.name ?? e.id); e.description = String(e.description ?? '');
    e.kind = e.kind === 'anti_value' || Number(e.sign) < 0 ? 'anti_value' : 'value';
    e.sign = e.kind === 'anti_value' ? -1 : 1;
    e.quantity = num(Number(e.quantity), 0); e.unit = String(e.unit ?? 'Æ');
    e.attributes = e.attributes && typeof e.attributes === 'object' ? e.attributes : {};
    if (e.location === 'in_flow') { // IO-8: move to the producing converter when the flow has one
      const f = doc.flows.find((x) => x.id === e.flow_id);
      if (f && f.source_node_id && opts.moveTypes !== false) {
        e.location = 'in_node'; e.node_id = f.source_node_id; e.flow_id = null;
        if (f.routing_mode === 'selected' && !f.element_type_ids.includes(e.id)) f.element_type_ids.push(e.id);
        report.push('type-moved:' + e.id);
      } else report.push((f && f.source_node_id ? 'type-kept:' : 'type-in-flow-kept:') + e.id);
    } else {
      e.location = 'in_node';
      if (!nodeIds.has(String(e.node_id))) fail('dangling-type:' + e.id + ':' + e.node_id);
      e.node_id = String(e.node_id); e.flow_id = null;
    }
  });
  // routing refs must belong to the source (TYPE-4)
  doc.flows.forEach((f) => {
    if (f.routing_mode !== 'selected') return;
    const ok = new Set(f.source_node_id ? doc.elements.filter((e) => e.node_id === f.source_node_id).map((e) => e.id) : []);
    const before = f.element_type_ids.length;
    f.element_type_ids = f.element_type_ids.filter((id) => ok.has(id));
    if (f.element_type_ids.length !== before) report.push('routing-cleaned:' + f.id);
  });
  doc.texts.forEach((x) => {
    if (x.position && (x.x === undefined || x.y === undefined)) { x.x = x.position.x; x.y = x.position.y; delete x.position; }
    x.x = num(Number(x.x), 0); x.y = num(Number(x.y), 0); x.text = String(x.text ?? '');
  });
  doc.integrations = doc.integrations && typeof doc.integrations === 'object' ? doc.integrations : {};
  doc.integrations.vet = doc.integrations.vet && typeof doc.integrations.vet === 'object' ? doc.integrations.vet : {};
  doc.integrations.vet.bindings = doc.integrations.vet.bindings && typeof doc.integrations.vet.bindings === 'object' ? doc.integrations.vet.bindings : {};
  for (const fid of Object.keys(doc.integrations.vet.bindings)) if (!flowIds.has(fid)) { doc.integrations.vet.bindings[fid].orphan = true; }
  doc.extensions = doc.extensions && typeof doc.extensions === 'object' ? doc.extensions : {};
  const extra = Object.keys(input).filter((k) => !KNOWN_ROOT.includes(k));
  if (extra.length) { doc.extensions.legacy = { ...(doc.extensions.legacy || {}) }; extra.forEach((k) => { doc.extensions.legacy[k] = doc[k]; delete doc[k]; }); report.push('legacy-fields:' + extra.join(',')); }
  doc.format = FORMAT; doc.schemaVersion = SCHEMA_VERSION;
  if (legacy) report.unshift('legacy');
  return { doc, report };
}

/** Canonical export (IO-9): no history, no UI state. */
export function serialize(doc) {
  const out = { format: FORMAT, schemaVersion: SCHEMA_VERSION };
  for (const k of ['schema', 'nodes', 'flows', 'elements', 'texts', 'integrations', 'extensions']) out[k] = doc[k];
  return JSON.stringify(out, null, 2);
}

// ---------- merge (IO-2 ... IO-5) ----------

/** Adds a migrated document as an independent copy: every id gets a new prefix, all references rewritten. */
export function merge(doc, imp, bounds) {
  const prefix = 'm' + uuidv7().slice(-5) + '_';
  const map = { nodes: new Map(), flows: new Map(), elements: new Map(), texts: new Map() };
  for (const k of Object.keys(map)) imp[k].forEach((o) => map[k].set(o.id, prefix + o.id));
  // place to the right of the current content, same top (IO-4)
  const ib = boundsOf(imp);
  const dx = bounds ? bounds.maxX + 220 - ib.minX : 0;
  const dy = bounds ? bounds.minY - ib.minY : 0;
  const added = { nodes: [], texts: [] };
  imp.nodes.forEach((n) => { const c = structuredClone(n); c.id = map.nodes.get(n.id); c.position = { x: n.position.x + dx, y: n.position.y + dy }; doc.nodes.push(c); added.nodes.push(c.id); });
  imp.flows.forEach((f) => {
    const c = structuredClone(f); c.id = map.flows.get(f.id);
    c.source_node_id = f.source_node_id ? map.nodes.get(f.source_node_id) : null;
    c.target_node_id = f.target_node_id ? map.nodes.get(f.target_node_id) : null;
    c.element_type_ids = (f.element_type_ids || []).map((id) => map.elements.get(id)).filter(Boolean);
    if (c.attributes && c.attributes.source_point) c.attributes.source_point = { x: c.attributes.source_point.x + dx, y: c.attributes.source_point.y + dy };
    doc.flows.push(c);
  });
  imp.elements.forEach((e) => { const c = structuredClone(e); c.id = map.elements.get(e.id); c.node_id = e.node_id ? map.nodes.get(e.node_id) : null; c.flow_id = e.flow_id ? map.flows.get(e.flow_id) : null; doc.elements.push(c); });
  imp.texts.forEach((x) => { const c = structuredClone(x); c.id = map.texts.get(x.id); c.x = x.x + dx; c.y = x.y + dy; doc.texts.push(c); added.texts.push(c.id); });
  // VET results come over only as read-only snapshots (IO-5)
  for (const [fid, b] of Object.entries(imp.integrations?.vet?.bindings || {})) {
    const nf = map.flows.get(fid);
    if (!nf) continue;
    doc.integrations.vet.bindings[nf] = { ...structuredClone(b), readonly: true, provenance: { schemaId: imp.schema.id, flowId: fid, merged_at: new Date().toISOString() }, boardSnapshot: null };
  }
  return added;
}

export function boundsOf(doc) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of doc.nodes) { minX = Math.min(minX, n.position.x - n.size.width / 2 - 160); maxX = Math.max(maxX, n.position.x + n.size.width / 2 + 160); minY = Math.min(minY, n.position.y - n.size.height / 2); maxY = Math.max(maxY, n.position.y + n.size.height / 2); }
  for (const x of doc.texts) { minX = Math.min(minX, x.x); maxX = Math.max(maxX, x.x + 120); minY = Math.min(minY, x.y - 16); maxY = Math.max(maxY, x.y + 16); }
  if (minX === Infinity) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

// ---------- VET bridge helpers (section 9) ----------

/** flowRef as in VET VS-1, with node snapshots {id, name} or null for the external side (DATA-2). */
export function flowRef(doc, f) {
  const s = f.source_node_id ? nodeById(doc, f.source_node_id) : null, t = f.target_node_id ? nodeById(doc, f.target_node_id) : null;
  return { vssSchemaId: doc.schema.id, flowId: f.id, flowLabel: f.name || '', sourceNode: s ? { id: s.id, name: s.name } : null, targetNode: t ? { id: t.id, name: t.name } : null };
}

/** SHA-256 of the context a VET result depends on (VET-8). */
export async function fingerprint(doc, f) {
  const types = (flowTypes(doc, f) || []).map((e) => [e.id, e.name, e.kind]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const raw = JSON.stringify([doc.schema.id, f.id, f.source_node_id, f.target_node_id, f.routing_mode, types]);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Validates a vet.result payload just enough to store it safely (BRIDGE-1). */
export function checkResult(p) {
  if (!p || typeof p !== 'object' || typeof p.boardId !== 'string' || !p.flowRef || !p.totals || !Array.isArray(p.items)) return false;
  const t = p.totals;
  for (const k of ['sumOut', 'sumIn', 'priority']) if (t[k] !== null && t[k] !== undefined && !Number.isFinite(t[k])) return false;
  return Number.isInteger(t.count) && t.count >= 0;
}
