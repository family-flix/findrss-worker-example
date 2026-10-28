import { RssRoutePatternModel } from "../server/domain/rss_route.js";

// 合并同一实例中重叠的预构建，后续任务重新采集，只复用编译结果。
export function create_rank_loader(scripts, { compile, execute, execute_hot }) {
  const compiled = new Map();
  let pending;
  return function load(on_board, task_signal) {
    task_signal?.throwIfAborted();
    return pending ||= collect(on_board, task_signal).finally(() => { pending = null; });
  };

  async function collect(on_board, task_signal) {
    const boards = new Array(scripts.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(8, scripts.length) }, async () => {
      while (next < scripts.length) {
        task_signal?.throwIfAborted();
        const index = next++;
        const { id, source } = scripts[index];
        let board = { id, title: id.replace(/_/g, " "), entries: [], error: "" };
        const timeout = AbortSignal.timeout(12000);
        const signal = task_signal ? AbortSignal.any([timeout, task_signal]) : timeout;
        try {
          if (!compiled.has(id)) compiled.set(id, await compile(source));
          const module = compiled.get(id);
          if (module.error) throw new Error(module.error);
          const route = module.metadata.routes[0];
          board = { ...board, title: route.name || board.title, platform: route.platform,
            category: module.metadata.category || "其他", order: module.metadata.order ?? 0 };
          const url = new URL(route.example, "https://rank.invalid");
          const match = RssRoutePatternModel(route.path).match(url.pathname);
          if (!match) throw new Error("榜单示例地址与路由不匹配");
          const context = {
            method: "GET", pathname: url.pathname, params: match.params, query: Object.fromEntries(url.searchParams),
          };
          const result = await execute_hot?.(context, signal)
            ?? await execute(source, { ...module.metadata, ...route }, null, context, [], "", null, signal);
          const value = JSON.parse(result.output);
          if (value?.kind !== "hot_rank" || !Array.isArray(value.entries)) throw new Error("脚本未返回热榜快照");
          boards[index] = { ...board, title: value.title || board.title, link: value.link,
            category: value.category || board.category, observed_at: value.observed_at, entries: value.entries };
        } catch (error) {
          task_signal?.throwIfAborted();
          boards[index] = { ...board, error: signal.aborted ? "榜单请求超时，请稍后重试" : String(error.problem?.message || error.message || "榜单加载失败").replace(/^脚本执行失败：/, "").slice(0, 500) };
        }
        task_signal?.throwIfAborted();
        await on_board?.(boards[index]);
      }
    }));
    boards.sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
    return { observed_at: new Date().toISOString(), boards };
  }
}
