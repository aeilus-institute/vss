/* VSS editor (Value System Schema), solo mode, with the VET bridge (TZ VSS v1.0, stages 1 and 3).
   Ported from the Æilus VSS Editor 2.4 (aeilus.tech/vss-editor) with every function kept and the known defects fixed:
   persistent pointer handlers, ports per flow, routing all/selected, DEL-1/2, Merge with full id rewrite, Redo,
   Connect mode, label on the real path, arrow along the last segment, PNG from a clean render. */

const root = document.getElementById('vss');
const V = root.dataset.v || '1';
const C = await import('./vss-core.js?v=' + V);
const LANG = (document.documentElement.lang || 'en').slice(0, 2);
const LOCALES = ['en', 'ru', 'uk', 'el', 'de', 'fr', 'es', 'pt', 'it', 'nl', 'pl', 'ro', 'sv', 'tr', 'ar', 'he', 'hi', 'zh', 'ja', 'ko'];
const LOC = LOCALES.includes(LANG) ? LANG : 'en';
const STR = await fetch(new URL('./locales/' + LOC + '.json?v=' + V, import.meta.url)).then((r) => r.json()).catch(() => ({}));
const EN = LOC === 'en' ? STR : await fetch(new URL('./locales/en.json?v=' + V, import.meta.url)).then((r) => r.json()).catch(() => ({}));
const plural = new Intl.PluralRules(LOC);
function t(key, vars = {}) {
  let s = STR[key] ?? EN[key];
  if (s && typeof s === 'object') s = s[plural.select(Number(vars.n ?? 0))] ?? s.other;
  if (s === undefined) s = key;
  return String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
}
const fmt = (v) => (v === null || v === undefined ? '—' : new Intl.NumberFormat(LANG, { maximumFractionDigits: 1, notation: Math.abs(v) >= 10000 ? 'compact' : 'standard' }).format(v));

