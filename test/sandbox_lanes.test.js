import assert from "node:assert/strict";
import test from "node:test";

import { SandboxLanePool } from "../server/infra/sandbox_lanes.js";

/**
 * 可控的异步任务：返回 { promise, resolve, reject }，由测试决定何时完成。
 * @returns {{ promise: Promise<void>, resolve: () => void, reject: (error: Error) => void }}
 */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 让已 resolve 的 promise 回调跑完（微任务队列排空）。 */
function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("没有并发就不预建泳道：串行执行始终只用一条", async () => {
  const pool = new SandboxLanePool(16);
  // 首次调用只建 1 条（而不是一次性建满 16 条 wasm 实例）。
  assert.equal(await pool.run(async () => "a"), "a");
  assert.equal(pool.lane_count, 1);
  // 后续任务逐个 await，空闲泳道被复用：泳道数不涨。
  for (const value of ["b", "c", "d"]) {
    assert.equal(await pool.run(async () => value), value);
    assert.equal(pool.lane_count, 1);
  }
  assert.equal(pool.inflight, 0);
});

test("同一泳道上的任务严格串行", async () => {
  const pool = new SandboxLanePool(1);
  const first = deferred();
  const started = [];
  const one = pool.run(async () => {
    started.push(1);
    await first.promise;
  });
  const two = pool.run(async () => {
    started.push(2);
  });
  await tick();
  // 第二个任务还没轮到：只有一条泳道，严格串行。
  assert.deepEqual(started, [1]);
  assert.equal(pool.lane_count, 1);
  assert.equal(pool.inflight, 2);
  first.resolve();
  await Promise.all([one, two]);
  assert.equal(pool.inflight, 0);
  assert.deepEqual(started, [1, 2]);
});

test("不同泳道之间真正并发", async () => {
  const pool = new SandboxLanePool(4);
  const gates = [deferred(), deferred(), deferred(), deferred()];
  let concurrent = 0;
  let peak = 0;
  const runs = gates.map((gate) =>
    pool.run(async () => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      await gate.promise;
      concurrent -= 1;
    }));
  await tick();
  assert.equal(peak, 4);
  assert.equal(pool.lane_count, 4);
  for (const gate of gates) gate.resolve();
  await Promise.all(runs);
  assert.equal(pool.lane_count, 4);
  assert.equal(pool.inflight, 0);
});

test("超过上限时并发度封顶在上限", async () => {
  const pool = new SandboxLanePool(2);
  const gates = Array.from({ length: 6 }, () => deferred());
  let concurrent = 0;
  let peak = 0;
  const runs = gates.map((gate) =>
    pool.run(async () => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      await gate.promise;
      concurrent -= 1;
    }));
  await tick();
  assert.equal(peak, 2);
  assert.equal(pool.lane_count, 2);
  assert.equal(pool.inflight, 6);
  for (const gate of gates) gate.resolve();
  await Promise.all(runs);
  assert.equal(peak, 2);
  assert.equal(pool.inflight, 0);
});

test("超出上限的任务挂到最浅的泳道，不做队头阻塞", async () => {
  const pool = new SandboxLanePool(2);
  const order = [];
  const slow_a = deferred();
  const slow_b = deferred();
  // 两条泳道各占一个长任务。
  const runs = [
    pool.run(async () => {
      order.push("a");
      await slow_a.promise;
    }),
    pool.run(async () => {
      order.push("b");
      await slow_b.promise;
    }),
  ];
  await tick();
  // 3 个任务排队：若都挤在泳道 0，它们要等 a 完成；分散开则只各等一条。
  runs.push(
    pool.run(async () => {
      order.push("c");
    }),
    pool.run(async () => {
      order.push("d");
    }),
    pool.run(async () => {
      order.push("e");
    }));
  await tick();
  assert.deepEqual(order, ["a", "b"]);
  slow_a.resolve();
  await tick();
  // a 的泳道空出来后只接走一个任务，另一个在 b 的泳道上等——两条泳道都在推进。
  assert.deepEqual(order, ["a", "b", "c", "e"]);
  slow_b.resolve();
  await Promise.all(runs);
  assert.deepEqual(order, ["a", "b", "c", "e", "d"]);
});

test("任务失败不会带崩泳道上的后续任务", async () => {
  const pool = new SandboxLanePool(1);
  const failure = new Error("沙箱炸了");
  const bad = pool.run(async () => {
    throw failure;
  });
  await assert.rejects(bad, failure);
  await tick();
  assert.equal(pool.inflight, 0);
  // 同一个泳道（只有一条）必须还能继续跑。
  assert.equal(await pool.run(async () => "ok"), "ok");
  assert.equal(await pool.run(async () => "ok2"), "ok2");
});

test("失败的返回值不污染调用方：并发任务各自拿到自己的结果", async () => {
  const pool = new SandboxLanePool(2);
  const results = await Promise.allSettled([
    pool.run(async () => {
      throw new Error("boom");
    }),
    pool.run(async () => "fine"),
  ]);
  assert.equal(results[0].status, "rejected");
  assert.equal(results[0].reason.message, "boom");
  assert.deepEqual(results[1], { status: "fulfilled", value: "fine" });
});
