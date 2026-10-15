export function cookie_header(cookies, url, now_seconds = Date.now() / 1000) {
  const target = new URL(url);
  return cookies
    .filter((cookie) => {
      const domain = String(cookie.domain || "").replace(/^(?:\*\.|\.)/, "").toLowerCase();
      const path = String(cookie.path || "/");
      const expires = Number(cookie.expirationDate || 0);
      return cookie.name && domain &&
        (target.hostname === domain || (!cookie.hostOnly && target.hostname.endsWith("." + domain))) &&
        (target.pathname === path || target.pathname.startsWith(path.endsWith("/") ? path : path + "/")) &&
        (!cookie.secure || target.protocol === "https:") &&
        (!expires || expires > now_seconds);
    })
    .map((cookie) => `${cookie.name}=${cookie.value ?? ""}`)
    .join("; ");
}