const NS = 'http://www.w3.org/2000/svg';
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}
function s(tag, attrs = {}) { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v); return el; }
const ICON = {
  hand: '<path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/>',
  arrow: '<path d="M4 4l7.07 17 2.51-7.39L21 11.07z"/>', undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>', redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
  node: '<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M12 9v6M9 12h6"/>', text: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>', menu: '<path d="m6 9 6 6 6-6"/>',
  panel: '<path d="m9 18 6-6-6-6"/>', panelOpen: '<path d="m15 18-6-6 6-6"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>', link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
};
const icon = (name) => { const e = s('svg', { viewBox: '0 0 24 24', width: 18, height: 18, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' }); e.innerHTML = ICON[name]; return e; };
function btn(label, onClick, { ic, cls = '', title, pressed, disabled } = {}) {
  const b = h('button', { type: 'button', class: 'vss-btn ' + cls, title: title || null, 'aria-pressed': pressed === undefined ? null : String(pressed), disabled: disabled || null, onclick: onClick });
  if (ic) b.append(icon(ic));
  if (label) b.append(h('span', { text: label }));
  if (ic && !label) b.setAttribute('aria-label', title || '');
  return b;
}

// ---------- state ----------

const st = {
  doc: null, sel: { type: 'schema', id: null }, nodes: new Set(), tool: 'hand', pan: { x: 0, y: 0 }, zoom: 1,
  connectFrom: null, dirty: false, report: [], panelOpen: window.innerWidth > 900, showVet: true, exported: false,
};
const undoStack = [], redoStack = [];
// Server mode (SAVE-5 ... SAVE-9): set at the start when the page names a schema (data-schema)
let srv = null;
let A = null; // aevri-api.js, loaded only when the server is needed (ARCH-3: solo has no network code)
const apiMod = async () => (A = A || await import(new URL('../../assets/aevri-api.js?v=' + V, import.meta.url).href));
// Host settings (packages, DIST-2): data-api, data-signin, data-server="off" (no Save to Institute), data-vet (VET embed URL)
const SIGNIN = root.dataset.signin || '';
const SERVER = root.dataset.server !== 'off';
const apiOf = async (id) => { const m = await apiMod(); return m.createApi({ base: root.dataset.api || '/api/v1', sessid: root.dataset.sessid || '', guest: () => (root.dataset.user || !id ? '' : m.guestStore.get(id)) }); };
const localHref = (p) => (LOC === 'en' ? p : '/' + LOC + p);

function snap() { return JSON.stringify(st.doc); }
function pushHistory(snapshot = snap()) { undoStack.push(snapshot); if (undoStack.length > 100) undoStack.shift(); redoStack.length = 0; st.dirty = true; touch(); afterChange(); }
function touch() { st.doc.schema.updated_at = new Date().toISOString(); }
function undo() { if (!undoStack.length) return; redoStack.push(snap()); st.doc = JSON.parse(undoStack.pop()); fixSelection(); st.dirty = true; render(); afterChange(); }
function redo() { if (!redoStack.length) return; undoStack.push(snap()); st.doc = JSON.parse(redoStack.pop()); fixSelection(); st.dirty = true; render(); afterChange(); }

/** After a change (pushHistory runs before it, so the work waits one tick): VET results on changed flows become
    outdated (VET-8, AT-15), and in server mode the schema is saved, or put back for a viewer. */
let afterTimer = null;
function afterChange() {
  clearTimeout(afterTimer);
  afterTimer = setTimeout(async () => {
    await refreshStale();
    if (!srv) return;
    if (!srv.canEdit) { st.doc = JSON.parse(srv.base); fixSelection(); undoStack.length = 0; redoStack.length = 0; st.dirty = false; render(); toast(t('srv.readonly')); return; }
    st.dirty = false;
    srv.changed();
  }, 0);
}
async function refreshStale() {
  const binds = st.doc.integrations.vet.bindings;
  let changed = false;
  for (const [fid, b] of Object.entries(binds)) {
    const f = C.flowById(st.doc, fid);
    if (!f || b.stale || !b.contextFingerprint) continue;
    if (await C.fingerprint(st.doc, f) !== b.contextFingerprint) { b.stale = true; changed = true; }
  }
  if (changed) render();
}
function fixSelection() {
  const { type, id } = st.sel;
  if ((type === 'node' && !C.nodeById(st.doc, id)) || (type === 'flow' && !C.flowById(st.doc, id)) || (type === 'text' && !C.textById(st.doc, id))) st.sel = { type: 'schema', id: null };
  for (const id2 of [...st.nodes]) if (!C.nodeById(st.doc, id2)) st.nodes.delete(id2);
}
/** One logical change = one Undo step. */
function act(fn, opts = {}) { pushHistory(); fn(); if (opts.panel !== false) render(); else { renderDiagram(); renderChrome(); } }

// ---------- layout ----------

let closeMenu = () => {};
document.addEventListener('click', () => closeMenu());
const ui = {};
function build() {
  root.innerHTML = '';
  ui.menu = h('div', { class: 'vss-menu' });
  ui.bar = h('div', { class: 'vss-toolbar', role: 'toolbar', 'aria-label': t('toolbar') });
  ui.title = h('button', { type: 'button', class: 'vss-title', onclick: () => select('schema') });
  ui.svg = s('svg', { class: 'vss-canvas', role: 'application', 'aria-label': t('canvas'), tabindex: '0' });
  const defs = s('defs');
  const pat = s('pattern', { id: 'vss-grid', width: 40, height: 40, patternUnits: 'userSpaceOnUse' });
  pat.append(s('circle', { cx: 1, cy: 1, r: 1, fill: '#9fb9d6', opacity: '.45' }));
  defs.append(pat);
  ui.svg.append(defs);
  ui.gridRect = s('rect', { class: 'vss-grid', fill: 'url(#vss-grid)' });
  ui.view = s('g');
  ui.content = s('g', { class: 'vss-content' });
  ui.overlay = s('g', { class: 'vss-overlay' });
  ui.view.append(ui.content, ui.overlay);
  ui.svg.append(ui.gridRect, ui.view);
  ui.panel = h('aside', { class: 'vss-panel', 'aria-label': t('properties') });
  ui.panelToggle = h('button', { type: 'button', class: 'vss-panel-toggle', onclick: () => { st.panelOpen = !st.panelOpen; renderChrome(); } });
  ui.main = h('div', { class: 'vss-main' }, h('div', { class: 'vss-stage' }, ui.svg), ui.panelToggle, ui.panel);
  ui.status = h('div', { class: 'vss-status' });
  ui.toasts = h('div', { class: 'vss-toasts', 'aria-live': 'polite' });
  root.append(ui.bar, ui.title, ui.main, ui.status, ui.toasts);
  bindCanvas();
}

function renderChrome() {
  // toolbar (UI-1, UI-2)
  const menuBtn = h('button', { type: 'button', class: 'vss-btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, h('span', { text: t('menu.schema') }), icon('menu'));
  const ro = srv && !srv.canEdit;
  const list = h('div', { class: 'vss-menu-list', role: 'menu', hidden: true },
    srv ? null : item(t('menu.new'), cmdNew), ro ? null : item(t('menu.open'), () => pickFile('open')), ro ? null : item(t('menu.merge'), () => pickFile('merge'), t('menu.mergeHint')),
    srv || !SERVER ? null : item(t('menu.saveInstitute'), saveToInstitute, t('menu.saveInstituteHint')),
    srv && srv.canEdit ? item(t('srv.saveVersion'), async () => { try { await srv.saveVersion(); toast(t('srv.versionSaved')); } catch (e) { toast(t('srv.error') + ' ' + (e.code || '')); } }) : null,
    srv && srv.canEdit ? item(t('srv.versions'), openVersions) : null,
    srv && srv.isOwner ? item(t('srv.share'), openSchemaShare) : null,
    srv && root.dataset.user ? item(t('srv.duplicate'), async () => { try { location.href = localHref('/tools/vss/s/' + await srv.duplicate() + '/'); } catch (e) { toast(t('srv.error') + ' ' + (e.code || '')); } }) : null,
    root.dataset.user ? item(t('srv.mySchemas'), () => { location.href = localHref('/tools/vss/schemas/'); }) : null,
    h('hr'),
    item(t('menu.exportJson'), exportJson), item(t('menu.exportPng'), exportPng));
  function item(label, fn, hint) {
    return h('button', { type: 'button', role: 'menuitem', class: 'vss-menu-item', disabled: fn ? null : true, onclick: () => { close(); fn && fn(); } }, h('span', { text: label }), hint ? h('small', { text: hint }) : null);
  }
  const close = () => { list.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); };
  menuBtn.onclick = (e) => { e.stopPropagation(); list.hidden = !list.hidden; menuBtn.setAttribute('aria-expanded', String(!list.hidden)); };
  closeMenu = close; // one document listener for all renders (audit: a listener was added on every render)
  ui.bar.replaceChildren(
    h('div', { class: 'vss-menu-wrap' }, menuBtn, list),
    btn('', undo, { ic: 'undo', title: t('undo') + ' (Ctrl+Z)', disabled: !undoStack.length }),
    btn('', redo, { ic: 'redo', title: t('redo') + ' (Ctrl+Shift+Z)', disabled: !redoStack.length }),
    h('span', { class: 'vss-sep' }),
    btn(t('tool.hand'), () => setTool('hand'), { ic: 'hand', pressed: st.tool === 'hand', title: t('tool.handHint') + ' (H)' }),
    btn(t('tool.arrow'), () => setTool('arrow'), { ic: 'arrow', pressed: st.tool === 'arrow', title: t('tool.arrowHint') + ' (V)' }),
    h('span', { class: 'vss-sep' }),
    btn(t('add.converter'), addConverter, { ic: 'node' }),
    btn(t('add.text'), addText, { ic: 'text' }),
    h('span', { class: 'vss-grow' }),
    srv ? h('span', { class: 'vss-save-state is-' + srv.status, text: t('srv.status.' + srv.status) + (srv.status === 'saved' && srv.savedAt ? ' ' + srv.savedAt.toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' }) : '') + (srv.canEdit ? '' : ' · ' + t('srv.role.' + srv.role)) })
      : h('span', { class: 'vss-save-state' + (st.dirty ? ' is-dirty' : ''), text: st.dirty ? t('notice.unsaved') : (st.exported ? t('notice.exported') : t('notice.solo')) }),
    btn(t('help'), openHelp, { ic: 'help' }));
  // title (UI-3)
  ui.title.textContent = st.doc.schema.title || t('untitled');
  ui.title.title = t('title.hint');
  // panel toggle (UI-5)
  ui.main.classList.toggle('is-collapsed', !st.panelOpen);
  ui.panelToggle.replaceChildren(icon(st.panelOpen ? 'panel' : 'panelOpen'));
  ui.panelToggle.setAttribute('aria-label', st.panelOpen ? t('panel.hide') : t('panel.show'));
  ui.panelToggle.title = ui.panelToggle.getAttribute('aria-label');
  // status (UI-4)
  const mode = st.connectFrom ? t('mode.connect') : st.tool === 'arrow' ? t('tool.arrow') : t('tool.hand');
  ui.status.replaceChildren(
    h('span', { class: 'vss-version', text: `Æilus VSS Editor ${C.APP_VERSION} · ${t('format')} ${C.SCHEMA_VERSION}` }),
    h('span', { class: 'vss-mode', text: mode + (st.nodes.size > 1 ? ' · ' + t('selected', { n: st.nodes.size }) : '') }),
    h('span', { class: 'vss-grow' }),
    btn('−', () => zoomAt(1 / 1.2), { cls: 'vss-btn-sm', title: t('zoom.out') }),
    h('span', { class: 'vss-zoom', text: Math.round(st.zoom * 100) + '%' }),
    btn('+', () => zoomAt(1.2), { cls: 'vss-btn-sm', title: t('zoom.in') }),
    btn('100%', () => { zoomAt(1 / st.zoom); }, { cls: 'vss-btn-sm', title: t('zoom.reset') }),
    btn(t('zoom.fit'), fit, { cls: 'vss-btn-sm' }));
}

function render() { renderChrome(); renderDiagram(); renderPanel(); }

// ---------- geometry ----------

const measureCtx = document.createElement('canvas').getContext('2d');
function measure(text, size = 12, weight = 600) { measureCtx.font = `${weight} ${size}px ${getComputedStyle(root).fontFamily || 'system-ui'}`; return measureCtx.measureText(text).width; }

/** Name wrap by measured width, long words broken (NODE-2). */
function wrap(text, maxW) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  const pushWord = (w) => {
    while (measure(w) > maxW) { let i = 1; while (i < w.length && measure(w.slice(0, i + 1)) <= maxW) i++; lines.push(w.slice(0, i)); w = w.slice(i); }
    return w;
  };
  for (let w of words) {
    const cand = cur ? cur + ' ' + w : w;
    if (measure(cand) <= maxW) { cur = cand; continue; }
    if (cur) lines.push(cur);
    cur = pushWord(w);
  }
  if (cur || !lines.length) lines.push(cur);
  return lines;
}

/** Sizes, ports and paths computed before drawing, so no flow lags behind its node (NODE-2, GEO-1). */
function layout() {
  const doc = st.doc;
  const maxAbs = Math.max(1, ...doc.flows.map((f) => Math.abs(f.value || 0)));
  const thick = (f) => Math.max(2, Math.min(14, (Math.abs(f.value || 0) / maxAbs) * 14)); // GEO-9: one linear scale, magnitude
  const L = { nodes: new Map(), flows: new Map() };
  for (const n of doc.nodes) {
    const lines = wrap(n.name || n.id, 250 - 24);
    const w = Math.min(250, Math.max(120, Math.max(...lines.map((l) => measure(l))) + 28));
    L.nodes.set(n.id, { n, lines, w, h: Math.max(60, lines.length * 16 + 26) });
  }
  const outs = new Map(), ins = new Map();
  for (const f of doc.flows) {
    if (f.attributes && f.attributes.is_unbound) continue;
    if (f.source_node_id) (outs.get(f.source_node_id) || outs.set(f.source_node_id, []).get(f.source_node_id)).push(f);
    if (f.target_node_id) (ins.get(f.target_node_id) || ins.set(f.target_node_id, []).get(f.target_node_id)).push(f);
  }
  const GAP = 8;
  const stackH = (list) => (list || []).reduce((a, f) => a + thick(f), 0) + GAP * Math.max(0, (list || []).length - 1);
  for (const [id, nl] of L.nodes) {
    nl.h = Math.max(nl.h, stackH(outs.get(id)) + 20, stackH(ins.get(id)) + 20);
    nl.n.size = { width: Math.round(nl.w), height: Math.round(nl.h) };
    nl.x0 = nl.n.position.x - nl.w / 2; nl.x1 = nl.n.position.x + nl.w / 2; nl.y0 = nl.n.position.y - nl.h / 2; nl.y1 = nl.n.position.y + nl.h / 2;
  }
  const portY = (nodeId, list, f) => {
    const n = L.nodes.get(nodeId);
    let y = n.n.position.y - stackH(list) / 2;
    for (const g of list) { if (g === f) return y + thick(g) / 2; y += thick(g) + GAP; }
    return n.n.position.y;
  };
  let lane = 0;
  for (const f of doc.flows) {
    if (f.attributes && f.attributes.is_unbound) continue;
    const src = f.source_node_id ? L.nodes.get(f.source_node_id) : null, tgt = f.target_node_id ? L.nodes.get(f.target_node_id) : null;
    if (!src && !tgt) continue;
    const th = thick(f);
    const arrowLen = Math.min(18, 9 + th * 0.6), arrowHalf = Math.min(11, th / 2 + 4);
    let sx, sy, ex, ey;
    if (src) { sx = src.x1; sy = portY(src.n.id, outs.get(src.n.id), f); } else { ex = tgt.x0; ey = portY(tgt.n.id, ins.get(tgt.n.id), f); sx = ex - 110; sy = ey; }
    if (tgt) { ex = tgt.x0; ey = portY(tgt.n.id, ins.get(tgt.n.id), f); } else { ex = sx + 110; ey = sy; }
    const lx = ex - arrowLen; // the band ends at the arrow base (GEO-5)
    let d, pts;
    const back = src && tgt && (src.n.id === tgt.n.id || sx + 30 > ex);
    if (!back) {
      const dx = Math.max(30, (lx - sx) / 2);
      d = `M ${sx} ${sy} C ${sx + dx} ${sy}, ${lx - dx} ${ey}, ${lx} ${ey}`; // GEO-2
    } else {
      // GEO-3: right, down below every converter in the corridor, left past the target, up to the port, right into it
      const c = 22 + (lane % 6) * 8;
      const xa = Math.min(ex - c, sx), xb = Math.max(sx + c, ex);
      let bottom = Math.max(src.y1, tgt.y1);
      for (const nl of L.nodes.values()) if (nl.x1 > xa - 10 && nl.x0 < xb + 10) bottom = Math.max(bottom, nl.y1);
      const ly = bottom + 30 + lane * (th + 10);
      lane++;
      pts = [[sx, sy], [sx + c, sy], [sx + c, ly], [ex - c - arrowLen, ly], [ex - c - arrowLen, ey], [lx, ey]];
      d = 'M ' + pts.map((p) => p.join(' ')).join(' L ');
    }
    L.flows.set(f.id, { f, d, th, ex, ey, arrowLen, arrowHalf });
  }
  return L;
}

// ---------- drawing ----------

function renderDiagram() {
  const doc = st.doc;
  const L = layout();
  st.layout = L;
  ui.content.replaceChildren();
  const flowsG = s('g'), nodesG = s('g'), textsG = s('g'), labelsG = s('g');
  ui.content.append(flowsG, nodesG, textsG, labelsG);
  for (const fl of L.flows.values()) {
    const f = fl.f;
    const selected = st.sel.type === 'flow' && st.sel.id === f.id;
    const color = f.color || '#888888';
    const g = s('g', { class: 'vss-flow' + (selected ? ' is-selected' : ''), 'data-type': 'flow', 'data-id': f.id });
    const hit = s('path', { d: fl.d, class: 'vss-hit', stroke: 'transparent', 'stroke-width': fl.th + 12, fill: 'none' });
    const p = s('path', { d: fl.d, stroke: color, 'stroke-width': fl.th, fill: 'none', 'stroke-linejoin': 'round' });
    const arrow = s('polygon', { points: `${fl.ex},${fl.ey} ${fl.ex - fl.arrowLen},${fl.ey - fl.arrowHalf} ${fl.ex - fl.arrowLen},${fl.ey + fl.arrowHalf}`, fill: color }); // GEO-6
    g.append(hit, p, arrow);
    flowsG.append(g);
    // label on the real path (FLOW-UI-3) and VET metrics (VET-11)
    const b = doc.integrations.vet.bindings[f.id];
    const vetText = b && st.showVet ? vetBadge(b) : '';
    if ((f.show_label && f.name) || vetText) {
      const len = p.getTotalLength();
      const m = p.getPointAtLength(len / 2);
      const lg = s('g', { class: 'vss-label', 'data-type': 'flow', 'data-id': f.id });
      let y = m.y - 8;
      for (const [txt, cls] of [[f.show_label ? f.name : '', ''], [vetText, 'is-vet' + (b && b.stale ? ' is-stale' : '')]]) {
        if (!txt) continue;
        const te = s('text', { x: m.x, y, 'text-anchor': 'middle', class: cls });
        te.textContent = txt;
        lg.append(te);
        y += 15;
      }
      labelsG.append(lg);
      for (const te of lg.querySelectorAll('text')) {
        const bb = te.getBBox();
        lg.insertBefore(s('rect', { x: bb.x - 4, y: bb.y - 2, width: bb.width + 8, height: bb.height + 4, rx: 3, fill: '#ffffff', class: te.getAttribute('class') ? 'vss-label-bg is-vet' : 'vss-label-bg' }), te);
      }
    }
  }
  for (const nl of L.nodes.values()) {
    const n = nl.n;
    const selected = st.nodes.has(n.id) || (st.sel.type === 'node' && st.sel.id === n.id);
    const g = s('g', { class: 'vss-node' + (selected ? ' is-selected' : '') + (st.connectFrom ? ' is-target' : ''), 'data-type': 'node', 'data-id': n.id });
    g.append(s('rect', { x: nl.x0, y: nl.y0, width: nl.w, height: nl.h, rx: 8, fill: selected ? '#b6ffdc' : '#ffffff', stroke: selected ? '#176B68' : '#4a6fa3', 'stroke-width': selected ? 2 : 1.2 }));
    const te = s('text', { 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 600, fill: '#1f2933' });
    const y0 = n.position.y - (nl.lines.length * 16) / 2 + 12;
    nl.lines.forEach((ln, i) => { const sp = s('tspan', { x: n.position.x, y: y0 + i * 16 }); sp.textContent = ln; te.append(sp); });
    g.append(te);
    if (n.bpmn_link || n.link) g.append(s('circle', { cx: nl.x1 - 8, cy: nl.y0 + 8, r: 3, fill: '#176B68' }));
    nodesG.append(g);
  }
  for (const x of doc.texts) {
    const selected = st.sel.type === 'text' && st.sel.id === x.id;
    const g = s('g', { class: 'vss-text' + (selected ? ' is-selected' : ''), 'data-type': 'text', 'data-id': x.id });
    const te = s('text', { x: x.x, y: x.y, 'font-size': x.fontSize || 13, fill: x.color || '#1f2933' });
    String(x.text || '').split('\n').forEach((ln, i) => { const sp = s('tspan', { x: x.x, dy: i ? '1.3em' : 0 }); sp.textContent = ln || ' '; te.append(sp); });
    g.append(te);
    textsG.append(g);
    const bb = te.getBBox();
    g.insertBefore(s('rect', { x: bb.x - 4, y: bb.y - 3, width: bb.width + 8, height: bb.height + 6, fill: 'transparent', class: 'vss-text-hit' }), te);
  }
  applyTransform();
}

function vetBadge(b) {
  const tt = b.totals || {};
  const pr = b.priorityKind === 'positive_infinity' ? '∞' : b.priorityKind === 'negative_infinity' ? '-∞' : tt.priority === null || tt.priority === undefined ? '—' : fmt(tt.priority);
  return `VET ${tt.count ?? 0} · ↑${fmt(tt.sumOut)} · ↓${fmt(tt.sumIn)} · P ${pr}${b.stale ? ' · ' + t('vet.stale') : ''}`;
}

function applyTransform() {
  ui.view.setAttribute('transform', `translate(${st.pan.x} ${st.pan.y}) scale(${st.zoom})`);
  // grid covers the visible area only (CAN-1)
  const w = ui.svg.clientWidth || 800, hh = ui.svg.clientHeight || 600;
  const x0 = -st.pan.x / st.zoom, y0 = -st.pan.y / st.zoom;
  ui.gridRect.setAttribute('x', 0); ui.gridRect.setAttribute('y', 0); ui.gridRect.setAttribute('width', w); ui.gridRect.setAttribute('height', hh);
  const pat = ui.svg.querySelector('#vss-grid');
  pat.setAttribute('patternTransform', `translate(${st.pan.x} ${st.pan.y}) scale(${st.zoom})`);
  void x0; void y0;
  const z = ui.status.querySelector('.vss-zoom'); if (z) z.textContent = Math.round(st.zoom * 100) + '%';
}

// ---------- view ----------

function toWorld(cx, cy) { const r = ui.svg.getBoundingClientRect(); return { x: (cx - r.left - st.pan.x) / st.zoom, y: (cy - r.top - st.pan.y) / st.zoom }; }
function visibleCenter() { const r = ui.svg.getBoundingClientRect(); return toWorld(r.left + r.width / 2, r.top + r.height / 2); }
/** Zoom keeping the world point under the cursor (CAN-5). */
function zoomAt(k, cx, cy) {
  const r = ui.svg.getBoundingClientRect();
  if (cx === undefined) { cx = r.left + r.width / 2; cy = r.top + r.height / 2; }
  const w = toWorld(cx, cy);
  st.zoom = Math.min(3, Math.max(0.2, st.zoom * k));
  st.pan.x = cx - r.left - w.x * st.zoom; st.pan.y = cy - r.top - w.y * st.zoom;
  applyTransform();
}
function centerOn(x, y) { const r = ui.svg.getBoundingClientRect(); st.pan.x = r.width / 2 - x * st.zoom; st.pan.y = r.height / 2 - y * st.zoom; applyTransform(); }
function fit() {
  const b = ui.content.getBBox();
  if (!b.width) { st.zoom = 1; centerOn(0, 0); return; }
  const r = ui.svg.getBoundingClientRect();
  st.zoom = Math.max(0.2, Math.min(1.5, (r.width - 80) / b.width, (r.height - 80) / b.height));
  centerOn(b.x + b.width / 2, b.y + b.height / 2);
}

// ---------- pointer handling: registered once on the editor surface (CAN-7) ----------

let gesture = null;
function bindCanvas() {
  const svg = ui.svg;
  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    svg.focus({ preventScroll: true });
    const hitEl = e.target.closest('[data-type]');
    const type = hitEl ? hitEl.getAttribute('data-type') : null, id = hitEl ? hitEl.getAttribute('data-id') : null;
    const w = toWorld(e.clientX, e.clientY);
    if (st.connectFrom) { // NODE-4: source -> click on the target (itself allowed); anything else cancels
      if (type === 'node') finishConnect(id); else cancelConnect();
      return;
    }
    svg.setPointerCapture(e.pointerId);
    if (type === 'node') {
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      if (st.tool === 'arrow') {
        if (additive) { if (st.nodes.has(id)) st.nodes.delete(id); else st.nodes.add(id); }
        else if (!st.nodes.has(id)) { st.nodes.clear(); st.nodes.add(id); } // drag of a selected node keeps the group (CAN-3)
      } else { st.nodes.clear(); st.nodes.add(id); }
      st.sel = { type: 'node', id };
      const ids = st.tool === 'arrow' ? [...st.nodes] : [id];
      gesture = { kind: 'drag', start: w, before: snap(), moved: false, items: ids.map((nid) => { const n = C.nodeById(st.doc, nid); return { n, x: n.position.x, y: n.position.y }; }) };
      renderDiagram(); renderPanel(); renderChrome();
    } else if (type === 'text') {
      const x = C.textById(st.doc, id);
      st.sel = { type: 'text', id }; st.nodes.clear();
      gesture = { kind: 'text', start: w, before: snap(), moved: false, x, ox: x.x, oy: x.y };
      renderDiagram(); renderPanel();
    } else if (type === 'flow') {
      st.sel = { type: 'flow', id }; st.nodes.clear();
      gesture = { kind: 'none' };
      renderDiagram(); renderPanel(); renderChrome();
    } else if (st.tool === 'arrow') {
      gesture = { kind: 'band', start: w, additive: e.shiftKey || e.ctrlKey || e.metaKey, moved: false, rect: s('rect', { class: 'vss-band' }) };
      ui.overlay.append(gesture.rect);
    } else {
      gesture = { kind: 'pan', cx: e.clientX, cy: e.clientY, px: st.pan.x, py: st.pan.y, moved: false };
      svg.classList.add('is-panning');
    }
  });
  svg.addEventListener('pointermove', (e) => {
    if (!gesture) { if (st.connectFrom) drawConnectLine(toWorld(e.clientX, e.clientY)); return; }
    const w = toWorld(e.clientX, e.clientY);
    if (gesture.kind === 'pan') {
      const dx = e.clientX - gesture.cx, dy = e.clientY - gesture.cy;
      if (Math.abs(dx) + Math.abs(dy) > 3) gesture.moved = true;
      st.pan.x = gesture.px + dx; st.pan.y = gesture.py + dy; applyTransform();
    } else if (gesture.kind === 'drag') {
      const dx = w.x - gesture.start.x, dy = w.y - gesture.start.y;
      if (!gesture.moved && Math.abs(dx) + Math.abs(dy) < 2 / st.zoom) return;
      gesture.moved = true;
      for (const it of gesture.items) { it.n.position.x = Math.round((it.x + dx) / 10) * 10; it.n.position.y = Math.round((it.y + dy) / 10) * 10; }
      renderDiagram();
    } else if (gesture.kind === 'text') {
      gesture.moved = true;
      gesture.x.x = Math.round((gesture.ox + w.x - gesture.start.x) / 5) * 5; gesture.x.y = Math.round((gesture.oy + w.y - gesture.start.y) / 5) * 5;
      renderDiagram();
    } else if (gesture.kind === 'band') {
      gesture.moved = true;
      const x = Math.min(w.x, gesture.start.x), y = Math.min(w.y, gesture.start.y);
      Object.assign(gesture, { bx: x, by: y, bw: Math.abs(w.x - gesture.start.x), bh: Math.abs(w.y - gesture.start.y) });
      gesture.rect.setAttribute('x', x); gesture.rect.setAttribute('y', y); gesture.rect.setAttribute('width', gesture.bw); gesture.rect.setAttribute('height', gesture.bh);
    }
  });
  const end = () => {
    const g = gesture; gesture = null;
    ui.svg.classList.remove('is-panning');
    if (!g) return;
    if ((g.kind === 'drag' || g.kind === 'text') && g.moved) { pushHistory(g.before); touch(); renderChrome(); } // one drag = one Undo (CAN-3)
    else if (g.kind === 'pan' && !g.moved) select('schema'); // a short click on empty space (CAN-2)
    else if (g.kind === 'band') {
      g.rect.remove();
      if (!g.moved) { select('schema'); return; }
      if (!g.additive) st.nodes.clear();
      for (const nl of st.layout.nodes.values()) if (nl.x0 < g.bx + g.bw && nl.x1 > g.bx && nl.y0 < g.by + g.bh && nl.y1 > g.by) st.nodes.add(nl.n.id);
      if (st.nodes.size === 1) st.sel = { type: 'node', id: [...st.nodes][0] };
      else st.sel = { type: 'schema', id: null };
      render();
    }
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  svg.addEventListener('wheel', (e) => { // CAN-5, CAN-6: pinch/ctrl zooms at the cursor, two-finger swipe pans, no browser history swipe
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY);
    else { st.pan.x -= e.deltaX; st.pan.y -= e.deltaY; applyTransform(); }
  }, { passive: false });
  window.addEventListener('resize', () => applyTransform());
  document.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]')) return;
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if (e.key === 'Escape') { if (st.connectFrom) cancelConnect(); if (gesture && gesture.kind === 'band') { gesture.rect.remove(); gesture = null; } return; }
    if (inField) return; // Ctrl+Z inside a field undoes the typing, not the schema (SAVE-10)
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); }
    else if (!e.ctrlKey && !e.metaKey && k === 'h') setTool('hand');
    else if (!e.ctrlKey && !e.metaKey && k === 'v') setTool('arrow');
    else if (e.key === 'Delete' || e.key === 'Backspace') { if (root.contains(e.target) || e.target === document.body) { e.preventDefault(); deleteSelection(); } }
  });
}

