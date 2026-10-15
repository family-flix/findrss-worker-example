import { Schema, Fragment } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { keymap } from "prosemirror-keymap";
import { baseKeymap, splitBlock } from "prosemirror-commands";
import { history, undo, redo } from "prosemirror-history";
import { KeyboardSettingsModel } from "../preferences/keyboard.js";
import { ShortcutModel } from "../preferences/shortcut.js";

const schema = new Schema({ nodes: {
  doc: { content: "paragraph+" },
  paragraph: { content: "inline*", group: "block", toDOM: () => ["p", { "data-n": "xiaoxun-input-paragraph", class: "margin-0" }, 0], parseDOM: [{ tag: "p" }] },
  text: { group: "inline" },
  reference: { inline: true, group: "inline", atom: true, selectable: true,
    attrs: { kind: {}, feed_url: {}, article_key: { default: "" }, title: {} },
    leafText: node => `【${node.attrs.kind === "article" ? "文章" : "订阅源"}：${node.attrs.title}】`,
    toDOM: node => ["span", { "data-n": "xiaoxun-input-reference", class: "display-inline padding-2-pixels-5-pixels border-radius-5-pixels background-color-surface color-reader-color-link box-decoration-break-clone webkit-box-decoration-break-clone", contenteditable: "false", title: "引用作为对话上下文，可用退格删除" , style: "--padding-2-pixels-5-pixels: 2px 5px; --border-radius-5-pixels: 5px"},
      `${node.attrs.kind === "article" ? "文章" : "订阅源"} · ${node.attrs.title}`],
  },
} });
const commands = [{ kind: "article", title: "引用文章", detail: "搜索文章标题", token: "文章" },
  { kind: "feed", title: "引用订阅源", detail: "搜索订阅源名称或地址", token: "订阅源" }];

