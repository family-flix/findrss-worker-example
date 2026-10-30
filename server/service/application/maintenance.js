// 定时清理：保留期裁剪 + 用户事件流的限流裁剪。
//
// 由 Cron 驱动，跨 Worker 的维护检查点保存在 D1。
import { ActivityEventModel } from "../../domain/activity_log.js";
import { RETENTION_MILLISECONDS } from "../../lib/constants.js";
export class ServiceMaintenance {
  /**
   * @param {{ repo: Record<string, any> }} deps
   */
  constructor({
    repo
  }) {
    this.repo = repo;
    /** user_events 清理的内存限流时间戳（最多每小时一次）。 */
    this.activity_pruned_at = 0;
    this.retention_pruned_at = null;
  }

  /**
   * 清理已完成调用；日志保留期由 Workers Logs 管理。
   * @param {number} now
   * @returns {void}
   */
  async prune_retention(now) {
    // Cron 每分钟检查租约和快照，历史记录无需跟着每次扫描。
    if (this.retention_pruned_at === null || now - this.retention_pruned_at >= 3600000) {
      await this.repo.calls.delete_completed_before(now - RETENTION_MILLISECONDS);
      this.retention_pruned_at = now;
    }
    // route 缓存的 L2 是按绝对过期时间判定的（TTL 只有分钟级，不是保留期），
    // 所以这里直接按 now 删，而不是 `now - RETENTION_MILLISECONDS`。
    await this.repo.rss_route_cache.delete_expired(now);
  }

  /**
   * 清理操作事件：先删保留期之外的，再按每用户条数上限删最旧的。
   * @param {number} now
   * @returns {void}
   */
  async prune_events(now) {
    if (!ActivityEventModel.should_prune(now, this.activity_pruned_at)) return;
    this.activity_pruned_at = now;
    try {
      await this.repo.activity.delete_before(ActivityEventModel.retention_cutoff(now));
      for (const user_id of await this.repo.activity.list_user_ids()) {
        await this.repo.activity.trim_user(user_id, ActivityEventModel.MAX_EVENTS_PER_USER);
      }
    } catch (error) {
      console.warn("prune_events failed", error);
    }
  }
}