function setTool(tool) { st.tool = tool; cancelConnect(false); renderChrome(); }

function drawConnectLine(w) {
  ui.overlay.querySelector('.vss-connect')?.remove();
  const nl = st.layout.nodes.get(st.connectFrom);
  if (!nl) return;
  ui.overlay.append(s('path', { class: 'vss-connect', d: `M ${nl.x1} ${nl.n.position.y} L ${w.x} ${w.y}` }));
}
function startConnect(nodeId) { st.connectFrom = nodeId; renderDiagram(); renderChrome(); toast(t('connect.hint')); }
function cancelConnect(redraw = true) { if (!st.connectFrom) return; st.connectFrom = null; ui.overlay.querySelector('.vss-connect')?.remove(); if (redraw) { renderDiagram(); renderChrome(); } }
function finishConnect(targetId) {
  const from = st.connectFrom;
  st.connectFrom = null; ui.overlay.querySelector('.vss-connect')?.remove();
  act(() => { const f = C.newFlow({ name: t('new.flow'), source: from, target: targetId, value: 50, color: C.freshColor(st.doc) }); st.doc.flows.push(f); st.sel = { type: 'flow', id: f.id }; st.nodes.clear(); });
}

function select(type, id = null) {
  st.sel = { type, id }; if (type !== 'node') st.nodes.clear(); else { st.nodes.clear(); st.nodes.add(id); }
  renderDiagram(); renderPanel(); renderChrome();
}

