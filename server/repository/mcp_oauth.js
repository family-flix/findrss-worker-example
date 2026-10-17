export class RepositoryMcpOauth {
  constructor({ sql, transaction }) { this.sql = sql; this.transaction = transaction; }
  client(id, resource) { return this.sql.exec("SELECT * FROM mcp_oauth_clients WHERE id = ? AND resource = ?", id, resource).toArray()[0]; }
  register(row) {
    this.sql.exec("INSERT INTO mcp_oauth_clients (id, resource, metadata_json, created_at) VALUES (?, ?, ?, ?)", row.id, row.resource, row.metadata_json, row.created_at);
  }
  client_count() { return this.sql.exec("SELECT COUNT(*) AS count FROM mcp_oauth_clients").toArray()[0].count; }
  prune(now) { this.sql.exec("DELETE FROM mcp_oauth_requests WHERE expires_at <= ?", now); }
  pending_count() { return this.sql.exec("SELECT COUNT(*) AS count FROM mcp_oauth_requests").toArray()[0].count; }
  request(id, resource) { return this.sql.exec("SELECT * FROM mcp_oauth_requests WHERE id = ? AND resource = ?", id, resource).toArray()[0]; }
  request_by_code(hash) { return this.sql.exec("SELECT * FROM mcp_oauth_requests WHERE code_hash = ?", hash).toArray()[0]; }
  insert_request(row) {
    this.sql.exec(`INSERT INTO mcp_oauth_requests
      (id, resource, client_id, redirect_uri, state, scopes_json, code_challenge, status, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`, row.id, row.resource, row.client_id, row.redirect_uri, row.state, row.scopes_json, row.code_challenge, row.created_at, row.expires_at);
  }
  decide(id, status, code_hash, scopes_json, expires_at) {
    this.sql.exec("UPDATE mcp_oauth_requests SET status = ?, code_hash = ?, scopes_json = ?, expires_at = ? WHERE id = ?", status, code_hash, scopes_json, expires_at, id);
  }
  consume(id) { this.sql.exec("UPDATE mcp_oauth_requests SET status = 'used' WHERE id = ?", id); }
  credential(hash, kind) {
    const column = kind === "refresh" ? "refresh_hash" : "access_hash";
    return this.sql.exec(`SELECT * FROM mcp_oauth_credentials WHERE ${column} = ?`, hash).toArray()[0];
  }
  insert_credential(row) {
    this.sql.exec(`INSERT INTO mcp_oauth_credentials
      (id, grant_id, access_hash, refresh_hash, access_expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    row.id, row.grant_id, row.access_hash, row.refresh_hash, row.access_expires_at, row.created_at);
  }
  use_credential(id, now) { this.sql.exec("UPDATE mcp_oauth_credentials SET used_at = ? WHERE id = ?", now, id); }
  grant_client(id) { return this.sql.exec("SELECT client_id FROM mcp_oauth_grants WHERE id = ?", id).toArray()[0]?.client_id; }
  insert_grant(id, client_id) { this.sql.exec("INSERT INTO mcp_oauth_grants (id, client_id) VALUES (?, ?)", id, client_id); }
}
