import { page_source } from "./page_source.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

const fixture = { name: "sid", value: "submitted", domain: ".example.com", path: "/", hostOnly: false, secure: true, expirationDate: 1900000000 };
const source = page_source("cookies.js");

function setup(fetch, confirm = () => true) {
  const ref = (value) => ({ value, set(next) { this.value = next; }, as(next) { this.value = next; } });
  const element = (props, children = []) => ({ props, children });
  const context = vm.createContext({ document: { activeElement: null }, window: {
    confirm, FindRSSAdminAuth: { fetch }, FindRSSAdminPages: {},
    FindRSSAdminShell: { Page: (_, children) => element({}, children) },
    Timeless: { DOM: {}, ref, refarr: ref,
      computed: (source, map) => ({ get value() { return map(source.value); } }),
      combine: (sources, map) => ({ get value() { return map(Object.fromEntries(Object.entries(sources).map(([key, value]) => [key, value.value]))); } }),
      For: ({ each, render }) => element({}, each.value.map(render)),
      Show: ({ when, ok }) => when.value ? ok() : element({}),
      Button: element, Dialog: element, Input: element, Textarea: element, View: element },
  } });
  context.window.FindRSSAdminUI = context.window.Timeless;
  context.window.FindRSSAdminUI.Card = context.window.Timeless.View;
  vm.runInContext(source + "\nglobalThis.model = CookiesViewModel();", context);
  return context;
}

function walk(node, nodes = []) {
  nodes.push(node);
  for (const child of node.children || []) if (child?.props) walk(child, nodes);
  return nodes;
}

test("导入按首个等号解析，更新已有值并保留属性、其他路径和草稿", async () => {
  const calls = [];
  const context = setup(async (_, options) => {
    if (!options.body) return Response.json({ cookies: [fixture, { ...fixture, path: "/account" }, { ...fixture, name: "draft" }] });
    const body = JSON.parse(options.body);
    calls.push({ method: options.method, body });
    return Response.json({ cookie: { ...fixture, ...body }, count: 3 + calls.filter(call => call.method === "POST").length });
  });
  const { model } = context;
  await model.methods.refresh();
  const group = model.state.groups.value[0];
  model.methods.set_value(group.rows.value[2].value, "unsaved");
  model.methods.open_import();
  assert.equal(model.state.import_domain.value, fixture.domain);
  const dialog = vm.runInContext("CookieImportView({ model })", context);
  walk(dialog).find(node => node.props.attributes?.n === "cookies-import-text").props.onInput({ target: { value: " sid=a=b==; empty=; new_key=v2; " } });
  await dialog.props.footer[1].props.onClick();
  assert.deepEqual(calls.map(call => call.method), ["PATCH", "POST", "POST"]);
  assert.deepEqual(calls[0].body, { domain: fixture.domain, name: "sid", path: "/", value: "a=b==" });
  assert.equal(group.rows.value[0].cookie.secure, true);
  assert.equal(group.rows.value[1].cookie.value, fixture.value);
  assert.equal(group.rows.value[2].value.value, "unsaved");
  assert.equal(group.rows.value[3].cookie.value, "");
  assert.equal(model.state.import_open.value, false);
  assert.equal(model.state.import_text.value, "");
  assert.equal(model.state.count.value, 5);
});

test("导入先校验完整字符串，错误不提交，取消清除输入", async () => {
  let writes = 0;
  const { model } = setup(async (_, options) => {
    if (options.body) writes++;
    return Response.json({ cookies: [] });
  });
  await model.methods.refresh();
  model.methods.open_import();
  model.methods.set_value(model.state.import_text, "a=b");
  await model.methods.import_cookies();
  assert.match(model.state.import_error.value, /域名/);
  model.methods.set_value(model.state.import_domain, ".example.com");
  for (const text of ["", "a=b; broken", "=b", "a=b; a=c", "a=b\nc=d"]) {
    model.methods.set_value(model.state.import_text, text);
    await model.methods.import_cookies();
    assert.ok(model.state.import_error.value);
  }
  assert.equal(writes, 0);
  model.methods.close_import();
  assert.equal(model.state.import_open.value, false);
  assert.equal(model.state.import_text.value, "");
});

