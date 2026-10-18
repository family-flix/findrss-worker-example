export class RepositoryScriptRelease {
  constructor({ sql }) { this.sql = sql; }
  list(script_id) {
    return this.sql.exec("SELECT id, script_id, version, script_hash, bytes, created_at FROM script_releases WHERE script_id = ? ORDER BY created_at DESC, id DESC", script_id).toArray();
  }
  references(script_id) {
    return this.sql.exec("SELECT metadata_json FROM script_releases WHERE script_id = ?", script_id).toArray();
  }
  find(script_id, id) {
    return this.sql.exec("SELECT * FROM script_releases WHERE script_id = ? AND id = ?", script_id, id).toArray()[0];
  }
  find_version(script_id, version) {
    return this.sql.exec("SELECT * FROM script_releases WHERE script_id = ? AND version = ?", script_id, version).toArray()[0];
  }
  insert(row) {
    this.sql.exec("INSERT INTO script_releases (id, script_id, version, script_hash, bytes, script, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      row.id, row.script_id, row.version, row.script_hash, row.bytes, row.script, row.metadata_json, row.created_at);
  }
  event({ script_id, action, from_id = "", to_id, created_at }) {
    this.sql.exec("INSERT INTO script_release_events (id, script_id, action, from_id, to_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      crypto.randomUUID(), script_id, action, from_id, to_id, created_at);
  }
  events(script_id) {
    return this.sql.exec("SELECT * FROM script_release_events WHERE script_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 100", script_id).toArray();
  }
  delete_for_script(script_id) {
    this.sql.exec("DELETE FROM script_releases WHERE script_id = ?", script_id);
    this.sql.exec("DELETE FROM script_release_events WHERE script_id = ?", script_id);
  }
}
