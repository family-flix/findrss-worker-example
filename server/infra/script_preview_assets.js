// 草稿资源短期保存在私有 R2 前缀，既不发布路由，也不进入公开响应缓存。
export class ScriptPreviewAssets {
  constructor({
    ttl_ms = 15 * 60 * 1000,
    max_entries = 16,
    now = Date.now,
    object_store = null
  } = {}) {
    this.object_store = object_store;
    this.ttl_ms = ttl_ms;
    this.max_entries = max_entries;
    this.now = now;
    this.entries = new Map();
  }
  async prune() {
    if (this.object_store?.available) {
      const objects = (await this.object_store.list({
        prefix: "previews/scripts/",
        limit: 1000
      })).objects.sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded));
      const expired = objects.filter((object, index) => index >= this.max_entries || new Date(object.uploaded).getTime() + this.ttl_ms <= this.now());
      await this.object_store.delete_many(expired.map(object => object.key), {
        best_effort: true
      });
    }
    for (const [id, entry] of this.entries) {
      if (entry.expires_at <= this.now()) this.entries.delete(id);
    }
  }
  async create(snapshot) {
    const paths = snapshot.metadata.routes.filter(route => route.allowed_hosts?.length).map(route => route.path);
    if (!paths.length || !snapshot.public_origin) return null;
    await this.prune();
    while (this.entries.size >= this.max_entries) this.entries.delete(this.entries.keys().next().value);
    const id = crypto.randomUUID();
    const expires_at = this.now() + this.ttl_ms;
    if (this.object_store?.available) {
      await this.object_store.put("previews/scripts/" + id + ".json", JSON.stringify({
        ...snapshot,
        expires_at
      }), {
        httpMetadata: {
          contentType: "application/json"
        }
      });
      await this.prune();
    } else this.entries.set(id, {
      ...snapshot,
      expires_at
    });
    const endpoint = "/admin/api/scripts/preview-assets/" + id;
    return {
      endpoint,
      ...(snapshot.media ? {
        media_url: endpoint + "?media=1"
      } : {}),
      public_origin: snapshot.public_origin,
      paths,
      expires_at
    };
  }
  async get(id) {
    if (this.object_store?.available) {
      const object = await this.object_store.get("previews/scripts/" + id + ".json");
      if (!object) return null;
      const value = JSON.parse(await object.text());
      return value.expires_at > this.now() ? value : null;
    }
    await this.prune();
    return this.entries.get(id) || null;
  }
}
