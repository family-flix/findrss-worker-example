export class RepositoryClip {
  constructor({
    sql
  }) {
    this.sql = sql;
  }
  async list() {
    return (await this.sql.exec(`SELECT id, script_id, script_url, title, url, selector, viewport_width, viewport_height, wait_ms, enabled,
      poll_policy_json, poll_updated_at, config_version, node, width, height, byte_size, image_missing,
      attempted_at, error, adaptive_interval, created_at, saved_at FROM clips ORDER BY created_at DESC, id LIMIT 100`)).toArray();
  }
  async count() {
    return Number((await this.sql.exec("SELECT COUNT(*) AS count FROM clips")).toArray()[0].count);
  }
  async find(id) {
    return (await this.sql.exec("SELECT * FROM clips WHERE id = ?", id)).toArray()[0];
  }
  async insert(row) {
    await this.sql.exec(`INSERT INTO clips (id, script_id, script_url, title, url, selector, viewport_width, viewport_height, wait_ms,
      enabled, poll_policy_json, poll_updated_at, config_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, row.id, row.script_id, row.script_url, row.title, row.url, row.selector, row.viewport_width, row.viewport_height, row.wait_ms, row.enabled, row.poll_policy_json, row.poll_updated_at, row.config_version, row.created_at);
  }
  async update(row) {
    await this.sql.exec(`UPDATE clips SET script_id = ?, script_url = ?, title = ?, url = ?, selector = ?, viewport_width = ?, viewport_height = ?,
      wait_ms = ?, enabled = ?, poll_policy_json = ?, poll_updated_at = ?, config_version = ?, error = '' WHERE id = ?`, row.script_id, row.script_url, row.title, row.url, row.selector, row.viewport_width, row.viewport_height, row.wait_ms, row.enabled, row.poll_policy_json, row.poll_updated_at, row.config_version, row.id);
  }
  async attempt(id, now) {
    await this.sql.exec("UPDATE clips SET attempted_at = ? WHERE id = ?", now, id);
  }
  async failure(id, error, version) {
    await this.sql.exec("UPDATE clips SET error = ? WHERE id = ? AND config_version = ? AND error != ?", error, id, version, error);
  }
  async save(row) {
    await this.sql.exec(`UPDATE clips SET url = COALESCE(?, url), html = ?, object_key = ?, node = ?, width = ?, height = ?,
      byte_size = ?, image_missing = ?, saved_at = ?, fingerprint = ?, adaptive_interval = ?, error = '' WHERE id = ?`, row.url ?? null, row.html, row.object_key, row.node, row.width, row.height, row.byte_size, row.image_missing, row.saved_at, row.fingerprint, row.adaptive_interval, row.id);
  }
  async delete(id) {
    await this.sql.exec("DELETE FROM clips WHERE id = ?", id);
  }
}
