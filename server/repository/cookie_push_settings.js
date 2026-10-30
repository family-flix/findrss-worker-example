export class RepositoryCookiePushSettings {
  constructor({
    sql
  }) {
    this.sql = sql;
  }
  async get() {
    return (await this.sql.exec("SELECT uuid, encrypted_key, updated_at FROM cookie_push_settings WHERE id = 1")).toArray()[0];
  }
  async put(uuid, encrypted_key, now) {
    await this.sql.exec(`INSERT INTO cookie_push_settings(id, uuid, encrypted_key, updated_at) VALUES(1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET uuid = excluded.uuid, encrypted_key = excluded.encrypted_key, updated_at = excluded.updated_at`, uuid, encrypted_key, now);
  }
}
