import { EditorView, Decoration, DecorationSet } from "prosemirror-view";
import { FeedAddressEditorModel } from "./feed_address_model.js";
import { source_value, subscribe_source, dispose_all, next_uid } from "./frui/shared.js";

function FeedAddressEditor({ value, scripts, disabled, attributes, placeholder, onInput }) {
  let editor, model, root, list, placeholder_node;
  let unlistens = [];
  const list_id = next_uid({class:"box-border absolute left-0 right-0 overflow-auto p-0 rounded-sm bg-surface-raised",style:{"z-index":"5","top":"calc(100% + 6px)","max-height":"240px","border":"1px solid var(--frui-color-border)","box-shadow":"0 8px 24px rgb(0 0 0 / .24)"}});
  const semantic = attributes.n;

  function element(tag, name, props, text) {
    const node = document.createElement(tag);
    node.setAttribute("data-n", semantic + "-" + name);
    if (props.class) node.className = props.class;
    Object.assign(node.style, props.style);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function render(snapshot) {
    if (!editor) return;
    editor.updateState(snapshot.editor_state);
    editor.setProps({ editable: () => !snapshot.disabled, decorations(state) {
      const decorations = (snapshot.snippet?.fields || []).filter(field => field.from < field.to)
        .map(field => Decoration.inline(field.from, field.to, {
          class: "box-border bg-selected", style: "border-radius: 2px; box-shadow: inset 0 -1px var(--frui-color-focus)", "data-n": semantic + "-parameter",
        }));
      if (snapshot.ghost) decorations.push(Decoration.widget(state.doc.content.size, () => {
        const ghost = element("span", "ghost", {class:"box-border text-muted pointer-events-none user-select-none",style:{"opacity":".65"}}, snapshot.ghost);
        ghost.setAttribute("aria-hidden", "true");
        return ghost;
      }, { side: 1, key: snapshot.ghost }));
      return DecorationSet.create(state.doc, decorations);
    } });
    editor.dom.setAttribute("aria-disabled", String(snapshot.disabled));
    editor.dom.setAttribute("aria-expanded", String(snapshot.suggestions.length > 0));
    placeholder_node.hidden = !snapshot.placeholder_visible;
    if (snapshot.snippet) editor.dom.setAttribute("aria-description", "输入替换当前路径参数，Tab 选择下一个，Shift+Tab 选择上一个，Esc 退出参数编辑");
    else editor.dom.removeAttribute("aria-description");
    root.style.opacity = snapshot.disabled ? ".6" : "1";
    list.hidden = snapshot.suggestions.length === 0;
    list.classList.toggle("hidden", list.hidden);
    list.replaceChildren(...snapshot.suggestions.map((suggestion, index) => {
      const option = element("div", "suggestion", {class:"box-border relative cursor-pointer",style:{"padding":"10px 48px 10px 12px","border-top":"1px solid var(--frui-color-border-soft)"}});
      option.id = list_id + "-" + index;
      option.style.borderTop = index ? "1px solid var(--frui-color-border-soft)" : "0";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(index === snapshot.selected));
      option.classList.toggle("bg-selected", index === snapshot.selected);
      const address = element("span", "suggestion-address", {class:"box-border block break-anywhere",style:{"font":"13px/20px ui-monospace, SFMono-Regular, Menlo, monospace"}});
      address.append(element("span", "suggestion-typed", {class:"box-border text-text",style:{}}, snapshot.text),
        element("span", "suggestion-completion", {class:"box-border text-muted",style:{}}, suggestion.value.slice(snapshot.text.length)));
      option.append(address, element("span", "suggestion-label", {class:"box-border block text-muted",style:{"margin-top":"3px","font-size":"11px"}},
        suggestion.label + (suggestion.disabled ? " · 已停用" : "")),
        element("kbd", "suggestion-shortcut", {class:"box-border absolute text-muted",style:{"top":"10px","right":"10px","padding":"1px 4px","border":"1px solid var(--frui-color-border)","border-radius":"3px","font":"10px/16px ui-monospace, monospace"}}, "Tab"));
      option.addEventListener("mousedown", event => event.preventDefault());
      option.addEventListener("click", () => { model.accept(index); editor.focus(); });
      return option;
    }));
    if (snapshot.suggestions.length) {
      const active = list.children[snapshot.selected];
      editor.dom.setAttribute("aria-activedescendant", active.id);
      if (active.offsetTop < list.scrollTop) list.scrollTop = active.offsetTop;
      else if (active.offsetTop + active.offsetHeight > list.scrollTop + list.clientHeight) {
        list.scrollTop = active.offsetTop + active.offsetHeight - list.clientHeight;
      }
    } else editor.dom.removeAttribute("aria-activedescendant");
  }

  return Timeless.View({ class: "box-border relative flex-1 w-full min-w-0", attributes: { n: semantic + "-root" },
    onMounted(event) {
      root = event.target.get$elm ? event.target.get$elm() : event.target;
      const surface = element("div", "surface", {class:"box-border relative rounded-sm bg-surface",style:{"border":"1px solid var(--frui-color-border)"}});
      placeholder_node = element("span", "placeholder", {class:"box-border absolute overflow-hidden whitespace-pre-wrap break-anywhere text-muted pointer-events-none user-select-none",style:{"top":"10px","left":"12px","right":"12px","max-height":"40px","opacity":".65","font":"13px/20px ui-monospace, SFMono-Regular, Menlo, monospace"}}, placeholder || "");
      placeholder_node.setAttribute("aria-hidden", "true");
      surface.append(placeholder_node);
      list = element("div", "suggestions", {class:"box-border absolute left-0 right-0 overflow-auto p-0 rounded-sm bg-surface-raised",style:{"z-index":"5","top":"calc(100% + 6px)","max-height":"240px","border":"1px solid var(--frui-color-border)","box-shadow":"0 8px 24px rgb(0 0 0 / .24)"}});
      list.id = list_id; list.hidden = true;
      list.setAttribute("role", "listbox");
      list.setAttribute("aria-label", "订阅地址补全建议");
      root.append(surface, list);
      model = FeedAddressEditorModel({ value: source_value(value, ""), scripts: source_value(scripts, []),
        disabled: source_value(disabled, false), onRender: render,
        onChange: next => onInput?.({ target: { value: next } }),
      });
      const { n, maxlength, ...dom_attributes } = attributes;
      editor = new EditorView(surface, {
        state: model.snapshot().editor_state,
        attributes: { ...dom_attributes, "data-n": semantic, role: "combobox", tabindex: "0",
          "aria-multiline": "false", "aria-autocomplete": "both", "aria-haspopup": "listbox",
          "aria-controls": list_id, class: "box-border w-full min-w-0 box-sizing-border-box outline-none whitespace-pre-wrap break-anywhere text-text", style: "min-height: 60px; padding: 10px 12px; font: 13px/20px ui-monospace, SFMono-Regular, Menlo, monospace; max-height: min(240px, 30dvh)" },
        dispatchTransaction: tr => model.dispatch(tr),
        handleKeyDown(view, event) {
          if (!model.keydown(event)) return false;
          event.stopPropagation(); return true;
        },
        handlePaste(view, event) {
          model.insert_text(event.clipboardData?.getData("text/plain") || ""); return true;
        },
        handleDOMEvents: {
          focus() { model.set_focus(true); return false; },
          blur() { model.set_focus(false); return false; },
          compositionstart() { model.set_composing(true); return false; },
          compositionend() { model.set_composing(false); return false; },
          drop(view, event) {
            event.preventDefault(); model.insert_text(event.dataTransfer?.getData("text/plain") || ""); return true;
          },
        },
      });
      render(model.snapshot());
      unlistens = [subscribe_source(value, next => model.set_value(next)),
        subscribe_source(scripts, next => model.set_scripts(next)),
        subscribe_source(disabled, next => model.set_disabled(next))];
      const on_resize = () => render(model.snapshot());
      window.addEventListener("resize", on_resize);
      unlistens.push(() => window.removeEventListener("resize", on_resize));
    },
    onUnmounted() { dispose_all(unlistens); editor?.destroy(); editor = null; },
  });
}

export { FeedAddressEditor };
