// 「用了某个名字但忘了 import」的护栏。
//
// findrss-worker/index.js 没有任何静态检查能抓住这种错误：esbuild 只报「导入了不存在的导出」
// （missing *export*），不报「用了没导入的名字」（unknown global）——后者会被当成
// 全局变量，只在运行时 ReferenceError（2026-09 `activity_page_result` 漏进 import，
// 管理页活动接口 500）。node --test 的纯模块单测也不加载 composition root。
//
// 做法：收集 server/ 与根目录 HTTP/API 的导出名，再扫 composition root / router / DO 的裸标识符用法，
// 任何「是已知导出、但既没 import 也没本地声明」的名字即判失败。
//
// 保守起见只扫这几个文件（避免把局部变量名误判成未导入的导出），且扫描前剥掉注释与
// 字符串字面量，模板串的 `${}` 内容按代码展开，所以字符串里的同名文本不会误报。
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const api_dir = join(dirname(fileURLToPath(import.meta.url)), "..");
const server_dir = join(api_dir, "server");

/** 需要审计的 composition root / router / DO（存在才扫，随重构阶段自然增减）。 */
const audited_files = [
  "index.js",
  "server/durable_object.js",
  "router.js",
  "admin.js",
  "discover.js",
  "messages_socket.js",
  "script_agent_socket.js",
  "api.js",
  "durable_object_router.js",
  "server/service/worker/auth.js",
  "server/service/worker/session.js",
  "server/service/worker/registration.js",
  "server/service/worker/do_proxy.js",
  "server/service/worker/discovery.js",
  "server/service/worker/rss.js",
  "socket_hub.js",
  "server/infra/device_socket.js",
  "server/service/durable_object/access_tokens.js",
  "server/service/durable_object/activity.js",
  "server/service/durable_object/auth.js",
  "server/service/durable_object/credits.js",
  "server/service/durable_object/devices.js",
  "server/service/durable_object/discovery.js",
  "server/service/durable_object/error.js",
  "server/service/durable_object/logs.js",
  "server/service/durable_object/maintenance.js",
  "server/service/durable_object/redemption.js",
  "server/service/durable_object/scripts.js",
  "server/service/durable_object/tasks.js",
  "server/service/durable_object/users.js",
];

/** @param {string} dir @returns {string[]} */
function list_js_files(dir) {
  const result = [];
  if (!existsSync(dir)) return result;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) result.push(...list_js_files(path));
    else if (entry.endsWith(".js")) result.push(path);
  }
  return result;
}

/**
 * 剥掉注释与字符串字面量，保留标识符与标点。
 * 模板串的 `${…}` 内层按代码片段递归剥离后原样拼回，保证其中的调用点仍可见。
 * @param {string} source
 * @returns {string}
 */
function strip_noise(source) {
  let out = "";
  let index = 0;
  let state = "code";
  let previous = "";
  const length = source.length;
  const can_start_regex = (c) => c === "" || "=(,:;[!&|?{};+-*%<>~^".includes(c);
  while (index < length) {
    const c = source[index];
    const c2 = source[index + 1];
    if (state === "code") {
      if (c === "/" && c2 === "/") { state = "line_comment"; index += 2; continue; }
      if (c === "/" && c2 === "*") { state = "block_comment"; index += 2; continue; }
      if (c === '"' || c === "'") { state = c; index += 1; out += c; continue; }
      if (c === "`") { state = "template"; index += 1; out += c; continue; }
      if (c === "/" && can_start_regex(previous)) { state = "regex"; index += 1; out += c; continue; }
      out += c;
      if (!/\s/.test(c)) previous = c;
      index += 1;
      continue;
    }
    if (state === "line_comment") {
      if (c === "\n") { state = "code"; out += c; previous = ""; }
      index += 1;
      continue;
    }
    if (state === "block_comment") {
      if (c === "*" && c2 === "/") { state = "code"; index += 2; previous = ""; }
      else index += 1;
      continue;
    }
    if (state === "regex") {
      if (c === "\\") { index += 2; continue; }
      if (c === "/") { state = "code"; previous = "/"; out += c; index += 1; continue; }
      index += 1;
      continue;
    }
    if (state === '"' || state === "'") {
      if (c === "\\") { out += "  "; index += 2; continue; }
      if (c === state) { state = "code"; previous = c; out += c; index += 1; continue; }
      out += c === "\n" ? "\n" : " ";
      index += 1;
      continue;
    }
    // template
    if (c === "\\") { out += "  "; index += 2; continue; }
    if (c === "`") { state = "code"; previous = c; out += c; index += 1; continue; }
    if (c === "$" && c2 === "{") {
      let depth = 1;
      let scan = index + 2;
      while (scan < length && depth > 0) {
        if (source[scan] === "{") depth += 1;
        else if (source[scan] === "}") depth -= 1;
        scan += 1;
      }
      const inner = source.slice(index + 2, depth === 0 ? scan - 1 : scan);
      out += ` ${strip_noise(inner)} `;
      index = scan;
      continue;
    }
    out += c === "\n" ? "\n" : " ";
    index += 1;
  }
  return out;
}

/** @param {string} source @returns {Set<string>} 消费方 import 进来的本地名。 */
function imported_names(source) {
  const names = new Set();
  for (const match of source.matchAll(/\bimport\s*\{([^}]*)\}\s*from/g)) {
    for (const clause of match[1].split(",")) {
      const trimmed = clause.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+as\s+/);
      names.add((parts[1] ?? parts[0]).trim());
    }
  }
  for (const match of source.matchAll(/\bimport\s+([A-Za-z_$][\w$]*)\s*(?:,|from)/g)) names.add(match[1]);
  for (const match of source.matchAll(/\bimport\s+\*\s+as\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1]);
  // `export { x } from "…"` 是再导出：对「本文件是否拿到了 x」而言等同于 import。
  for (const match of source.matchAll(/\bexport\s*\{([^}]*)\}\s*from/g)) {
    for (const clause of match[1].split(",")) {
      const trimmed = clause.trim();
      if (!trimmed) continue;
      names.add(trimmed.split(/\s+as\s+/)[0].trim());
    }
  }
  return names;
}

