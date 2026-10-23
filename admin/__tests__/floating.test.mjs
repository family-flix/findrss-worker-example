import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const bundle = await build({
  stdin: {
    contents: 'export { FloatingModel } from "./floating.js"; export { configure_frui } from "./platform.js"; export { Select } from "./select.js"; export { DropdownMenu } from "./dropdown-menu.js";',
    resolveDir: fileURLToPath(new URL("../components/frui", import.meta.url)), loader: "js",
  },
  bundle: true, write: false, format: "iife", globalName: "floating_fixture",
});
const runtime = readFileSync(new URL("../../public/assets/timeless/0.34.2/timeless.umd.min.js", import.meta.url), "utf8");

function rect(x, y, width, height) {
  return { x, y, left: x, top: y, right: x + width, bottom: y + height, width, height };
}

function fixture({ scoped = true } = {}) {
  const context = vm.createContext({ console, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {} });
  context.window = context;
  vm.runInContext(runtime, context);
  const { Timeless } = context;
  context.vm = Timeless.vm;
  context.ui = Timeless.ui;
  const layout = { x: 120, y: 180, scale: 0.5, left: 32, top: 48, width: 200, height: 32 };
  const root = {
    offsetWidth: 560, offsetHeight: 600, clientWidth: 560, clientHeight: 600,
    clientLeft: 0, clientTop: 0, scrollLeft: 0, scrollTop: 0,
    getBoundingClientRect: () => rect(layout.x, layout.y, 560 * layout.scale, 600 * layout.scale),
  };
  root.ownerDocument = { body: scoped ? {} : root };
  function visual_rect(x, y, width, height) {
    return rect(layout.x + (x + root.clientLeft - root.scrollLeft) * layout.scale,
      layout.y + (y + root.clientTop - root.scrollTop) * layout.scale, width * layout.scale, height * layout.scale);
  }
  Timeless.setPlatform({
    getClippingRect: () => rect(0, 0, root.clientWidth, root.clientHeight),
    getOffsetParent: () => root, isElement: () => true, isRTL: () => false,
    getScale: () => ({ x: layout.scale, y: layout.scale }),
    getElementRects: ({ reference, floating }) => ({ reference: reference.getRect(), floating: floating.getRect() }),
  });
  vm.runInContext(bundle.outputFiles[0].text, context);
  const api = context.floating_fixture;
  api.configure_frui({ floating_root: () => root, viewport: () => ({ width: root.clientWidth, height: root.clientHeight }) });
  const reference = { getBoundingClientRect: () => visual_rect(layout.left, layout.top, layout.width, layout.height), focus() {} };
  const floating = { getRect: () => visual_rect(layout.left, layout.top + layout.height + 4, 200, 160) };
  return { context, api, layout, root, reference, floating };
}

test("画板浮层将视口位置和缩放后的尺寸还原为局部 CSS 坐标", async () => {
  const f = fixture();
  const store = new f.context.vm.SelectCore({ position: "popper" });
  const model = f.api.FloatingModel({ store });
  try {
    model.reference(f.reference);
    model.popper.setFloating(f.floating);
    await model.popper.place();
    assert.equal(model.popper.reference.getRect().width, 200);
    assert.equal(model.popper.floating.getRect().height, 160);
    assert.equal(model.popper.state.x, 32);
    assert.equal(model.popper.state.y, 84);
    model.toggle();
    model.close();
    f.layout.left = 80;
    model.toggle();
    await new Promise(setImmediate);
    assert.equal(model.popper.state.x, 80, "保留浮层节点时，重新展开也必须重新定位");
    f.layout.left = 32;
    assert.equal(model.popper.state.placement, "bottom-start");

    f.layout.x = -300; f.layout.y = 900; f.layout.scale = 1.5;
    await model.popper.place();
    assert.equal(model.popper.state.x, 32);
    assert.equal(model.popper.state.y, 84);
    f.root.clientLeft = 2; f.root.clientTop = 3;
    f.root.scrollLeft = 10; f.root.scrollTop = 20;
    await model.popper.place();
    assert.equal(model.popper.state.x, 32);
    assert.equal(model.popper.state.y, 84);
  } finally { model.destroy(); store.destroy(); }
});

