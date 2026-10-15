import assert from "node:assert/strict";
import test from "node:test";

import {
  ActivityCursorModel,
  ActivityEventModel,
  ActivityPageModel,
  SubscriptionDiffModel,
} from "../server/domain/activity_log.js";

test("ActivityEventModel.normalize_type 只认 7 种主动操作", () => {
  for (const type of [
    "login",
    "register",
    "verify_email",
    "subscription_add",
    "subscription_remove",
    "refresh",
    "redeem",
  ]) {
    assert.equal(ActivityEventModel.normalize_type(type), type);
  }
  assert.equal(ActivityEventModel.normalize_type("poll"), "");
  assert.equal(ActivityEventModel.normalize_type(""), "");
  assert.equal(ActivityEventModel.normalize_type(null), "");
  assert.equal(ActivityEventModel.normalize_type(42), "");
  assert.equal(ActivityEventModel.normalize_type(undefined), "");
});

test("ActivityEventModel.normalize_reader_type 进一步收窄到 3 种", () => {
  for (const type of ["subscription_add", "subscription_remove", "refresh"]) {
    assert.equal(ActivityEventModel.normalize_reader_type(type), type);
  }
  // 只有 api 在真实业务里才知道的四种，客户端不得上报
  for (const type of ["login", "register", "verify_email", "redeem"]) {
    assert.equal(ActivityEventModel.normalize_reader_type(type), "");
  }
  assert.equal(ActivityEventModel.normalize_reader_type("poll"), "");
  assert.equal(ActivityEventModel.normalize_reader_type(null), "");
  assert.equal(ActivityEventModel.normalize_reader_type(42), "");
});

test("ActivityEventModel.subject 去控制字符、trim、按字符截断", () => {
  assert.equal(ActivityEventModel.subject("  刷新「示例」  "), "刷新「示例」");
  assert.equal(ActivityEventModel.subject("第一行\r\n第二行"), "第一行 第二行");
  assert.equal(ActivityEventModel.subject("a\u0000b\u007Fc"), "a b c");
  assert.equal(ActivityEventModel.subject(null), "");
  assert.equal(ActivityEventModel.subject(undefined), "");
  assert.equal(ActivityEventModel.subject(123), "123");
  const long = "字".repeat(100);
  assert.equal([...ActivityEventModel.subject(long, 10)].length, 10);
  assert.equal(ActivityEventModel.subject("anything", 0), "");
  // 不劈开代理对：emoji 计为一个字符
  assert.equal(ActivityEventModel.subject("😀😀😀", 2), "😀😀");
  assert.equal(ActivityEventModel.SUBJECT_MAX_LENGTH, 120);
  assert.equal(
    [...ActivityEventModel.subject("字".repeat(500))].length,
    ActivityEventModel.SUBJECT_MAX_LENGTH,
  );
});

test("ActivityCursorModel 编解码可往返，非法输入返回 null", () => {
  const cursor = ActivityCursorModel.fromRow({ id: "abc-123", created_at: 1700000000000 });
  assert.equal(cursor.key(), "1700000000000_abc-123");
  assert.deepEqual(ActivityCursorModel.parse(cursor.key()).toValue(), {
    created_at: 1700000000000,
    id: "abc-123",
  });

  assert.equal(ActivityCursorModel.fromRow({ id: "", created_at: 1 }), null);
  assert.equal(ActivityCursorModel.fromRow({ id: "x", created_at: "nope" }), null);
  assert.equal(ActivityCursorModel.fromRow(null), null);

  assert.equal(ActivityCursorModel.parse(""), null);
  assert.equal(ActivityCursorModel.parse("   "), null);
  assert.equal(ActivityCursorModel.parse("_abc"), null);
  assert.equal(ActivityCursorModel.parse("123_"), null);
  assert.equal(ActivityCursorModel.parse("nope_abc"), null);
  assert.equal(ActivityCursorModel.parse("123"), null);
  assert.equal(ActivityCursorModel.parse(null), null);
  assert.equal(ActivityCursorModel.parse(123), null);
  assert.equal(ActivityCursorModel.parse("1_" + "a".repeat(200)), null);
});

