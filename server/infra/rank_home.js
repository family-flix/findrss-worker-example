import { renderToString } from "timeless-ssr";
import { minify } from "csso/dist/csso.esm";
import template from "../../rank/index.html";
import stylesheet from "../../rank/style.css";
import base_styles from "../../public/base.css";
import { RankViewModel } from "../../rank/model.js";
import { RankPage } from "../../rank/view.js";

const styles = minify(stylesheet.replace('@import url("/base.css");', base_styles), { restructure: false, comments: false }).css;
let style_hash;
export function rank_style_hash() {
  return style_hash ||= crypto.subtle.digest("SHA-256", new TextEncoder().encode(styles))
    .then(bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))));
}

export function render_rank_home(catalog, origin, parameters = null) {
  const body = renderToString(RankPage({ vm$: RankViewModel(catalog, parameters) }));
  const data = JSON.stringify(catalog).replace(/</g, "\\u003c");
  return template.trim().replace(/>\s+</g, "><")
    .replace(/<link id="rank-stylesheet"[^>]*>/, () => `<style id="rank-stylesheet" data-n="rank-stylesheet">${styles}</style>`)
    .replace('<link rel="canonical" href="/rank/"', () => `<link rel="canonical" href="${new URL("/rank/", origin).href}"`)
    .replace('<main id="rank-root" data-n="rank-root"></main>', () =>
      `<main id="rank-root" data-n="rank-root">${body}</main><script id="rank-catalog" type="application/json" data-n="rank-catalog">${data}</script>`);
}
