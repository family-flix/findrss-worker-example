import { redact_log_value } from "../lib/log_redact.js";

const escape_html = value => String(value ?? "").replace(/[&<>"']/g, character =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

export function script_debug_html(debug, status) {
  const request = redact_log_value(debug.request);
  const heading = status < 400 ? "路由调试" : "路由请求失败";
  const block = (name, title, value) => `<section data-n="debug-${name}"><h2 data-n="debug-${name}-title">${title}</h2><pre data-n="debug-${name}-content">${escape_html(value)}</pre></section>`;
  return `<!doctype html>
<html lang="zh-CN" data-n="rss-debug-page"><head data-n="debug-head"><meta data-n="debug-charset" charset="utf-8"><meta data-n="debug-viewport" name="viewport" content="width=device-width,initial-scale=1"><title data-n="debug-title">${heading} · FindRSS</title>
<style data-n="debug-style">
:root{color-scheme:light dark;font:15px/1.6 system-ui,sans-serif;background:#f6f7f9;color:#172033}*{box-sizing:border-box}body{margin:0;padding:24px 16px}main{max-width:1600px;margin:auto}header,.column{background:#fff;border:1px solid #e2e6ed;border-radius:16px}header{padding:24px;margin-bottom:16px;border-top:4px solid ${status < 400 ? "#2563eb" : "#e11d48"}}h1{font-size:26px;margin:8px 0}h2{font-size:15px;margin:0 0 12px}p{margin:8px 0;overflow-wrap:anywhere}.meta{color:#667085;font-size:13px}pre{margin:0;font:13px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;height:75vh}.column{min-width:0;min-height:0;overflow:auto}.context section{padding:24px;border-bottom:1px solid #e2e6ed}.xml{display:flex;flex-direction:column;overflow:hidden}.xml h2{padding:20px 24px;margin:0;border-bottom:1px solid #e2e6ed}.xml pre{overflow:auto;min-height:0;flex:1;padding:24px}svg{color:#e11d48;width:28px;height:28px}@media(prefers-color-scheme:dark){:root{background:#10141c;color:#e5eaf3}header,.column{background:#191f2b;border-color:#30394a}.context section,.xml h2{border-color:#30394a}.meta{color:#a4aec0}}@media(max-width:800px){body{padding:16px 12px}.layout{grid-template-columns:minmax(0,1fr);height:auto}.context{max-height:65vh}.xml{height:65vh}header,.context section{padding:18px}}
</style></head><body data-n="debug-body"><main data-n="debug-main"><header data-n="debug-header">
${status >= 400 ? '<svg data-n="debug-error-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle data-n="debug-icon-circle" cx="12" cy="12" r="10"/><path data-n="debug-icon-mark" d="M12 7v6m0 4h.01"/></svg>' : ""}
<p data-n="debug-brand" class="meta">FindRSS · 脚本 Debug</p><h1 data-n="debug-heading">${heading}</h1>
<p data-n="debug-script">${escape_html(debug.script.name || debug.script.path)}</p>
<p data-n="debug-status" class="meta">HTTP ${escape_html(status)} · ${escape_html(debug.phase)} · ${escape_html(debug.elapsed_ms)} ms${debug.invoked ? " · 已调用设备" : ""}</p>
<p data-n="debug-upstream">${escape_html(debug.upstream_error)}</p></header>
<div data-n="debug-layout" class="layout"><div data-n="debug-context-column" class="column context" tabindex="0" role="region" aria-label="上下文与执行日志">
${debug.error_text ? block("error", "错误详情与堆栈", debug.error_text) : ""}
${block("route", "脚本路由", JSON.stringify(debug.script, null, 2))}
${block("request", "请求上下文", JSON.stringify(request, null, 2))}
${block("upstream-requests", "上游请求（只显示凭证是否发送，不含凭证值）", JSON.stringify(redact_log_value(debug.upstream_requests || []), null, 2))}
${block("logs", "执行日志", (debug.lines || []).map(line => `[${line.level}] ${line.text}`).join("\n") || "无执行日志")}
</div><section data-n="debug-output" class="column xml"><h2 data-n="debug-output-title">路由输出</h2><pre data-n="debug-output-content" tabindex="0" role="region" aria-label="路由输出">${escape_html(debug.output ?? "执行失败，未生成输出")}</pre></section></div>
</main></body></html>`;
}