function XiaoxunComposerModel(pet, ports = {}) {
  const listeners = new Set();
  const shortcuts = ShortcutModel(ports.now || Date.now);
  let send_binding;
  const set_timer = ports.set_timeout || setTimeout, clear_timer = ports.clear_timeout || clearTimeout;
  const create_state = doc => EditorState.create({ schema, doc,
    plugins: [history(), keymap({ "Shift-Enter": splitBlock, "Mod-z": undo, "Mod-Shift-z": redo, "Mod-y": redo }), keymap(baseKeymap)],
  });
  let editor = create_state(), backup = editor, busy = false;
  let menu = null, dismissed = "", search_key = "", revision = 0, timer;
  let destroyed = false;
  let editor_revision = pet.dialogue().editor_revision;
  function value() { return { editor, busy, menu, empty: editor.doc.textContent === "" && !reference() }; }
  function emit() { for (const listener of listeners) listener(value()); }
  function text() { return editor.doc.textBetween(0, editor.doc.content.size, "\n"); }
  function reference() {
    let result = null;
    editor.doc.descendants(node => { if (node.type === schema.nodes.reference) result = { ...node.attrs }; });
    return result;
  }
  function close_menu() { clear_timer(timer); revision++; search_key = ""; menu = null; }
  function update_menu() {
    const { $from, empty } = editor.selection;
    const match = empty && $from.parent.isTextblock && $from.parent.textBetween(0, $from.parentOffset, "", "\ufffc").match(/(?:^|\s)\/([^\n]*)$/);
    if (busy || !match) { dismissed = ""; close_menu(); return; }
    const query_text = match[1];
    const from = $from.pos - query_text.length - 1, to = $from.pos;
    const key = `${from}/${to}/${query_text}`;
    if (key === dismissed) { close_menu(); return; }
    const available_commands = ports.reference_commands || commands;
    if (!available_commands.length) { close_menu(); return; }
    const command = available_commands.find(item => query_text.startsWith(item.token + " "));
    const query = command ? query_text.slice(command.token.length + 1).trim() : query_text.trim();
    if (!command) {
      close_menu();
      menu = { stage: "commands", key, from, to, query, index: 0, items: available_commands.filter(item => `${item.title} ${item.detail}`.includes(query)), loading: false, error: "" };
      return;
    }
    const next_key = `${command.kind}/${query}`;
    if (next_key === search_key && menu) { menu = { ...menu, key, from, to }; return; }
    close_menu(); search_key = next_key;
    menu = { stage: command.kind, key, from, to, query, index: 0, items: [], loading: command.kind === "article", error: "" };
    const sources = ports.read_context?.().subscriptions || [];
    if (command.kind === "feed") {
      menu.items = sources.filter(source => `${source.title} ${source.feed_title} ${source.url}`.toLowerCase().includes(query.toLowerCase())).slice(0, 20)
        .map(source => ({ kind: "feed", feed_url: source.url, title: source.title || source.feed_title || source.url, detail: source.url }));
      return;
    }
    const current_revision = revision;
    timer = set_timer(async () => {
      try {
        const page = await ports.search_articles?.(query);
        if (destroyed || current_revision !== revision) return;
        menu = { ...menu, loading: false, items: (page?.articles || []).map(article => ({ kind: "article", feed_url: article.feed_url,
          article_key: article.guid, title: article.title || "无标题文章",
          detail: sources.find(source => source.url === article.feed_url)?.title || article.feed_url,
        })).filter(item => item.feed_url && item.article_key) };
      } catch (error) {
        if (destroyed || current_revision !== revision) return;
        menu = { ...menu, loading: false, error: error instanceof Error ? error.message : "搜索失败，请重试" };
      }
      emit();
    }, 180);
  }
  const model = {
    toValue: value,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispatch(transaction) {
      if (busy) return;
      editor = editor.apply(transaction);
      update_menu(); emit();
      pet.set_draft(text(), reference());
    },
    select(index = menu?.index) {
      const item = menu?.items[index];
      if (!item || busy) return;
      const { from, to } = menu;
      if (menu.stage === "commands") { this.dispatch(editor.tr.insertText(`/${item.token} `, from, to)); return; }
      const transaction = editor.tr;
      // shortcut: 每条问题引用一个对话对象；需要跨文章比较时再扩展请求上下文为引用列表。
      const positions = [];
      editor.doc.descendants((node, pos) => { if (node.type === schema.nodes.reference) positions.push(pos); });
      for (const pos of positions.reverse()) transaction.delete(pos, pos + 1);
      const start = transaction.mapping.map(from), end = transaction.mapping.map(to);
      const node = schema.nodes.reference.create({ kind: item.kind, feed_url: item.feed_url, article_key: item.article_key || "", title: item.title });
      transaction.replaceWith(start, end, Fragment.fromArray([node, schema.text(" ")]));
      transaction.setSelection(TextSelection.near(transaction.doc.resolve(start + 2)));
      this.dispatch(transaction);
    },
    handle_key(event) {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || busy) { shortcuts.reset(); return false; }
      if (menu && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) {
        shortcuts.reset();
        if (event.key === "Escape") {
          dismissed = menu.key;
          close_menu();
        } else if (["Enter", "Tab"].includes(event.key)) this.select();
        else if (menu.items.length) menu = { ...menu, index: (menu.index + (event.key === "ArrowDown" ? 1 : -1) + menu.items.length) % menu.items.length };
        event.preventDefault(); event.stopPropagation(); emit(); return true;
      }
      const binding = KeyboardSettingsModel.normalize(ports.read_keyboard?.()).xiaoxun_send;
      if (binding !== send_binding) {
        shortcuts.clear();
        send_binding = binding;
        if (binding) shortcuts.register({ [binding]: event => { if (!event.repeat) void pet.send(); return true; } });
      }
      if (shortcuts.handle_keydown(event)) { event.stopPropagation(); return true; }
      return false;
    },
    destroy() { destroyed = true; close_menu(); shortcuts.clear(); detach(); listeners.clear(); },
  };
  function sync(dialogue) {
    busy = Boolean(dialogue.busy || dialogue.loading);
    if (editor_revision !== dialogue.editor_revision) {
      editor_revision = dialogue.editor_revision;
      editor = backup = create_state();
      close_menu(); dismissed = "";
    }
    if (dialogue.draft !== text().trim() && dialogue.draft !== text()) {
      if (!dialogue.draft) { backup = editor; editor = create_state(); }
      else if (dialogue.draft === backup.doc.textBetween(0, backup.doc.content.size, "\n").trim()) editor = backup;
      else editor = create_state(schema.node("doc", null, [schema.node("paragraph", null, schema.text(dialogue.draft))]));
      close_menu();
      dismissed = "";
    }
    if (busy) close_menu();
    emit();
  }
  const detach = pet.subscribe(sync);
  sync(pet.dialogue());
  return model;
}
XiaoxunComposerModel.schema = schema;
export { XiaoxunComposerModel };
