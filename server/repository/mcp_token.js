export class RepositoryMcpToken {
  constructor({ sql }) { this.sql = sql; }
  list(now) {
    return this.sql.exec(`SELECT * FROM mcp_tokens
      ORDER BY (revoked_at IS NULL AND expires_at > ?) DESC, created_at DESC, id DESC LIMIT 200`, now).toArray();
  }
  find(id) { return this.sql.exec("SELECT * FROM mcp_tokens WHERE id = ?", id).toArray()[0]; }
  find_by_hash(hash) { return this.sql.exec("SELECT * FROM mcp_tokens WHERE token_hash = ?", hash).toArray()[0]; }
  count_active(now) {
    return Number(this.sql.exec("SELECT COUNT(*) AS count FROM mcp_tokens WHERE revoked_at IS NULL AND expires_at > ?", now).toArray()[0].count);
  }
  insert(row) {
    this.sql.exec(`INSERT INTO mcp_tokens (id, name, token_hash, token_hint, scopes_json, resource, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, row.id, row.name, row.token_hash, row.token_hint, row.scopes_json, row.resource, row.created_at, row.expires_at);
  }
  revoke(id, now) { this.sql.exec("UPDATE mcp_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?", now, id); }
  set_last_used(id, now) { this.sql.exec("UPDATE mcp_tokens SET last_used_at = ? WHERE id = ?", now, id); }
  record_call(id, tool_name, status, now) {
    this.sql.exec("INSERT INTO mcp_calls (token_id, tool_name, status, created_at) VALUES (?, ?, ?, ?)", id, tool_name, status, now);
    this.sql.exec("DELETE FROM mcp_calls WHERE id < (SELECT id FROM mcp_calls ORDER BY id DESC LIMIT 1 OFFSET 999)");
  }
  calls(id) { return this.sql.exec("SELECT tool_name, status, created_at FROM mcp_calls WHERE token_id = ? ORDER BY id DESC LIMIT 50", id).toArray(); }
}
