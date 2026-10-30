import { ScriptModel } from "../domain/script.js";
import { script_tags } from "../lib/script_tags.js";
export class RepositoryTag {
  constructor({
    sql
  }) {
    this.sql = sql;
  }
  async list() {
    return (await this.sql.exec("SELECT name FROM tags ORDER BY created_at, name")).toArray().map(row => row.name);
  }
  async collect(metadata, now = Date.now()) {
    const tags = new Set((metadata.routes || [metadata]).flatMap(route => script_tags(route.tags ?? metadata.tags)));
    for (const name of tags) {
      await this.sql.exec("INSERT OR IGNORE INTO tags (name, created_at) VALUES (?, ?)", name, now);
    }
  }
  async import_published(rows) {
    for (const row of [...rows].sort((a, b) => Number(a.updated_at || 0) - Number(b.updated_at || 0))) {
      const script = ScriptModel.fromRow(row);
      if (script.status === "published") await this.collect(script, Number(row.updated_at || row.created_at || 0));
    }
  }
}
