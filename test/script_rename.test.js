import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { API_SCHEMA_SQL, migrate_script_tables } from "../server/repository/schema.js";
import { RepositoryScript } from "../server/repository/script.js";
import { RepositoryScriptLog } from "../server/repository/script_log.js";
import { RepositoryScriptAgent } from "../server/repository/script_agent.js";
import { create_script_agent_credentials } from "../server/infra/script_agent_credentials.js";
import { snapshot_store } from "./support/snapshot_store.js";
register("./support/quickjs_wasm_hook.js", import.meta.url);
const {
  default: worker
} = await import("../api.js");
const {
  route
} = await import("../application_router.js");
test("旧表原地迁移，保留脚本、日志 ID、加密模型密钥；重复启动不改数据", async t => {
  const {
    db,
    sql
  } = snapshot_store();
  t.after(() => db.close());
  for (const [current, previous] of [["scripts", "rss_scripts"], ["script_logs", "rss_script_logs"], ["script_agent_settings", "rss_script_agent_settings"]]) {
    db.exec(`ALTER TABLE ${current} RENAME TO ${previous}`);
  }
  db.exec("CREATE UNIQUE INDEX rss_scripts_path ON rss_scripts(path) WHERE path <> ''");
  db.exec("CREATE INDEX rss_script_logs_retention ON rss_script_logs(created_at)");
  const script = "export const route = { path: '/legacy' };";
  const metadata_json = JSON.stringify({
    kind: "hot",
    version: "1.0.0",
    cookie_grant_id: "grant"
  });
  db.prepare("INSERT INTO rss_scripts(route, title, path, metadata_json, script, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 1, 2)").run("legacy", "旧脚本", "/legacy", metadata_json, script);
  db.exec(`INSERT INTO rss_script_logs(id, route, source, method, pathname, status, phase, level, message, created_at)
    VALUES (42, 'legacy', 'request', 'GET', '/legacy', 'error', 'runtime', 'error', '原错误', 1)`);
  const encrypted_api_key = '{"v":1,"iv":[228,165,154,178,183,77,18,183,130,9,243,114],"data":[25,90,25,203,166,216,238,89,88,245,171,93,234,191,162,75,205,146,45,244,21,151,72,163,126,216,74,250,136,248]}';
  db.prepare("INSERT INTO rss_script_agent_settings(id, base_url, model, encrypted_api_key, updated_at) VALUES (1, 'https://model.example', 'test', ?, 1)").run(encrypted_api_key);
  migrate_script_tables(sql);
  db.exec(API_SCHEMA_SQL);
  db.exec("CREATE UNIQUE INDEX scripts_path ON scripts(path) WHERE path <> ''");
  const scripts = new RepositoryScript({
    sql
  });
  const logs = new RepositoryScriptLog({
    sql
  });
  const agent = new RepositoryScriptAgent({
    sql
  });
  const before = {
    scripts: await scripts.list(),
    logs: await logs.list_by_route("legacy", null, 10),
    agent: await agent.get()
  };
  assert.equal(before.scripts[0].script, script);
  assert.equal(before.scripts[0].metadata_json, metadata_json);
  assert.equal(before.logs[0].id, 42);
  assert.equal(before.logs[0].message, "原错误");
  assert.equal(await create_script_agent_credentials("test-admin").decrypt(before.agent.encrypted_api_key), "legacy-api-key");
  assert.equal(sql.exec("SELECT name FROM sqlite_master WHERE name GLOB 'rss_script*'").toArray().length, 0);
  migrate_script_tables(sql);
  db.exec(API_SCHEMA_SQL);
  assert.deepEqual({
    scripts: await scripts.list(),
    logs: await logs.list_by_route("legacy", null, 10),
    agent: await agent.get()
  }, before);
  assert.throws(() => db.exec("INSERT INTO scripts SELECT 'duplicate', title, path, metadata_json, script, enabled, created_at, updated_at FROM scripts"), /UNIQUE/);
});
test("新库无迁移；新旧表冲突时拒绝覆盖已有数据", t => {
  const {
    db,
    sql
  } = snapshot_store();
  t.after(() => db.close());
  assert.doesNotThrow(() => migrate_script_tables(sql));
  db.exec("CREATE TABLE rss_scripts(id TEXT)");
  db.exec("INSERT INTO rss_scripts VALUES ('keep')");
  assert.throws(() => migrate_script_tables(sql), /scripts already exists/);
  assert.equal(sql.exec("SELECT id FROM rss_scripts").toArray()[0].id, "keep");
});
test("scripts 管理接口与旧前缀均保留鉴权、请求方法、正文和查询参数", async () => {
  const app = {
    scripts: {
      list_scripts: async url => ({
        scripts: [{
          kind: await url.searchParams.get("kind")
        }]
      }),
      create_script: async request => ({
        script: await request.json()
      }),
      update_script: async (request, id) => ({
        script: {
          id,
          ...(await request.json())
        }
      }),
      delete_script: id => ({
        deleted: id
      }),
      list_script_logs: async url => ({
        route: await url.searchParams.get("route"),
        before_id: await url.searchParams.get("before_id")
      })
    }
  };
  const env = {
    ADMIN_PASSWORD: "test-admin",
    APPLICATION: (() => ({
      fetch: request => route(request, app)
    }))()
  };
  for (const prefix of ["scripts", "rss-scripts"]) {
    const base = "https://api.example/admin/api/" + prefix;
    const request = async (path, method = "GET", body, authorized = true) => await worker.fetch(new Request(base + path, {
      method,
      headers: authorized ? {
        Authorization: "Bearer test-admin"
      } : {},
      ...(body ? {
        body: JSON.stringify(body)
      } : {})
    }), env);
    assert.equal((await request("", "GET", undefined, false)).status, 401);
    assert.deepEqual(await (await request("?kind=hot")).json(), {
      scripts: [{
        kind: "hot"
      }]
    });
    assert.deepEqual(await (await request("", "POST", {
      script: "draft"
    })).json(), {
      script: {
        script: "draft"
      }
    });
    assert.deepEqual(await (await request("/legacy", "PATCH", {
      enabled: false
    })).json(), {
      script: {
        id: "legacy",
        enabled: false
      }
    });
    assert.deepEqual(await (await request("/legacy", "DELETE")).json(), {
      deleted: "legacy"
    });
    assert.deepEqual(await (await request("/logs?route=legacy&before_id=42")).json(), {
      route: "legacy",
      before_id: "42"
    });
  }
});
