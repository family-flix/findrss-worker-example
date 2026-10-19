// 分层依赖纪律（对齐 xiaoxunrss-worker/test/domain_layering.test.js）。
//
// server/ 保留 lib ← domain ← {infra, repository} ← service，HTTP/API 模块直接放项目根目录。
// 下层不许知道上层——`lib/` 只 import `lib/`，`domain/` 只 import `lib/`+`domain/`……
// 违反时 esbuild 照样打得出来（它不关心层次），所以这条纪律只能靠本测试守。
//
// 两个组合根豁免层次规则：`index.js`（wrangler 入口，只做再导出）与
// `server/durable_object.js`（DO 组装点，把各层拼在一起，下一轮才会拆成 repository/service）。
// 顺带钉住「只有 index.js 能 import durable_object.js」——否则 router 反手 import DO 类就成环。
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const api_dir = join(dirname(fileURLToPath(import.meta.url)), "..");
const server_dir = join(api_dir, "server");

/** 层名 → 它允许依赖的层。 */
const ALLOWED = Object.freeze({
  lib: ["lib"],
  domain: ["lib", "domain"],
  infra: ["lib", "domain", "infra"],
  repository: ["lib", "domain", "repository"],
  service: ["lib", "domain", "infra", "repository", "service"],
  api: ["lib", "domain", "infra", "repository", "service", "api"],
});
const LAYERS = Object.freeze(Object.keys(ALLOWED).filter(layer => layer !== "api"));
const API_FILES = Object.freeze([
  "router.js", "api.js", "admin.js", "discover.js", "durable_object_router.js",
  "messages_socket.js", "script_agent_socket.js", "socket_hub.js", "admin_socket.js",
]);

/** 组合根：不适用层次规则。 */
const COMPOSITION_ROOTS = Object.freeze(["index.js", "server/durable_object.js"]);

const SSR_VIEWS = {
  "server/infra/discovery_home.js": ["discover/index.html", "discover/unavailable.html", "discover/index.js", "discover/style.css", "public/base.css"],
};

const SPECIFIER_PATTERNS = [
  /\bfrom\s+["']([^"']+)["']/g,
  /\bimport\s+["']([^"']+)["']/g,
  /\bimport\(\s*["']([^"']+)["']\s*\)/g,
];

/** @param {string} dir @returns {string[]} */
function list_js_files(dir) {
  const result = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) result.push(...list_js_files(path));
    else if (entry.endsWith(".js")) result.push(path);
  }
  return result;
}

/** @param {string} source @returns {string[]} */
function specifiers(source) {
  const found = [];
  for (const pattern of SPECIFIER_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) found.push(match[1]);
  }
  return found;
}

/** 相对 server/ 的路径；不在任何层目录下时返回 null。 @param {string} file @returns {string | null} */
function layer_of(file) {
  if (API_FILES.includes(name_of(file))) return "api";
  const segments = relative(server_dir, file).split(/[\\/]/);
  if (segments.length < 2) return null;
  return LAYERS.includes(segments[0]) ? segments[0] : null;
}

/** @param {string} file @returns {string} 相对 findrss-worker/ 的路径，用于报错信息。 */
function name_of(file) {
  return relative(api_dir, file);
}

const source_files = [join(api_dir, "index.js"), ...API_FILES.map(file => join(api_dir, file)), ...list_js_files(server_dir)];

test("HTTP/API 模块放根目录，server/ 只保留业务层和 DO 组合根", () => {
  const entries = readdirSync(server_dir).filter((entry) => !entry.startsWith("."));
  const expected = [...LAYERS, "durable_object.js"].sort();
  assert.deepEqual([...entries].sort(), expected);
  const roots = source_files
    .filter((file) => layer_of(file) === null)
    .map(name_of)
    .sort();
  assert.deepEqual(roots, [...COMPOSITION_ROOTS].sort());
});

test("所有相对引用都从层内出发、只向下依赖", () => {
  for (const file of source_files) {
    const specifier_list = specifiers(readFileSync(file, "utf8"));
    if (!specifier_list.length) continue;
    for (const specifier of specifier_list) {
      if (!specifier.startsWith(".")) {
        // 包与运行时内建只允许待在外部适配层（infra/）与组合根里；其余层必须保持纯净，
        // 否则 `node --test` 直接 import 该模块时会挂在无法解析的包上。
        assert.ok(
          layer_of(file) === "infra" || COMPOSITION_ROOTS.includes(name_of(file)),
          `${name_of(file)} 不许 import 外部包 ${specifier}`,
        );
        continue;
      }
      if (specifier.endsWith(".wasm")) continue; // WASM 由 Wrangler 打包
      const target = resolve(dirname(file), specifier);
      assert.ok(existsSync(target), `${name_of(file)} 引用不存在的 ${specifier}`);
      if (SSR_VIEWS[name_of(file)]?.includes(name_of(target))) continue;
      const from_layer = layer_of(file);
      const to_layer = layer_of(target);
      if (from_layer === null) continue; // index.js / server/durable_object.js
      assert.ok(to_layer, `${name_of(file)} 引用了层目录之外的 ${specifier}`);
      assert.ok(
        ALLOWED[from_layer].includes(to_layer),
        `${name_of(file)}（${from_layer}）不许依赖 ${to_layer} 层：${specifier}`,
      );
    }
  }
});

test("只有 index.js 能 import server/durable_object.js", () => {
  const target = join(server_dir, "durable_object.js");
  const importers = [];
  for (const file of source_files) {
    if (file === target) continue;
    const hit = specifiers(readFileSync(file, "utf8")).some(
      (specifier) => specifier.startsWith(".") && resolve(dirname(file), specifier) === target,
    );
    if (hit) importers.push(name_of(file));
  }
  assert.deepEqual(importers, ["index.js"]);
});
