import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { start_local_worker } from "./local_worker.js";

// Explicit non-browser integration check with isolated local SQLite and R2.
test("本地 Worker 使用同一 WS 推送变更并复用助手通道，保留会话与来源校验", { timeout: 120000 }, async t => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const temp = await mkdtemp(join(tmpdir(), "findrss-admin-realtime-"));
  let worker, socket;
  t.after(async () => { socket?.terminate(); await worker?.stop(); await rm(temp, { recursive: true, force: true }); });
  worker = await start_local_worker(join(root, "index.js"), {
    config: join(root, "wrangler.jsonc"), assets: join(root, "dist/assets"), persistTo: join(temp, "state"), temp_dir: temp,
    port: 0, watch: false, vars: { ADMIN_PASSWORD: "isolated-realtime-smoke" },
  });
  const origin = `http://${worker.address}:${worker.port}`;
  const path = origin + "/admin/api/events/ws";
  assert.equal((await fetch(path)).status, 401);
  const login = await fetch(origin + "/admin/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "isolated-realtime-smoke" }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("Set-Cookie").split(";")[0];
  assert.equal((await fetch(path, { headers: { Cookie: cookie } })).status, 426);
  const denied = new WebSocket(path.replace("http:", "ws:"), { headers: { Cookie: cookie, Origin: "https://other.example" } });
  const denied_status = await new Promise((resolve, reject) => {
    denied.on("unexpected-response", (_request, response) => { response.resume(); denied.terminate(); resolve(response.statusCode); });
    denied.on("error", () => {}); denied.on("open", () => reject(new Error("跨站连接不应成功")));
  });
  assert.equal(denied_status, 403);
  socket = new WebSocket(path.replace("http:", "ws:"), { headers: { Cookie: cookie, Origin: origin } });
  const events = [], waiters = new Set();
  socket.on("message", data => {
    const event = JSON.parse(data.toString()); events.push(event);
    for (const waiter of [...waiters]) if (waiter.match(event)) { clearTimeout(waiter.timer); waiters.delete(waiter); waiter.resolve(event); }
  });
  await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  const wait_for = match => {
    const existing = events.find(match);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = { match, resolve, timer: setTimeout(() => { waiters.delete(waiter); reject(new Error("未收到预期实时事件")); }, 10000) };
      waiters.add(waiter);
    });
  };
  const send = value => socket.send(JSON.stringify(value));
  send({ type: "subscribe", topics: ["discovery.changed", "messages.changed"] });
  send({ type: "channel.open", channel: "editor", name: "script-agent" });
  send({ type: "channel.open", channel: "global", name: "admin-agent" });
  await wait_for(event => event.channel === "editor" && event.data?.type === "ready");
  await wait_for(event => event.channel === "global" && event.data?.type === "ready");
  send({ type: "channel.close", channel: "editor" });
  send({ type: "channel.message", channel: "global", data: { type: "run", run_id: "invalid", pathname: "/", messages: [] } });
  await wait_for(event => event.channel === "global" && event.data?.run_id === "invalid" && event.data.type === "error");
  const created = await fetch(origin + "/admin/api/discovery/sources", { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Realtime smoke", feed_url: "https://example.com/feed", enabled: false, require_token: true }) });
  assert.equal(created.status, 201, await created.text());
  await wait_for(event => event.type === "admin.changed" && event.events.some(change => change.type === "discovery.changed"));
  assert.equal(socket.readyState, WebSocket.OPEN);
});
