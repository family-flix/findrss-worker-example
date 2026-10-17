import CodeMirror from "codemirror";
import "codemirror/mode/javascript/javascript.js";
import "codemirror/mode/xml/xml.js";
import "codemirror/mode/css/css.js";
import "codemirror/mode/htmlmixed/htmlmixed.js";
import "codemirror/mode/diff/diff.js";
import { Textarea } from "./frui/textarea.js";
import { source_value, subscribe_source, dispose_all } from "./frui/shared.js";

function CodeEditor({ value, disabled, readOnly = false, mode = "javascript", attributes, onInput, wrapperStyle = {}, rootStyle, style }) {
  let editor = null;
  let resize_observer = null;
  let unlistens = [];
  const readonly_value = () => source_value(disabled, false) ? "nocursor" : Boolean(source_value(readOnly, false));
  return Textarea({class: "box-border",  value, disabled, readOnly, attributes, onInput, rootStyle, style,
    onMounted(event) {
      const textarea = event.target.get$elm ? event.target.get$elm() : event.target;
      editor = CodeMirror.fromTextArea(textarea, {
        mode: source_value(mode, "javascript"), theme: "material-darker", lineNumbers: true,
        indentUnit: 2, tabSize: 2, inputStyle: "textarea",
        readOnly: readonly_value(),
        extraKeys: { Tab: false, "Shift-Tab": false },
      });
      const wrapper = editor.getWrapperElement();
      Object.assign(wrapper.style, wrapperStyle);
      wrapper.setAttribute("data-n", attributes.n + "-editor");
      editor.getInputField().setAttribute("aria-label", attributes["aria-label"]);
      editor.getInputField().setAttribute("data-n", attributes.n + "-input");
      if (source_value(mode) === "diff") {
        editor.on("renderLine", (_, line, element) => {
          const color = { "+": "success", "-": "danger" }[line.text[0]];
          if (!color) return;
          element.style.background = `var(--frui-color-${color}-bg)`;
          for (const token of element.querySelectorAll(".cm-positive, .cm-negative")) {
            token.style.color = `var(--frui-color-${color})`;
          }
        });
      }
      editor.on("change", (_, change) => {
        if (change.origin !== "setValue" && !readonly_value()) onInput?.({ target: { value: editor.getValue() } });
      });
      unlistens = [
        subscribe_source(value, next => {
          if (editor.getValue() === next) return;
          editor.setValue(next);
          editor.clearHistory();
        }),
        subscribe_source(disabled, () => editor.setOption("readOnly", readonly_value())),
        subscribe_source(readOnly, () => editor.setOption("readOnly", readonly_value())),
        subscribe_source(mode, next => editor.setOption("mode", next || "text/plain")),
      ];
      // fromTextArea measures the default size before wrapperStyle is applied.
      editor.refresh();
      if (typeof ResizeObserver === "function") {
        resize_observer = new ResizeObserver(() => editor?.refresh());
        resize_observer.observe(wrapper);
      }
    },
    onUnmounted() {
      resize_observer?.disconnect();
      resize_observer = null;
      dispose_all(unlistens);
      editor?.toTextArea();
      editor = null;
    },
  });
}

export { CodeEditor };
