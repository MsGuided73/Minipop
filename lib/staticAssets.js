// Deciding whether a request is asking for a build artifact or for the app.
//
// server.js ends in a catch-all that hands out index.html, so the client can be
// deep-linked. Without a rule like this one, that catch-all also answers
// requests for files that do not exist — including /assets/, where Vite puts
// every fingerprinted bundle. A missing stylesheet then comes back as HTML with
// a 200, and the browser's only available complaint is:
//
//     Refused to apply style from '.../assets/index-abc123.css' because its
//     MIME type ('text/html') is not a supported stylesheet MIME type
//
// which says nothing about the cause, and reads identically whether the deploy
// is mid-swap, the browser is holding a stale index.html, or the build never
// emitted the file at all. Three causes, one unreadable symptom; it cost most
// of an evening once. A real 404 tells them apart.
//
// Two rules, both narrow on purpose:
//
//   1. Anything under /assets/ is a build artifact. Vite fingerprints
//      everything it puts there, so such a request names one exact file and can
//      never be an application route.
//
//   2. A path ending in a known static file extension is a build artifact
//      (/favicon.svg, /robots.txt). The extension list is explicit rather than
//      "contains a dot" so that a name with a dot in it is still treated as a
//      route — this app has no client-side path routing today, but a rule that
//      only breaks once routing arrives is a trap worth not setting.

export const ASSET_DIR = '/assets/'

const STATIC_EXTENSION =
  /\.(?:js|mjs|cjs|css|map|json|txt|xml|wasm|woff2?|ttf|otf|eot|png|jpe?g|gif|svg|webp|avif|ico|mp4|webm|mp3|pdf)$/i

/**
 * True when `pathname` is a request for a build artifact rather than for the
 * single-page app. Takes a URL path; a query string or fragment is tolerated
 * but ignored.
 */
export function isStaticAssetPath(pathname) {
  const raw = String(pathname ?? '')
  if (!raw.startsWith('/')) return false

  const clean = raw.split('?')[0].split('#')[0]
  if (clean.startsWith(ASSET_DIR)) return true

  return STATIC_EXTENSION.test(clean)
}

/**
 * Plain-text body for an asset that is not on disk. Deliberately explains the
 * three causes, because whoever reads this is reading it in a Network tab at
 * the point where the old behaviour told them nothing.
 */
export function assetNotFoundBody(pathname) {
  return [
    `Not found: ${pathname}`,
    '',
    'This path is served from the build output and no such file exists.',
    '',
    '  - loaded from a stale page?   hard-reload the browser',
    '  - deploy still swapping?      retry in a moment',
    '  - neither?                    this build did not emit the file',
    '',
  ].join('\n')
}
