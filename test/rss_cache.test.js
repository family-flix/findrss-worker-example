import { async_map } from "../server/lib/async_array.js";
import assert from "node:assert/strict";
import test from "node:test";
import { RssRouteCache, rss_route_cache_key } from "../server/infra/rss_cache.js";
test("长时间冷请求完成后才开始 TTL，管理端查询不增加命中数", async () => {
  let now = 1000;
  const cache = new RssRouteCache(300_000, 1024, {
    clock: () => now
  });
  await cache.run("/slow", now, async () => {
    now = 601000;
    return {
      output: "fresh result",
      invoked: true
    };
  });
  const snapshot = await cache.inspect("/slow", now);
  assert.equal(snapshot.saved_at, 601000);
  assert.equal(snapshot.expires_at, 901000);
  assert.equal(snapshot.status, "fresh");
  assert.equal(snapshot.persistent, false);
  assert.equal(cache.stats().l1_hits, 0);
  assert.equal((await cache.inspect("/missing", now)).status, "empty");
  assert.equal(cache.lookup("/slow", now).output, "fresh result");
});

/**
 * 假的 L2 store：接口与 `RepositoryRssRouteCache` 一致（方法名即约定）。
 * @param {{ output_json: string, invoked: number, expires_at: number, created_at?: number }[]} [rows]
 */
