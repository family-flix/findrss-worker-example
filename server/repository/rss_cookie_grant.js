export class RepositoryRssCookieGrant {
  constructor({ sql }) { this.sql = sql; }
  find(id) { return this.sql.exec("SELECT * FROM rss_cookie_grants WHERE id = ?", id).toArray()[0]; }
  insert({ id, script_id, script_hash, permissions_json, created_at }) {
    this.sql.exec("DELETE FROM rss_cookie_grants WHERE script_id = '' AND created_at < ?", created_at - 900000);
    this.sql.exec("INSERT INTO rss_cookie_grants (id, script_id, script_hash, permissions_json, created_at) VALUES (?, ?, ?, ?, ?)", id, script_id, script_hash, permissions_json, created_at);
  }
  bind(id, script_id) { this.sql.exec("UPDATE rss_cookie_grants SET script_id = ? WHERE id = ? AND script_id = ''", script_id, id); }
  revoke(script_id) { this.sql.exec("DELETE FROM rss_cookie_grants WHERE script_id = ?", script_id); }
}
