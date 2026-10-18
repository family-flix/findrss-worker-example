export const SITE_CSP = Object.freeze({
  "admin": "default-src 'none'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data: https: http:; media-src 'self' blob: https: http:; frame-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "discovery": "default-src 'none'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; connect-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
});

export const SITE_HEADERS = Object.freeze({
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
});

export function secure_site_response(response, section, style_hash = "") {
  if (response.status === 101) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SITE_HEADERS)) headers.set(name, value);
  headers.set("Content-Security-Policy", style_hash
    ? SITE_CSP[section].replace("style-src 'self'", `style-src 'self' 'sha256-${style_hash}'`)
    : SITE_CSP[section]);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
