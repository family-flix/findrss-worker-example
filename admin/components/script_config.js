import { ModalViewModel } from "./frui/modal.model.js";

const { View, Dialog, Button, Field, Input, Select, Switch, Textarea, For, computed } = window.FindRSSAdminUI;

export function ScriptConfigView({ model }) {
  const { state, methods } = model;
  const modal = ModalViewModel({ onClose: methods.close });
  return Dialog({
    open: state.open,
    title: computed(state.current, script => (script?.name || "脚本") + " · 配置"),
    description: computed(state.current, script => script?.config_schema.description || "填写配置后保存，脚本通过 ctx.config 读取。"),
    attributes: { n: "script-config-dialog", "aria-label": "脚本配置" },
    style: { width: "min(560px, calc(100vw - 32px))", "max-height": "85dvh" },
    bodyProps: { class: "box-border overflow-auto min-h-0" },
    maskClosable: false, closable: false,
    onMounted: modal.mount, onUnmounted: modal.unmount, onKeyDown: modal.keydown,
    footer: [
      Button({ variant: "secondary", disabled: state.busy, attributes: { n: "script-config-cancel" }, onClick: methods.close }, ["取消"]),
      Button({ disabled: state.busy, attributes: { n: "script-config-save" }, onClick: methods.save }, [computed(state.busy, busy => busy ? "保存中…" : "保存")]),
    ],
  }, [
    View({ class: "box-border grid gap-4", attributes: { n: "script-config-fields" } }, [For({
      each: state.fields, key: "key",
      render(raw) {
        const field = raw?.__is_ref ? raw.value : raw;
        const name = "script-config-field-" + field.path.join("-");
        const label = field.label + (field.required ? " *" : "");
        const props = { disabled: state.busy, attributes: { n: name, id: name, "aria-label": label, "aria-required": String(field.required) },
          onChange: value => methods.set_field(field.key, value) };
        const control = field.options
          ? Select({ ...props, value: computed(field.value, value => value ?? ""), options: field.options, placeholder: "请选择",
            onChange: event => methods.set_field(field.key, event.target.value) })
          : field.schema.type === "boolean"
            ? Switch({ ...props, checked: computed(field.value, value => value === true) })
            : field.schema.type === "array"
              ? Textarea({ ...props, value: computed(field.value, value => value ?? ""), placeholder: "JSON 数组，例如 [\"a\", \"b\"]", rows: 4 })
              : Input({ ...props, value: computed(field.value, value => String(value ?? "")),
                type: field.schema.writeOnly ? "password" : ["number", "integer"].includes(field.schema.type) ? "number" : "text",
                autoComplete: field.schema.writeOnly ? "new-password" : "off",
                attributes: { ...props.attributes, min: field.schema.minimum, max: field.schema.maximum, step: field.schema.type === "integer" ? "1" : "any" },
              });
        return Field({ label, help: field.schema.description, control_id: name, attributes: { n: name + "-group" } }, [control]);
      },
    })]),
    View({ class: "box-border text-danger", attributes: { n: "script-config-error", role: "alert" } }, [state.error]),
  ]);
}