test("ActivityCursorModel.fromQuery：缺省/空串是首页，非法输入是 false", () => {
  assert.deepEqual(ActivityCursorModel.fromQuery(new URL("https://x.test/a")), { cursor: null });
  assert.deepEqual(
    ActivityCursorModel.fromQuery(new URL("https://x.test/a?cursor=%20")),
    { cursor: null },
  );
  assert.equal(ActivityCursorModel.fromQuery(new URL("https://x.test/a?cursor=nope")), false);
  const parsed = ActivityCursorModel.fromQuery(
    new URL("https://x.test/a?cursor=1700000000000_abc"),
  );
  assert.equal(parsed.cursor.key(), "1700000000000_abc");
});

test("ActivityPageModel.clamp_limit 夹到 1..100，缺省 50", () => {
  assert.equal(ActivityPageModel.clamp_limit(null), 50);
  assert.equal(ActivityPageModel.clamp_limit(undefined), 50);
  assert.equal(ActivityPageModel.clamp_limit(""), 50);
  assert.equal(ActivityPageModel.clamp_limit("abc"), 50);
  assert.equal(ActivityPageModel.clamp_limit(0), 1);
  assert.equal(ActivityPageModel.clamp_limit(-5), 1);
  assert.equal(ActivityPageModel.clamp_limit(7.9), 7);
  assert.equal(ActivityPageModel.clamp_limit(1000), 100);
});

test("ActivityCursorModel.where 只绑定参数，不做字符串拼接", () => {
  assert.deepEqual(ActivityCursorModel.where(null), { clause: "", params: [] });
  assert.deepEqual(ActivityCursorModel.where(undefined), { clause: "", params: [] });
  const cursor = { created_at: 1700000000000, id: "abc-123" };
  const { clause, params } = ActivityCursorModel.where(cursor);
  assert.deepEqual(params, [1700000000000, 1700000000000, "abc-123"]);
  assert.equal(clause.includes("abc-123"), false, "游标绝不能拼进 SQL");
  assert.equal(clause.split("?").length - 1, 3, "占位符数量必须与参数一致");
});

test("ActivityPageModel 把多取的一条切成当前页 + 下一页游标", () => {
  const rows = [
    { id: "b", created_at: 2 },
    { id: "a", created_at: 1 },
  ];
  const page = ActivityPageModel(rows, 1, (row) => ({ id: row.id })).toValue();
  assert.deepEqual(page.values, [{ id: "b" }]);
  assert.equal(page.next_cursor, "2_b");

  // 不多取（rows.length <= limit）时没有下一页
  const single = ActivityPageModel([{ id: "b", created_at: 2 }], 1, (row) => ({ id: row.id }))
    .toValue();
  assert.deepEqual(single.values, [{ id: "b" }]);
  assert.equal(single.next_cursor, null);
  assert.deepEqual(ActivityPageModel(undefined, 5, (row) => row).toValue(), {
    values: [],
    next_cursor: null,
  });
});

test("SubscriptionDiffModel：纯增", () => {
  const { added, removed } = SubscriptionDiffModel(
    [{ feed_url: "https://a.test/feed" }],
    [
      { url: "https://a.test/feed", title: "A" },
      { url: "https://b.test/feed", title: "B" },
    ],
  ).toValue();
  assert.deepEqual(added, [{ url: "https://b.test/feed", title: "B" }]);
  assert.deepEqual(removed, []);
});

test("SubscriptionDiffModel：纯删", () => {
  const { added, removed } = SubscriptionDiffModel(
    [
      { feed_url: "https://a.test/feed" },
      { feed_url: "https://b.test/feed" },
    ],
    [{ url: "https://a.test/feed", title: "A" }],
  ).toValue();
  assert.deepEqual(added, []);
  assert.deepEqual(removed, [{ url: "https://b.test/feed", title: "" }]);
});

test("SubscriptionDiffModel：仅改名不产生增删", () => {
  const { added, removed } = SubscriptionDiffModel(
    [{ feed_url: "https://a.test/feed", title: "旧名" }],
    [{ url: "https://a.test/feed", title: "新名" }],
  ).toValue();
  assert.deepEqual(added, []);
  assert.deepEqual(removed, []);
});

