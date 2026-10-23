import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

// Real Workers SQL counters, isolated in-memory SQLite. Measure rows read and
// written (including indexes), rather than returned rows or query count.
test("统计冷启动、目录调度、设备心跳和任务流转的实际 SQL 读写行数", { timeout: 120000 }, async t => {
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
    import { RepositoryDevice } from "./server/repository/device.js";
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
          reports.push({ label, rows_read: queries.reduce((sum,item) => sum + item.rows_read,0),
            rows_written: queries.reduce((sum,item) => sum + item.rows_written,0), queries: queries.length,
            expensive: queries.sort((a,b) => b.rows_read - a.rows_read).slice(0,4) });
        }
        function measure(label, run) { cursors.length = 0; run(); record(label); }
        async function measure_async(label, run) { cursors.length = 0; await run(); record(label); }
        const repo = { discovery: new RepositoryDiscoverySource({sql}), platforms: new RepositoryPlatform({sql}), tags: new RepositoryTag({sql}) };
        const discovery = new ServiceDiscovery({repo});
        const tasks = new RepositoryBackgroundTasks({sql});
        measure('admin_source_page_20_cold', () => discovery.list_discovery_sources(new URL('https://internal/?limit=20&offset=0'), true));
        measure('admin_source_page_20_warm', () => discovery.list_discovery_sources(new URL('https://internal/?limit=20&offset=0'), true));
        measure('public_source_page_20_cold', () => discovery.list_discovery_sources(new URL('https://internal/?limit=20&offset=0'), false));
        measure('public_source_page_20_warm', () => discovery.list_discovery_sources(new URL('https://internal/?limit=20&offset=0'), false));
        measure('calls_recent_50', () => new RepositoryCall({sql}).list('', '', 50));
        measure('calls_publisher_recent_50', () => new RepositoryCall({sql}).list('device', '', 50));
        measure('constructor_schema_replay', () => bootstrap(ctx));
        measure('startup_script_scan', () => new RepositoryScript({sql}).list());
        measure('background_tasks_list', () => tasks.list());
        measure('background_tasks_for_source', () => tasks.running_for_sources(['source-1']));
        measure('background_task_insert', () => tasks.insert({id:'new-task',kind:'snapshot',title:'Refresh',target:'target',source_id:'source-1',started_at:101}));
        measure('background_1000_create_finish', () => {
          for(let i=0;i<1000;i++) {
            tasks.insert({id:'batch-'+i,kind:'snapshot',title:'Refresh',target:'target',source_id:'source-1',started_at:30000+i});
            tasks.finish('batch-'+i,'completed','',40000+i);
          }
        });
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
        seed("INSERT INTO rss_public_feeds(key,pathname,query_json,self_url) SELECT 'feed-'||i,'/feed/'||i,'[]','https://example.com/rss/feed/'||i FROM n", count);
        measure('rss_registration_existing_after_restart', () => {
          const feeds = new RepositoryRssRouteCache({sql});
          feeds.public_schedule();
          for(let i=1;i<=count;i++) {
            feeds.register_public('feed-'+i,'/feed/'+i,[],'https://example.com/rss/feed/'+i,1024);
            // serve_rss_route 紧接着 schedule_alarm，后者重新读取调度表。
            feeds.public_schedule();
          }
        });
        measure('calls_status_summary', () => new RepositoryCall({sql}).count_by_status());
        measure('statistics_core_queries', () => {
          const stats = new RepositoryStatistics({sql});
          stats.sources(); stats.scripts(); new RepositoryCall({sql}).count_by_status();
        });
        measure('cache_cleanup', () => new RepositoryRssRouteCache({sql}).delete_expired(100));
        seed("INSERT INTO rss_route_cache_chunks(key,chunk_index,body) SELECT 'public-snapshot:'||i,0,'{}' FROM n", count);
        measure('cache_cleanup_with_legacy_chunks', () => new RepositoryRssRouteCache({sql}).delete_expired(100));
        for (const name of ['calls_recent', 'calls_publisher_recent', 'discovery_sources_recent', 'discovery_sources_public_order']) native.exec('DROP INDEX ' + name);
        native.exec('UPDATE api_schema_version SET version = 2');
        measure('schema_v3_index_upgrade', () => {
          // 多语句 exec 的游标只计最后一条，单独执行新索引以统计完整建索引成本。
          for (const [query] of API_SCHEMA_SQL.matchAll(/CREATE INDEX IF NOT EXISTS (?:calls_recent|calls_publisher_recent|discovery_sources_recent|discovery_sources_public_order)\\b[^;]+;/g)) sql.exec(query);
          bootstrap(ctx);
        });
        if (native.exec("SELECT name FROM sqlite_master WHERE name IN ('calls_recent','calls_publisher_recent','discovery_sources_recent','discovery_sources_public_order')").toArray().length !== 4) throw new Error('Read indexes missing after upgrade');
        measure('schema_v3_index_upgrade_second_run', () => bootstrap(ctx));
        measure('startup_platform_tag_import', () => {
          const scripts = new RepositoryScript({sql}).list();
          repo.platforms.import_published(scripts); repo.tags.import_published(scripts);
        });
        const devices = new RepositoryDevice({sql});
        devices.upsert_connection({device_id:'device',connection_id:'connection',methods_json:'["test"]',device_name:'Device',device_os:'test',max_concurrency:1,connected_at:1000000,last_seen_at:1000000});
        native.exec('CREATE INDEX calls_access_token ON calls(access_token_id,created_at)');
        native.exec('CREATE INDEX devices_status ON devices(status,last_seen_at)');
        const calls = new RepositoryCall({sql});
        function task_lifecycle() {
          calls.insert({id:'write-task',method:'test',publisher_device_id:'publisher',access_token_id:null,credit_cost:0,target_device_id:'device',idempotency_key:null,coalesce_key:null,args_json:'{}',created_at:20000,updated_at:20000});
          calls.assign('write-task','device','lease',140001,20001);
          calls.set_running('write-task',140002,20002);
          calls.set_completed('write-task','{}',20003);
        }
        measure('task_create_to_complete_before_upgrade', task_lifecycle);
        native.exec("DELETE FROM calls WHERE id = 'write-task'");
        native.exec('DELETE FROM call_status_counts WHERE count = 0');
        measure('device_180_heartbeats_before_upgrade', () => {
          for(let i=1;i<=180;i++) sql.exec("UPDATE devices SET last_seen_at = ?,status = 'online',disconnected_at = NULL WHERE device_id = ? AND connection_id = ?",1000000+i*20000,'device','connection');
        });
        native.exec("UPDATE devices SET last_seen_at = 1000000 WHERE device_id = 'device'");
        native.exec('UPDATE api_schema_version SET version = 1');
        measure('unused_write_indexes_upgrade', () => bootstrap(ctx));
        if(native.exec("SELECT name FROM sqlite_master WHERE name IN ('calls_access_token','devices_status')").toArray().length) throw new Error('Unused write indexes survived upgrade');
        measure('write_upgrade_second_run', () => bootstrap(ctx));
        measure('device_180_heartbeats_one_hour', () => {
          for(let i=1;i<=180;i++) new RepositoryDevice({sql}).set_seen('device','connection',1000000+i*20000);
        });
        measure('device_disconnect_and_duplicate', () => {
          devices.set_offline('device','connection',4600001);
          devices.set_offline('device','connection',4600002);
        });
        measure('task_create_to_complete', task_lifecycle);
        native.exec("DELETE FROM calls WHERE id = 'write-task'");
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
    for (const report of result.reports) console.log(JSON.stringify({ sources: count, ...report }));
    const reads = label => result.reports.find(report => report.label === label).rows_read;
    const writes = label => result.reports.find(report => report.label === label).rows_written;
    assert.ok(writes('unused_write_indexes_upgrade') <= 3);
    assert.equal(writes('write_upgrade_second_run'), 0);
    assert.equal(writes('device_180_heartbeats_before_upgrade'), 360);
    assert.equal(writes('device_180_heartbeats_one_hour'), 12);
    assert.equal(writes('device_disconnect_and_duplicate'), 1);
    assert.equal(writes('task_create_to_complete'), 30);
    assert.equal(writes('task_create_to_complete_before_upgrade'), 31);
    assert.ok(reads('admin_source_page_20_warm') <= 100);
    assert.ok(reads('public_source_page_20_warm') <= 100);
    assert.ok(reads('calls_recent_50') <= 50);
    assert.ok(reads('calls_publisher_recent_50') <= 50);
    assert.ok(reads('rss_registration_existing_after_restart') <= count * 3 + 5);
    assert.equal(writes('rss_registration_existing_after_restart'), 0);
    assert.ok(reads('background_1000_create_finish') <= 10000);
    assert.equal(writes('background_1000_create_finish'), 7999);
    assert.equal(writes('schema_v3_index_upgrade'), 20005 + count * 2);
    assert.equal(reads('schema_v3_index_upgrade_second_run'), 1);
    assert.equal(writes('schema_v3_index_upgrade_second_run'), 0);
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
