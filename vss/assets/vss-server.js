/* VSS server mode (VSS TZ 8.2 SAVE-5 ... SAVE-9, 12 API-1): the schema lives in the ÆVRI account.
   One editor at a time: every save sends If-Match with the revision it started from; 412 = somebody else saved
   first, and the user chooses (SAVE-7: never a silent overwrite). Autosave 1.5 s after the last change (SAVE-6:
   within 2 s); a poll every 10 s shows another editor's save when there is nothing unsaved here. */

export function createServer({ api, id, onStatus, onRemote, onConflict }) {
  const srv = {
    on: true, id, revision: 0, role: 'viewer', status: 'saved', savedAt: null, view: null, pending: false, base: '',
    get canEdit() { return srv.role === 'editor' || srv.role === 'owner'; },
    get isOwner() { return srv.role === 'owner'; },
  };
  let timer = null, inflight = null, poller = null, getDoc = null;
  const setStatus = (s) => { srv.status = s; if (s === 'saved') srv.savedAt = new Date(); onStatus && onStatus(s); };

  function apply(view) {
    srv.view = view; srv.revision = view.revision; srv.role = view.me.role; srv.base = JSON.stringify(view.doc);
    return structuredClone(view.doc);
  }

  async function load(get) {
    getDoc = get;
    const v = apply(await api.get(`/vss/schemas/${id}`));
    poll();
    return v;
  }

  /** Called after every change of the document. */
  function changed() {
    if (!srv.canEdit) return false;
    srv.pending = true;
    clearTimeout(timer);
    timer = setTimeout(save, 1500);
    setStatus('saving');
    return true;
  }

  async function save(force = false) {
    if (inflight) await inflight.catch(() => {});
    const doc = getDoc();
    const body = JSON.stringify(doc);
    if (!force && body === srv.base) { srv.pending = false; setStatus('saved'); return; }
    srv.pending = false;
    inflight = (async () => {
      const r = await api.put(`/vss/schemas/${id}`, force ? { doc, force: true } : { doc }, force ? {} : { 'If-Match': String(srv.revision) });
      srv.revision = r.revision; srv.base = body;
      setStatus(JSON.stringify(getDoc()) === body ? 'saved' : 'saving');
      if (JSON.stringify(getDoc()) !== body) { srv.pending = true; clearTimeout(timer); timer = setTimeout(save, 300); }
    })();
    try { await inflight; }
    catch (e) {
      srv.pending = true;
      if (e.status === 412) { setStatus('conflict'); onConflict && onConflict(); }
      else setStatus(e.status === 0 ? 'offline' : 'error');
    } finally { inflight = null; }
  }

  async function reload() {
    const v = apply(await api.get(`/vss/schemas/${id}`));
    srv.pending = false; setStatus('saved');
    return v;
  }

  function poll() {
    clearTimeout(poller);
    poller = setTimeout(async () => {
      try {
        if ((srv.status === 'offline' || srv.status === 'error') && srv.pending) await save();
        else if (!srv.pending && !inflight && srv.status !== 'conflict') {
          const r = await api.get(`/vss/schemas/${id}/changes?since=${srv.revision}`);
          srv.view && r.participants && (srv.view.participants = r.participants);
          if (r.changed && !srv.pending) onRemote && onRemote(apply(r));
        }
      } catch (e) { if (e.status === 0) setStatus('offline'); }
      poll();
    }, document.hidden ? 30000 : 10000);
  }

  const links = async (role) => (srv.view.links = (await api.post(`/vss/schemas/${id}/links`, { role })).links);
  const revoke = async (linkId) => (srv.view.links = (await api.del(`/vss/schemas/${id}/links/${linkId}`)).links);
  const versions = async () => (await api.get(`/vss/schemas/${id}/versions`)).versions;
  const saveVersion = async () => { if (srv.pending) await save(); return (await api.post(`/vss/schemas/${id}/versions`)).versions; };
  const restore = async (v) => { await api.post(`/vss/schemas/${id}/versions/${v}/restore`); return reload(); };
  const duplicate = async () => (await api.post(`/vss/schemas/${id}/duplicate`)).id;

  window.addEventListener('beforeunload', (e) => { if (srv.pending || inflight) { e.preventDefault(); e.returnValue = ''; } });
  return Object.assign(srv, { load, changed, save, reload, links, revoke, versions, saveVersion, restore, duplicate });
}
