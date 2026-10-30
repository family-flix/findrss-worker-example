export class RepositoryMcpToken {
  constructor({
    sql
  }) {
    this.sql = sql;
  }
  async list(now) {
    return (await this.sql.exec(`SELECT * FROM mcp_tokens
      ORDER BY (revoked_at IS NULL AND expires_at > ?) DESC, created_at DESC, id DESC LIMIT 200`, now)).toArray();
  }
  async find(id) {
    return (await this.sql.exec("SELECT * FROM mcp_tokens WHERE id = ?", id)).toArray()[0];
  }
  async find_by_hash(hash) {
    return (await this.sql.exec("SELECT * FROM mcp_tokens WHERE token_hash = ?", hash)).toArray()[0];
  }
  async count_active(now) {
    return Number((await this.sql.exec("SELECT COUNT(*) AS count FROM mcp_tokens WHERE revoked_at IS NULL AND expires_at > ?", now)).toArray()[0].count);
  }
  async insert(row) {
    await this.sql.exec(`INSERT INTO mcp_tokens (id, name, token_hash, token_hint, scopes_json, resource, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, row.id, row.name, row.token_hash, row.token_hint, row.scopes_json, row.resource, row.created_at, row.expires_at);
  }
  async revoke(id, now) {
    await this.sql.exec("UPDATE mcp_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?", now, id);
  }
  async set_last_used(id, now) {
    await this.sql.exec("UPDATE mcp_tokens SET last_used_at = ? WHERE id = ? AND (last_used_at IS NULL OR last_used_at <= ?)", now, id, now - 300000);
  }
  async record_call(id, tool_name, status, now) {
    await this.sql.exec("INSERT INTO mcp_calls (token_id, tool_name, status, created_at) VALUES (?, ?, ?, ?)", id, tool_name, status, now);
    await this.sql.exec("DELETE FROM mcp_calls WHERE id < (SELECT id FROM mcp_calls ORDER BY id DESC LIMIT 1 OFFSET 999)");
  }
  async calls(id) {
    return (await this.sql.exec("SELECT tool_name, status, created_at FROM mcp_calls WHERE token_id = ? ORDER BY id DESC LIMIT 50", id)).toArray();
  }
}
