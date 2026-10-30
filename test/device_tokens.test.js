import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { register } from "node:module";
import { DeviceTokenModel } from "../server/domain/device_token.js";
import { RepositoryDeviceToken } from "../server/repository/device_token.js";
import { API_SCHEMA_SQL } from "../server/repository/schema.js";
import { create_device_token_credentials } from "../server/infra/device_token_credentials.js";
import { ServiceDeviceToken } from "../server/service/application/device_tokens.js";
import { ServiceTask } from "../server/service/application/tasks.js";
register("./support/quickjs_wasm_hook.js", import.meta.url);
const {
  ServiceDevice
} = await import("../server/service/application/devices.js");
const {
  route
} = await import("../application_router.js");
const {
  default: worker
} = await import("../api.js");
function fixture(t) {
  const db = new DatabaseSync(":memory:");
  db.exec(API_SCHEMA_SQL);
  t.after(() => db.close());
  const sql = {
    exec(text, ...args) {
      const statement = db.prepare(text);
      if (/^(SELECT|PRAGMA)/.test(text.trim())) return {
        toArray: () => statement.all(...args)
      };
      statement.run(...args);
      return {
        toArray: () => []
      };
    }
  };
  const repo = new RepositoryDeviceToken({
    sql
  });
  const app = {
    devices: {
      close_unauthorized_connections() {}
    },
    tasks: {
      async dispatch_pending() {}
    }
  };
  app.device_tokens = new ServiceDeviceToken({
    repo,
    app,
    schedule_alarm: async () => {},
    credentials: create_device_token_credentials("test-admin")
  });
  const env = {
    ADMIN_PASSWORD: "test-admin",
    APPLICATION: (() => ({
      fetch: (url, init) => route(url instanceof Request ? url : new Request(url, init), app)
    }))()
  };
  const admin = async (path = "", method = "GET", body) => await worker.fetch(new Request("https://api/admin/api/device-tokens" + path, {
    method,
    headers: {
      Authorization: "Bearer test-admin"
    },
    ...(body === undefined ? {} : {
      body: JSON.stringify(body)
    })
  }), env);
  return {
    db,
    repo,
    app,
    env,
    admin
  };
}
test("无需部署 Device Token 即可管理多个设备凭证，默认脱敏，管理员单独获取明文", async t => {
  const f = fixture(t);
  const response = await f.admin("", "POST", {
    name: "笔记本",
    note: "本地调试",
    expires_in_seconds: 60
  });
  assert.equal(response.status, 201);
  const {
    device_token: first,
    ...rest
  } = await response.json();
  assert.deepEqual(rest, {});
  const second = await (await f.admin("", "POST", {
    name: "服务器"
  })).json();
  assert.notEqual(first.id, second.device_token.id);
  const reveal = await f.admin("/" + first.id + "/reveal", "POST");
  assert.equal(await reveal.headers.get("Cache-Control"), "no-store");
  const {
    token
  } = await reveal.json();
  assert.match(token, /^frd_[0-9a-f]{64}$/);
  const row = await f.repo.find(first.id);
  assert.equal(await f.app.device_tokens.is_active(undefined), false);
  assert.equal(await f.repo.min_expires_at(first.created_at), first.expires_at);
  assert.equal(await f.repo.min_expires_at(first.expires_at), null);
  assert.equal(row.encrypted_token.includes(token), false);
  assert.equal(JSON.stringify(await (await f.admin()).json()).includes(token), false);
  assert.equal(row.token_hash.length, 64);
  const verified = await f.app.device_tokens.verify(token);
  assert.equal(verified.device_token.id, first.id);
  assert.ok((await f.repo.find(first.id)).last_used_at);
  assert.equal((await f.admin("/" + first.id, "PATCH", {
    note: "更新备注"
  })).status, 200);
  assert.equal((await f.repo.find(first.id)).note, "更新备注");
  const unauthorized = await worker.fetch(new Request("https://api/admin/api/device-tokens/" + first.id + "/reveal", {
    method: "POST"
  }), f.env);
  assert.equal(unauthorized.status, 401);
});
test("撤销只影响关联 Token，删除密文，旧环境变量不会重新激活已撤销凭证", async t => {
  const f = fixture(t);
  const legacy = "legacy-device-token";
  await f.app.device_tokens.import_legacy(legacy);
  const first = (await f.app.device_tokens.verify(legacy)).device_token;
  const second = (await f.app.device_tokens.create({
    name: "第二台"
  })).data.device_token;
  let closed = 0;
  f.app.devices.close_unauthorized_connections = () => closed++;
  assert.equal((await f.admin("/" + first.id + "/revoke", "POST")).status, 200);
  assert.equal(closed, 1);
  assert.equal((await f.repo.find(first.id)).encrypted_token, "");
  assert.equal(await f.repo.min_expires_at(0), null);
  await assert.rejects(f.app.device_tokens.verify(legacy), {
    status: 401
  });
  assert.equal((await f.admin("/" + first.id + "/reveal", "POST")).status, 409);
  await f.app.device_tokens.import_legacy(legacy);
  assert.equal((await f.repo.list()).length, 2);
  assert.equal(await f.app.device_tokens.is_active(first.id), false);
  assert.equal(await f.app.device_tokens.is_active(second.id), true);
});
test("到期边界拒绝 HTTP / WebSocket 消息与任务分发，伪造内部 Token ID 无效", async t => {
  const f = fixture(t);
  const {
    device_token: created
  } = (await f.app.device_tokens.create({
    name: "即将过期",
    expires_in_seconds: 60
  })).data;
  const {
    token
  } = await f.app.device_tokens.reveal(created.id);
  assert.equal(await f.app.device_tokens.is_active(created.id, created.expires_at - 1), true);
  assert.equal(await f.app.device_tokens.is_active(created.id, created.expires_at), false);
  let received_headers;
  f.app.credit = {
    credit_usage: request => {
      received_headers = request.headers;
      return {};
    }
  };
  const device_request = token => new Request("https://api/v1/credits", {
    headers: {
      Authorization: "Bearer " + token,
      "X-Api-Device-ID": "device-1",
      "X-Api-Device-Token-ID": "forged",
      "X-Api-Access-Token-ID": "forged",
      "X-Api-Authenticated-Publisher-ID": "forged"
    }
  });
  assert.equal((await worker.fetch(device_request(token), f.env)).status, 200);
  assert.equal(await received_headers.get("X-Api-Device-Token-ID"), created.id);
  assert.equal(await received_headers.get("X-Api-Authenticated-Publisher-ID"), "device-1");
  assert.equal(received_headers.has("X-Api-Access-Token-ID"), false);
  f.db.prepare("UPDATE device_tokens SET expires_at = ? WHERE id = ?").run(Date.now(), created.id);
  const denied = await worker.fetch(new Request("https://api/v1/connect", {
    headers: {
      Authorization: "Bearer " + token,
      "X-Api-Device-Token-ID": created.id
    }
  }), f.env);
  assert.equal(denied.status, 401);
  const closed = [],
    marked = [];
  const socket = {
    deserializeAttachment: () => ({
      device_id: "device-1",
      device_token_id: created.id,
      connection_id: "connection-1"
    })
  };
  const legacy_socket = {
    deserializeAttachment: () => ({
      device_id: "legacy-device",
      connection_id: "old-connection"
    })
  };
  const sockets = {
    get_all: () => [socket, legacy_socket],
    close: (...args) => closed.push(args)
  };
  const devices = new ServiceDevice({
    repo: {},
    ports: {
      sockets
    },
    app: f.app
  });
  devices.mark_device_offline = (...args) => marked.push(args);
  await devices.webSocketMessage(socket, '{"type":"task.complete"}');
  assert.equal(closed[0][1], 1008);
  assert.equal(marked.length, 2);
  // 没有可用设备就不应读写任务仓储。
  const tasks = new ServiceTask({
    repo: {},
    ports: {
      sockets
    },
    app: f.app,
    storage: {}
  });
  await tasks.dispatch_pending();
});
test("参数校验、Token 数量限制、加密损坏与密钥轮换都有明确失败结果", async t => {
  const f = fixture(t);
  for (const body of [null, [], {}, {
    name: " "
  }, {
    name: "n",
    note: 1
  }, {
    name: "n",
    note: "x".repeat(257)
  }, {
    name: "n",
    expires_in_seconds: -1
  }, {
    name: "n",
    expires_in_seconds: [60]
  }]) {
    assert.equal((await f.admin("", "POST", body)).status, 400);
  }
  assert.equal((await f.admin("", "POST", {
    name: "x".repeat(5000)
  })).status, 413);
  const created = (await f.app.device_tokens.create({
    name: "test"
  })).data.device_token;
  f.app.device_tokens.credentials = create_device_token_credentials("rotated-admin");
  await assert.rejects(f.app.device_tokens.reveal(created.id), {
    status: 409
  });
  const service = new ServiceDeviceToken({
    repo: {
      count: () => DeviceTokenModel.MAX_TOKENS
    }
  });
  await assert.rejects(service.create({
    name: "full"
  }), {
    status: 409
  });
  const cipher = create_device_token_credentials("test-admin");
  await assert.rejects(cipher.decrypt('{"iv":[],"data":[]}'));
});