/** @param {string} stripped 已剥掉注释/字符串的源码 @returns {Set<string>} */
function declared_names(stripped) {
  const names = new Set();
  for (const match of stripped.matchAll(/\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1]);
  for (const match of stripped.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1]);
  for (const match of stripped.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1]);
  for (const match of stripped.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}/g)) {
    for (const clause of match[1].split(",")) {
      const target = clause.trim().split(":")[0].trim().replace(/^\.\.\./, "");
      if (target) names.add(target);
    }
  }
  return names;
}

/**
 * @param {string} stripped
 * @returns {Set<string>} 非属性位置的裸标识符（`a.b` 的 b 不算）。
 *
 * 还要排除**对象字面量的键**（`{ route: … }`）：那只是字段名，不是对同名导出的引用。
 * 判据是「后面的非空白字符是 `:` 且前面的非空白字符是 `{` 或 `,`」——三元表达式
 * `c ? route : 1` 的 `route` 前面是 `?`，因此仍被算作真实引用。
 */
function used_names(stripped) {
  const names = new Set();
  for (const match of stripped.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)/g)) {
    const name = match[1];
    let after = match.index + name.length;
    while (after < stripped.length && /\s/.test(stripped[after])) after += 1;
    let before = match.index - 1;
    while (before >= 0 && /\s/.test(stripped[before])) before -= 1;
    if (stripped[after] === ":" && (stripped[before] === "{" || stripped[before] === ",")) {
      continue;
    }
    names.add(name);
  }
  return names;
}

/** @param {string} source @returns {Set<string>} 该模块对外提供的名字。 */
function exported_names(source) {
  const names = new Set();
  for (const match of source.matchAll(/\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1]);
  for (const match of source.matchAll(/\bexport\s+class\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1]);
  for (const match of source.matchAll(/\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1]);
  for (const match of source.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const clause of match[1].split(",")) {
      const trimmed = clause.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+as\s+/);
      names.add((parts[1] ?? parts[0]).trim());
    }
  }
  return names;
}

/** @returns {Set<string>} 业务层和根目录 HTTP/API 对外提供的名字（先剥注释/字符串，避免模板串里的假 export）。 */
function known_exports() {
  const names = new Set();
  for (const file of [...list_js_files(server_dir), ...audited_files.filter(file => !file.startsWith("server/")).map(file => join(api_dir, file))]) {
    for (const name of exported_names(strip_noise(readFileSync(file, "utf8")))) names.add(name);
  }
  return names;
}

/** @param {string} source @returns {string[]} 用了已知导出却没 import / 本地声明的名字。 */
function unresolved_exports(source, known) {
  const stripped = strip_noise(source);
  const imported = imported_names(stripped);
  const declared = declared_names(stripped);
  return [...used_names(stripped)]
    .filter((name) => known.has(name) && !imported.has(name) && !declared.has(name))
    .sort();
}

test("扫不到任何已知导出时判失败（护栏自身不能静默失效）", () => {
  const known = known_exports();
  assert.ok(known.size > 50, `server/ 下应当扫出足够多的导出，实际 ${known.size}`);
});

test("模板串里的 export 声明不算真导出", () => {
  const synthetic = 'const t = `\nexport const fake_name = 1;\n`;';
  assert.ok(!exported_names(strip_noise(synthetic)).has("fake_name"));
});

test("剥噪声后仍能看见模板串插值里的调用点", () => {
  const stripped = strip_noise("const a = `x ${json_response(1)} y`;");
  assert.match(stripped, /json_response/);
  assert.doesNotMatch(strip_noise("const a = `json_response`;"), /json_response/);
  assert.doesNotMatch(strip_noise("// json_response\nconst a = 1;"), /json_response/);
});

test("字符串字面量必须闭合，不能吞掉其后全部代码", () => {
  assert.match(strip_noise(`const a = "x"; void json_response(1);`), /json_response/);
  assert.match(strip_noise(`const a = 'x'; void json_response(1);`), /json_response/);
  assert.match(strip_noise(`const a = "'"; void json_response(1);`), /json_response/);
  assert.match(strip_noise(`const a = /x/; void json_response(1);`), /json_response/);
});

test("对象字面量的键不算一次裸引用，三元里的同名值仍算", () => {
  assert.ok(!used_names(strip_noise("const o = { route: 1 };")).has("route"));
  assert.ok(!used_names(strip_noise("const o = { a, route: 1 };")).has("route"));
  assert.ok(used_names(strip_noise("const x = c ? route : 1;")).has("route"));
  assert.ok(used_names(strip_noise("const o = { route: route };")).has("route"));
  assert.ok(used_names(strip_noise("const o = { a, b };")).has("a"));
});

test("已知导出在该用它的文件里必须被 import 或本地声明", () => {
  const known = known_exports();
  const audited = audited_files.filter((file) => existsSync(join(api_dir, file)));
  assert.ok(audited.length > 0, "至少要有一个被审计的文件");
  for (const file of audited) {
    const source = readFileSync(join(api_dir, file), "utf8");
    const unresolved = unresolved_exports(source, known);
    assert.equal(
      unresolved.length,
      0,
      `${file} 用了未导入的导出：${unresolved.join(", ")}`,
    );
  }
});
