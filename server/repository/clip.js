export class RepositoryClip {
  constructor({ sql }) { this.sql = sql; }
  list() {
    return this.sql.exec(`SELECT id, title, url, selector, viewport_width, viewport_height, wait_ms, enabled,
      poll_policy_json, poll_updated_at, config_version, node, width, height, byte_size, image_missing,
      attempted_at, error, adaptive_interval, created_at, saved_at FROM clips ORDER BY created_at DESC, id LIMIT 100`).toArray();
  }
  count() { return Number(this.sql.exec("SELECT COUNT(*) AS count FROM clips").toArray()[0].count); }
  find(id) { return this.sql.exec("SELECT * FROM clips WHERE id = ?", id).toArray()[0]; }
  insert(row) {
    this.sql.exec(`INSERT INTO clips (id, title, url, selector, viewport_width, viewport_height, wait_ms,
      enabled, poll_policy_json, poll_updated_at, config_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id, row.title, row.url, row.selector, row.viewport_width, row.viewport_height, row.wait_ms,
      row.enabled, row.poll_policy_json, row.poll_updated_at, row.config_version, row.created_at);
  }
  update(row) {
    this.sql.exec(`UPDATE clips SET title = ?, url = ?, selector = ?, viewport_width = ?, viewport_height = ?,
      wait_ms = ?, enabled = ?, poll_policy_json = ?, poll_updated_at = ?, config_version = ?, error = '' WHERE id = ?`,
      row.title, row.url, row.selector, row.viewport_width, row.viewport_height, row.wait_ms,
      row.enabled, row.poll_policy_json, row.poll_updated_at, row.config_version, row.id);
  }
  attempt(id, now) { this.sql.exec("UPDATE clips SET attempted_at = ? WHERE id = ?", now, id); }
  failure(id, error, version) { this.sql.exec("UPDATE clips SET error = ? WHERE id = ? AND config_version = ?", error, id, version); }
  save(row) {
    this.sql.exec(`UPDATE clips SET html = ?, object_key = ?, node = ?, width = ?, height = ?,
      byte_size = ?, image_missing = ?, saved_at = ?, fingerprint = ?, adaptive_interval = ?, error = '' WHERE id = ?`,
      row.html, row.object_key, row.node, row.width, row.height, row.byte_size, row.image_missing, row.saved_at, row.fingerprint, row.adaptive_interval, row.id);
  }
  delete(id) { this.sql.exec("DELETE FROM clips WHERE id = ?", id); }
}