test("新域名导入中断保留已保存结果，重试只提交剩余条目", async () => {
  let fail = true;
  const calls = [];
  const { model } = setup(async (_, options) => {
    if (!options.body) return Response.json({ cookies: [] });
    const cookie = JSON.parse(options.body);
    calls.push(cookie.name);
    if (cookie.name === "second" && fail) return Response.json({ error: "保存失败" }, { status: 500 });
    return Response.json({ cookie, count: cookie.name === "first" ? 1 : 2 });
  });
  await model.methods.refresh();
  model.methods.open_import();
  model.methods.set_value(model.state.import_domain, " .NEW.COM ");
  model.methods.set_value(model.state.import_text, "first=1; second=2");
  await model.methods.import_cookies();
  assert.equal(model.state.import_open.value, true);
  assert.match(model.state.import_error.value, /已导入 1 条.*保存失败/);
  assert.equal(model.state.import_text.value, "second=2");
  assert.equal(model.state.selected_domain.value, ".new.com");
  assert.equal(model.state.groups.value[0].rows.value.length, 1);
  fail = false;
  await model.methods.import_cookies();
  assert.deepEqual(calls, ["first", "second", "second"]);
  assert.equal(model.state.groups.value[0].rows.value.length, 2);
  assert.equal(model.state.busy.value, false);
  assert.equal(model.state.import_open.value, false);
});

test("按域名聚合，同名不同路径分别列出，保存仅发送目标 Cookie 并保留其他草稿", async () => {
  const calls = [];
  const second = { ...fixture, path: "/account", value: "other-path" };
  const third = { ...fixture, domain: ".other.com" };
  const { model } = setup(async (url, options) => {
    calls.push({ url, options });
    return Response.json(options.body ? { cookie: { ...fixture, value: "edited" }, count: 3 } : { cookies: [third, fixture, second] });
  });
  await model.methods.refresh();
  assert.deepEqual(Array.from(model.state.groups.value, group => group.domain), [".example.com", ".other.com"]);
  const group = model.state.groups.value[0];
  assert.equal(group.rows.value.length, 2);
  assert.notEqual(group.rows.value[0].id, group.rows.value[1].id);
  model.methods.set_value(group.rows.value[0].value, "edited");
  model.methods.set_value(group.rows.value[1].value, "unsaved");
  await model.methods.save_cookie(group.rows.value[0]);
  assert.equal(calls[1].url, "/admin/api/cookies");
  assert.equal(calls[1].options.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[1].options.body), { domain: fixture.domain, name: fixture.name, path: "/", value: "edited" });
  assert.equal(group.rows.value[0].cookie.secure, true);
  assert.equal(group.rows.value[1].value.value, "unsaved");
  assert.match(model.state.message.value, /已保存/);
});

test("单条保存失败保留草稿，删除只移除对应路径的 Cookie", async () => {
  let fail = true;
  const calls = [];
  const { model } = setup(async (url, options) => {
    calls.push({ url, options });
    if (!options.body) return Response.json({ cookies: [fixture, { ...fixture, path: "/account" }] });
    return fail ? Response.json({ error: "invalid cookie" }, { status: 400 }) : Response.json({ cookie: null, count: 1 });
  });
  await model.methods.refresh();
  const group = model.state.groups.value[0];
  const row = group.rows.value[0];
  model.methods.set_value(row.value, "invalid;value");
  await model.methods.save_cookie(row);
  assert.equal(row.value.value, "invalid;value");
  assert.equal(row.cookie.value, "submitted");
  assert.match(model.state.error.value, /invalid/);
  fail = false;
  await model.methods.remove_cookie(group, row);
  assert.equal(calls[2].options.method, "DELETE");
  assert.equal(group.rows.value.length, 1);
  assert.equal(group.rows.value[0].cookie.path, "/account");
  assert.equal(model.state.count.value, 1);
});

test("域名内添加 key/value，失败保留输入，成功添加并清空添加表单", async () => {
  let fail = true;
  const calls = [];
  const { model } = setup(async (url, options) => {
    calls.push({ url, options });
    if (!options.body) return Response.json({ cookies: [fixture] });
    return fail ? Response.json({ error: "Cookie 已存在" }, { status: 409 }) :
      Response.json({ cookie: { ...JSON.parse(options.body), secure: false, hostOnly: false, expirationDate: 0 }, count: 2 });
  });
  await model.methods.refresh();
  const group = model.state.groups.value[0];
  assert.equal(group.domain, ".example.com");
  assert.equal(model.state.selected_domain.value, ".example.com");
  await model.methods.add_cookie(group);
  assert.equal(calls.length, 1);
  model.methods.set_value(group.new_name, "new_key");
  model.methods.set_value(group.new_value, "");
  await model.methods.add_cookie(group);
  assert.equal(group.new_name.value, "new_key");
  fail = false;
  await model.methods.add_cookie(group);
  assert.equal(calls[2].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[2].options.body), { domain: ".example.com", name: "new_key", value: "", path: "/" });
  assert.equal(group.rows.value[1].cookie.name, "new_key");
  assert.equal(group.new_name.value, "");
  assert.equal(group.new_value.value, "");
});

