import { parse } from "node-html-parser";
import { ClipModel } from "../domain/clip.js";

const dropped_tags = new Set(["script", "style", "link", "iframe", "frame", "frameset", "object", "embed", "applet", "base", "meta", "noscript", "template", "audio", "video", "source", "track", "portal"]);
const dropped_attributes = new Set(["srcdoc", "srcset", "sizes", "action", "formaction", "target", "ping", "poster", "background", "contenteditable", "autofocus", "is"]);
const image_data = /^data:image\/(?:png|jpeg|gif|webp|avif|svg\+xml|x-icon|bmp)(?:;[^,]*)?,/i;

export function sanitize_clip_html(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("剪藏内容不能为空");
  if (new TextEncoder().encode(value).length > ClipModel.MAX_BYTES) throw new Error("剪藏内容超过 8MB，请缩小选区");
  const root = parse(value, { blockTextElements: { script: true, style: true, pre: true } });
  for (const node of root.querySelectorAll("*")) {
    const tag = node.rawTagName.toLowerCase();
    if (dropped_tags.has(tag) || tag.includes("-")) { node.remove(); continue; }
    for (const [original, value] of Object.entries(node.attributes)) {
      const name = original.toLowerCase();
      if (name.startsWith("on") || dropped_attributes.has(name) || name === "class" || name === "xmlns:xlink") node.removeAttribute(original);
      else if (["href", "xlink:href"].includes(name) && !/^#[a-z\d_-]+$/i.test(value)) node.removeAttribute(original);
      else if (name === "src" && (tag !== "img" || !image_data.test(value))) node.removeAttribute(original);
      else if (name === "style") {
        // CSP also blocks non-data resources. Reject obfuscated CSS URLs rather than resolving external resources here.
        if (/\\|\/\*|@import|expression\s*\(|-moz-binding|behavior\s*:/i.test(value)
          || [...value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)].some(match => !match[2].startsWith("#") && !image_data.test(match[2]))) {
          node.removeAttribute(original);
        }
      }
    }
    if (["input", "textarea", "select", "button"].includes(tag)) node.setAttribute("disabled", "");
  }
  const html = root.toString();
  if (!root.querySelector("*") || !html.trim()) throw new Error("剪藏中没有可显示的节点");
  return html;
}

function escape_html(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function render_clip_document(record, html) {
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + `<title>${escape_html(record.title)}</title></head><body style="margin:0">`
    + `<div style="width:${record.width || 800}px;max-width:100%;overflow:hidden">${html}</div></body></html>`;
}

// No scripts, requests, forms or same-origin access; embedding itself is permitted on any origin.
export const CLIP_RESPONSE_HEADERS = Object.freeze({
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; frame-ancestors *; base-uri 'none'; form-action 'none'",
  "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
});
