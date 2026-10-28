export const DETECT_SNAPSHOT_BYTES = 1024 * 1024;
export const DETECT_RESULT_BYTES = 8 * 1024 * 1024;

function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function check(condition, message) { if (!condition) throw new Error(message); }
function size(value, limit) { check(new TextEncoder().encode(JSON.stringify(value)).length <= limit, "检测数据超过大小限制"); }
export function detect_json(value) {
  if (Array.isArray(value)) return "[" + value.map(detect_json).join(",") + "]";
  if (object(value)) return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + detect_json(value[key])).join(",") + "}";
  return JSON.stringify(value);
}
function equal(left, right) { return detect_json(left) === detect_json(right); }
function json_value(value, depth = 0) {
  check(depth <= 20, "检测数据嵌套过深");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") { check(Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER, "检测数值无效，大整数请用字符串"); return value; }
  if (Array.isArray(value)) { check(value.length <= 2000, "检测数组过长"); return value.map(item => json_value(item, depth + 1)); }
  check(object(value), "检测数据必须是 JSON 值");
  check(Object.keys(value).length <= 2000, "检测字段过多");
  const result = Object.create(null);
  for (const key of Object.keys(value).sort()) {
    check(key.length <= 200 && !/[\u0000-\u001f\u007f]/.test(key) && !["__proto__", "prototype", "constructor"].includes(key), "检测字段名称无效");
    result[key] = json_value(value[key], depth + 1);
  }
  return result;
}

export function normalize_detect_snapshot(value) {
  check(object(value) && Object.keys(value).length > 0 && Object.keys(value).length <= 32, "snapshot 必须包含 1–32 个检测对象");
  const result = Object.create(null);
  let count = 0;
  for (const id of Object.keys(value).sort()) {
    check(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(id), "检测对象 ID 无效");
    const target = value[id];
    check(object(target) && ["content", "record", "list"].includes(target.type), "检测对象类型必须是 content、record 或 list");
    check(target.present === undefined || typeof target.present === "boolean", "present 必须是布尔值");
    const normalized = { type: target.type, present: target.present !== false };
    result[id] = normalized;
    if (target.incomplete === true) {
      check(typeof target.reason === "string" && target.reason.trim() && target.reason.length <= 1000, "不完整检测对象须提供 reason");
      Object.assign(normalized, { incomplete: true, reason: target.reason }); continue;
    }
    check(target.incomplete === undefined || target.incomplete === false, "incomplete 必须是布尔值");
    if (!normalized.present) { check(target.coverage !== "partial", "不完整列表不能确认为不存在"); continue; }
    if (target.type === "content") {
      check([undefined, "text", "html"].includes(target.format) && typeof target.value === "string", "正文需要 text/html format 和字符串 value");
      Object.assign(normalized, { format: target.format || "text", value: target.value });
    } else if (target.type === "record") {
      check(object(target.value), "record.value 必须是对象"); normalized.value = json_value(target.value);
    } else {
      check(["complete", "window", "partial"].includes(target.coverage), "列表必须声明 coverage=complete/window/partial");
      check(target.ordered === undefined || typeof target.ordered === "boolean", "ordered 必须是布尔值");
      check(target.scope === undefined || typeof target.scope === "string" && target.scope.length <= 200, "scope 必须是最多 200 字符的字符串");
      check(target.coverage !== "window" || target.scope?.trim(), "窗口列表需要稳定的 scope");
      check(Array.isArray(target.items) && target.items.length <= 2000, "列表必须提供最多 2000 个 items");
      const ids = new Set();
      Object.assign(normalized, { coverage: target.coverage, scope: target.scope || "", ordered: target.ordered === true,
        items: target.items.map(item => {
          check(object(item) && typeof item.id === "string" && item.id.trim() && item.id.length <= 200, "列表项必须提供稳定的字符串 ID");
          check(!ids.has(item.id), "列表项 ID 重复：" + item.id); ids.add(item.id);
          check(object(item.data), "列表项 data 必须是对象");
          count++; check(count <= 5000, "检测列表项总数超过 5000");
          return { id: item.id, data: json_value(item.data) };
        }) });
    }
  }
  size(result, DETECT_SNAPSHOT_BYTES);
  return result;
}

