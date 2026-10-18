// 领域模型纪律（对齐 xiaoxunrss-worker/test/frontend_architecture.test.js 的同类护栏）。
//
// `server/domain/` 里每个业务概念都必须是一个充血模型：工厂函数 `XxxModel(state)`
// 返回**冻结的纯对象**——自身属性是状态、方法（含 `toValue()`）是行为，模型之间可组合。
// 三条纪律靠本测试守，静态检查抓不到的（esbuild 也不抓）在这里兜：
//
//   1. 每个导出都得是 `XxxModel` 工厂（对齐 reader 端 `biz/domain` 的命名规矩）。
//   2. 工厂返回冻结对象，且 `toValue()` 回的是**新的、未冻结的**普通对象/数组——
//      外层要就地改它（`service/worker/discovery.js` 展开 `{{hostname}}` 前会赋值），
//      回冻结对象会在真机上才炸。
//   3. `domain/` 不许碰 `lib/http`、不许造 `Response`——校验失败只回 `{ ok, error }`
//      数据，由组合根换成 HTTP 响应。
//
// 形状检查靠显式样本表（`SAMPLES`）；新增模型必须同时加一行，否则本测试红。
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const api_dir = join(dirname(fileURLToPath(import.meta.url)), "..");
const domain_dir = join(api_dir, "server", "domain");

const MODEL_NAME_PATTERN = /^[A-Z][A-Za-z0-9]*Model$/;

/**
 * 每个 `XxxModel` 工厂的合法样本入参（工厂返回 null 的容错模型也照给有效值）。
 * 只求「能构造出实例」，不校验业务正确性——那是各模型自己的测试文件的事。
 * @type {Record<string, Record<string, unknown[]>>}
 */
const SAMPLES = Object.freeze({
  "clip.js": { ClipModel: [{ id: "clip", title: "天气", url: "https://example.com/", selector: "#weather" }] },
  "script_version.js": { ScriptVersionModel: ["1.0.0"] },
  "script_cookie_permissions.js": { ScriptCookiePermissionsModel: [{}] },
  "admin_agent.js": { AdminAgentRunRequestModel: [{ run_id: "run", pathname: "/admin/discovery", messages: [{ role: "user", content: "查看订阅源" }] }] },
  "access_token.js": {
    AccessTokenModel: [{ id: "t1", name: "n", token_hint: "abc" }],
  },
  "activity_log.js": {
    ActivityEventModel: [{ id: 1, type: "login", subject: "s", metadata_json: "{}", created_at: 1 }],
    ActivityCursorModel: [{ created_at: 1, id: "a" }],
    ActivityPageModel: [[{ id: "a", created_at: 1 }], 10, (row) => ({ id: row.id })],
    SubscriptionDiffModel: [[{ feed_url: "https://a.example", title: "A" }], [{ url: "https://b.example", title: "B" }]],
  },
  "call.js": {
    CallModel: [{ args_json: "{}", result_json: null }],
  },
  "credits.js": {
    CreditModel: [],
    CreditTransactionModel: [{}],
  },
  "device_capacity.js": {
    DeviceModel: [{ device_id: "d1" }],
    DevicePoolModel: [[{ device_id: "d1" }], new Map()],
  },
  "device_log.js": {
    DeviceLogModel: [{}],
  },
  "device_token.js": { DeviceTokenModel: [{}] },
  "mcp_token.js": { McpTokenModel: [{}] },
  "discovery_source.js": {
    SourceAvatarModel: [{}],
    DiscoverySourceModel: [{ id: "1", title: "T", tags_json: "[]", category: "technology" }],
  },
  "feed_format.js": {
    FeedPersonModel: [{ name: "n" }],
    FeedImageModel: [{ url: "https://img.example/1.png" }],
    FeedEnclosureModel: [{ url: "https://cdn.example/1.mp4", type: "video/mp4" }],
    FeedItemModel: [{ id: "i" }],
    FeedModel: [{ items: [] }],
  },
  "redemption_code.js": {
    RedemptionCodeModel: [{ code: "GIFT2026READER" }],
    RedemptionCardBatchModel: [[{ code: "GIFT2026READER", normalized_code: "GIFT2026READER" }]],
    RedemptionCampaignModel: [{
      id: 1,
      name: "n",
      credits: 1,
      active: 1,
      starts_at: null,
      expires_at: null,
      created_at: 0,
    }],
  },
  "rss_route.js": {
    RssRoutePatternModel: ["/wxmp/:account?"],
  },
  "script_log.js": {
    ScriptLogQueryModel: [{ route: "r" }],
    ScriptLogModel: [{}],
  },
  "script_test.js": {
    ScriptTestRequestModel: [{ script: "x" }],
  },
  "script_debug_request.js": {
    ScriptDebugRequestModel: [{ script: "x", request_url: "/debug/demo" }],
  },
  "script_agent.js": {
    ScriptAgentSettingsModel: [{ base_url: "https://models.example/v1", model: "model", has_api_key: true }],
    ScriptAgentRunRequestModel: [{ run_id: "run", script: "", messages: [{ role: "user", content: "生成脚本" }] }],
  },
  "rss_route_selection.js": {
    RssRouteSelectionModel: [[{ route: "r1", path: "/wxmp/:account?", metadata_json: "{}" }], "/wxmp/foo"],
  },
  "script.js": {
    ScriptModel: [{}],
  },
  "source_address.js": {
    SourceAddressModel: ["https://host.example/rss/x"],
  },
  "registered_user.js": {
    RegisteredUserModel: [{ id: "u1", name: "Reader" }],
  },
});

