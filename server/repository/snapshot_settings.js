export class RepositorySnapshotSettings {
  constructor({ sql }) { this.sql = sql; }
  get() { return this.sql.exec("SELECT policy_json, max_concurrency, updated_at FROM snapshot_settings WHERE id = 1").toArray()[0]; }
  put(policy, now, max_concurrency) {
    this.sql.exec(`INSERT INTO snapshot_settings(id, policy_json, max_concurrency, updated_at) VALUES(1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET policy_json = excluded.policy_json, max_concurrency = excluded.max_concurrency,
      updated_at = excluded.updated_at`, JSON.stringify(policy), max_concurrency, now);
  }
}