// ---------- commands ----------

function freePlace(x, y) {
  let yy = y;
  for (let i = 0; i < 30; i++) {
    const busy = st.doc.nodes.some((n) => Math.abs(n.position.x - x) < (n.size.width + 140) / 2 && Math.abs(n.position.y - yy) < n.size.height / 2 + 50);
    if (!busy) return { x, y: yy };
    yy += 110;
  }
  return { x, y: yy };
}
function addConverter() {
  const c = visibleCenter();
  act(() => { const p = freePlace(Math.round(c.x / 10) * 10, Math.round(c.y / 10) * 10); const n = C.newNode(t('new.converter'), p.x, p.y); st.doc.nodes.push(n); st.sel = { type: 'node', id: n.id }; st.nodes = new Set([n.id]); });
}
function addNext(node) { // NODE-4: one operation creates the node and the connection
  act(() => {
    const p = freePlace(node.position.x + node.size.width / 2 + 260, node.position.y);
    const n = C.newNode(t('new.converter'), p.x, p.y); st.doc.nodes.push(n);
    st.doc.flows.push(C.newFlow({ name: t('new.flow'), source: node.id, target: n.id, value: 50, color: C.freshColor(st.doc) }));
    st.sel = { type: 'node', id: n.id }; st.nodes = new Set([n.id]);
  });
}
function addExternal(node, dir) {
  act(() => { const f = C.newFlow({ name: dir === 'out' ? t('new.extOut') : t('new.extIn'), source: dir === 'out' ? node.id : null, target: dir === 'in' ? node.id : null, value: 50, color: C.freshColor(st.doc) }); st.doc.flows.push(f); });
}
function addText() { // TEXT-1: in the centre of the visible scene
  const c = visibleCenter();
  act(() => { const x = { id: C.newId('text'), x: Math.round(c.x), y: Math.round(c.y), text: t('new.text') }; st.doc.texts.push(x); st.sel = { type: 'text', id: x.id }; st.nodes.clear(); });
}
function deleteSelection() {
  const { type, id } = st.sel;
  if (st.nodes.size > 1) { act(() => { [...st.nodes].forEach((nid) => C.deleteNode(st.doc, nid)); st.nodes.clear(); st.sel = { type: 'schema', id: null }; }); return; }
  if (type === 'node') deleteNode(id);
  else if (type === 'flow') deleteFlow(id);
  else if (type === 'text') act(() => { st.doc.texts = st.doc.texts.filter((x) => x.id !== id); st.sel = { type: 'schema', id: null }; });
}
function deleteNode(id) {
  let r;
  act(() => { r = C.deleteNode(st.doc, id); st.nodes.delete(id); st.sel = { type: 'schema', id: null }; });
  toast(t('deleted.node', { flows: r.removedFlows, detached: r.detached }) + (r.unbound ? ' ' + t('deleted.unbound', { n: r.unbound }) : ''), undo);
}
function deleteFlow(id) {
  act(() => { st.doc.flows = st.doc.flows.filter((f) => f.id !== id); st.sel = { type: 'schema', id: null }; });
  if (st.doc.integrations.vet.bindings[id]) toast(t('deleted.flowVet'), undo); // DEL-3: the VET board itself is not touched
}

// ---------- properties panel ----------

/** A text field: one Undo step per editing session; typing never rebuilds the input (FLOW-UI-3). */
function fText(label, value, onInput, { area = false, rows = 3, type = 'text', after } = {}) {
  const inp = h(area ? 'textarea' : 'input', area ? { rows: String(rows) } : { type });
  inp.value = value ?? '';
  let session = false;
  inp.addEventListener('focus', () => { session = false; });
  inp.addEventListener('input', () => { if (!session) { pushHistory(); session = true; } onInput(type === 'number' ? (inp.value === '' ? 0 : Number(inp.value)) : inp.value); renderDiagram(); if (after) after(); });
  inp.addEventListener('change', () => renderChrome());
  return h('label', { class: 'vss-field' }, h('span', { text: label }), inp);
}
function fSelect(label, value, options, onChange) {
  const sel = h('select', { onchange: () => onChange(sel.value) }, options.map(([v, l]) => h('option', { value: v, selected: v === value || null, text: l })));
  return h('label', { class: 'vss-field' }, h('span', { text: label }), sel);
}
function fCheck(label, checked, onChange) {
  const cb = h('input', { type: 'checkbox', checked: checked || null, onchange: () => onChange(cb.checked) });
  return h('label', { class: 'vss-check' }, cb, h('span', { text: label }));
}
const section = (title, ...kids) => h('section', { class: 'vss-section' }, h('h3', { text: title }), ...kids);
const idLine = (id) => h('p', { class: 'vss-id' }, 'ID: ', h('code', { text: id }));

function renderPanel() {
  ui.panel.replaceChildren();
  const { type, id } = st.sel;
  if (type === 'node' && st.nodes.size <= 1) { const n = C.nodeById(st.doc, id); if (n) return panelNode(n); }
  if (type === 'flow') { const f = C.flowById(st.doc, id); if (f) return panelFlow(f); }
  if (type === 'text') { const x = C.textById(st.doc, id); if (x) return panelText(x); }
  panelSchema();
}

