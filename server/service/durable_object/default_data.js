import { compile_script_module } from "../../infra/script_sandbox.js";
import { sha256_hex } from "../../lib/crypto.js";
import { discovery_platform_id } from "../../lib/discovery_platform.js";

export async function seed_default_data({ repo, storage, script }) {
  if (await storage.get("default_data_v1")) return;
  // 只初始化空库，已有部署和管理员清空后的数据都不补回。
  if (repo.scripts.count() || repo.discovery.count()) {
    await storage.put("default_data_v1", true);
    return;
  }
  const compiled = await compile_script_module(script);
  if (compiled.error || !compiled.metadata) throw new Error("默认脚本校验失败：" + compiled.error);
  const metadata = { ...compiled.metadata, status: "published", version: "1.0.0",
    published_version: "1.0.0", published_script: script, script_hash: await sha256_hex(script) };
  const now = Date.now();
  storage.transactionSync(() => {
    repo.scripts.insert({ route: crypto.randomUUID(), title: metadata.name, path: metadata.path,
      metadata_json: JSON.stringify(metadata), script, enabled: 1, created_at: now, updated_at: now });
    repo.platforms.collect(metadata, now);
    repo.tags.collect(metadata, now);
    repo.discovery.insert({ id: crypto.randomUUID(), title: metadata.name,
      description: metadata.description, website: "https://apps.apple.com/us/app/id408709785",
      feed_url: "{{hostname}}/rss" + metadata.example, category: "technology", tags_json: JSON.stringify(metadata.tags),
      enabled: 1, require_token: 0, credit_cost: 0, sort_order: 0,
      source_type: discovery_platform_id(metadata.platform), created_at: now, updated_at: now });
  });
  await storage.put({ default_data_v1: true, discovery_catalog_dirty: true });
}
