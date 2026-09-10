// Deciding whether a browser Origin may call this API.
//
// The previous version of this rule took the site down. It compared the Origin
// against an allow-list that defaulted to three localhost entries, and when the
// Origin did not match it called back with an Error. In production
// ALLOWED_ORIGINS was never set, so the site's own origin was not on the list,
// and every browser request carrying an Origin header — which includes the
// module script and the stylesheet, because Vite marks both `crossorigin` —
// got Express's default error page: a 500 whose body is HTML. The browser could
// only report it as
//
//     Refused to apply style ... MIME type ('text/html')
//
// so a CORS misconfiguration presented as a mysterious asset failure, and the
// 500 leaked a stack trace with container paths to anyone who sent an Origin
// header.
//
// Two rules follow from that:
//
//   1. A request to the site's own host is always allowed, regardless of
//      configuration. A missing environment variable must not be able to stop
//      the app serving itself. The allow-list exists to permit OTHER origins,
//      which is the only thing CORS is actually protecting.
//
//   2. A disallowed origin is not an error. The correct response is to omit
//      Access-Control-Allow-Origin and let the browser refuse — which it will.
//      Throwing turns a routine policy decision into a 500 and, in a non-
//      production NODE_ENV, into an information leak.

/** Origin values the browser sends for a non-HTTP context. Never same-host. */
const OPAQUE = new Set(['null', 'undefined'])

/**
 * The host this request was addressed to. Behind a reverse proxy the original
 * host arrives in X-Forwarded-Host; Host alone would be the internal name.
 */
export function requestHost(headers = {}) {
  const forwarded = headers['x-forwarded-host']
  const host = forwarded ? String(forwarded).split(',')[0] : headers.host
  return host ? String(host).trim().toLowerCase() : ''
}

/**
 * True when `origin` names the same host the request was addressed to. Compared
 * on host (name plus port), so http/https and path differences do not matter —
 * a same-host request over the wrong scheme is still this site, and the proxy
 * already redirects http to https.
 */
export function isSameHost(origin, host) {
  if (!origin || !host || OPAQUE.has(String(origin).trim().toLowerCase())) return false
  try {
    return new URL(String(origin)).host.toLowerCase() === String(host).trim().toLowerCase()
  } catch {
    return false
  }
}

/**
 * Whether a request may be answered with CORS headers.
 *
 * @param origin    the request's Origin header, if any
 * @param allowList extra origins to permit (exact match, e.g. a separate front end)
 * @param headers   the request headers, used to find this site's own host
 */
export function isAllowedOrigin(origin, { allowList = [], headers = {} } = {}) {
  // No Origin header: not a browser cross-origin request at all. curl, the
  // app's own server-side calls, health checks. Not what CORS guards against.
  if (!origin) return true

  const value = String(origin).trim()
  if (allowList.includes(value)) return true

  return isSameHost(value, requestHost(headers))
}

/** Parse a comma-separated ALLOWED_ORIGINS value into a list. */
export function parseAllowList(raw) {
  return String(raw ?? '')
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean)
}
