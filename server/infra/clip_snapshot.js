import { ClipModel } from "../domain/clip.js";

export function create_clip_loader(env, capture_source, fetch_impl = fetch) {
  const account = String(env.CF_BROWSER_ACCOUNT_ID || "").trim();
  const token = String(env.CF_BROWSER_API_TOKEN || "").trim();
  if (!account || !token) return null;
  return async (record, signal) => {
    if (!/^[a-f0-9]{32}$/i.test(account)) throw new Error("CF_BROWSER_ACCOUNT_ID 必须为 32 位账号 ID");
    const marker = "findrss-clip-" + crypto.randomUUID();
    const config = JSON.stringify({ selector: record.selector, wait_ms: record.wait_ms, marker, id_prefix: record.id });
    // Module script completion includes top-level await; the final marker also prevents reading a partial result.
    const content = capture_source + `\nconst config = ${config};
let result;
try {
  const deadline = Date.now() + 15000;
  while (!document.querySelector(config.selector)) {
    if (Date.now() > deadline) throw new Error('未找到指定节点：' + config.selector);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await new Promise(resolve => setTimeout(resolve, config.wait_ms));
  await Promise.race([document.fonts?.ready, new Promise(resolve => setTimeout(resolve, 2000))]);
  result = await FindRSSRegionClip.capture(config.selector, { id_prefix: config.id_prefix });
} catch (error) { result = { ok: false, error: error.message || String(error) }; }
const output = document.createElement('pre');
output.id = config.marker;
output.textContent = JSON.stringify(result);
document.documentElement.appendChild(output);`;
    const combined = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(110000)]);
    let response;
    try {
      response = await fetch_impl(`https://api.cloudflare.com/client/v4/accounts/${account}/browser-rendering/scrape?cacheTTL=0`, {
        method: "POST", signal: combined,
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ url: record.url, viewport: { width: record.viewport_width, height: record.viewport_height },
          gotoOptions: { waitUntil: "networkidle2", timeout: 30000 },
          addScriptTag: [{ content, type: "module" }],
          waitForSelector: { selector: "#" + marker, timeout: 90000 }, actionTimeout: 90000,
          elements: [{ selector: "#" + marker }] }),
      });
    } catch {
      signal?.throwIfAborted();
      throw new Error("Browser Rendering 请求失败或超时，请检查配置与网站访问状态");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Browser Rendering 返回 HTTP ${response.status}，请检查账号、Token 权限或服务额度`);
    }
    const reader = response.body.getReader(), chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > ClipModel.MAX_BYTES * 3) { await reader.cancel(); throw new Error("Browser Rendering 结果过大，请缩小选区"); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let payload, result;
    try {
      payload = JSON.parse(new TextDecoder().decode(bytes));
      const entry = payload.result?.find(entry => entry.selector === "#" + marker);
      result = JSON.parse(entry?.results?.[0]?.text || "null");
    } catch { throw new Error("Browser Rendering 返回了无效的剪藏结果"); }
    if (!payload.success || !result) throw new Error("Browser Rendering 未返回选区，请检查 CSS 选择器及网站是否可访问");
    if (!result.ok) throw new Error(String(result.error || "节点提取失败").slice(0, 200));
    signal?.throwIfAborted();
    return result;
  };
}