export function normalize_detect_previous(value) {
  if (value === undefined || value === null) return null;
  check(object(value), "previous 必须是旧快照对象或 null");
  const envelope = Object.hasOwn(value, "snapshot") && !["content", "record", "list"].includes(value.snapshot?.type);
  check(!envelope || value.snapshot !== null, "旧快照没有有效 snapshot");
  if (envelope && value.status !== undefined) check(["initialized", "unchanged", "changed"].includes(value.status), "旧快照必须来自成功可靠的检测");
  const snapshot = normalize_detect_snapshot(envelope ? value.snapshot : value);
  check(!Object.values(snapshot).some(target => target.incomplete || target.present && target.type === "list" && target.coverage === "partial"), "旧快照必须是完整的有效数据");
  return { id: envelope && typeof value.id === "string" ? value.id.slice(0, 128) : null,
    snapshot,
    ...(envelope && typeof value.context_key === "string" ? { context_key: value.context_key } : {}) };
}

function pointer(key) { return key.replace(/~/g, "~0").replace(/\//g, "~1"); }
function fields(before, after, path = "") {
  const changes = [];
  for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    const next = path + "/" + pointer(key);
    if (!Object.hasOwn(before, key)) changes.push({ op: "add", path: next, after: after[key] });
    else if (!Object.hasOwn(after, key)) changes.push({ op: "remove", path: next, before: before[key] });
    else if (object(before[key]) && object(after[key])) changes.push(...fields(before[key], after[key], next));
    else if (!equal(before[key], after[key])) changes.push({ op: "replace", path: next, before: before[key], after: after[key] });
  }
  return changes;
}

// A longest increasing subsequence leaves insertion/deletion shifts out of move events.
function stationary_ids(before, after) {
  const positions = new Map(before.map((item, index) => [item.id, index]));
  const common = after.filter(item => positions.has(item.id));
  const tails = [], parents = [];
  for (let index = 0; index < common.length; index++) {
    const position = positions.get(common[index].id);
    let low = 0, high = tails.length;
    while (low < high) { const middle = (low + high) >> 1; if (positions.get(common[tails[middle]].id) < position) low = middle + 1; else high = middle; }
    parents[index] = low ? tails[low - 1] : -1; tails[low] = index;
  }
  const result = new Set();
  for (let index = tails.at(-1) ?? -1; index >= 0; index = parents[index]) result.add(common[index].id);
  return result;
}

export function compare_detect_snapshots(previous, current) {
  current = normalize_detect_snapshot(current);
  previous = previous == null ? null : normalize_detect_snapshot(previous);
  const issues = Object.entries(current).filter(([, value]) => value.incomplete || value.type === "list" && value.present && value.coverage === "partial")
    .map(([target, value]) => ({ target, reason: value.reason || "列表采集不完整" }));
  if (previous) {
    if (!equal(Object.keys(previous), Object.keys(current))) issues.push({ reason: "检测对象集合变化，请重置基线" });
    for (const [id, value] of Object.entries(current)) {
      const old = previous[id];
      if (!old) continue;
      if (old.type !== value.type || old.present && value.present && ["format", "coverage", "scope", "ordered"].some(key => old[key] !== value[key])) {
        issues.push({ target: id, reason: "检测结构或范围变化，请重置基线" });
      }
    }
  }
  if (issues.length) return { status: "inconclusive", changes: [], matches: [], issues };
  if (!previous) return { status: "initialized", changes: [], matches: [], issues: [] };
  const changes = [];
  for (const [target, value] of Object.entries(current)) {
    const old = previous[target];
    if (old.present !== value.present) {
      changes.push({ type: value.present ? "target.appeared" : "target.disappeared", target, before: old, after: value }); continue;
    }
    if (!value.present) continue;
    if (value.type === "content") {
      if (old.value !== value.value) changes.push({ type: "content.updated", target, before: old.value, after: value.value });
    } else if (value.type === "record") {
      changes.push(...fields(old.value, value.value).map(({ op, ...field }) => ({ type: { add: "field.added", remove: "field.removed", replace: "field.updated" }[op], target, ...field })));
    } else {
      const before = new Map(old.items.map((item, index) => [item.id, { ...item, index }]));
      const after = new Map(value.items.map((item, index) => [item.id, { ...item, index }]));
      const stationary = value.ordered ? stationary_ids(old.items, value.items) : null;
      for (const item of old.items) if (!after.has(item.id)) changes.push({ type: value.coverage === "window" ? "list.item_left" : "list.item_removed", target, item_id: item.id, before: item.data });
      for (const item of value.items) {
        const prior = before.get(item.id);
        if (!prior) changes.push({ type: value.coverage === "window" ? "list.item_entered" : "list.item_added", target, item_id: item.id, after: item.data });
        else {
          const modified = fields(prior.data, item.data);
          if (modified.length) changes.push({ type: "list.item_updated", target, item_id: item.id, fields: modified });
          if (stationary && !stationary.has(item.id)) changes.push({ type: "list.item_moved", target, item_id: item.id, from: prior.index, to: after.get(item.id).index,
            before_previous_id: old.items[prior.index - 1]?.id ?? null, after_previous_id: value.items[after.get(item.id).index - 1]?.id ?? null });
        }
      }
    }
  }
  return { status: changes.length ? "changed" : "unchanged", changes, matches: [], issues: [] };
}

export function normalize_detect_result(value, baseline = null) {
  check(object(value) && value.kind === "detect" && value.schema_version === 1, "检测结果需要 kind=detect 和 schema_version=1");
  check(typeof value.title === "string" && value.title.trim() && value.title.length <= 200, "检测标题须为 1–200 字符");
  let link;
  try { link = new URL(value.link); } catch { throw new Error("检测来源链接无效"); }
  check(typeof value.link === "string" && !/[\s\\]/.test(value.link) && ["http:", "https:"].includes(link.protocol) && !link.username && !link.password && link.href.length <= 8192, "检测来源必须是无凭据的 HTTP(S) 地址");
  const previous = normalize_detect_previous(baseline);
  const snapshot = normalize_detect_snapshot(value.snapshot);
  const standard = compare_detect_snapshots(previous?.snapshot, snapshot);
  check(Array.isArray(value.changes) && value.changes.length <= 20000, "changes 必须是最多 20000 项的数组");
  const allowed = new Map(standard.changes.map(change => [detect_json([change.type, change.target, change.item_id, change.path]), change]));
  const seen = new Set();
  const changes = value.changes.map(raw => {
    const change = json_value(raw);
    const key = detect_json([change.type, change.target, change.item_id, change.path]);
    check(!seen.has(key), "变化事件重复"); seen.add(key);
    const actual = allowed.get(key);
    check(actual, "变化事件与前后快照不符");
    if (change.type === "list.item_updated") {
      check(Array.isArray(change.fields) && change.fields.length > 0, "条目更新必须包含 fields");
      const valid = new Set(actual.fields.map(detect_json)), unique = new Set();
      for (const field of change.fields) { const identity = detect_json(field); check(valid.has(identity) && !unique.has(identity), "条目变化字段与快照不符或重复"); unique.add(identity); }
      check(Object.keys(change).every(name => ["type", "target", "item_id", "fields"].includes(name)), "变化事件包含未知字段");
    } else check(equal(change, actual), "变化事件中的前后值与快照不符");
    return change;
  });
  let issues = standard.issues;
  const reported = value.issues === undefined ? [] : value.issues;
  check(Array.isArray(reported) && reported.length <= 64, "issues 必须是最多 64 项的数组");
  for (const issue of reported) check(object(issue) && typeof issue.reason === "string" && issue.reason.trim() && issue.reason.length <= 1000
    && (issue.target === undefined || typeof issue.target === "string" && Object.hasOwn(snapshot, issue.target)), "判断不明确时需要有效的 reason 和检测对象");
  const uncertain = value.status === "inconclusive" && reported.length > 0;
  if (uncertain) issues = [...new Map([...issues, ...reported].map(issue => [detect_json(issue), json_value(issue)])).values()];
  const status = standard.status === "inconclusive" || uncertain ? "inconclusive" : standard.status === "initialized" ? "initialized" : changes.length ? "changed" : "unchanged";
  check(value.status === status, "检测状态与变化明细不符");
  check(status !== "inconclusive" || changes.length === 0, "无法可靠判断时不能返回变化事件");
  check(status === "inconclusive" || reported.length === 0, "存在不确定原因时必须返回 inconclusive");
  const matches = value.matches === undefined ? [] : value.matches;
  check(Array.isArray(matches) && matches.length <= 100, "matches 必须是最多 100 项的数组");
  const rules = new Set();
  for (const match of matches) {
    check(object(match) && typeof match.id === "string" && match.id.trim() && match.id.length <= 128 && !rules.has(match.id), "规则命中必须包含唯一 ID"); rules.add(match.id);
    check(typeof match.label === "string" && match.label.trim() && match.label.length <= 200, "规则命中需要 label");
    if (match.change_indexes !== undefined) check(Array.isArray(match.change_indexes) && match.change_indexes.every(index => Number.isInteger(index) && index >= 0 && index < changes.length), "规则引用的变化不存在");
  }
  check(!["initialized", "inconclusive"].includes(status) || matches.length === 0, "尚未建立可靠比较时不能返回规则命中");
  const result = { kind: "detect", schema_version: 1, title: value.title.trim(), link: link.href, status,
    previous_id: previous?.id || null, observed_at: new Date().toISOString(), snapshot, changes, matches: json_value(matches), issues };
  size(result, DETECT_RESULT_BYTES);
  return result;
}
