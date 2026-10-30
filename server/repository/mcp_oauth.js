export class RepositoryMcpOauth {
  constructor({
    sql,
    transaction
  }) {
    this.sql = sql;
    this.transaction = transaction;
  }
  async client(id, resource) {
    return (await this.sql.exec("SELECT * FROM mcp_oauth_clients WHERE id = ? AND resource = ?", id, resource)).toArray()[0];
  }
  async register(row) {
    await this.sql.exec("INSERT INTO mcp_oauth_clients (id, resource, metadata_json, created_at) VALUES (?, ?, ?, ?)", row.id, row.resource, row.metadata_json, row.created_at);
  }
  async client_count() {
    return (await this.sql.exec("SELECT COUNT(*) AS count FROM mcp_oauth_clients")).toArray()[0].count;
  }
  async prune(now) {
    await this.sql.exec("DELETE FROM mcp_oauth_requests WHERE expires_at <= ?", now);
  }
  async pending_count() {
    return (await this.sql.exec("SELECT COUNT(*) AS count FROM mcp_oauth_requests")).toArray()[0].count;
  }
  async request(id, resource) {
    return (await this.sql.exec("SELECT * FROM mcp_oauth_requests WHERE id = ? AND resource = ?", id, resource)).toArray()[0];
  }
  async request_by_code(hash) {
    return (await this.sql.exec("SELECT * FROM mcp_oauth_requests WHERE code_hash = ?", hash)).toArray()[0];
  }
  async insert_request(row) {
    await this.sql.exec(`INSERT INTO mcp_oauth_requests
      (id, resource, client_id, redirect_uri, state, scopes_json, code_challenge, status, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`, row.id, row.resource, row.client_id, row.redirect_uri, row.state, row.scopes_json, row.code_challenge, row.created_at, row.expires_at);
  }
  async decide(id, status, code_hash, scopes_json, expires_at) {
    await this.sql.exec("UPDATE mcp_oauth_requests SET status = ?, code_hash = ?, scopes_json = ?, expires_at = ? WHERE id = ?", status, code_hash, scopes_json, expires_at, id);
  }
  async consume(id) {
    await this.sql.exec("UPDATE mcp_oauth_requests SET status = 'used' WHERE id = ?", id);
  }
  async credential(hash, kind) {
    const column = kind === "refresh" ? "refresh_hash" : "access_hash";
    return (await this.sql.exec(`SELECT * FROM mcp_oauth_credentials WHERE ${column} = ?`, hash)).toArray()[0];
  }
  async insert_credential(row) {
    await this.sql.exec(`INSERT INTO mcp_oauth_credentials
      (id, grant_id, access_hash, refresh_hash, access_expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`, row.id, row.grant_id, row.access_hash, row.refresh_hash, row.access_expires_at, row.created_at);
  }
  async use_credential(id, now) {
    await this.sql.exec("UPDATE mcp_oauth_credentials SET used_at = ? WHERE id = ?", now, id);
  }
  async grant_client(id) {
    return (await this.sql.exec("SELECT client_id FROM mcp_oauth_grants WHERE id = ?", id)).toArray()[0]?.client_id;
  }
  async insert_grant(id, client_id) {
    await this.sql.exec("INSERT INTO mcp_oauth_grants (id, client_id) VALUES (?, ?)", id, client_id);
  }
}
