// 草稿只在当前 DO 内短期保留，既不发布路由，也不进入公开响应缓存。
export class ScriptPreviewAssets {
  constructor({ ttl_ms = 15 * 60 * 1000, max_entries = 16, now = Date.now } = {}) {
    this.ttl_ms = ttl_ms;
    this.max_entries = max_entries;
    this.now = now;
    this.entries = new Map();
  }

  prune() {
    for (const [id, entry] of this.entries) {
      if (entry.expires_at <= this.now()) this.entries.delete(id);
    }
  }

  create(snapshot) {
    const paths = snapshot.metadata.routes.filter(route => route.allowed_hosts?.length).map(route => route.path);
    if (!paths.length || !snapshot.public_origin) return null;
    this.prune();
    while (this.entries.size >= this.max_entries) this.entries.delete(this.entries.keys().next().value);
    const id = crypto.randomUUID();
    const expires_at = this.now() + this.ttl_ms;
    this.entries.set(id, { ...snapshot, expires_at });
    const endpoint = "/admin/api/scripts/preview-assets/" + id;
    return { endpoint, ...(snapshot.media ? { media_url: endpoint + "?media=1" } : {}),
      public_origin: snapshot.public_origin, paths, expires_at };
  }

  get(id) {
    this.prune();
    return this.entries.get(id) || null;
  }
}