function panelSchema() {
  const d = st.doc, sc = d.schema;
  const kids = [
    fText(t('f.title'), sc.title, (v) => { sc.title = v; renderChromeTitle(); }),
    fText(t('f.description'), sc.description, (v) => { sc.description = v; }, { area: true }),
    fText(t('f.version'), sc.version, (v) => { sc.version = v; }),
    fText(t('f.author'), sc.author, (v) => { sc.author = v; }),
    idLine(sc.id),
    h('p', { class: 'vss-id', text: `${t('f.created')}: ${sc.created_at?.slice(0, 16).replace('T', ' ')} · ${t('f.updated')}: ${sc.updated_at?.slice(0, 16).replace('T', ' ')}` }),
    fCheck(t('vet.showOnDiagram'), st.showVet, (v) => { st.showVet = v; renderDiagram(); }),
  ];
  ui.panel.append(section(t('p.schema'), ...kids));
  if (st.nodes.size > 1) ui.panel.append(section(t('selected', { n: st.nodes.size }), h('p', { class: 'vss-hint', text: t('multi.hint') }), btn(t('delete'), deleteSelection, { cls: 'vss-btn-danger' })));
  const unbound = d.flows.filter((f) => f.attributes && f.attributes.is_unbound);
  if (unbound.length) ui.panel.append(section(t('unbound.title'), h('p', { class: 'vss-warn', text: t('unbound.hint') }),
    ...unbound.map((f) => h('div', { class: 'vss-row' }, h('span', { text: f.name || f.id }),
      h('select', { 'aria-label': t('unbound.reconnect'), onchange: (e) => { const v = e.target.value; if (v) act(() => { C.setEnd(d, f, 'target', v); f.type = 'external_in'; C.autoType(f); }); } },
        h('option', { value: '', text: t('unbound.reconnect') }), d.nodes.map((n) => h('option', { value: n.id, text: n.name }))),
      btn('', () => deleteFlow(f.id), { ic: 'x', title: t('delete'), cls: 'vss-btn-icon' })))));
  if (st.report.length) ui.panel.append(section(t('report.title'), h('ul', { class: 'vss-report' }, st.report.map((r) => h('li', { text: reportLine(r) })))));
  // NFR-5: every object reachable from the keyboard
  ui.panel.append(section(t('objects'),
    h('ul', { class: 'vss-objects' }, d.nodes.map((n) => h('li', {}, h('button', { type: 'button', class: 'vss-link', text: '▭ ' + (n.name || n.id), onclick: () => { select('node', n.id); centerOn(n.position.x, n.position.y); } }))),
      d.flows.map((f) => h('li', {}, h('button', { type: 'button', class: 'vss-link', text: '→ ' + (f.name || f.id), onclick: () => select('flow', f.id) }))))));
}
function renderChromeTitle() { ui.title.textContent = st.doc.schema.title || t('untitled'); }
function reportLine(r) { const [k, ...rest] = r.split(':'); return t('report.' + k, { x: rest.join(':') }); }

