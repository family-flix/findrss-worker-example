import { ScriptModel } from "../domain/script.js";
import { discovery_platform_id, script_platform } from "../lib/discovery_platform.js";

export class RepositoryPlatform {
  constructor({ sql }) { this.sql = sql; }

  list() {
    return this.sql.exec("SELECT id, name, icon FROM platforms ORDER BY created_at, id").toArray();
  }

  collect(metadata, now = Date.now(), { if_absent = false } = {}) {
    const platforms = new Map();
    for (const route of metadata.routes || [metadata]) {
      const platform = script_platform(route.platform ?? metadata.platform);
      const id = discovery_platform_id(platform);
      platforms.set(id, { ...platform, icon: platform.icon || platforms.get(id)?.icon || "" });
    }
    for (const [id, platform] of platforms) {
      this.sql.exec(if_absent
        ? `INSERT OR IGNORE INTO platforms (id, name, icon, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
        : `INSERT INTO platforms (id, name, icon, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name,
             icon = CASE WHEN excluded.icon <> '' THEN excluded.icon ELSE platforms.icon END,
             updated_at = excluded.updated_at`,
        id, platform.name, platform.icon, now, now);
    }
  }

  import_published(rows) {
    for (const row of [...rows].sort((a, b) => Number(b.updated_at || 0) - Number(a.updated_at || 0))) {
      const script = ScriptModel.fromRow(row);
      if (script.status === "published") this.collect(script, Number(row.updated_at || row.created_at || 0), { if_absent: true });
    }
  }
}
