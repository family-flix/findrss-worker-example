import { Schema } from "prosemirror-model";
import { EditorState, TextSelection, Plugin } from "prosemirror-state";
import { history, closeHistory, undo, redo } from "prosemirror-history";

const hostname_token = "{{hostname}}";
const max_length = 2048;
const address_schema = new Schema({ nodes: { doc: { content: "text*" }, text: { inline: true } } });

function feed_routes(scripts) {
  const paths = new Map();
  for (const script of scripts || []) {
    if (script.kind !== "rss") continue;
    const routes = Array.isArray(script.routes) ? script.routes : [script];
    for (const route of routes) {
      if (!route.path?.startsWith("/")) continue;
      if (!paths.has(route.path)) paths.set(route.path, {
        path: route.path, label: route.name || script.name || route.path,
        template_path: route.path.split("/").map(segment => {
          const parameter = /^:([A-Za-z_][A-Za-z0-9_]*)(?:\{[\s\S]+\})?\??$/.exec(segment);
          return parameter ? ":" + parameter[1] : segment;
        }).join("/"),
        disabled: script.enabled === false,
      });
    }
  }
  return [...paths.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function address_suggestions(text, routes) {
  if (text && hostname_token.startsWith(text) && text !== hostname_token) {
    return [{ value: hostname_token, label: "当前订阅域名" }];
  }
  const match = /^((?:\{\{hostname\}\}|https?:\/\/[^/?#\s]+)?)(\/(?:rss|atom))\/[^?#\s]*$/.exec(text);
  if (!match) return [];
  return routes.map(route => ({ ...route, value: match[1] + match[2] + route.template_path }))
    .filter(route => route.value.startsWith(text) && route.value !== text && route.value.length <= max_length);
}

function FeedAddressEditorModel({ value = "", scripts = [], disabled = false, onChange, onRender }) {
  let routes = feed_routes(scripts);
  let editor_state = create_state(value);
  let focused = false;
  let composing = false;
  let dismissed = false;
  let selected = 0;
  let snippet = null;

  function create_state(text) {
    const normalized = String(text).replace(/[\r\n]+/g, "").slice(0, max_length);
    const doc = address_schema.node("doc", null, normalized ? address_schema.text(normalized) : null);
    return EditorState.create({ doc, selection: TextSelection.create(doc, doc.content.size), plugins: [
      history(),
      new Plugin({ filterTransaction: tr => tr.doc.textContent.length <= max_length && !/[\r\n]/.test(tr.doc.textContent) }),
    ] });
  }

  function snapshot() {
    const text = editor_state.doc.textContent;
    const at_end = editor_state.selection.empty && editor_state.selection.to === text.length;
    const suggestions = focused && !disabled && !composing && !dismissed && !snippet && at_end
      ? address_suggestions(text, routes) : [];
    const active = suggestions[selected] || suggestions[0];
    return { editor_state, text, disabled, placeholder_visible: !text, snippet,
      suggestions, selected: active ? suggestions.indexOf(active) : 0,
      ghost: active ? active.value.slice(text.length) : "" };
  }

  function render() { onRender?.(snapshot()); }

  function dispatch(tr) {
    if (disabled && tr.docChanged) return;
    const before = editor_state.doc.textContent;
    const next = editor_state.apply(tr);
    if (next === editor_state) return;
    const snippet_update = tr.getMeta("feed_address_snippet");
    if (snippet_update !== undefined) snippet = snippet_update;
    else if (snippet) {
      // 只跟踪当前参数内部的编辑；跨参数删除或移出参数时退出片段模式。
      for (const map of tr.mapping.maps) {
        const active = snippet.fields[snippet.index];
        let outside = false;
        map.forEach((from, to) => { if (from < active.from || to > active.to) outside = true; });
        if (outside) { snippet = null; break; }
        snippet = { ...snippet, fields: snippet.fields.map(field => ({ ...field,
          from: map.map(field.from, -1), to: map.map(field.to, 1),
        })) };
      }
      if (snippet && tr.selectionSet) {
        const active = snippet.fields[snippet.index];
        if (next.selection.from < active.from || next.selection.to > active.to) snippet = null;
      }
    }
    editor_state = next;
    if (tr.docChanged || tr.selectionSet) { dismissed = false; selected = 0; }
    render();
    if (before !== next.doc.textContent) onChange?.(next.doc.textContent);
  }

  function accept(index = snapshot().selected) {
    const suggestion = snapshot().suggestions[index];
    if (!suggestion) return false;
    // 补全单独成为一次撤销操作，撤销后保留用户已输入的前缀。
    const fields = [...suggestion.value.matchAll(/\/:([A-Za-z_][A-Za-z0-9_]*)(?=\/|$)/g)]
      .map(match => ({ name: match[1], from: match.index + 1, to: match.index + match[0].length }));
    const tr = closeHistory(editor_state.tr).insertText(suggestion.value.slice(editor_state.doc.textContent.length));
    tr.setMeta("feed_address_snippet", fields.length ? { fields, index: 0 } : null);
    if (fields.length) tr.setSelection(TextSelection.create(tr.doc, fields[0].from, fields[0].to));
    dispatch(tr.scrollIntoView());
    dispatch(closeHistory(editor_state.tr));
    return true;
  }

  return {
    snapshot, dispatch, accept,
    set_value(value) {
      if (String(value) === editor_state.doc.textContent) return;
      editor_state = create_state(value);
      snippet = null;
      selected = 0; dismissed = false;
      render();
    },
    set_scripts(scripts) { routes = feed_routes(scripts); selected = 0; render(); },
    set_disabled(value) { disabled = Boolean(value); render(); },
    set_focus(value) { focused = value; if (!value) snippet = null; dismissed = false; render(); },
    set_composing(value) { composing = value; render(); },
    insert_text(text) {
      const room = max_length - editor_state.doc.textContent.length + editor_state.selection.to - editor_state.selection.from;
      dispatch(editor_state.tr.insertText(String(text).replace(/[\r\n]+/g, "").slice(0, room)));
    },
    keydown(event) {
      if (disabled || composing || event.isComposing) return false;
      if (event.metaKey || event.ctrlKey) {
        if (event.altKey) return false;
        const key = event.key.toLowerCase();
        if (key === "z" || key === "y") {
          snippet = null;
          const handled = (key === "y" || event.shiftKey ? redo : undo)(editor_state, dispatch);
          if (!handled) render();
          return handled;
        }
        return false;
      }
      if (event.altKey) return false;
      if (snippet) {
        if (event.key === "Escape") { snippet = null; dismissed = true; render(); return true; }
        if (event.key === "Tab") {
          const index = snippet.index + (event.shiftKey ? -1 : 1);
          const field = snippet.fields[index];
          const tr = editor_state.tr.setMeta("feed_address_snippet", field ? { ...snippet, index } : null);
          if (field) tr.setSelection(TextSelection.create(tr.doc, field.from, field.to));
          else if (!event.shiftKey) tr.setSelection(TextSelection.create(tr.doc, tr.doc.content.size));
          dispatch(tr.scrollIntoView());
          return Boolean(field) || !event.shiftKey;
        }
      }
      const { suggestions } = snapshot();
      if (suggestions.length) {
        if ((event.key === "Tab" && !event.shiftKey) || event.key === "Enter") return accept();
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          selected = (snapshot().selected + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length;
          render(); return true;
        }
        if (event.key === "Escape") { dismissed = true; render(); return true; }
      }
      return event.key === "Enter";
    },
  };
}

export { FeedAddressEditorModel };
