export class RepositoryStatistics {
  constructor({ sql }) {
    this.sql = sql;
  }

  sources() {
    return this.sql.exec(`SELECT d.id, d.title, d.feed_url, d.enabled, d.source_type, d.category, d.tags_json,
      COALESCE(c.call_count, 0) AS call_count FROM discovery_sources d
      LEFT JOIN discovery_source_calls c ON c.source_id = d.id ORDER BY call_count DESC, d.title, d.id`).toArray();
  }

  scripts() {
    return this.sql.exec("SELECT route, path, metadata_json, enabled FROM scripts").toArray();
  }

  record_calls(source_ids) {
    if (!source_ids.length) return;
    this.sql.exec(`INSERT INTO discovery_source_calls (source_id, call_count)
      SELECT id, 1 FROM discovery_sources WHERE enabled = 1 AND id IN (${source_ids.map(() => "?").join(",")})
      ON CONFLICT(source_id) DO UPDATE SET call_count = call_count + 1`, ...source_ids);
  }
}