test("左侧删除整个域名，切换选择并保留其他域名草稿，最后一个域名删除后显示空状态", async () => {
  const calls = [];
  const confirmations = [];
  const context = setup(async (url, options) => {
    if (!options.body) return Response.json({ cookies: [fixture, { ...fixture, path: "/account" }, { ...fixture, domain: ".other.com" }] });
    calls.push({ url, options });
    return Response.json({ count: calls.length === 1 ? 1 : 0 });
  }, text => { confirmations.push(text); return true; });
  const { model } = context;
  await model.methods.refresh();
  const other = model.state.groups.value[1];
  model.methods.set_value(other.rows.value[0].value, "unsaved");
  model.methods.set_value(other.new_name, "draft");
  const root = vm.runInContext("CookieWorkspaceView({ model })", context);
  const sidebar = walk(root).find(node => node.props.attributes?.n === "cookies-domains");
  const remove = walk(sidebar).find(node => node.props.attributes?.n === "cookie-domain-delete-.example.com");
  assert.match(remove.props.attributes["aria-label"], /example\.com.*所有 Cookie/);
  await remove.props.onClick();
  assert.equal(calls[0].url, "/admin/api/cookies/domain");
  assert.equal(calls[0].options.method, "DELETE");
  assert.deepEqual(JSON.parse(calls[0].options.body), { domain: ".example.com" });
  assert.match(confirmations[0], /example\.com.*所有路径.*无法撤销/);
  assert.equal(model.state.groups.value.length, 1);
  assert.equal(model.state.selected_domain.value, ".other.com");
  assert.equal(model.state.selected_groups.value[0], other);
  assert.equal(other.rows.value[0].value.value, "unsaved");
  assert.equal(other.new_name.value, "draft");
  assert.equal(model.state.count.value, 1);
  await model.methods.remove_domain(other);
  assert.equal(model.state.groups.value.length, 0);
  assert.equal(model.state.selected_domain.value, "");
  assert.equal(model.state.selected_groups.value.length, 0);
  assert.equal(model.state.count.value, 0);
  assert.match(model.state.message.value, /other\.com.*已删除/);
});

test("取消或删除域名失败时保留 Cookie、选择和草稿，忙碌时禁止重复删除", async () => {
  let confirmed = false;
  let writes = 0;
  let finish;
  const { model } = setup(async (_, options) => {
    if (!options.body) return Response.json({ cookies: [fixture] });
    writes++;
    await new Promise(resolve => { finish = resolve; });
    return Response.json({ error: "删除失败" }, { status: 500 });
  }, () => confirmed);
  await model.methods.refresh();
  const group = model.state.groups.value[0];
  model.methods.set_value(group.rows.value[0].value, "draft");
  await model.methods.remove_domain(group);
  assert.equal(writes, 0);
  confirmed = true;
  const pending = model.methods.remove_domain(group);
  assert.equal(model.state.busy.value, true);
  await model.methods.remove_domain(group);
  assert.equal(writes, 1);
  finish();
  await pending;
  assert.equal(model.state.busy.value, false);
  assert.equal(model.state.groups.value[0], group);
  assert.equal(model.state.selected_domain.value, fixture.domain);
  assert.equal(model.state.count.value, 1);
  assert.equal(group.rows.value[0].value.value, "draft");
  assert.match(model.state.error.value, /删除失败/);
});

test("删除未选中的空域名保留当前选择", async () => {
  const { model } = setup(async (_, options) => {
    if (!options.body) return Response.json({ cookies: [fixture, { ...fixture, domain: ".other.com" }] });
    return Response.json({ count: 1 });
  });
  await model.methods.refresh();
  const group = model.state.groups.value[1];
  await model.methods.remove_cookie(group, group.rows.value[0]);
  assert.equal(group.rows.value.length, 0);
  await model.methods.remove_domain(group);
  assert.equal(model.state.groups.value.length, 1);
  assert.equal(model.state.selected_domain.value, fixture.domain);
});

