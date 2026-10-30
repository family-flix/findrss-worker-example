export class RepositoryWebhookSettings {
  constructor({
    sql
  }) {
    this.sql = sql;
  }
  async get() {
    return (await this.sql.exec("SELECT url, encrypted_token, template, updated_at FROM webhook_settings WHERE id = 1")).toArray()[0];
  }
  async put(url, encrypted_token, template, now) {
    await this.sql.exec(`INSERT INTO webhook_settings(id, url, encrypted_token, template, updated_at) VALUES(1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET url = excluded.url, encrypted_token = excluded.encrypted_token,
      template = excluded.template, updated_at = excluded.updated_at`, url, encrypted_token, template, now);
  }
}