test("SubscriptionDiffModel：仅排序不产生增删", () => {
  const { added, removed } = SubscriptionDiffModel(
    [
      { feed_url: "https://a.test/feed" },
      { feed_url: "https://b.test/feed" },
    ],
    [
      { url: "https://b.test/feed", title: "B" },
      { url: "https://a.test/feed", title: "A" },
    ],
  ).toValue();
  assert.deepEqual(added, []);
  assert.deepEqual(removed, []);
});

test("SubscriptionDiffModel：新列表里的重复 URL 只算一次", () => {
  const { added, removed } = SubscriptionDiffModel(
    [],
    [
      { url: "https://b.test/feed", title: "第一次" },
      { url: "https://b.test/feed", title: "第二次" },
    ],
  ).toValue();
  assert.deepEqual(added, [{ url: "https://b.test/feed", title: "第一次" }]);
  assert.deepEqual(removed, []);
});

test("SubscriptionDiffModel：空旧 / 空新", () => {
  assert.deepEqual(SubscriptionDiffModel([], [{ url: "https://a.test/feed" }]).toValue(), {
    added: [{ url: "https://a.test/feed", title: "https://a.test/feed" }],
    removed: [],
  });
  assert.deepEqual(SubscriptionDiffModel([{ feed_url: "https://a.test/feed" }], []).toValue(), {
    added: [],
    removed: [{ url: "https://a.test/feed", title: "" }],
  });
  assert.deepEqual(SubscriptionDiffModel(undefined, undefined).toValue(), {
    added: [],
    removed: [],
  });
  assert.deepEqual(SubscriptionDiffModel([], []).toValue(), { added: [], removed: [] });
});

test("ActivityEventModel.metadata_json 截到 1KB，非对象退回空对象", () => {
  assert.equal(ActivityEventModel.metadata_json(null), "{}");
  assert.equal(ActivityEventModel.metadata_json("nope"), "{}");
  assert.equal(ActivityEventModel.metadata_json(["a"]), "{}");
  assert.equal(ActivityEventModel.metadata_json(undefined), "{}");
  assert.equal(
    ActivityEventModel.metadata_json({ kind: "manual", trigger: "manual" }),
    '{"kind":"manual","trigger":"manual"}',
  );
  const big = ActivityEventModel.metadata_json({ blob: "x".repeat(4096) });
  assert.ok(new TextEncoder().encode(big).byteLength <= ActivityEventModel.METADATA_MAX_BYTES);
  assert.equal(big, "{}", "单个超限键被整个丢弃");
});

test("ActivityEventModel 返回解析后的 metadata 对象", () => {
  const value = ActivityEventModel.fromRow({
    id: "e1",
    type: "refresh",
    subject: "示例",
    metadata_json: '{"feed_url":"https://a.test/feed","trigger":"manual"}',
    created_at: "1700000000000",
  }).toValue();
  assert.deepEqual(value.metadata, {
    feed_url: "https://a.test/feed",
    trigger: "manual",
  });
  assert.equal(value.created_at, 1700000000000);
  assert.equal("metadata_json" in value, false, "不能吐 metadata_json 原文");
  assert.deepEqual(
    ActivityEventModel.fromRow({ id: "e2", metadata_json: "not json" }).toValue().metadata,
    {},
  );
});

test("ActivityEventModel 的保留期与清理限流口径", () => {
  const now = 10_000_000_000;
  assert.equal(ActivityEventModel.retention_cutoff(now), now - ActivityEventModel.RETENTION_MS);
  // 恰好一个间隔即该清理
  assert.equal(ActivityEventModel.should_prune(now, now - ActivityEventModel.PRUNE_INTERVAL_MS), true);
  assert.equal(ActivityEventModel.should_prune(now, now - ActivityEventModel.PRUNE_INTERVAL_MS + 1), false);
  // 从没清理过（0）也要清理
  assert.equal(ActivityEventModel.should_prune(now, 0), true);
});
