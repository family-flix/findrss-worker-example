export class RepositoryBackgroundTasks {
  constructor({ sql }) { this.sql = sql; this.recent = null; }
  list() {
    // 两次索引范围查询，进行中任务优先，避免对全部记录排序。
    const running = this.sql.exec("SELECT * FROM background_tasks WHERE status = 'running' ORDER BY started_at DESC, rowid DESC LIMIT 100").toArray();
    if (running.length === 100) return running;
    const finished = this.sql.exec("SELECT * FROM background_tasks WHERE status != 'running' ORDER BY started_at DESC, rowid DESC LIMIT ?", 100 - running.length).toArray();
    return [...running, ...finished];
  }
  running_for_sources(source_ids) {
    if (!source_ids.length) return [];
    return this.sql.exec(`SELECT * FROM background_tasks WHERE status = 'running'
      AND source_id IN (${source_ids.map(() => "?").join(",")}) ORDER BY started_at DESC, rowid DESC`, ...source_ids).toArray();
  }
  find(id) { return this.sql.exec("SELECT * FROM background_tasks WHERE id = ?", id).toArray()[0]; }
  cleanup() {
    this.recent = null;
    this.sql.exec("DELETE FROM background_tasks WHERE status IN ('completed', 'failed')");
  }
  insert(task) {
    this.sql.exec("INSERT INTO background_tasks (id, kind, title, target, source_id, status, started_at) VALUES (?, ?, ?, ?, ?, 'running', ?)",
      task.id, task.kind, task.title, task.target, task.source_id || "", task.started_at);
    try {
      // 只在冷启动加载保留边界；后续插入复用最近 100 条的时间和 rowid。
      const recent = this.recent === null
        ? this.sql.exec("SELECT started_at, rowid FROM background_tasks ORDER BY started_at DESC, rowid DESC LIMIT 100").toArray()
        : [...this.recent, ...this.sql.exec("SELECT started_at, rowid FROM background_tasks WHERE id = ?", task.id).toArray()]
          .sort((a, b) => b.started_at - a.started_at || b.rowid - a.rowid).slice(0, 100);
      if (recent.length === 100) {
        const boundary = recent[99];
        this.sql.exec(`DELETE FROM background_tasks WHERE status != 'running'
          AND (started_at, rowid) < (?, ?)`, boundary.started_at, boundary.rowid);
      }
      this.recent = recent;
    } catch (error) {
      this.recent = null;
      throw error;
    }
  }
  finish(id, status, error, now) {
    this.sql.exec("UPDATE background_tasks SET status = ?, error = ?, finished_at = ? WHERE id = ? AND status = 'running'", status, error, now, id);
  }
  interrupt(now) {
    this.sql.exec("UPDATE background_tasks SET status = 'failed', error = '服务重启，任务已中断', finished_at = ? WHERE status = 'running'", now);
  }
}
