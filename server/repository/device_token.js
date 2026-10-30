export class RepositoryDeviceToken {
  constructor({
    sql
  }) {
    this.sql = sql;
  }
  async list() {
    return (await this.sql.exec("SELECT * FROM device_tokens ORDER BY created_at DESC, id")).toArray();
  }
  async find(id) {
    return (await this.sql.exec("SELECT * FROM device_tokens WHERE id = ?", id)).toArray()[0];
  }
  async find_by_hash(hash) {
    return (await this.sql.exec("SELECT * FROM device_tokens WHERE token_hash = ?", hash)).toArray()[0];
  }
  async count() {
    return Number((await this.sql.exec("SELECT COUNT(*) AS count FROM device_tokens WHERE revoked_at IS NULL")).toArray()[0].count);
  }
  async min_expires_at(now) {
    return (await this.sql.exec("SELECT MIN(expires_at) AS expires_at FROM device_tokens WHERE revoked_at IS NULL AND expires_at > ?", now)).toArray()[0]?.expires_at ?? null;
  }
  async insert(row) {
    await this.sql.exec(`INSERT INTO device_tokens
      (id, name, note, token_hash, token_hint, encrypted_token, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, row.id, row.name, row.note, row.token_hash, row.token_hint, row.encrypted_token, row.created_at, row.expires_at);
  }
  async set_last_used(id, now) {
    await this.sql.exec("UPDATE device_tokens SET last_used_at = ? WHERE id = ? AND (last_used_at IS NULL OR last_used_at <= ?)", now, id, now - 300000);
  }
  async revoke(id, now) {
    await this.sql.exec("UPDATE device_tokens SET revoked_at = ?, encrypted_token = '' WHERE id = ?", now, id);
  }
  async update_note(id, note) {
    await this.sql.exec("UPDATE device_tokens SET note = ? WHERE id = ?", note, id);
  }
}