function panelNode(n) {
  const d = st.doc;
  const types = C.typesOf(d, n.id);
  const typeList = h('div', { class: 'vss-types' });
  types.forEach((e) => typeList.append(h('div', { class: 'vss-type' + (e.kind === 'anti_value' ? ' is-anti' : '') },
    h('span', { text: `${e.name} · ${e.kind === 'anti_value' ? t('kind.anti') : t('kind.value')}${e.quantity ? ' · ' + fmt(e.quantity) + ' ' + (e.unit || '') : ''}` }),
    btn('', () => typeEditor(n, e), { ic: 'text', title: t('edit'), cls: 'vss-btn-icon' }),
    btn('', () => act(() => C.deleteType(d, e.id)), { ic: 'x', title: t('delete'), cls: 'vss-btn-icon' }))));
  if (!types.length) typeList.append(h('p', { class: 'vss-hint', text: t('types.none') }));
  ui.panel.append(
    section(t('p.converter'), idLine(n.id),
      fText(t('f.name'), n.name, (v) => { n.name = v; }),
      fText(t('f.description'), n.description, (v) => { n.description = v; }, { area: true }),
      fText(t('f.bpmn'), n.bpmn_link, (v) => { n.bpmn_link = v; }, { type: 'url' }),
      fText(t('f.link'), n.link, (v) => { n.link = v; }, { type: 'url' }),
      linkOut(n.bpmn_link), linkOut(n.link),
      h('div', { class: 'vss-actions' },
        btn(t('a.next'), () => addNext(n), { cls: 'vss-btn-sm' }), btn(t('a.extOut'), () => addExternal(n, 'out'), { cls: 'vss-btn-sm' }),
        btn(t('a.extIn'), () => addExternal(n, 'in'), { cls: 'vss-btn-sm' }), btn(t('a.connect'), () => startConnect(n.id), { cls: 'vss-btn-sm', ic: 'link' }))),
    section(t('types.title'), typeList, btn(t('types.add'), () => typeEditor(n, null), { cls: 'vss-btn-sm' }), h('div', { class: 'vss-type-editor' })),
    h('div', { class: 'vss-section' }, btn(t('p.deleteConverter'), () => deleteNode(n.id), { cls: 'vss-btn-danger' })));
}
/** Only http(s) links are opened, never javascript: (NFR-6). */
function linkOut(url) { return /^https?:\/\//i.test(url || '') ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', class: 'vss-small', text: '↗ ' + url }) : null; }

function typeEditor(node, e) { // TYPE-2
  const box = ui.panel.querySelector('.vss-type-editor');
  const name = h('input', { value: e ? e.name : '' }), desc = h('textarea', { rows: '2' }); desc.value = e ? e.description || '' : '';
  const kind = h('select', {}, h('option', { value: 'value', text: t('kind.value') }), h('option', { value: 'anti_value', text: t('kind.anti') })); kind.value = e ? e.kind : 'value';
  const qty = h('input', { type: 'number', value: e ? String(e.quantity) : '0' }), unit = h('input', { value: e ? e.unit : 'Æ' });
  const f = (l, i) => h('label', { class: 'vss-field' }, h('span', { text: l }), i);
  box.replaceChildren(h('div', { class: 'vss-subform' }, h('strong', { text: e ? t('types.edit') : t('types.add') }), f(t('f.name'), name), f(t('f.description'), desc), f(t('types.kind'), kind),
    h('div', { class: 'vss-row' }, f(t('types.qty'), qty), f(t('types.unit'), unit)), h('p', { class: 'vss-hint', text: t('types.qtyHint') }),
    h('div', { class: 'vss-row' }, btn(t('save'), () => {
      const nm = name.value.trim(); if (!nm) { name.focus(); return; }
      act(() => {
        const data = { name: nm, description: desc.value, kind: kind.value, sign: kind.value === 'anti_value' ? -1 : 1, quantity: Number(qty.value) || 0, unit: unit.value || 'Æ' };
        if (e) Object.assign(C.nodeById(st.doc, node.id) && st.doc.elements.find((x) => x.id === e.id), data);
        else st.doc.elements.push({ id: C.newId('elem'), ...data, location: 'in_node', node_id: node.id, flow_id: null, attributes: {} });
      });
    }, { cls: 'vss-btn-primary vss-btn-sm' }), btn(t('cancel'), () => box.replaceChildren(), { cls: 'vss-btn-sm' }))));
  name.focus();
}

function panelFlow(f) {
  const d = st.doc;
  const nodeOpts = [['', t('external')], ...d.nodes.map((n) => [n.id, n.name || n.id])];
  const src = f.source_node_id ? C.nodeById(d, f.source_node_id) : null, tgt = f.target_node_id ? C.nodeById(d, f.target_node_id) : null;
  const typeLabel = { internal: t('ft.internal'), external_in: t('ft.extIn'), external_out: t('ft.extOut') }[f.type];
  ui.panel.append(section(t('p.flow'), idLine(f.id),
    fText(t('f.name'), f.name, (v) => { f.name = v; }),
    fText(t('f.description'), f.description, (v) => { f.description = v; }, { area: true, rows: 2 }),
    h('div', { class: 'vss-row' }, fText(t('f.value'), f.value, (v) => { f.value = v; }, { type: 'number' }), fText(t('f.unit'), f.unit, (v) => { f.unit = v; })),
    h('p', { class: 'vss-hint', text: t('f.valueHint') }),
    h('div', { class: 'vss-row' }, (() => { const c = h('input', { type: 'color', value: f.color || '#888888', 'aria-label': t('f.color') }); let sess = false;
      c.addEventListener('focus', () => { sess = false; }); c.addEventListener('input', () => { if (!sess) { pushHistory(); sess = true; } f.color = c.value; renderDiagram(); });
      return h('label', { class: 'vss-field' }, h('span', { text: t('f.color') }), c); })(),
      fCheck(t('f.showLabel'), f.show_label, (v) => act(() => { f.show_label = v; }, { panel: false }))),
    fSelect(t('f.source'), f.source_node_id || '', nodeOpts, (v) => { let removed = 0; act(() => { removed = C.setEnd(d, f, 'source', v); markStale(f); }); if (removed > 0) toast(t('routing.removed', { n: removed })); }),
    fSelect(t('f.target'), f.target_node_id || '', nodeOpts, (v) => act(() => { C.setEnd(d, f, 'target', v); markStale(f); })),
    h('p', { class: 'vss-dir' }, h('strong', { text: typeLabel }), ' · ', `${src ? src.name : t('external')} → ${tgt ? tgt.name : t('external')}`),
    h('div', { class: 'vss-row' }, btn(t('delete'), () => deleteFlow(f.id), { cls: 'vss-btn-danger vss-btn-sm' }))));
  // routing of element types (TYPE-4 ... TYPE-7)
  const types = f.source_node_id ? C.typesOf(d, f.source_node_id) : null;
  const rs = section(t('routing.title'));
  if (!types) rs.append(h('p', { class: 'vss-hint', text: t('routing.external') }));
  else if (!types.length) rs.append(h('p', { class: 'vss-hint', text: t('routing.noTypes') }));
  else {
    rs.append(h('div', { class: 'vss-seg' },
      btn(t('routing.all'), () => act(() => { f.routing_mode = 'all'; f.element_type_ids = []; markStale(f); }), { pressed: f.routing_mode !== 'selected', cls: 'vss-btn-sm' }),
      btn(t('routing.selected'), () => act(() => { if (f.routing_mode !== 'selected') { f.routing_mode = 'selected'; f.element_type_ids = types.map((e) => e.id); markStale(f); } }), { pressed: f.routing_mode === 'selected', cls: 'vss-btn-sm' })));
    const sel = new Set(f.routing_mode === 'selected' ? f.element_type_ids : types.map((e) => e.id));
    types.forEach((e) => rs.append(fCheck(`${e.name} · ${e.kind === 'anti_value' ? t('kind.anti') : t('kind.value')}`, sel.has(e.id), (on) => act(() => { C.toggleType(d, f, e.id, on); markStale(f); }))));
    rs.append(h('p', { class: 'vss-hint', text: f.routing_mode === 'selected' ? (f.element_type_ids.length ? t('routing.selectedHint', { n: f.element_type_ids.length }) : t('routing.none')) : t('routing.allHint') }));
  }
  ui.panel.append(rs);
  if (root.dataset.vet !== 'off') ui.panel.append(panelVet(f)); // the VSS Editor package ships without VET (DIST-1)
  if (root.dataset.ledger !== 'off') ui.panel.append(panelLedger(f));
}

// ---------- Value Wallet (VSS spec 10, LED-1 ... LED-11, SC-5; Value Wallet SPEC 16.2) ----------

/** Transfers recorded in the holder's wallet for this flow: their own layer, only the summary the holder allows
    (LED-9 ... LED-11); never added to the planned VET estimate. */
function panelLedger(f) {
  const sec = section(t('ledger.title'));
  if (!f.source_node_id && !f.target_node_id) { sec.append(h('p', { class: 'vss-hint', text: t('vet.unbound') })); return sec; }
  const list = ((st.doc.integrations.ledger || {}).transfers || {})[f.id] || [];
  sec.append(h('p', { class: 'vss-hint', text: t('ledger.hint') }));
  if (list.length) sec.append(h('ul', { class: 'vss-ledger-list' }, list.map((x) => h('li', { text: transferLine(x.summary || {}) }))));
  else sec.append(h('p', { class: 'vss-hint', text: t('ledger.none') }));
  const ro = srv && !srv.canEdit;
  if (!ro) sec.append(h('div', { class: 'vss-row' },
    btn(t('ledger.record'), () => openLedger(f, 'record'), { cls: 'vss-btn-primary vss-btn-sm' }),
    btn(t('ledger.refresh'), () => openLedger(f, 'list'), { cls: 'vss-btn-sm' })));
  return sec;
}

function transferLine(s) {
  const date = s.occurredAt ? new Date(s.occurredAt).toLocaleDateString(LOC) : '—';
  const role = s.role ? t('ledger.role.' + s.role) : '';
  const value = typeof s.v === 'number' ? ' · ' + fmt(s.v) + ' Æ' + (typeof s.spentV === 'number' ? ' / ' + fmt(s.spentV) : '') : '';
  return `${date}${role ? ' · ' + role : ''} · ${t(s.assessed ? 'ledger.assessed' : 'ledger.notAssessed')}${value}`;
}

/** The wallet in a dialog (same origin): waits for ledger.ready (a wallet is open), then one request. */
function openLedger(f, action) {
  const requestId = C.uuidv7();
  const prefix = LOC === 'en' ? '' : '/' + LOC;
  const frame = h('iframe', { class: 'vss-vet-frame', src: (root.dataset.vledger || prefix + '/tools/vledger/') + '?embed=vss', title: t('ledger.title') });
  const status = h('p', { class: 'vss-hint', text: t('ledger.openWallet') });
  const d = h('dialog', { class: 'vss-dialog vss-vet-dialog', 'aria-label': t('ledger.title') },
    h('div', { class: 'vss-dialog-head' }, h('strong', { text: `${t('ledger.title')} · ${f.name || f.id}` }), status, h('span', { class: 'vss-grow' }),
      btn('', () => close(), { ic: 'x', title: t('close') })), frame);
  document.body.append(d);
  d.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  d.showModal();
  let sent = false;
  const flowRef = C.flowRef(st.doc, f);
  const ref = { vssSchemaId: flowRef.vssSchemaId, flowId: flowRef.flowId, flowLabel: flowRef.flowLabel,
    sourceNode: flowRef.sourceNode ? { name: flowRef.sourceNode.name } : undefined, targetNode: flowRef.targetNode ? { name: flowRef.targetNode.name } : undefined };
  function close() { window.removeEventListener('message', onMsg); d.close(); d.remove(); }
  function send(type, payload) { frame.contentWindow.postMessage({ protocol: 'aevri.vledger', version: 1, type, requestId, payload }, location.origin); }
  function keep(transfers) { // only {ledgerRef, summary} is stored in the schema (LED-10)
    act(() => {
      st.doc.integrations.ledger = st.doc.integrations.ledger || { transfers: {} };
      st.doc.integrations.ledger.transfers = st.doc.integrations.ledger.transfers || {};
      st.doc.integrations.ledger.transfers[f.id] = transfers.map((x) => ({ ledgerRef: x.ledgerRef, summary: x.summary }));
    });
  }
  function onMsg(e) {
    if (e.origin !== location.origin || e.source !== frame.contentWindow) return;
    const m = e.data;
    if (!m || m.protocol !== 'aevri.vledger' || m.version !== 1) return;
    if (m.type === 'ledger.ready' && !sent) {
      if (!((m.payload && m.payload.capabilities) || []).includes('transfers-v1')) { status.textContent = t('ledger.old'); return; }
      sent = true; status.textContent = action === 'record' ? t('ledger.confirm') : '';
      if (action === 'record') send('vss.transfer.open', { transferContext: { flowRef: ref } });
      else send('vss.transfers.list', { flowRef: ref });
      return;
    }
    if (m.requestId !== requestId) return;
    if (m.type === 'ledger.cancel') { close(); return; }
    if (m.type === 'ledger.transfer.saved' && m.payload && m.payload.ledgerRef) {
      const cur = (((st.doc.integrations.ledger || {}).transfers || {})[f.id] || []).filter((x) => x.ledgerRef.entryId !== m.payload.ledgerRef.entryId);
      keep([...cur, { ledgerRef: m.payload.ledgerRef, summary: m.payload.summary || {} }]);
      close(); toast(t('ledger.saved'));
    }
    if (m.type === 'ledger.transfers' && m.payload && Array.isArray(m.payload.transfers)) {
      keep(m.payload.transfers); close(); toast(t('ledger.listed', { n: m.payload.transfers.length }));
    }
  }
  window.addEventListener('message', onMsg);
}

function panelText(x) {
  ui.panel.append(section(t('p.text'), idLine(x.id),
    fText(t('f.text'), x.text, (v) => { x.text = v; }, { area: true, rows: 4 }),
    h('div', { class: 'vss-row' }, fText(t('f.fontSize'), x.fontSize || 13, (v) => { x.fontSize = Math.max(8, Math.min(48, v || 13)); }, { type: 'number' }),
      (() => { const c = h('input', { type: 'color', value: x.color || '#1f2933' }); let sess = false; c.addEventListener('focus', () => { sess = false; });
        c.addEventListener('input', () => { if (!sess) { pushHistory(); sess = true; } x.color = c.value; renderDiagram(); }); return h('label', { class: 'vss-field' }, h('span', { text: t('f.color') }), c); })()),
    btn(t('delete'), () => act(() => { st.doc.texts = st.doc.texts.filter((y) => y.id !== x.id); st.sel = { type: 'schema', id: null }; }), { cls: 'vss-btn-danger vss-btn-sm' })));
}

// ---------- VET (section 9) ----------

function markStale(f) { const b = st.doc.integrations.vet.bindings[f.id]; if (b) b.stale = true; }

function panelVet(f) {
  const b = st.doc.integrations.vet.bindings[f.id];
  const sec = section(t('vet.title'));
  if (!f.source_node_id && !f.target_node_id) { sec.append(h('p', { class: 'vss-hint', text: t('vet.unbound') })); return sec; }
  if (b) {
    const tt = b.totals || {};
    const pr = b.priorityKind === 'positive_infinity' ? '∞' : b.priorityKind === 'negative_infinity' ? '-∞' : tt.priority === null || tt.priority === undefined ? t('vet.notEstimated') : fmt(tt.priority);
    const ax = (k) => { const a = (b.axes || {})[k] || {}; const l = a.label || {}; return (l[LOC] || l.en || Object.values(l)[0] || k) + (a.unit ? ', ' + a.unit : ''); };
    sec.append(h('dl', { class: 'vss-vet' },
      h('dt', { text: t('vet.count') }), h('dd', { text: String(tt.count ?? 0) }),
      h('dt', { text: ax('out') }), h('dd', { text: fmt(tt.sumOut) + (tt.coverage && tt.count && tt.coverage.out < tt.count ? ' (' + t('vet.partial') + ')' : '') }),
      h('dt', { text: ax('in') }), h('dd', { text: fmt(tt.sumIn) + (tt.coverage && tt.count && tt.coverage.in < tt.count ? ' (' + t('vet.partial') + ')' : '') }),
      h('dt', { text: t('vet.priority') }), h('dd', { text: pr + (tt.partial ? ' (' + t('vet.partial') + ')' : '') }),
      h('dt', { text: t('vet.received') }), h('dd', { text: (b.receivedAt || '').slice(0, 16).replace('T', ' ') })));
    if (b.buckets) sec.append(h('p', { class: 'vss-hint', text: ['out', 'in'].map((k) => (b.buckets[k] || []).filter((x) => x.count).map((x) => `${x.label} ${x.count}`).join(', ')).filter(Boolean).join(' / ') }));
    if (b.note === 'neg-in') sec.append(h('p', { class: 'vss-warn', text: t('vet.negIn') })); // CALC-2: VET's own note is kept
    if (b.stale) sec.append(h('p', { class: 'vss-warn', text: t('vet.staleHint') }));
    if (b.readonly) sec.append(h('p', { class: 'vss-hint', text: t('vet.readonly') }));
    if (!b.boardSnapshot && !b.readonly) sec.append(h('p', { class: 'vss-hint', text: t('vet.onlyResults') }));
  } else sec.append(h('p', { class: 'vss-hint', text: t('vet.none') }));
  const types = C.flowTypes(st.doc, f);
  sec.append(h('p', { class: 'vss-hint', text: t('vet.before', { types: types === null ? t('routing.externalShort') : String(types.length) }) }));
  const ro = srv && !srv.canEdit;
  sec.append(h('div', { class: 'vss-row' }, ro ? null : btn(b ? t('vet.continue') : t('vet.estimate'), () => openVet(f), { cls: 'vss-btn-primary vss-btn-sm' }),
    srv && !ro ? btn(t('vet.fullPage'), () => openVetPage(f), { cls: 'vss-btn-sm', title: t('vet.fullPageHint') }) : null,
    b && !ro ? btn(t('vet.remove'), () => act(() => { delete st.doc.integrations.vet.bindings[f.id]; }), { cls: 'vss-btn-sm' }) : null));
  return sec;
}

/** HostBridge (VET-2 ... VET-13): VET in an iframe, same origin only, one request at a time. */
async function openVet(f) {
  const requestId = C.uuidv7();
  const fp = await C.fingerprint(st.doc, f);
  const b = st.doc.integrations.vet.bindings[f.id];
  const types = C.flowTypes(st.doc, f) || [];
  const prefix = LOC === 'en' ? '' : '/' + LOC;
  const frame = h('iframe', { class: 'vss-vet-frame', src: root.dataset.vet ? root.dataset.vet + '?v=' + V : prefix + '/tools/vet/embed.php?v=' + V, title: 'VET' });
  const status = h('p', { class: 'vss-hint', text: t('vet.loading') });
  let state = 'loading', timer = null;
  const d = h('dialog', { class: 'vss-dialog vss-vet-dialog', 'aria-label': 'VET' },
    h('div', { class: 'vss-dialog-head' }, h('strong', { text: `VET · ${f.name || f.id}` }), status, h('span', { class: 'vss-grow' }),
      btn('', () => closeVet(true), { ic: 'x', title: t('close') })), frame);
  document.body.append(d);
  d.addEventListener('cancel', (e) => { e.preventDefault(); closeVet(true); });
  d.showModal();
  timer = setTimeout(() => { if (state === 'loading') { status.textContent = t('vet.timeout'); state = 'failed'; } }, 20000);
  function closeVet(ask) {
    if (ask && state === 'editing' && !confirm(t('vet.closeAsk'))) return;
    window.removeEventListener('message', onMsg); clearTimeout(timer); d.close(); d.remove();
  }
  function send(type, payload) { frame.contentWindow.postMessage({ protocol: 'aevri.vet', version: 1, type, requestId, payload }, location.origin); }
  async function onMsg(e) {
    if (e.origin !== location.origin || e.source !== frame.contentWindow) return; // BRIDGE-1
    const m = e.data;
    if (!m || m.protocol !== 'aevri.vet' || m.version !== 1) return;
    if (m.type === 'vet.ready' && state === 'loading') {
      state = 'editing'; clearTimeout(timer); status.textContent = '';
      const caps = (m.payload && m.payload.capabilities) || [];
      send('vss.open', (await vetOpenPayload(f, caps)).payload);
      return;
    }
    if (m.requestId !== requestId) return; // a stale or foreign request never changes the schema
    if (m.type === 'vet.cancel') { state = 'cancelled'; closeVet(false); return; }
    if (m.type === 'vet.result') {
      const p = m.payload;
      if (!C.checkResult(p)) { toast(t('vet.badResult')); return; }
      const ext = (p.extensions && p.extensions.aevriVss) || {};
      const flow = C.flowById(st.doc, f.id);
      if (!flow) { closeVet(false); toast(t('vet.flowGone')); return; } // VET-8: a deleted flow is not restored
      state = 'complete';
      closeVet(false);
      await applyVetResult(f.id, p, fp);
    }
  }
  window.addEventListener('message', onMsg);
}

/** The payload VSS sends to VET for a flow (VET-4 ... VET-6): context, already estimated items and, when only results
    are stored, the board id, so VET continues the same Board instead of starting a new one (audit item 4). */
async function vetOpenPayload(f, caps = []) {
  const b = st.doc.integrations.vet.bindings[f.id];
  const types = C.flowTypes(st.doc, f) || [];
  const fp = await C.fingerprint(st.doc, f);
  const snapshot = b && b.boardSnapshot && !b.readonly ? b.boardSnapshot : null;
  return { fp, payload: { mode: srv ? 'server' : 'solo', flowRef: C.flowRef(st.doc, f), items: snapshot ? [] : ((b && b.items) || []),
    extensions: { aevriVss: { schemaVersion: C.SCHEMA_VERSION, contextFingerprint: fp, requestBoardSnapshot: caps.includes('vss-board-snapshot-v1') || !!srv,
      boardSnapshot: snapshot, boardId: b && !snapshot ? b.boardId : null,
      elementTypes: types.map((e2) => ({ id: e2.id, name: e2.name, kind: e2.kind })), typeMappings: (b && b.typeMappings) || [] } } } };
}

/** Applies a vet.result (VET-7 ... VET-13): idempotent by resultId, older revisions ignored, a changed flow asks first. */
async function applyVetResult(flowId, p, fp) {
  if (!C.checkResult(p)) { toast(t('vet.badResult')); return; }
  const ext = (p.extensions && p.extensions.aevriVss) || {};
  const flow = C.flowById(st.doc, flowId);
  if (!flow) { toast(t('vet.flowGone')); return; } // VET-8: a deleted flow is not restored
  const prev = st.doc.integrations.vet.bindings[flowId];
  if (prev && prev.resultId === ext.resultId) return; // VET-12 idempotent
  if (prev && prev.boardId === p.boardId && (ext.resultRevision || 0) < (prev.resultRevision || 0)) { toast(t('vet.olderResult')); return; } // VET-12 order
  const now = await C.fingerprint(st.doc, flow);
  if (now !== fp && !confirm(t('vet.changedAsk'))) return; // VET-8, AT-31: the user decides
  act(() => {
    st.doc.integrations.vet.bindings[flowId] = {
      flowRef: p.flowRef, boardId: p.boardId, boardUrl: p.boardUrl || null, resultId: ext.resultId || C.uuidv7(), resultRevision: ext.resultRevision || 1,
      receivedAt: new Date().toISOString(), contextFingerprint: fp, stale: now !== fp, totals: p.totals, priorityKind: ext.priorityKind || (p.totals.priority === null ? 'not_estimated' : 'finite'),
      note: ext.note || null, buckets: p.totals.buckets || null, axes: p.axes || null, items: p.items.map((it) => ({ id: it.id, code: it.code, title: it.title, out: it.out ?? null, in: it.in ?? null })),
      boardSnapshot: ext.boardSnapshot || null, typeMappings: ext.typeMappings || [],
    };
  });
  toast(now !== fp ? t('vet.savedStale') : t('vet.saved'));
}

/** Server mode: VET in a full page through a one-time session (VET VS-5 second way, VSS VET-3). */
async function openVetPage(f) {
  try {
    if (srv.pending) await srv.save();
    const { payload } = await vetOpenPayload(f);
    const api = await apiOf(srv.id);
    const r = await api.post('/vss/sessions', { payload, return: localHref('/tools/vss/s/' + srv.id + '/') });
    location.href = localHref(r.url);
  } catch (e) { toast(t('srv.error') + ' ' + (e.code || '')); }
}

// ---------- server mode (SAVE-5 ... SAVE-9) ----------

/** Solo -> server: sign in if needed, then create the schema in the account (ids kept, SAVE-5). */
async function saveToInstitute() {
  if (!root.dataset.user) {
    if (!SIGNIN) { toast(t('srv.signIn')); return; }
    try { sessionStorage.setItem('vss.save', C.serialize(st.doc)); } catch (e) { toast(t('srv.exportFirst')); return; }
    st.dirty = false;
    location.href = SIGNIN + encodeURIComponent(localHref('/tools/vss/?save=1'));
    return;
  }
  try {
    const api = await apiOf('');
    const r = await api.post('/vss/schemas', { doc: JSON.parse(C.serialize(st.doc)) });
    st.dirty = false;
    location.href = localHref('/tools/vss/s/' + r.id + '/');
  } catch (e) { toast(t('srv.error') + ' ' + (e.code || '')); }
}

function dialogBox(title, body, foot = []) {
  const d = h('dialog', { class: 'vss-dialog vss-wide' }, h('div', { class: 'vss-dialog-head' }, h('strong', { text: title }), h('span', { class: 'vss-grow' }), btn('', () => { d.close(); d.remove(); }, { ic: 'x', title: t('close') })),
    body, h('div', { class: 'vss-dialog-foot' }, ...foot, btn(t('close'), () => { d.close(); d.remove(); })));
  d.addEventListener('close', () => d.remove());
  document.body.append(d); d.showModal();
  return d;
}

/** Links for the owner: editor and viewer (SAVE-8). A new link replaces the old one with the same role. */
function openSchemaShare() {
  const body = h('div', { class: 'vss-share' });
  const safe = (fn) => async () => { try { await fn(); } catch (e) { toast(t('srv.error') + ' ' + (e.code || '')); } };
  const draw = () => {
    body.replaceChildren(h('p', { class: 'vss-hint', text: t('srv.shareHint') }));
    for (const role of ['editor', 'viewer']) {
      const l = (srv.view.links || []).find((x) => x.role === role);
      const row = h('div', { class: 'vss-link-row' }, h('span', { class: 'vss-link-role', text: t('srv.role.' + role) }));
      if (l) {
        const inp = h('input', { value: l.url, readonly: true, onfocus: (e) => e.target.select() });
        row.append(inp, btn(t('srv.copy'), async () => { try { await navigator.clipboard.writeText(l.url); toast(t('srv.copied')); } catch (e) { inp.select(); } }, { cls: 'vss-btn-primary vss-btn-sm' }),
          btn(t('srv.newLink'), safe(async () => { await srv.links(role); draw(); }), { cls: 'vss-btn-sm' }),
          btn(t('srv.revoke'), safe(async () => { await srv.revoke(l.id); draw(); }), { cls: 'vss-btn-sm vss-btn-danger' }));
      } else row.append(btn(t('srv.createLink'), safe(async () => { await srv.links(role); draw(); }), { cls: 'vss-btn-sm' }));
      body.append(row);
    }
  };
  draw();
  dialogBox(t('srv.share'), body);
}

async function openVersions() {
  let list = [];
  try { list = await srv.versions(); } catch (e) { toast(t('srv.error') + ' ' + (e.code || '')); return; }
  const body = h('div', { class: 'vss-versions' }, list.map((v) => h('div', { class: 'vss-row' },
    h('span', { text: new Date(v.createdAt).toLocaleString(LOC) + ' · r' + v.revision + ' · ' + t('srv.reason.' + v.reason) }), h('span', { class: 'vss-grow' }),
    btn(t('srv.restore'), async () => {
      if (!confirm(t('srv.restoreAsk'))) return;
      try { setDoc(await srv.restore(v.id)); d.close(); toast(t('srv.restored')); } catch (e) { toast(t('srv.error') + ' ' + (e.code || '')); }
    }, { cls: 'vss-btn-sm' }))));
  const d = dialogBox(t('srv.versions'), body);
}

/** Somebody saved first (412): reload theirs, overwrite with mine, or keep mine as a copy (SAVE-7). */
function onConflict() {
  const body = h('p', { text: t('srv.conflictText') });
  const d = dialogBox(t('srv.conflict'), body, [
    btn(t('srv.conflictReload'), async () => { d.close(); setDoc(await srv.reload()); }, { cls: 'vss-btn-sm' }),
    btn(t('srv.conflictCopy'), async () => { d.close(); try { const api = await apiOf(''); const r = await api.post('/vss/schemas', { doc: JSON.parse(C.serialize(st.doc)) }); srv.pending = false; location.href = localHref('/tools/vss/s/' + r.id + '/'); } catch (e) { toast(t('srv.error') + ' ' + (e.code || '')); } }, { cls: 'vss-btn-sm' }),
    btn(t('srv.conflictOverwrite'), async () => { d.close(); await srv.save(true); }, { cls: 'vss-btn-sm vss-btn-danger' })]);
}

function setDoc(doc) {
  st.doc = doc; fixSelection(); undoStack.length = 0; redoStack.length = 0; st.dirty = false; render();
}

// ---------- files (IO-1 ... IO-11) ----------

function confirmDiscard() { return !st.dirty || confirm(t('discard.ask')); }
function cmdNew() {
  if (!confirmDiscard()) return;
  st.doc = C.newSchema({ newTitle: t('new.title'), mainConverter: t('new.main'), extIn: t('new.extIn'), extOut: t('new.extOut'), customerValue: t('new.customerValue') });
  undoStack.length = 0; redoStack.length = 0; st.dirty = false; st.report = []; st.sel = { type: 'schema', id: null }; st.nodes.clear();
  render(); st.zoom = 1; centerOn(0, 0); // AT-01 (New): the main converter in the centre of the visible scene
}
function pickFile(mode) {
  const inp = h('input', { type: 'file', accept: '.json,.vss.json,application/json' });
  inp.addEventListener('change', async () => {
    const file = inp.files[0]; if (!file) return;
    if (file.size > 25 * 1024 * 1024) { toast(t('file.tooBig')); return; } // NFR-2
    let res;
    try { res = C.migrate(JSON.parse(await file.text())); }
    catch (e) { showReport(t(e.message === 'newer' ? 'file.newer' : 'file.invalid'), (e.report || []).map(reportLine)); return; } // the current work stays untouched (IO-1)
    if (mode === 'open') {
      if (!confirmDiscard()) return;
      pushHistory(); st.dirty = false;
      st.doc = res.doc; st.report = res.report; st.sel = { type: 'schema', id: null }; st.nodes.clear();
      render(); fit();
    } else {
      const before = C.boundsOf(st.doc);
      let added;
      act(() => { added = C.merge(st.doc, res.doc, before); st.nodes = new Set(added.nodes); st.sel = { type: 'schema', id: null }; st.report = res.report; });
      toast(t('merged', { n: added.nodes.length }), undo);
      fit();
    }
    if (res.report.length) toast(t('file.report', { n: res.report.length }));
  });
  inp.click();
}
function showReport(title, lines) {
  const d = h('dialog', { class: 'vss-dialog' }, h('div', { class: 'vss-dialog-head' }, h('strong', { text: title })), h('ul', { class: 'vss-report' }, lines.map((l) => h('li', { text: l }))),
    h('div', { class: 'vss-dialog-foot' }, btn(t('close'), () => { d.close(); d.remove(); }, { cls: 'vss-btn-primary' })));
  document.body.append(d); d.showModal();
}
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function baseName() { return (st.doc.schema.title || 'schema').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'schema'; }
function exportJson() {
  download(new Blob([C.serialize(st.doc)], { type: 'application/json' }), baseName() + '.vss.json');
  st.dirty = false; st.exported = true; renderChrome(); // SAVE-4: "JSON exported", not "saved to the institute"
}
/** PNG from a clean render of the whole schema in world coordinates (PNG-1 ... PNG-4). */
function exportPng() {
  const keepSel = st.sel, keepNodes = st.nodes;
  st.sel = { type: 'schema', id: null }; st.nodes = new Set();
  renderDiagram();
  const bb = ui.content.getBBox();
  const clone = ui.content.cloneNode(true);
  st.sel = keepSel; st.nodes = keepNodes; renderDiagram();
  if (!bb.width || !bb.height) { toast(t('png.empty')); return; }
  clone.querySelectorAll('.vss-hit,.vss-text-hit').forEach((x) => x.remove());
  const M = 50, foot = 34;
  const W = Math.ceil(bb.width + M * 2), H = Math.ceil(bb.height + M * 2 + foot);
  const scale = W * H * 4 > 8000 * 8000 ? 1 : 2;
  if (W * scale > 16000 || H * scale > 16000) { toast(t('png.tooBig')); return; }
  const svg = s('svg', { xmlns: NS, width: W, height: H, viewBox: `${bb.x - M} ${bb.y - M} ${W} ${H}` });
  const style = s('style'); style.textContent = `text{font-family:Inter,"Segoe UI",system-ui,sans-serif}.vss-label text{font-size:11px;fill:#1f2933}.vss-label text.is-vet{font-size:10px;fill:#176B68;font-weight:600}`;
  svg.append(style, s('rect', { x: bb.x - M, y: bb.y - M, width: W, height: H, fill: '#ffffff' }), clone);
  const brand = s('text', { x: bb.x - M + 14, y: bb.y - M + H - 14, 'font-size': 13, 'font-weight': 700, fill: '#1a365d' }); brand.textContent = 'Æilus VSS';
  svg.append(brand);
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' }));
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas'); c.width = W * scale; c.height = H * scale;
    const ctx = c.getContext('2d'); ctx.scale(scale, scale); ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    c.toBlob((blob) => { if (!blob) { toast(t('png.failed')); return; } download(blob, baseName() + '.png'); }, 'image/png');
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast(t('png.failed')); };
  img.src = url;
}