test("画板浮层在局部边界内翻转和约束横向位置", async () => {
  const f = fixture();
  f.layout.left = 500; f.layout.top = 570;
  const model = f.api.FloatingModel();
  try {
    model.reference(f.reference);
    model.popper.setFloating(f.floating);
    await model.popper.place();
    assert.equal(model.popper.state.x, 352);
    assert.equal(model.popper.state.placement, "top-end");
    assert.equal(model.popper.state.y, 400);
  } finally { model.destroy(); }
});

test("真实文档 body 的浮层保留视口坐标", async () => {
  const f = fixture({ scoped: false });
  f.layout.x = 0; f.layout.y = 0; f.layout.scale = 1;
  const store = new f.context.vm.SelectCore({ position: "popper" });
  const model = f.api.FloatingModel({ store });
  try {
    model.reference(f.reference);
    model.popper.setFloating(f.floating);
    await model.popper.place();
    assert.equal(model.popper.state.x, 32);
    assert.equal(model.popper.state.y, 84);
  } finally { model.destroy(); store.destroy(); }
});

function find(node, name) {
  if (node?.state?.attributes?.n === name) return node;
  for (const child of node?.children || []) { const result = find(child, name); if (result) return result; }
  return null;
}

test("Select 默认展开和鼠标键盘重开时同步画板局部宽度与最新位置", async () => {
  const f = fixture();
  const select = f.api.Select({ defaultOpen: true, attributes: { n: "canvas-select" }, options: [{ value: "one", label: "选项" }] });
  const trigger = find(select, "canvas-select");
  const mount_popup = async () => {
    const popup = find(select, "canvas-select-popup");
    popup.onMounted({ target: { getBoundingClientRect: f.floating.getRect } });
    await new Promise(setImmediate);
    return popup;
  };
  try {
    trigger.onMounted({ target: f.reference });
    let popup = await mount_popup();
    assert.equal(popup.state.style.width, "200px");
    assert.equal(popup.state.style.transform, "translate3d(32px, 84px, 0)");
    const layer = new f.context.vm.DismissableLayerCore().layerManager.getTopLayer();
    const anchor_rect = f.reference.getBoundingClientRect();
    assert.equal(layer.containsPoint(anchor_rect.left + 1, anchor_rect.top + 1), true);
    assert.equal(layer.containsPoint(0, 0), false);
    trigger.events.onClick({ currentTarget: f.reference });
    await new Promise(setImmediate);
    assert.equal(find(select, "canvas-select-popup"), null);
    f.layout.left = 80; f.layout.top = 120; f.layout.scale = 1.25;
    f.layout.width = 240;
    trigger.events.onClick({ currentTarget: f.reference });
    popup = await mount_popup();
    assert.equal(popup.state.style.width, "240px");
    assert.equal(popup.state.style.transform, "translate3d(80px, 156px, 0)");
    trigger.events.onClick({ currentTarget: f.reference });
    await new Promise(setImmediate);
    f.layout.left = 120; f.layout.top = 200;
    trigger.events.onKeyDown({ key: "ArrowDown", preventDefault() {}, stopPropagation() {} });
    popup = await mount_popup();
    assert.equal(popup.state.style.transform, "translate3d(120px, 236px, 0)");
  } finally { select.destroy(); }
});

test("画板下拉菜单的定位使用局部坐标，触发器与菜单点击区域保留视口坐标", async () => {
  const f = fixture();
  const menu = f.api.DropdownMenu({ trigger: ["菜单"], attributes: { n: "canvas-menu" } });
  const trigger = find(menu, "canvas-menu");
  try {
    trigger.onMounted({ target: f.reference });
    trigger.events.onClick({ currentTarget: f.reference });
    const popup = find(menu, "dropdown-menu");
    popup.onMounted({ target: { getBoundingClientRect: f.floating.getRect, querySelector: () => null } });
    await new Promise(setImmediate);
    assert.equal(popup.state.style.transform, "translate3d(32px, 90px, 0)");
    const layer = new f.context.vm.DismissableLayerCore().layerManager.getTopLayer();
    for (const box of [f.reference.getBoundingClientRect(), f.floating.getRect()]) {
      assert.equal(layer.containsPoint(box.left + 1, box.top + 1), true);
    }
    assert.equal(layer.containsPoint(0, 0), false);
  } finally { menu.destroy(); }
});
