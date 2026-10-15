import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Keep the updater dependency-free so an old generated repository can bootstrap it.
export function parse_jsonc(source) {
  const strings_and_comments = /"(?:\\[\s\S]|[^"\\])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g;
  const without_comments = source.replace(strings_and_comments, token => token.startsWith('"') ? token : " ");
  const without_trailing_commas = without_comments.replace(/"(?:\\[\s\S]|[^"\\])*"|,(?=\s*[}\]])/g,
    token => token === "," ? "" : token);
  const config = JSON.parse(without_trailing_commas.replace(/^\uFEFF/, ""));
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Wrangler 配置必须是对象");
  return config;
}

export function merge_deployment_config(upstream, local) {
  const merged = structuredClone(upstream);
  // Application settings (assets, aliases, exports/migrations, etc.) follow upstream.
  for (const key of ["name", "account_id", "route", "routes", "zone_id", "workers_dev", "preview_urls"]) {
    if (Object.hasOwn(local, key)) merged[key] = local[key];
  }
  if (Object.hasOwn(local, "route")) delete merged.routes;
  if (Object.hasOwn(local, "routes")) delete merged.route;
  if (local.vars) merged.vars = { ...upstream.vars, ...local.vars };
  if (upstream.r2_buckets) {
    merged.r2_buckets = upstream.r2_buckets.map(binding => {
      const existing = local.r2_buckets?.find(item => item.binding === binding.binding);
      return { ...binding, ...existing };
    });
  }
  if (upstream.durable_objects?.bindings) {
    merged.durable_objects.bindings = upstream.durable_objects.bindings.map(binding => {
      const existing = local.durable_objects?.bindings?.find(item => item.name === binding.name);
      const preserved = {};
      for (const key of ["script_name", "environment"]) {
        if (existing && Object.hasOwn(existing, key)) preserved[key] = existing[key];
      }
      return { ...binding, ...preserved };
    });
  }
  if (local.env) {
    merged.env ??= {};
    for (const [name, config] of Object.entries(local.env)) {
      // Keep custom environments not defined upstream, including their bindings.
      merged.env[name] = merge_deployment_config({ ...config, ...upstream.env?.[name] }, config);
    }
  }
  return merged;
}

export function sync_upstream({ root = process.cwd(), upstream_ref }) {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (git("status", "--porcelain").trim()) throw new Error("工作目录不干净，已停止更新");
  const upstream_sha = git("rev-parse", "--verify", `${upstream_ref}^{commit}`).trim();
  const config_path = resolve(root, "wrangler.jsonc");
  const local = parse_jsonc(readFileSync(config_path, "utf8"));
  if (typeof local.name !== "string" || !local.name.trim()) throw new Error("缺少现有 Worker 名称，已停止更新");
  const upstream_source = git("show", `${upstream_sha}:wrangler.jsonc`);
  const upstream = parse_jsonc(upstream_source);
  const merged = merge_deployment_config(upstream, local);
  // Restore a snapshot rather than merging unrelated histories. Keep workflow files:
  // GITHUB_TOKEN cannot update them, and users may have their own automation.
  git("restore", "--source", upstream_sha, "--staged", "--worktree", "--", ".", ":(exclude).github/workflows/**");
  const config_source = JSON.stringify(merged) === JSON.stringify(upstream)
    ? upstream_source : JSON.stringify(merged, null, 2) + "\n";
  writeFileSync(config_path, config_source);
  git("add", "--", "wrangler.jsonc");
  const changed = !!git("diff", "--cached", "--name-only").trim();
  return { changed, upstream_sha };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (!process.argv[2]) throw new Error("用法：node sync_upstream.mjs <upstream commit>");
    const result = sync_upstream({ upstream_ref: process.argv[2] });
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `changed=${result.changed}\nupstream_sha=${result.upstream_sha}\n`);
    }
    console.log(result.changed ? `已准备 FindRSS 更新：${result.upstream_sha}` : "当前已是最新版本");
  } catch (error) {
    console.error(`更新失败：${error.message}`);
    process.exitCode = 1;
  }
}
