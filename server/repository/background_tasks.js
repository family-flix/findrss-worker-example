export class RepositoryBackgroundTasks {
  constructor({ sql }) { this.sql = sql; }
  list() {
    return this.sql.exec("SELECT * FROM background_tasks ORDER BY (status = 'running') DESC, started_at DESC, rowid DESC LIMIT 100").toArray();
  }
  find(id) { return this.sql.exec("SELECT * FROM background_tasks WHERE id = ?", id).toArray()[0]; }
  insert(task) {
    this.sql.exec("INSERT INTO background_tasks (id, kind, title, target, status, started_at) VALUES (?, ?, ?, ?, 'running', ?)",
      task.id, task.kind, task.title, task.target, task.started_at);
    this.sql.exec(`DELETE FROM background_tasks WHERE status != 'running' AND id NOT IN
      (SELECT id FROM background_tasks ORDER BY started_at DESC, rowid DESC LIMIT 100)`);
  }
  finish(id, status, error, now) {
    this.sql.exec("UPDATE background_tasks SET status = ?, error = ?, finished_at = ? WHERE id = ? AND status = 'running'", status, error, now, id);
  }
  interrupt(now) {
    this.sql.exec("UPDATE background_tasks SET status = 'failed', error = '服务重启，任务已中断', finished_at = ? WHERE status = 'running'", now);
  }
}
