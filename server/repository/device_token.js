export class RepositoryDeviceToken {
  constructor({ sql }) { this.sql = sql; }
  list() { return this.sql.exec("SELECT * FROM device_tokens ORDER BY created_at DESC, id").toArray(); }
  find(id) { return this.sql.exec("SELECT * FROM device_tokens WHERE id = ?", id).toArray()[0]; }
  find_by_hash(hash) { return this.sql.exec("SELECT * FROM device_tokens WHERE token_hash = ?", hash).toArray()[0]; }
  count() { return Number(this.sql.exec("SELECT COUNT(*) AS count FROM device_tokens WHERE revoked_at IS NULL").toArray()[0].count); }
  min_expires_at(now) {
    return this.sql.exec("SELECT MIN(expires_at) AS expires_at FROM device_tokens WHERE revoked_at IS NULL AND expires_at > ?", now).toArray()[0]?.expires_at ?? null;
  }
  insert(row) {
    this.sql.exec(`INSERT INTO device_tokens
      (id, name, note, token_hash, token_hint, encrypted_token, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, row.id, row.name, row.note, row.token_hash,
    row.token_hint, row.encrypted_token, row.created_at, row.expires_at);
  }
  set_last_used(id, now) { this.sql.exec("UPDATE device_tokens SET last_used_at = ? WHERE id = ?", now, id); }
  revoke(id, now) { this.sql.exec("UPDATE device_tokens SET revoked_at = ?, encrypted_token = '' WHERE id = ?", now, id); }
  update_note(id, note) { this.sql.exec("UPDATE device_tokens SET note = ? WHERE id = ?", note, id); }
}
