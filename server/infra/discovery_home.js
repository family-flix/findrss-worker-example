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

export function discovery_style_hash() {
  return style_hash ||= crypto.subtle.digest("SHA-256", new TextEncoder().encode(styles))
    .then(digest => btoa(String.fromCharCode(...new Uint8Array(digest))));
}

export function inline_home_styles(html) {
  return html.replace(/<link data-n="discovery-stylesheet"[^>]*>|<style data-n="discovery-stylesheet">[^]*?<\/style>/,
    () => `<style data-n="discovery-stylesheet">${styles}</style>`);
}

export function render_home_document(catalog, origin) {
  const data = { ...catalog, sources: lazy_catalog_avatars(catalog).sources.map(source => ({ ...source,
    feed_url: SourceAddressModel.resolve_feed_url(source.feed_url, origin),
  })) };
  const body = renderToString(HomePage({ vm$: DiscoveryViewModel(data) }));
  const bootstrap = JSON.stringify(data).replace(/</g, "\\u003c");
  return inline_home_styles(compact_template).replace('<main data-n="discovery-root" id="discovery-root"></main>',
    () => `<main data-n="discovery-root" id="discovery-root">${body}</main>` +
      `<script data-n="discovery-catalog" type="application/json">${bootstrap}</script>`);
}

export function render_embedded_home(catalog, origin) {
  return render_home_document(catalog, origin).replace("</head>",
    '<meta data-n="discovery-embedded-assets" name="discovery-embedded-assets" content="4"></head>');
}