test("切换域名只展示选中域名的键值对，保留各域名未保存的修改", async () => {
  const context = setup(async () => Response.json({ cookies: [fixture, { ...fixture, domain: ".other.com", name: "other_key" }] }));
  const { model } = context;
  await model.methods.refresh();
  assert.equal(model.state.selected_domain.value, ".example.com");
  const group = model.state.selected_groups.value[0];
  model.methods.set_value(group.rows.value[0].value, "unsaved");
  model.methods.set_value(group.new_name, "draft_key");
  model.methods.set_value(group.new_value, "draft_value");
  const render = () => vm.runInContext("CookieWorkspaceView({ model })", context);
  let root = render();
  const names = node => walk(node).map(item => item.props.attributes?.n);
  const sidebar = walk(root).find(node => node.props.attributes?.n === "cookies-domains");
  assert.equal(walk(root).some(node => node.props.attributes?.n === "cookie-new-domain-button"), false);
  const detail = walk(root).find(node => node.props.attributes?.n === "cookies-details");
  assert.equal(names(sidebar).filter(name => name?.startsWith("cookie-domain-select-")).length, 2);
  assert.equal(names(detail).filter(name => name === "cookie-row").length, 1);
  assert.equal(names(sidebar).includes("cookie-row"), false);
  walk(sidebar).find(node => node.props.attributes?.n === "cookie-domain-select-.other.com").props.onClick();
  assert.equal(model.state.selected_domain.value, ".other.com");
  root = render();
  assert.equal(walk(root).find(node => node.props.attributes?.n === "cookie-name").children[0], "other_key");
  assert.equal(walk(root).find(node => node.props.attributes?.n === "cookie-domain-select-.other.com").props.attributes["aria-pressed"].value, "true");
  model.methods.select_domain(".unknown.com");
  assert.equal(model.state.selected_domain.value, ".other.com");
  model.methods.select_domain(".example.com");
  assert.equal(model.state.selected_groups.value[0], group);
  assert.equal(group.rows.value[0].value.value, "unsaved");
  assert.equal(group.new_name.value, "draft_key");
  assert.equal(group.new_value.value, "draft_value");
});

test("重新读取保留当前域名，域名消失时选首项，空列表清除选择", async () => {
  let cookies = [fixture, { ...fixture, domain: ".other.com" }];
  const { model } = setup(async () => Response.json({ cookies }));
  await model.methods.refresh();
  model.methods.select_domain(".other.com");
  await model.methods.refresh();
  assert.equal(model.state.selected_domain.value, ".other.com");
  cookies = [fixture];
  await model.methods.refresh();
  assert.equal(model.state.selected_domain.value, ".example.com");
  cookies = [];
  await model.methods.refresh();
  assert.equal(model.state.selected_domain.value, "");
  assert.equal(model.state.selected_groups.value.length, 0);
});

test("重新读取取消时保留逐条修改和新增草稿，读取失败禁止导入", async () => {
  let calls = 0;
  let fail = true;
  const { model } = setup(async () => {
    calls++;
    return fail ? Response.json({ error: "读取失败" }, { status: 500 }) : Response.json({ cookies: [fixture] });
  }, () => false);
  await model.methods.refresh();
  model.methods.open_import();
  assert.equal(model.state.import_open.value, false);
  assert.equal(model.state.groups.value.length, 0);
  fail = false;
  await model.methods.refresh();
  const group = model.state.groups.value[0];
  model.methods.set_value(group.rows.value[0].value, "unsaved");
  model.methods.set_value(group.new_name, "new_key");
  await model.methods.refresh();
  assert.equal(calls, 2);
  assert.equal(group.rows.value[0].value.value, "unsaved");
  assert.equal(group.new_name.value, "new_key");
});

test("域名组渲染键值列表、单条保存删除和添加入口，没有全量 JSON 编辑器", async () => {
  const context = setup(async () => Response.json({ cookies: [fixture, { ...fixture, name: "second" }] }));
  await context.model.methods.refresh();
  const root = vm.runInContext("CookieGroupView({ model, group: model.state.groups.value[0] })", context);
  const nodes = walk(root);
  const named = (name) => nodes.filter(node => node.props.attributes?.n === name);
  assert.equal(named("cookie-row").length, 2);
  assert.equal(named("cookie-save-button").length, 2);
  assert.equal(named("cookie-delete-button").length, 2);
  assert.equal(named("cookie-add-button").length, 1);
  assert.equal(named("cookies-json-input").length, 0);
  const input = named("cookie-value")[0].children[0];
  input.props.onInput({ target: { value: "edited-in-view" } });
  assert.equal(context.model.state.groups.value[0].rows.value[0].value.value, "edited-in-view");
  assert.equal(vm.runInContext("typeof CookiesPage", context), "function");
});
