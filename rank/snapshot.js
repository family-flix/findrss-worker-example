import { create_api_object_store } from "../server/infra/object_store.js";

export const rank_snapshot_key = id => `rank/scripts/${id}.json`;
const pending = new WeakMap();

export async function publish_rank_snapshots(load, env, signal) {
  signal?.throwIfAborted();
  const store = create_api_object_store(env);
  if (!store) throw new Error("排行榜快照存储未配置");
  if (pending.has(env.API_STORAGE)) return pending.get(env.API_STORAGE);
  // 手动触发与 Cron 共用整轮发布，所有调用方都等待相同的 R2 写入结果。
  const task = (async () => {
    const failures = [];
    const snapshot = await load(async board => {
      signal?.throwIfAborted();
      try {
        await store.put(rank_snapshot_key(board.id), JSON.stringify(board), {
          httpMetadata: { contentType: "application/json; charset=utf-8" },
        });
      } catch (error) { signal?.throwIfAborted(); failures.push(error); }
    }, signal);
    signal?.throwIfAborted();
    if (failures.length) throw new AggregateError(failures, `${failures.length} 个脚本快照写入失败`);
    return snapshot;
  })().finally(() => pending.delete(env.API_STORAGE));
  pending.set(env.API_STORAGE, task);
  return task;
}

export async function read_rank_snapshots(scripts, env) {
  const store = create_api_object_store(env);
  if (!store) throw new Error("排行榜快照存储未配置");
  const snapshots = new Array(scripts.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(8, scripts.length) }, async () => {
    while (next < scripts.length) {
      const index = next++;
      const { id } = scripts[index];
      let error = "脚本快照尚未生成，请稍后重试";
      try {
        const object = await store.get(rank_snapshot_key(id));
        if (object) {
          const board = JSON.parse(await object.text());
          if (board?.id !== id || !Array.isArray(board.entries)
            || board.entries.some(entry => !entry || typeof entry !== "object" || Array.isArray(entry))) throw new Error("快照数据无效");
          snapshots[index] = { board, available: true };
          continue;
        }
      } catch { error = "脚本快照读取失败，请稍后重试"; }
      const board = { id, title: id.replace(/_/g, " "), entries: [], error };
      snapshots[index] = { board, available: false };
    }
  }));
  return {
    boards: snapshots.map(snapshot => snapshot.board),
    available: snapshots.filter(snapshot => snapshot.available).length,
  };
}
