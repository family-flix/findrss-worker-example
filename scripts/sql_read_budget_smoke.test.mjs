import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

// Real Workers SQL counters, isolated in-memory SQLite. This measures rows
// scanned rather than estimating cost from returned rows or query count.
test("统计冷启动、任务列表、快照目录发布及清理的实际 SQL 读取行数", { timeout: 120000 }, async t => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const source = await readFile(new URL("../server/durable_object.js", import.meta.url), "utf8");
  const start = source.indexOf('    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS api_schema_version');
  const end = source.indexOf("    /** 纯 SQL 存储层", start);
  assert.ok(start > 0 && end > start);
  const bootstrap = source.slice(start, end).replaceAll("this.ctx", "ctx");
  const scripts_source = await readFile(new URL("../server/service/durable_object/scripts.js", import.meta.url), "utf8");
  const prune = scripts_source.slice(scripts_source.indexOf("  async prune_script_objects()"), scripts_source.indexOf("  async get_script("));
  const contents = `
    import { DurableObject } from "cloudflare:workers";
    import { API_SCHEMA_SQL, API_SCHEMA_VERSION, migrate_script_tables } from "./server/repository/schema.js";
    import { ScriptModel } from "./server/domain/script.js";
    import { RepositoryDiscoverySource } from "./server/repository/discovery_source.js";
    import { RepositoryRssRouteCache } from "./server/repository/rss_route_cache.js";
    import { RepositoryBackgroundTasks } from "./server/repository/background_tasks.js";
    import { RepositoryStatistics } from "./server/repository/statistics.js";
    import { RepositoryPlatform } from "./server/repository/platform.js";
    import { RepositoryTag } from "./server/repository/tag.js";
    import { RepositoryScript } from "./server/repository/script.js";
    import { RepositoryCall } from "./server/repository/call.js";
    import { RepositoryScriptRelease } from "./server/repository/script_release.js";
    import { ScriptSourceStore } from "./server/infra/script_source_store.js";
    import { ServiceDiscovery } from "./server/service/durable_object/discovery.js";
    function bootstrap(ctx) { ${bootstrap} }
    class ScriptMaintenance { ${prune} }
    export class ReadBudget extends DurableObject {
      async fetch(request) {
        const count = Number(new URL(request.url).searchParams.get("sources")) || 100;
        const native = this.ctx.storage.sql;
        const cursors = [];
        const sql = { exec(query, ...args) { const cursor = native.exec(query, ...args); cursors.push({ query, cursor }); return cursor; } };
        const ctx = { storage: { sql, transactionSync: callback => this.ctx.storage.transactionSync(callback) } };
        bootstrap(ctx);
        const seed = (query, size) => native.exec("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?) " + query, size);
        seed("INSERT INTO discovery_sources(id,title,feed_url,category,created_at,updated_at) SELECT 'source-'||i,'Source '||i,'https://example.com/feed/'||i,'',i,i FROM n", count);
        seed("INSERT INTO discovery_source_snapshots(source_id,feed_url,articles_json,saved_at,attempted_at) SELECT 'source-'||i,'https://example.com/feed/'||i,'[]',1,1 FROM n", count);
        seed("INSERT INTO scripts(route,title,path,metadata_json,script,enabled,created_at,updated_at) SELECT 'script-'||i,'Script '||i,'/route/'||i,json_object('status','published','path','/route','version','1.0.0'),'',1,i,i FROM n", 20);
        seed("INSERT INTO access_tokens(id,user_id,name,token_hash,token_hint,created_at,expires_at) SELECT 'token-'||i,'token-'||i,'Token '||i,'hash-'||i,'hint',1,9999999999999 FROM n", 5);
        seed("INSERT INTO calls(id,method,publisher_device_id,args_json,status,created_at,updated_at,completed_at) SELECT 'call-'||i,'test','device','{}','completed',i,i,i FROM n", 10000);
        seed("INSERT INTO background_tasks(id,kind,title,target,source_id,status,started_at) SELECT 'task-'||i,'snapshot','Snapshot','target','source-'||i,'completed',i FROM n", 100);
        seed("INSERT INTO rss_route_cache(key,output_json,invoked,expires_at,created_at) SELECT 'public-snapshot:'||i,'{}',0,9999999999999,i FROM n", count);
        const reports = [];
        function record(label) {
          const queries = cursors.map(({query,cursor}) => ({ query: query.replace(/\\s+/g,' ').trim().slice(0,180), rows_read: cursor.rowsRead, rows_written: cursor.rowsWritten }));
          reports.push({ label, rows_read: queries.reduce((sum,item) => sum + item.rows_read,0), queries: queries.length,
            expensive: queries.sort((a,b) => b.rows_read - a.rows_read).slice(0,4) });
        }
        function measure(label, run) { cursors.length = 0; run(); record(label); }
        async function measure_async(label, run) { cursors.length = 0; await run(); record(label); }
        const repo = { discovery: new RepositoryDiscoverySource({sql}), platforms: new RepositoryPlatform({sql}), tags: new RepositoryTag({sql}) };
        const discovery = new ServiceDiscovery({repo});
        const tasks = new RepositoryBackgroundTasks({sql});
        measure('constructor_schema_replay', () => bootstrap(ctx));
        measure('startup_script_scan', () => new RepositoryScript({sql}).list());
        measure('background_tasks_list', () => tasks.list());
        measure('background_tasks_for_source', () => tasks.running_for_sources(['source-1']));
        measure('background_task_insert', () => tasks.insert({id:'new-task',kind:'snapshot',title:'Refresh',target:'target',source_id:'source-1',started_at:101}));
        measure('public_catalog_once', () => discovery.public_catalog());
        const catalog_state = new Map();
        const catalog = new ServiceDiscovery({repo,
          storage:{get:async key=>catalog_state.get(key),put:async(key,value)=>catalog_state.set(key,value),delete:async key=>catalog_state.delete(key)},
          object_store:{head:async()=>true,put:async()=>{},delete:async()=>{}},render_catalog:JSON.stringify,schedule_alarm:async()=>{} });
        await measure_async('public_catalog_per_source', async () => {
          for(let i=0;i<count;i++) await catalog.defer_catalog();
          catalog.catalog_retry_at = 0;
          catalog_state.set('discovery_catalog_due_at',0);
          await catalog.ensure_catalog();
        });
        measure('scheduler_1000_calls', () => { for(let i=0;i<1000;i++) repo.discovery.snapshot_schedule(); });
        measure('calls_status_summary', () => new RepositoryCall({sql}).count_by_status());
        measure('statistics_core_queries', () => {
          const stats = new RepositoryStatistics({sql});
          stats.sources(); stats.scripts(); new RepositoryCall({sql}).count_by_status();
        });
        measure('cache_cleanup', () => new RepositoryRssRouteCache({sql}).delete_expired(100));
        seed("INSERT INTO rss_route_cache_chunks(key,chunk_index,body) SELECT 'public-snapshot:'||i,0,'{}' FROM n", count);
        measure('cache_cleanup_with_legacy_chunks', () => new RepositoryRssRouteCache({sql}).delete_expired(100));
        measure('startup_platform_tag_import', () => {
          const scripts = new RepositoryScript({sql}).list();
          repo.platforms.import_published(scripts); repo.tags.import_published(scripts);
        });
        seed("INSERT INTO script_releases(id,script_id,version,script_hash,bytes,script,metadata_json,created_at) SELECT 'release-'||i,'script-1','1.0.'||i,'hash-'||i,10,'',json_object('source_ref',json_object('key','scripts/script-1/1.0.'||i||'.js')),i FROM n",100);
        const maintenance = new ScriptMaintenance();
        maintenance.repo = { scripts: new RepositoryScript({sql}), script_releases: new RepositoryScriptRelease({sql}) };
        maintenance.prune_index = 19;
        maintenance.source_store = new ScriptSourceStore({ available:true,
          async list() { return { truncated:false, objects:Array.from({length:100},(_,index)=>({key:'scripts/script-1/1.0.'+(index+1)+'.js',uploaded:'2000-01-01T00:00:00Z'})) }; },
          async delete() { throw new Error('Referenced versions must not be removed'); } });
        await measure_async('script_cleanup_100_retained_versions', () => maintenance.prune_script_objects());
        native.exec('CREATE TABLE tasks AS SELECT id,method AS kind,publisher_device_id AS publisher_id,target_device_id AS target_client_id,idempotency_key,args_json AS payload_json,status,assigned_device_id AS assigned_client_id,lease_token,lease_expires_at,attempt_count,result_json,error_message,created_at,updated_at,completed_at FROM calls');
        measure('constructor_replay_with_10000_legacy_tasks', () => bootstrap(ctx));
        native.exec("DELETE FROM calls WHERE id IN ('call-1','call-2')");
        native.exec('DELETE FROM call_status_counts');
        native.exec('DELETE FROM api_schema_version');
        measure('legacy_migration_first_run', () => bootstrap(ctx));
        if(native.exec("SELECT COUNT(*) AS count FROM calls").toArray()[0].count!==10000) throw new Error('Legacy tasks not imported');
        measure('legacy_migration_second_run', () => bootstrap(ctx));
        const actual = native.exec('SELECT status,COUNT(*) AS count FROM calls GROUP BY status ORDER BY status').toArray();
        if(JSON.stringify(actual)!==JSON.stringify(new RepositoryCall({sql}).count_by_status())) throw new Error('Migrated task counts mismatch');
        return Response.json({ sources:count, reports });
      }
    }
    export default { fetch(request,env) { return env.BENCH.getByName('count-'+new URL(request.url).searchParams.get('sources')).fetch(request); } };
  `;
  const bundle = await build({ stdin: { contents, resolveDir: root }, bundle: true, write: false, format: "esm", platform: "neutral", mainFields: ["browser", "module", "main"],
    external: ["cloudflare:workers"], loader: { ".svg": "text", ".css": "text", ".wasm": "binary" } });
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-05-03",
    durableObjects: { BENCH: { className: "ReadBudget", useSQLite: true } } }));
  t.after(() => mf.dispose());
  for (const count of [100, 1000]) {
    const response = await mf.dispatchFetch("https://benchmark.invalid/?sources=" + count);
    assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json();
    console.log(JSON.stringify(result));
    const reads = label => result.reports.find(report => report.label === label).rows_read;
    assert.ok(reads("public_catalog_once") > 0);
    assert.ok(reads("public_catalog_per_source") <= reads("public_catalog_once") + 10);
    assert.ok(reads("calls_status_summary") <= 5);
    assert.ok(reads("constructor_schema_replay") <= 2);
    assert.ok(reads("constructor_replay_with_10000_legacy_tasks") <= 2);
    assert.ok(reads("legacy_migration_second_run") <= 2);
    assert.ok(reads("script_cleanup_100_retained_versions") < 200);
    assert.ok(reads("background_task_insert") < 150);
    assert.ok(reads("cache_cleanup_with_legacy_chunks") <= 2);
  }
});