// ---------- help, toasts, leaving ----------

function openHelp() {
  const d = h('dialog', { class: 'vss-dialog vss-help', 'aria-label': t('help') });
  const body = h('div', { class: 'vss-help-body' });
  for (const k of ['schema', 'converter', 'flow', 'types', 'routing', 'tools', 'files', 'vet', 'ledger', 'keys']) body.append(h('h3', { text: t('help.' + k + '.t') }), h('p', { text: t('help.' + k) }));
  d.append(h('div', { class: 'vss-dialog-head' }, h('strong', { text: t('help.title') }), h('span', { class: 'vss-grow' }), btn('', () => { d.close(); d.remove(); }, { ic: 'x', title: t('close') })), body);
  d.addEventListener('close', () => d.remove());
  document.body.append(d); d.showModal();
}
function toast(text, onUndo) {
  const el = h('div', { class: 'vss-toast' }, h('span', { text }));
  if (onUndo) el.append(btn(t('undo'), () => { el.remove(); onUndo(); }, { cls: 'vss-btn-sm' }));
  ui.toasts.append(el); setTimeout(() => el.remove(), 7000);
}
window.addEventListener('beforeunload', (e) => { if (st.dirty) { e.preventDefault(); e.returnValue = ''; } }); // SAVE-2

// ---------- start ----------

