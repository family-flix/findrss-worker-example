import assert from "node:assert/strict";
import test from "node:test";
import { ServiceTask } from "../server/service/durable_object/tasks.js";

function service(sockets = []) {
  return new ServiceTask({
    repo: { devices: { find: () => ({ disabled: 0 }) }, calls: {
      count_queued() { throw new Error("queue reached"); },
    } },
    ports: { sockets: { get_for_method: () => sockets } },
    storage: { transactionSync: (callback) => callback() }, app: {},
  });
}
function request() {
  return new Request("https://internal/invoke", { method: "POST",
    headers: { "X-Api-Device-ID": "anonymous" },
    body: JSON.stringify({ method: "wxmp.biz.msg.list", args: {} }),
  });
}

test("同步调用无在线匹配设备时在入队和扣费前立即返回 503", async () => {
  for (const sockets of [[], [{ deserializeAttachment: () => ({ device_id: "other", methods: ["other.method"] }) }]]) {
    const tasks = service(sockets);
    await assert.rejects(tasks.invoke(request()), (error) =>
      error.status === 503 && error.message.includes("服务不可用"));
    assert.equal(tasks.waiters.size, 0);
  }
});

test("在线设备即使繁忙仍允许排队，异步提交仍允许离线入队", async () => {
  const tasks = service([{ deserializeAttachment: () => ({
    device_id: "mp", methods: ["wxmp.biz.msg.list"], max_concurrency: 1,
  }) }]);
  await assert.rejects(tasks.invoke(request()), /queue reached/);
  await assert.rejects(service().create_task(request()), /queue reached/);
});