function fake_store(rows = []) {
  const map = new Map(rows.map((row, index) => ["/" + index, {
    created_at: index,
    ...row
  }]));
  return {
    map,
    write_calls: 0,
    read: key => map.get(key) ?? null,
    write(entry) {
      this.write_calls += 1;
      map.set(entry.key, entry);
    },
    delete_expired: now => {
      for (const [key, entry] of map) if (entry.expires_at <= now) map.delete(key);
    },
    clear() {
      for (const key of map.keys()) if (!/^(public|private)-snapshot:/.test(key)) map.delete(key);
    },
    count: () => map.size,
    delete_oldest(keep) {
      const newest = [...map.entries()].sort((a, b) => b[1].created_at - a[1].created_at);
      for (const [key] of newest.slice(keep)) map.delete(key);
    }
  };
}
test("缓存键对乱序 query 归一化且区分不同参数", () => {
  assert.equal(rss_route_cache_key("/wxmp", new URLSearchParams("b=2&a=1")), rss_route_cache_key("/wxmp", new URLSearchParams("a=1&b=2")));
  assert.equal(rss_route_cache_key("/wxmp", new URLSearchParams()), "cookie-explicit:/wxmp");
  assert.equal(rss_route_cache_key("/wxmp", new URLSearchParams("a=1")).includes("?a=1"), true);
  assert.notEqual(rss_route_cache_key("/wxmp", new URLSearchParams("a=1")), rss_route_cache_key("/wxmp/other", new URLSearchParams("a=1")));
  assert.notEqual(rss_route_cache_key("/wxmp", new URLSearchParams("a=1")), rss_route_cache_key("/wxmp", new URLSearchParams("a=0&a=1")));
  // 同名多值按值排序，两种顺序归一为同键。
  assert.equal(rss_route_cache_key("/wxmp", new URLSearchParams("a=1&a=0")), rss_route_cache_key("/wxmp", new URLSearchParams("a=0&a=1")));
});
test("run 命中后不再执行 produce 并返回缓存结果", async () => {
  const cache = new RssRouteCache(300_000);
  let calls = 0;
  const produce = async () => {
    calls += 1;
    return {
      output: "<rss/>",
      invoked: true
    };
  };
  const first = await cache.run("/feed", 1000, produce);
  const second = await cache.run("/feed", 2000, produce);
  assert.equal(calls, 1);
  assert.deepEqual(first, {
    output: "<rss/>",
    invoked: true,
    cached: false
  });
  assert.deepEqual(second, {
    output: "<rss/>",
    invoked: true,
    cached: true
  });
});
test("TTL 过期后回源重新执行", async () => {
  let now = 1000;
  const cache = new RssRouteCache(1000, 1024, {
    clock: () => now
  });
  let calls = 0;
  const produce = async () => {
    calls += 1;
    return {
      output: "v" + calls,
      invoked: false
    };
  };
  await cache.run("/feed", 1000, produce);
  now = 2001;
  const refreshed = await cache.run("/feed", 2001, produce);
  assert.equal(calls, 2);
  assert.deepEqual(refreshed, {
    output: "v2",
    invoked: false,
    cached: false
  });
  assert.equal(cache.lookup("/feed", 3001), null);
});
test("并发 run 同 key 只执行一次且共享结果", async () => {
  const cache = new RssRouteCache(300_000);
  let calls = 0;
  const produce = () => new Promise(resolve => {
    calls += 1;
    setTimeout(() => resolve({
      output: "<rss/>",
      invoked: true
    }), 10);
  });
  const results = await Promise.all([cache.run("/feed", 1000, produce), cache.run("/feed", 1000, produce), cache.run("/feed", 1000, produce)]);
  assert.equal(calls, 1);
  assert.deepEqual(results.map(result => result.cached), [false, false, false]);
  assert.equal((await cache.run("/feed", 1500, produce)).cached, true);
  // misses 数「没查到缓存的请求」（3 个并发各记一次），executions 数「真的跑了一次 produce」（1 次）。
  // 压测判定「合并有没有生效」要用 executions——用 misses 会得到「3 > 1 个 key」的假失败。
  assert.equal(cache.stats().misses, 3);
  assert.equal(cache.stats().executions, 1);
});
test("失败不缓存且并发等待者共享 rejection", async () => {
  const cache = new RssRouteCache(300_000);
  let calls = 0;
  const produce = () => new Promise((_, reject) => {
    calls += 1;
    setTimeout(() => reject(new Error("boom")), 10);
  });
  await assert.rejects(Promise.all([cache.run("/feed", 1000, produce), cache.run("/feed", 1000, produce)]), /boom/);
  assert.equal(calls, 1);
  const recovered = await cache.run("/feed", 2000, async () => ({
    output: "ok",
    invoked: false
  }));
  assert.equal(recovered.cached, false);
});
test("超出容量先清过期再按最旧淘汰", async () => {
  const cache = new RssRouteCache(300_000, 2);
  await cache.run("/a", 1000, async () => ({
    output: "a",
    invoked: false
  }));
  await cache.run("/b", 1000, async () => ({
    output: "b",
    invoked: false
  }));
  await cache.run("/c", 2000, async () => ({
    output: "c",
    invoked: false
  }));
  assert.equal(cache.lookup("/a", 2000), null);
  assert.notEqual(cache.lookup("/b", 2000), null);
  assert.notEqual(cache.lookup("/c", 2000), null);
});
test("invalidate_all 清空条目并作废执行中的旧结果", async () => {
  const cache = new RssRouteCache(300_000);
  await cache.run("/feed", 1000, async () => ({
    output: "old",
    invoked: false
  }));
  await cache.invalidate_all();
  assert.equal(cache.lookup("/feed", 1001), null);
  let release;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  const inflight = cache.run("/feed", 1002, async () => {
    await gate;
    return {
      output: "stale",
      invoked: false
    };
  });
  await cache.invalidate_all();
  release();
  await inflight;
  assert.equal(cache.lookup("/feed", 1100), null);
});
test("未命中执行后同时写入 L1 与 L2，新的实例可从 L2 命中", async () => {
  const store = fake_store();
  const first = new RssRouteCache(300_000, 1024, {
    store,
    clock: () => 1000
  });
  let calls = 0;
  await first.run("/a", 1000, async () => {
    calls += 1;
    return {
      output: "A",
      invoked: true
    };
  });
  assert.equal(store.write_calls, 1);
  assert.equal((await store.read("/a")).output_json, "A");
  assert.equal((await store.read("/a")).expires_at, 1000 + 300_000);
  assert.equal(first.stats().misses, 1);

  // 另一个实例（模拟 DO 被驱逐后重建）只靠 L2 就能命中，不再执行脚本。
  const second = new RssRouteCache(300_000, 1024, {
    store
  });
  const hit = await second.run("/a", 2000, async () => {
    calls += 1;
    return {
      output: "B",
      invoked: true
    };
  });
  assert.equal(calls, 1);
  assert.deepEqual(hit, {
    output: "A",
    invoked: true,
    cached: true
  });
  assert.equal(second.stats().l2_hits, 1);
  // L2 的回填沿用 L2 自己的 expires_at，不续期。
  assert.equal(second.lookup("/a", 1000 + 300_001), null);
});
test("L2 命中后同样进入单飞：并发请求共享一次回填", async () => {
  const store = fake_store([{
    output_json: "A",
    invoked: 0,
    expires_at: 999_999
  }]);
  await store.map.clear();
  store.map.set("/a", {
    output_json: "A",
    invoked: 0,
    expires_at: 999_999,
    created_at: 1
  });
  const cache = new RssRouteCache(300_000, 1024, {
    store
  });
  const results = await Promise.all([cache.run("/a", 1000, async () => ({
    output: "redo",
    invoked: false
  })), cache.run("/a", 1000, async () => ({
    output: "redo",
    invoked: false
  }))]);
  assert.deepEqual(results.map(result => result.output), ["A", "A"]);
  assert.deepEqual(results.map(result => result.cached), [true, true]);
  assert.equal(cache.stats().l2_hits, 1);
  assert.equal(cache.stats().l1_hits, 0);
});
test("失败不落 L2，超大的条目只留 L1", async () => {
  const store = fake_store();
  const cache = new RssRouteCache(300_000, 1024, {
    store,
    persist_max_bytes: 4
  });
  await assert.rejects(cache.run("/boom", 1000, async () => {
    throw new Error("nope");
  }), /nope/);
  assert.equal(await store.count(), 0);
  await cache.run("/big", 1000, async () => ({
    output: "123456789",
    invoked: false
  }));
  assert.equal(await store.count(), 0);
  assert.notEqual(cache.lookup("/big", 1000), null);
  await cache.run("/small", 1000, async () => ({
    output: "1",
    invoked: false
  }));
  assert.equal(await store.count(), 1);
});
test("超出 max_bytes 时按写入序淘汰，字节预算不会失控", async () => {
  const cache = new RssRouteCache(300_000, 1024, {
    max_bytes: 10
  });
  await cache.run("/a", 1000, async () => ({
    output: "123456",
    invoked: false
  }));
  await cache.run("/b", 1000, async () => ({
    output: "123456",
    invoked: false
  }));
  assert.equal(cache.entries.size, 1);
  assert.equal(cache.lookup("/a", 1000), null);
  assert.notEqual(cache.lookup("/b", 1000), null);
  assert.ok(cache.bytes <= 10);
});
test("render 按 (key, format, self_url) 记忆化", async () => {
  const cache = new RssRouteCache(300_000);
  let builds = 0;
  const build = body => () => {
    builds += 1;
    return body;
  };
  await cache.run("/a", 1000, async () => ({
    output: "{}",
    invoked: false
  }));
  assert.equal(cache.render("/a", "rss", "https://x/feed", build("<rss/>")), "<rss/>");
  assert.equal(cache.render("/a", "rss", "https://x/feed", build("<rss2/>")), "<rss/>");
  assert.equal(builds, 1);
  // 同一个 key 的不同 format / self_url 各渲染一次：rel="self" 与格式都进渲染结果。
  assert.equal(cache.render("/a", "atom", "https://x/feed", build("<feed/>")), "<feed/>");
  assert.equal(cache.render("/a", "rss", "https://y/feed", build("<rss3/>")), "<rss3/>");
  assert.equal(builds, 3);
  // 条目不在 L1（未缓存过）时只渲染不记忆。
  assert.equal(cache.render("/missing", "rss", "", build("<z/>")), "<z/>");
  assert.equal(cache.render("/missing", "rss", "", build("<z2/>")), "<z2/>");
});
test("invalidate_all 同时清掉 L2", async () => {
  const store = fake_store();
  const cache = new RssRouteCache(300_000, 1024, {
    store
  });
  await cache.run("/a", 1000, async () => ({
    output: "A",
    invoked: false
  }));
  assert.equal(await store.count(), 1);
  await cache.invalidate_all();
  assert.equal(await store.count(), 0);
  // 重建的实例也不能再从 L2 拿到失效前的旧内容。
  const rebuilt = new RssRouteCache(300_000, 1024, {
    store
  });
  let produced = 0;
  const result = await rebuilt.run("/a", 1001, async () => {
    produced += 1;
    return {
      output: "B",
      invoked: false
    };
  });
  assert.equal(produced, 1);
  assert.equal(result.output, "B");
});
test("失效期间的新生成不合并旧任务，旧任务完成不能删掉新任务", async () => {
  const cache = new RssRouteCache();
  let finish_old, finish_new;
  const old = cache.run("/feed", Date.now(), () => new Promise(resolve => {
    finish_old = resolve;
  }));
  await new Promise(setImmediate);
  await cache.invalidate_all();
  const latest = cache.run("/feed", Date.now(), () => new Promise(resolve => {
    finish_new = resolve;
  }));
  await new Promise(setImmediate);
  finish_old({
    output: "old",
    invoked: false
  });
  await old;
  assert.equal(cache.stats().inflight, 1);
  const shared = cache.run("/feed", Date.now(), () => assert.fail("新任务应继续合并"));
  finish_new({
    output: "new",
    invoked: false
  });
  assert.equal((await latest).output, "new");
  assert.equal((await shared).output, "new");
  assert.equal(cache.lookup("/feed", Date.now()).output, "new");
});
test("配置失效保留公开和私密 XML 及其生成任务，普通缓存和任务仍失效", async () => {
  const store = fake_store();
  const cache = new RssRouteCache(300_000, 100, {
    store
  });
  for (const key of ["public-snapshot:/saved", "private-snapshot:/saved", "/saved-drop"]) {
    await cache.run(key, Date.now(), async () => ({
      output: key,
      invoked: false
    }));
  }
  let release;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  const jobs = ["public-snapshot:/keep", "private-snapshot:/keep", "/drop"].map(key => cache.run(key, Date.now(), async () => {
    await gate;
    return {
      output: key,
      invoked: false
    };
  }));
  await new Promise(setImmediate);
  await cache.invalidate_all();
  jobs.push(cache.run("public-snapshot:/keep", Date.now(), () => assert.fail("XML 任务应继续合并")));
  release();
  await Promise.all(jobs);
  for (const key of ["public-snapshot:/saved", "private-snapshot:/saved", "public-snapshot:/keep", "private-snapshot:/keep"]) {
    assert.equal((await cache.resolve(key, Date.now())).output, key);
    assert.ok(await store.read(key));
  }
  for (const key of ["/drop", "/saved-drop"]) {
    assert.equal(await cache.resolve(key, Date.now()), null);
    assert.equal(await store.read(key), null);
  }
  assert.equal(cache.stats().bytes, [...cache.entries.values()].reduce((total, entry) => total + entry.bytes, 0));
});
