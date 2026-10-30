export class RepositoryScriptAgent {
  constructor({
    sql
  }) {
    this.sql = sql;
  }
  async get() {
    return (await this.sql.exec("SELECT base_url, model, encrypted_api_key, config_json, encrypted_keys_json FROM script_agent_settings WHERE id = 1")).toArray()[0] || {};
  }
  async put({
    base_url = "",
    model = "",
    encrypted_api_key = "",
    config_json = "",
    encrypted_keys_json = "{}"
  }) {
    await this.sql.exec(`INSERT INTO script_agent_settings(id, base_url, model, encrypted_api_key, config_json, encrypted_keys_json, updated_at) VALUES(1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET base_url = excluded.base_url, model = excluded.model,
      encrypted_api_key = excluded.encrypted_api_key, config_json = excluded.config_json,
      encrypted_keys_json = excluded.encrypted_keys_json, updated_at = excluded.updated_at`, base_url, model, encrypted_api_key, config_json, encrypted_keys_json, Date.now());
  }
}
