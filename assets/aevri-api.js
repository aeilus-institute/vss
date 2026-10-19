/* HTTP adapter of the tools (VET DL-1 StorageAdapter over REST, VSS ARCH-3): the /api/v1 contract from
   docs/contracts/openapi.yaml. The same module works against any backend that implements the contract (Team package:
   pass another base). Errors are application/problem+json; offline = status 0. */

export class ApiError extends Error {
  constructor(status, body) {
    super((body && (body.detail || body.title)) || 'error ' + status);
    this.status = status;
    this.body = body || {};
    this.code = (this.body.code || '').split('/').pop() || (status ? 'http-' + status : 'offline');
  }
}

/** Guest tokens live in the guest's own browser (VET MO-8); access may be blocked, so every call is guarded. */
export const guestStore = {
  get(id) { try { return localStorage.getItem('aevri.guest.' + id) || sessionStorage.getItem('aevri.guest.' + id) || ''; } catch (e) { return ''; } },
  set(id, token) { try { localStorage.setItem('aevri.guest.' + id, token); } catch (e) { /* private window: the token lives for this page only */ } },
};

/**
 * createApi({ base, sessid, guest }) -> { call, get, post, put, patch, del }
 * sessid: the site session token for signed-in users (sent as X-Bitrix-Sessid); guest(): the guest token or ''.
 */
export function createApi({ base = '/api/v1', sessid = '', guest = () => '' } = {}) {
  async function call(method, path, body, headers = {}) {
    const h = { Accept: 'application/json', ...headers };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const g = guest();
    if (g) h.Authorization = 'Guest ' + g;
    else if (method !== 'GET' && sessid) h['X-Bitrix-Sessid'] = sessid;
    let r;
    try {
      r = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', cache: 'no-store' });
    } catch (e) { throw new ApiError(0, { code: 'offline' }); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(r.status, data);
    return data;
  }
  return {
    call,
    get: (p) => call('GET', p),
    post: (p, b = {}, hd) => call('POST', p, b, hd),
    put: (p, b, hd) => call('PUT', p, b, hd),
    patch: (p, b, hd) => call('PATCH', p, b, hd),
    del: (p) => call('DELETE', p),
  };
}

/** The current page in the same language prefix (/ru/tools/... stays /ru/...). */
export function localPath(path) {
  const m = location.pathname.match(/^\/([a-z]{2})\//);
  return m && m[1] !== 'en' && !path.startsWith('/' + m[1] + '/') ? '/' + m[1] + path : path;
}
