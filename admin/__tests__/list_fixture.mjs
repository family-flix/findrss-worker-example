import vm from "node:vm";
import { readFileSync } from "node:fs";

// 使用发布产物的真实 ListCore/RequestCore，不模拟分页领域逻辑。
const context = vm.createContext({ setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  document: { querySelector: () => null } });
context.window = context;
vm.runInContext(readFileSync(new URL("../../public/assets/timeless/0.34.2/timeless.umd.min.js", import.meta.url), "utf8"), context);
export const list_runtime = { kit: context.Timeless.kit, vm: context.Timeless.vm, Result: context.Timeless.Result };
export const list_ui = context.Timeless;

// 旧视图测试的内存服务端：响应按查询条件筛选并返回当前页。
export async function paged_fixture(response, address) {
  if (!response.ok) return response;
  const url = new URL(address, "https://admin");
  if (!url.searchParams.has("limit")) return response;
  const payload = await response.json();
  const key = Array.isArray(payload.sources) ? "sources" : Array.isArray(payload.scripts) ? "scripts" : null;
  if (!key || payload.total_count !== undefined) return Response.json(payload);
  const params = url.searchParams, query = (params.get("q") || "").trim().toLowerCase();
  const filtered = payload[key].filter(row => {
    const kind = row.kind || row.script_type || "rss", status = row.status || "published";
    if (params.get("kind") && params.get("kind") !== kind) return false;
    if (params.get("status") === "enabled" && row.enabled === false || params.get("status") === "disabled" && row.enabled !== false) return false;
    if (["draft", "published"].includes(params.get("status")) && params.get("status") !== status) return false;
    if (params.get("visibility") === "public" && row.require_token || params.get("visibility") === "private" && !row.require_token) return false;
    if (params.get("source_type") && params.get("source_type") !== row.source_type) return false;
    return !query || JSON.stringify(row).toLowerCase().includes(query);
  });
  const offset = Number(params.get("offset")), limit = Number(params.get("limit"));
  return Response.json({ ...payload, [key]: filtered.slice(offset, offset + limit), total_count: filtered.length, limit, offset });
}
