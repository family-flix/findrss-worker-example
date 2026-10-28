export class RepositoryDetection {
  constructor({ sql }) { this.sql = sql; }
  list() { return this.sql.exec(`SELECT d.*, COALESCE(r.status,'pending') AS status, COALESCE(r.change_count,0) AS change_count,
    COALESCE(r.match_count,0) AS match_count FROM detections d LEFT JOIN detection_runs r ON r.id=d.last_run_id ORDER BY d.created_at DESC, d.id LIMIT 100`).toArray(); }
  count() { return Number(this.sql.exec("SELECT COUNT(*) AS count FROM detections").toArray()[0].count); }
  find(id) { return this.sql.exec("SELECT d.*,r.status,r.change_count,r.match_count FROM detections d LEFT JOIN detection_runs r ON r.id=d.last_run_id WHERE d.id=?", id).toArray()[0]; }
  insert(row) { this.sql.exec(`INSERT INTO detections(id,title,script_id,script_url,enabled,poll_policy_json,poll_updated_at,config_version,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`, row.id, row.title, row.script_id, row.script_url, row.enabled, row.poll_policy_json, 0, row.config_version, row.created_at); }
  update(row) { this.sql.exec(`UPDATE detections SET title=?,script_id=?,script_url=?,enabled=?,poll_policy_json=?,poll_updated_at=?,config_version=?,baseline_id=?,error='' WHERE id=?`,
    row.title, row.script_id, row.script_url, row.enabled, row.poll_policy_json, row.poll_updated_at, row.config_version, row.baseline_id, row.id); }
  attempt(id, now) { this.sql.exec("UPDATE detections SET attempted_at=? WHERE id=?", now, id); }
  save(row) { this.sql.exec(`UPDATE detections SET baseline_id=?,last_run_id=?,saved_at=?,error=?,adaptive_interval=? WHERE id=?`,
    row.baseline_id, row.last_run_id, row.saved_at, row.error || "", row.adaptive_interval || 0, row.id); }
  insert_run(row) { this.sql.exec(`INSERT INTO detection_runs(id,detection_id,status,observed_at,previous_id,object_key,body_json,change_count,match_count,error)
    VALUES(?,?,?,?,?,?,?,?,?,?)`, row.id, row.detection_id, row.status, row.observed_at, row.previous_id || "", row.object_key || "", row.body_json || "", row.change_count || 0, row.match_count || 0, row.error || ""); }
  runs(id) { return this.sql.exec(`SELECT id,status,observed_at,previous_id,change_count,match_count,error FROM detection_runs
    WHERE detection_id=? ORDER BY observed_at DESC,id DESC LIMIT 20`, id).toArray(); }
  run(id, run_id) { return this.sql.exec("SELECT * FROM detection_runs WHERE detection_id=? AND id=?", id, run_id).toArray()[0]; }
  expired(id, baseline_id) { return this.sql.exec(`SELECT id,object_key FROM detection_runs WHERE detection_id=? AND id<>?
    AND id NOT IN (SELECT id FROM detection_runs WHERE detection_id=? ORDER BY observed_at DESC,id DESC LIMIT 20)`, id, baseline_id, id).toArray(); }
  delete_run(id) { this.sql.exec("DELETE FROM detection_runs WHERE id=?", id); }
  objects(id) { return this.sql.exec("SELECT object_key FROM detection_runs WHERE detection_id=? AND object_key<>''", id).toArray(); }
  delete(id) { this.sql.exec("DELETE FROM detection_runs WHERE detection_id=?", id); this.sql.exec("DELETE FROM detections WHERE id=?", id); }
}
