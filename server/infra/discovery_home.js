import { renderToString } from "timeless-ssr";
import template from "../../discover/index.html";
import stylesheet from "../../discover/style.css";
import base_styles from "../../public/base.css";
import { HomePage, DiscoveryViewModel } from "../../discover/index.js";
import { SourceAddressModel } from "../domain/source_address.js";
import { lazy_catalog_avatars } from "./discovery_assets.js";
import { minify } from "csso/dist/csso.esm";

const styles = minify(stylesheet.replace('@import url("/base.css");', base_styles), {
  restructure: false, comments: false,
}).css;
// 只精简静态外壳，SSR 正文中的空白与 hydration 节点保持原样。
const compact_template = template.trim().replace(/>\s+</g, "><");
let style_hash = null;
// 页头等 HTML 结构变更时递增，旧 R2 产物与边缘缓存共用这一版本。
export const DISCOVERY_ASSETS_VERSION = "10";

export function discovery_style_hash() {
  return style_hash ||= crypto.subtle.digest("SHA-256", new TextEncoder().encode(styles))
    .then(digest => btoa(String.fromCharCode(...new Uint8Array(digest))));
}

export function inline_home_styles(html) {
  return html.replace(/<link (?:id|data-n)="discovery-stylesheet"[^>]*>|<style (?:id|data-n)="discovery-stylesheet">[^]*?<\/style>/,
    () => `<style id="discovery-stylesheet">${styles}</style>`);
}

export function resolve_home_metadata(html, origin) {
  const page_url = new URL("/", origin).href;
  const image_url = new URL("/brand/icon-512.png", origin).href;
  return html
    .replace(/<link rel="canonical" href="[^"]*">/, () => `<link rel="canonical" href="${page_url}">`)
    .replace(/<meta property="og:url" content="[^"]*">/, () => `<meta property="og:url" content="${page_url}">`)
    .replace(/<meta property="og:image" content="[^"]*">/, () => `<meta property="og:image" content="${image_url}">`)
    .replace(/<meta name="twitter:image" content="[^"]*">/, () => `<meta name="twitter:image" content="${image_url}">`);
}

export function render_home_document(catalog, origin, parameters = null) {
  const data = { ...catalog, sources: lazy_catalog_avatars(catalog).sources.map(source => ({ ...source,
    feed_url: SourceAddressModel.resolve_feed_url(source.feed_url, origin),
  })) };
  const body = renderToString(HomePage({ vm$: DiscoveryViewModel(data, parameters) }));
  const bootstrap = JSON.stringify(data).replace(/</g, "\\u003c");
  return resolve_home_metadata(inline_home_styles(compact_template), origin).replace('<main id="discovery-root"></main>',
    () => `<main id="discovery-root">${body}</main>` +
      `<script id="discovery-catalog" type="application/json">${bootstrap}</script>`);
}

export function render_embedded_home(catalog, origin, parameters = null) {
  return render_home_document(catalog, origin, parameters).replace("</head>",
    `<meta name="discovery-embedded-assets" content="${DISCOVERY_ASSETS_VERSION}"></head>`);
}
