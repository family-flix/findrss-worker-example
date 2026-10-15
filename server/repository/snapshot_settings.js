export class RepositorySnapshotSettings {
  constructor({ sql }) { this.sql = sql; }
  get() { return this.sql.exec("SELECT policy_json, updated_at FROM snapshot_settings WHERE id = 1").toArray()[0]; }
  put(policy, now) {
    this.sql.exec(`INSERT INTO snapshot_settings(id, policy_json, updated_at) VALUES(1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET policy_json = excluded.policy_json, updated_at = excluded.updated_at`, JSON.stringify(policy), now);
  }
}
