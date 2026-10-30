import { do_error, do_result } from "./error.js";
export class ServiceHotSnapshots {
  constructor({
    background_tasks,
    build_snapshot,
    build_home
  }) {
    this.background_tasks = background_tasks;
    this.build_snapshot = build_snapshot;
    this.build_home = build_home;
  }
  async start() {
    if (!this.build_snapshot || !this.build_home) throw do_error("hot snapshot service is unavailable", 503);
    const {
      task
    } = await this.background_tasks.start("hot-snapshot", {
      kind: "hot_snapshot",
      title: "刷新热榜快照",
      target: "/rank/"
    }, async signal => {
      const result = await this.build_snapshot(signal);
      signal.throwIfAborted();
      await this.build_home(result, signal);
      signal.throwIfAborted();
      const failed = result.boards.filter(board => board.error);
      return {
        snapshot: {
          error: failed.length ? `${failed.length} 个 Hot 脚本采集失败：` + failed.map(board => `${board.id}: ${board.error}`).join("；") : ""
        }
      };
    });
    return do_result({
      task_id: task.id,
      task
    }, 202);
  }
}