build();
st.doc = C.newSchema({ newTitle: t('new.title'), mainConverter: t('new.main'), extIn: t('new.extIn'), extOut: t('new.extOut'), customerValue: t('new.customerValue') });
const params = new URLSearchParams(location.search);
let failed = false;
if (root.dataset.schema) { // server mode
  try {
    const S = await import('./vss-server.js?v=' + V);
    srv = S.createServer({ api: await apiOf(root.dataset.schema), id: root.dataset.schema, onStatus: () => renderChrome(), onConflict,
      onRemote: (doc) => { setDoc(doc); toast(t('srv.updated')); } });
    st.doc = C.migrate(await srv.load(() => st.doc)).doc;
    srv.base = JSON.stringify(st.doc);
  } catch (e) {
    failed = true;
    const key = e.status === 401 ? 'srv.signIn' : e.status === 404 || e.status === 410 ? 'srv.notFound' : 'srv.forbidden';
    root.replaceChildren(h('div', { class: 'vss-empty-state' }, h('p', { text: t(key) }),
      e.status === 401 && SIGNIN ? h('a', { class: 'vss-btn vss-btn-primary', href: SIGNIN + encodeURIComponent(location.pathname), text: t('srv.signInBtn') }) : null));
    root.classList.add('is-ready');
  }
  const session = params.get('session');
  if (!failed && session) { // back from VET in a full page: take the result once (VS-5, VSS VET-3)
    history.replaceState(null, '', location.pathname);
    try {
      const r = (await (await apiOf(srv.id)).get('/vss/sessions/' + session + '/result')).result;
      const fid = r.flowRef && r.flowRef.flowId;
      if (fid) await applyVetResult(fid, r, (r.extensions && r.extensions.aevriVss && r.extensions.aevriVss.contextFingerprint) || '');
    } catch (e) { if (e.status !== 404) toast(t('srv.error') + ' ' + (e.code || '')); }
  }
} else if (params.get('save') === '1') { // back from sign-in with a solo schema to save (SAVE-5)
  let saved = null;
  try { saved = sessionStorage.getItem('vss.save'); sessionStorage.removeItem('vss.save'); } catch (e) { saved = null; }
  if (saved) { try { st.doc = C.migrate(JSON.parse(saved)).doc; } catch (e) { /* keep the new schema */ } if (root.dataset.user) setTimeout(() => saveToInstitute(), 0); }
  history.replaceState(null, '', location.pathname);
}
if (failed) throw new Error('vss: no access'); // nothing else to set up
render();
// AT-01: centre the main converter once the scene has its real size; the panel starts open on wide screens
let centered = false;
new ResizeObserver(() => {
  if (centered || ui.svg.clientWidth < 60 || ui.svg.clientHeight < 60) { applyTransform(); return; }
  centered = true;
  if (root.clientWidth > 900 && !st.panelOpen) { st.panelOpen = true; renderChrome(); }
  centerOn(0, 0);
}).observe(ui.svg);
root.classList.add('is-ready');
window.VSS = { get doc() { return st.doc; }, core: C };