/** `server/domain/` 下的模块文件名。 */
const domain_files = readdirSync(domain_dir).filter((name) => name.endsWith(".js")).sort();

test("server/domain 下的导出只有 XxxModel 工厂", () => {
  for (const name of domain_files) {
    const source = readFileSync(join(domain_dir, name), "utf8");
    const exported = [...source.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)].map((m) => m[1]);
    const reexported = [...source.matchAll(/^export\s*\{([^}]+)\}/gm)]
      .flatMap((m) => m[1].split(",").map((part) => part.trim()).filter((part) => part !== ""));
    const offenders = [...exported, ...reexported].filter((value) => !MODEL_NAME_PATTERN.test(value));
    assert.deepEqual(offenders, [], `${name} 导出了非模型的名字`);
    assert.ok(exported.length > 0 || reexported.length > 0, `${name} 没有任何模型导出`);
    assert.ok(SAMPLES[name], `${name} 未登记样本表`);
  }
  assert.deepEqual(
    Object.keys(SAMPLES).sort(),
    domain_files,
    "样本表与 server/domain 下的文件对不上",
  );
});

test("domain/ 不碰 lib/http、不造 Response", () => {
  for (const name of domain_files) {
    const source = readFileSync(join(domain_dir, name), "utf8");
    const specifiers = [...source.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]);
    for (const specifier of specifiers) {
      assert.ok(!/(^|\/)http\.js$/.test(specifier), `${name} 不许 import ${specifier}`);
    }
    assert.doesNotMatch(source, /\bnew\s+Response\s*\(/, `${name} 不许直接构造 Response`);
    assert.doesNotMatch(source, /\b(?:error_response|json_response)\s*\(/, `${name} 不许调用 http 助手`);
  }
});

test("每个 XxxModel 工厂都以函数导出、并带 .of 别名（若声明）", async () => {
  for (const name of domain_files) {
    const module = await import(pathToFileURL(join(domain_dir, name)).href);
    for (const [export_name, value] of Object.entries(module)) {
      assert.equal(typeof value, "function", `${name} 的 ${export_name} 不是工厂函数`);
      if ("of" in value) {
        assert.equal(value.of, value, `${name} 的 ${export_name}.of 不是自身别名`);
      }
    }
  }
});

test("工厂返回冻结对象，toValue() 回新的未冻结数据", async () => {
  for (const name of domain_files) {
    const module = await import(pathToFileURL(join(domain_dir, name)).href);
    for (const [factory_name, calls] of Object.entries(SAMPLES[name])) {
      const factory = module[factory_name];
      assert.equal(typeof factory, "function", `${name} 缺少导出 ${factory_name}`);
      const model = factory(...calls);
      assert.equal(model === null, false, `${factory_name} 的样本应当构造出实例`);
      assert.ok(Object.isFrozen(model), `${factory_name} 必须返回冻结对象`);
      assert.equal(typeof model.toValue, "function", `${factory_name} 缺少 toValue()`);
      const value = model.toValue();
      assert.ok(
        (value !== null && typeof value === "object") || Array.isArray(value),
        `${factory_name}.toValue() 必须回对象或数组`,
      );
      assert.ok(!Object.isFrozen(value), `${factory_name}.toValue() 不许回冻结对象`);
      assert.notEqual(value, model, `${factory_name}.toValue() 不许就是模型自身`);
    }
  }
});
