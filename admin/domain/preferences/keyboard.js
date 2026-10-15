// 与 server/domain/keyboard.js 保持一致：账号级快捷键的默认值与校验。
const definitions = [
  ["page_dashboard", "页面", "首页", "Alt+Digit1"],
  ["page_timeline", "页面", "时间线", "Alt+Digit2"],
  ["page_subscriptions", "页面", "订阅", "Alt+Digit3"],
  ["page_search", "页面", "搜索", "Alt+Digit4"],
  ["page_collections", "页面", "收藏", "Alt+Digit5"],
  ["page_notes", "页面", "笔记", "Alt+Digit6"],
  ["page_automation", "页面", "自动化流程", "Alt+Digit7"],
  ["page_queue", "页面", "队列", "Alt+Digit8"],
  ["page_settings", "页面", "设置", "Control+KeyO"],
  ["subscription_add", "订阅源", "添加订阅源", "Alt+KeyN"],
  ["reading_next", "阅读", "选择下一条", "KeyJ,ArrowDown"],
  ["reading_previous", "阅读", "选择上一条", "KeyK,ArrowUp"],
  ["reading_first", "阅读", "回到列表第一条", "KeyGKeyG,Home"],
  ["reading_open", "阅读", "打开选中的内容", "Enter,Space"],
  ["reading_mark_all", "阅读", "当前范围全部已读", "Control+KeyB,Meta+KeyB"],
  ["xiaoxun_send", "小讯", "发送消息", "Enter"],
  ["messages", "其他", "打开消息", "Alt+KeyM"],
  ["account_menu", "其他", "打开账号菜单", "Alt+KeyA"],
].map(([id, group, label, binding]) => Object.freeze({ id, group, label, binding, scope: group === "小讯" ? "xiaoxun" : "reader" }));
const modifiers = ["Control", "Meta", "Alt", "Shift"];
const aliases = { ctrl: "Control", control: "Control", cmd: "Meta", command: "Meta", meta: "Meta", alt: "Alt", option: "Alt", shift: "Shift", "⌘": "Meta", "空格": "Space", space: "Space", esc: "Escape", escape: "Escape", enter: "Enter", home: "Home", end: "End", tab: "Tab", backspace: "Backspace", delete: "Delete", arrowup: "ArrowUp", arrowdown: "ArrowDown", arrowleft: "ArrowLeft", arrowright: "ArrowRight", "↑": "ArrowUp", "↓": "ArrowDown", "←": "ArrowLeft", "→": "ArrowRight", pageup: "PageUp", pagedown: "PageDown" };
function parse_binding(raw) {
  if (typeof raw !== "string" || raw.length > 256) return null;
  if (!raw.trim()) return "";
  const alternatives = raw.split(",");
  if (alternatives.length > 8) return null;
  const result = [];
  for (const alternative of alternatives) {
    const parts = alternative.trim().split("+").map(part => {
      part = part.trim();
      if (/^(Control|Meta|Alt|Shift)(Left|Right)$/.test(part)) return part.replace(/(Left|Right)$/, "");
      if (Object.hasOwn(aliases, part.toLowerCase())) return aliases[part.toLowerCase()];
      if (/^[a-z]$/i.test(part)) return `Key${part.toUpperCase()}`;
      if (/^\d$/.test(part)) return `Digit${part}`;
      if (/^(Key[A-Z]|Digit\d|F([1-9]|1\d|2[0-4]))$/.test(part)) return part;
      if (/^(Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|CapsLock|Insert|Numpad(\d|Add|Subtract|Multiply|Divide|Decimal|Enter|Equal))$/.test(part)) return part;
      if (/^(gg|KeyGKeyG)$/i.test(part)) return "KeyGKeyG";
      return null;
    });
    const key = parts.pop();
    if (!key || modifiers.includes(key) || parts.some(part => !modifiers.includes(part)) || new Set(parts).size !== parts.length || (key === "KeyGKeyG" && parts.length)) return null;
    result.push([...modifiers.filter(modifier => parts.includes(modifier)), key].join("+"));
  }
  return [...new Set(result)].join(",");
}
function defaults() { return Object.fromEntries(definitions.map(item => [item.id, item.binding])); }
function normalize(raw) {
  return Object.fromEntries(definitions.map(item => [item.id,
    raw && Object.hasOwn(raw, item.id) ? parse_binding(raw[item.id]) ?? item.binding : item.binding,
  ]));
}
function validate(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, message: "快捷键配置格式错误" };
  const value = defaults(), owners = new Map();
  for (const item of definitions) {
    const binding = Object.hasOwn(raw, item.id) ? parse_binding(raw[item.id]) : item.binding;
    if (binding === null) return { ok: false, message: `${item.label}：快捷键格式错误，请使用 Alt+1、Ctrl+B 等格式` };
    value[item.id] = binding;
    // 小讯仅在对话编辑器内触发，可以与阅读页面复用按键。
    if (!owners.has(item.scope)) owners.set(item.scope, new Map());
    const scope_owners = owners.get(item.scope);
    for (const key of binding.split(",").filter(Boolean)) {
      if (scope_owners.has(key)) return { ok: false, message: `${item.label}与${scope_owners.get(key)}使用了相同的快捷键` };
      if ((key === "KeyGKeyG" && scope_owners.has("KeyG")) || (key === "KeyG" && scope_owners.has("KeyGKeyG"))) return { ok: false, message: `${item.label}：G 与 GG 连按快捷键冲突` };
      scope_owners.set(key, item.label);
    }
  }
  return { ok: true, value };
}
function display(binding) {
  return String(binding || "").split(",").map(key => key.replace(/KeyGKeyG/g, "GG").replace(/Control/g, "Ctrl").replace(/Meta/g, "Cmd").replace(/Key([A-Z])/g, "$1").replace(/Digit(\d)/g, "$1").replace(/ArrowUp/g, "↑").replace(/ArrowDown/g, "↓").replace(/ArrowLeft/g, "←").replace(/ArrowRight/g, "→").replace(/Space/g, "空格")).join(", ");
}
const KeyboardSettingsModel = Object.freeze({ definitions: Object.freeze(definitions), groups: Object.freeze(["页面", "订阅源", "阅读", "小讯", "其他"]), defaults, normalize, validate, display, parse: parse_binding });
export { KeyboardSettingsModel };
