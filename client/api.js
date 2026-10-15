export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? res.statusText);
  return data;
}

// GETs started before the page that wants them has mounted (see prefetch).
const early = new Map();
const EARLY_FOR_MS = 10_000;

export const api = {
  get(path) {
    const pending = early.get(path);
    early.delete(path);
    return pending ?? request('GET', path);
  },
  /**
   * Start a GET that a page is about to make, so it overlaps whatever comes
   * first. The page's own get() of the same path takes the response, if it
   * asks within a few seconds; after that it's stale and fetched again.
   */
  prefetch(path) {
    const pending = request('GET', path);
    pending.catch(() => {});   // a failure is reported to whoever takes it
    early.set(path, pending);
    setTimeout(() => early.get(path) === pending && early.delete(path), EARLY_FOR_MS);
  },
  post: (path, body = {}) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  delete: (path) => request('DELETE', path),
};
