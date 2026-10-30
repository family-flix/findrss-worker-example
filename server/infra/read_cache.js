const namespaces = new WeakMap();
export class ReadCache {
  constructor(namespace, wait_until) {
    this.namespace = namespace;
    this.wait_until = wait_until;
    if (namespace && !namespaces.has(namespace)) namespaces.set(namespace, new Map());
    this.local = namespace ? namespaces.get(namespace) : new Map();
  }
  remember(key, value) {
    if (this.local.size >= 128) this.local.delete(this.local.keys().next().value);
    this.local.set(key, {
      value: structuredClone(value),
      expires: Date.now() + 15000
    });
  }
  async read(key, load) {
    const hit = this.local.get(key);
    if (hit && hit.expires > Date.now()) return structuredClone(hit.value);
    let value;
    try {
      value = await this.namespace?.get('read:v1:' + key, 'json');
    } catch (error) {
      console.warn('KV 读取失败，回源 D1', error.message);
    }
    if (value === null || value === undefined) {
      value = await load();
      this.wait_until(this.put(key, value));
    }
    this.remember(key, value);
    return structuredClone(value);
  }
  async put(key, value) {
    value = await value;
    this.remember(key, value);
    try {
      await this.namespace?.put('read:v1:' + key, JSON.stringify(value), {
        expirationTtl: 300
      });
    } catch (error) {
      console.warn('KV 更新失败，将在缓存过期后回源 D1', error.message);
    }
  }
}
