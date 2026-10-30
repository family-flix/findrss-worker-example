import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { RepositoryScriptLog } from "../server/repository/script_log.js";
import { snapshot_store } from "./support/snapshot_store.js";

// 同一份沙箱在 Node 中读取 WASM；Worker 仍用静态模块绑定。
register("data:text/javascript," + encodeURIComponent(`
  import { readFile } from 'node:fs/promises';
  export async function load(url, context, next) {
    if (!url.endsWith('.wasm')) return next(url, context);
    return { format: 'module', shortCircuit: true,
      source: 'export default await WebAssembly.compile(new Uint8Array(' + JSON.stringify([...await readFile(new URL(url))]) + '));' };
  }
`));
const {
  execute_script,
  script_failure_fields
} = await import("../server/infra/script_sandbox.js");
const {
  ServiceScript
} = await import("../server/service/application/scripts.js");
const source = `const handler = async (ctx) => {
  ctx.log("before error");
  throw new Error("invalid device result");
};
export const route = { handler };`;
test("真实 QuickJS 错误指向源码第 3 行并保留 mock 覆盖后的参数", async () => {
  const failure = await execute_script(source, {}, null, {
    method: "GET",
    pathname: "/rss/demo",
    params: {
      gh: "baseline"
    },
    query: {}
  }, [], '({ params: { gh: "gh_e59ba9dfaa66" }, query: { offset: "20", token: "private" } })').catch(error => error);
  const fields = script_failure_fields(failure);
  assert.match(fields.error_text, /script-source\.js:3(?:\D|$)/);
  assert.match(fields.error_text, /rss-result\.js:/);
  assert.equal(fields.lines[0].text, '"before error"');
  assert.equal(failure.request_context.params.gh, "gh_e59ba9dfaa66");
  assert.equal(failure.request_context.query.offset, "20");
});
test("消息接口要求管理员身份、保留分页参数并拒绝跨站 Basic WebSocket", async () => {
  const {
    default: worker
  } = await import("../api.js");
  let internal_url;
  const env = {
    ADMIN_PASSWORD: "admin-secret",
    APPLICATION: (() => ({
      fetch: async request => {
        internal_url = new URL(request.url);
        return Response.json({
          messages: []
        });
      }
    }))()
  };
  assert.equal((await worker.fetch(new Request("https://api/admin/api/messages"), env)).status, 401);
  await worker.fetch(new Request("https://api/admin/api/messages?before_id=3&limit=1", {
    headers: {
      Authorization: "Bearer admin-secret"
    }
  }), env);
  assert.equal(internal_url.pathname, "/_admin/messages");
  assert.equal(await internal_url.searchParams.get("before_id"), "3");
  assert.equal((await worker.fetch(new Request("https://api/admin/api/messages/ws", {
    headers: {
      Authorization: "Basic " + btoa("admin:admin-secret"),
      Origin: "https://other.example",
      Upgrade: "websocket"
    }
  }), env)).status, 403);
});
test("错误持久化后推送一次消息，成功不推送，消息参数脱敏且历史可分页", async () => {
  const rows = [],
    events = [];
  const service = new ServiceScript({
    repo: {
      script_logs: {
        insert(row) {
          rows.push({
            ...row,
            id: rows.length + 1
          });
        },
        list_errors(before, limit) {
          return rows.filter(row => row.status === "error" && (before === null || row.id < before)).reverse().slice(0, limit);
        }
      }
    },
    ports: {},
    app: {}
  });
  await service.message_listeners.add(value => events.push(value));
  await service.record_log({
    status: "ok"
  });
  await service.record_log({
    status: "error",
    params: {
      gh: "gh_1"
    },
    query: {
      token: "secret"
    }
  });
  await service.record_log({
    status: "error",
    params: {
      gh: "gh_2"
    }
  });
  assert.equal(events.length, 2);
  const first = await service.list_messages(new URL("https://internal/_admin/messages?limit=1"));
  assert.equal(first.messages[0].params.gh, "gh_2");
  assert.equal(first.has_more, true);
  const second = await service.list_messages(new URL("https://internal/_admin/messages?before_id=" + first.next_before_id));
  assert.equal(second.messages[0].query.token, "[redacted]");
  assert.equal(second.has_more, false);
  await assert.rejects(service.list_messages(new URL("https://internal/_admin/messages?before_id=oops")), /invalid before_id/);
});
test("删除已读消息要求管理员身份和有效边界，删除全部旧错误并保留未读与成功日志", async t => {
  const {
    default: worker
  } = await import("../api.js");
  const {
    route
  } = await import("../application_router.js");
  const {
    db,
    sql
  } = snapshot_store();
  t.after(() => db.close());
  db.exec(`INSERT INTO script_logs(id, route, source, method, pathname, status, phase, level, message, created_at)
    VALUES (1, 'demo', 'test', 'GET', '/demo', 'error', 'runtime', 'error', '旧错误', 1),
           (2, 'demo', 'test', 'GET', '/demo', 'ok', 'ok', 'info', '成功', 2),
           (3, 'demo', 'test', 'GET', '/demo', 'error', 'runtime', 'error', '已读', 3),
           (4, 'demo', 'test', 'GET', '/demo', 'error', 'runtime', 'error', '未读', 4)`);
  const scripts = new ServiceScript({
    repo: {
      script_logs: new RepositoryScriptLog({
        sql
      })
    },
    ports: {},
    app: {}
  });
  const events = [];
  await scripts.message_listeners.add(value => events.push(value));
  const env = {
    ADMIN_PASSWORD: "admin-secret",
    APPLICATION: (() => ({
      fetch: request => route(request, {
        scripts
      })
    }))()
  };
  const remove = async (query, authorized = true) => await worker.fetch(new Request("https://api/admin/api/messages" + query, {
    method: "DELETE",
    headers: authorized ? {
      Authorization: "Bearer admin-secret"
    } : {}
  }), env);
  assert.equal((await remove("?read_id=3", false)).status, 401);
  for (const value of ["", "?read_id=", "?read_id=0", "?read_id=-1", "?read_id=oops", "?read_id=1.5", "?read_id=9007199254740992"]) {
    assert.equal((await remove(value)).status, 400);
  }
  assert.equal(sql.exec("SELECT id FROM script_logs").toArray().length, 4);
  assert.equal(events.length, 0);
  assert.deepEqual(await (await remove("?read_id=3")).json(), {
    ok: true
  });
  assert.deepEqual(sql.exec("SELECT id FROM script_logs ORDER BY id").toArray().map(row => row.id), [2, 4]);
  assert.deepEqual(events, [{
    type: "messages.changed"
  }]);
  assert.equal((await remove("?read_id=3")).status, 200);
});
