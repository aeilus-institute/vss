/* A small JSON Schema (draft 2020-12 subset) validator for imported files (VET IO-3, VSS IO-1). Plain ES module.
   Supports: type (incl. arrays of types and "integer"), const, enum, required, properties, additionalProperties
   (schema or false), items, minItems, maxItems, minLength, maxLength, pattern, minimum, maximum, allOf, if/then,
   local $ref "#/$defs/...". Unknown keywords are ignored, so the check never rejects more than the schema says. */

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

/** Returns a list of { path, rule } (empty = valid); stops after `limit` problems. */
export function validate(schema, value, { limit = 20 } = {}) {
  const errors = [];
  const resolve = (s) => {
    let guard = 0;
    while (s && s.$ref && guard++ < 20) {
      if (!s.$ref.startsWith('#/')) return {};
      s = s.$ref.slice(2).split('/').reduce((o, k) => (o ? o[k.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined), schema);
    }
    return s || {};
  };
  const check = (s, v, path) => {
    if (errors.length >= limit) return;
    s = resolve(s);
    if (s === true || !s) return;
    if (s === false) { errors.push({ path, rule: 'false' }); return; }
    const fail = (rule) => errors.push({ path: path || '/', rule });
    const t = typeOf(v);
    if (s.type !== undefined) {
      const types = [].concat(s.type);
      const ok = types.some((x) => x === t || (x === 'integer' && t === 'number' && Number.isInteger(v)) || (x === 'number' && t === 'number' && Number.isFinite(v)));
      if (!ok) { fail('type ' + types.join('|')); return; }
    }
    if ('const' in s && JSON.stringify(s.const) !== JSON.stringify(v)) fail('const');
    if (s.enum && !s.enum.some((x) => JSON.stringify(x) === JSON.stringify(v))) fail('enum');
    if (t === 'string') {
      if (s.maxLength !== undefined && [...v].length > s.maxLength) fail('maxLength ' + s.maxLength);
      if (s.minLength !== undefined && [...v].length < s.minLength) fail('minLength ' + s.minLength);
      if (s.pattern) { try { if (!new RegExp(s.pattern, 'u').test(v)) fail('pattern'); } catch (e) { /* a pattern JS cannot read is skipped */ } }
    }
    if (t === 'number') {
      if (s.minimum !== undefined && v < s.minimum) fail('minimum ' + s.minimum);
      if (s.maximum !== undefined && v > s.maximum) fail('maximum ' + s.maximum);
    }
    if (t === 'array') {
      if (s.minItems !== undefined && v.length < s.minItems) fail('minItems ' + s.minItems);
      if (s.maxItems !== undefined && v.length > s.maxItems) fail('maxItems ' + s.maxItems);
      if (s.items) v.forEach((x, i) => check(s.items, x, path + '/' + i));
    }
    if (t === 'object') {
      for (const k of s.required || []) if (!(k in v)) fail('required ' + k);
      const props = s.properties || {};
      for (const [k, x] of Object.entries(v)) {
        if (props[k]) check(props[k], x, path + '/' + k);
        else if (s.additionalProperties === false) fail('additional ' + k);
        else if (s.additionalProperties && typeof s.additionalProperties === 'object') check(s.additionalProperties, x, path + '/' + k);
      }
    }
    for (const sub of s.allOf || []) check(sub, v, path);
    if (s.if && s.then) { const before = errors.length; check(s.if, v, path); const matched = errors.length === before; errors.length = before; if (matched) check(s.then, v, path); }
  };
  check(schema, value, '');
  return errors;
}

const cache = new Map();
/** Loads a schema next to the tools (`contracts/<name>`), cached; null when it cannot be loaded (the import then goes on). */
export async function loadSchema(name) {
  if (!cache.has(name)) cache.set(name, fetch(new URL('../contracts/' + name + '?v=' + (new URL(import.meta.url).searchParams.get('v') || '1'), import.meta.url)).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return cache.get(name);
}
