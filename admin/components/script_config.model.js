import { config_defaults, script_config_value } from "../../server/lib/script_config.js";

const { ref, computed } = window.FindRSSAdminUI;

export function ScriptConfigModel({ save }) {
  const current = ref(null);
  const busy = ref(false);
  const error = ref("");
  const fields = ref([]);
  let original = {};

  function collect(schema, value, path = [], labels = []) {
    if (value && typeof value === "object" && schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!Object.hasOwn(schema.properties, key)) delete value[key];
    }
    return Object.entries(schema.properties).flatMap(([key, child]) => {
      const child_path = [...path, key];
      const child_labels = [...labels, child.title || key];
      let next = value?.[key];
      if (child.type === "object") {
        if (next === undefined && value && schema.required?.includes(key)) next = value[key] = config_defaults(child, {});
        return collect(child, next, child_path, child_labels);
      }
      return [{ key: JSON.stringify(child_path), path: child_path, schema: child,
        label: child_labels.join(" / "), required: schema.required?.includes(key) === true,
        options: child.enum?.map((option, index) => ({ value: JSON.stringify(option), label: child.enumDescriptions?.[index] || String(option) })),
        value: ref(next === undefined ? undefined : child.enum || child.type === "array" ? JSON.stringify(next, null, child.enum ? 0 : 2) : next),
      }];
    });
  }

  const methods = {
    open(script) {
      if (busy.value || !script.config_schema) return;
      original = config_defaults(script.config_schema, structuredClone(script.config || {}));
      fields.set(collect(script.config_schema, original));
      error.set("");
      current.set(script);
    },
    close() {
      if (busy.value) return;
      current.set(null);
      fields.set([]);
      original = {};
      error.set("");
    },
    set_field(key, value) {
      if (busy.value) return;
      fields.value.find(field => field.key === key)?.value.set(value);
      error.set("");
    },
    async save() {
      if (busy.value || !current.value) return false;
      error.set("");
      try {
        const config = structuredClone(original);
        for (const field of fields.value) {
          let value = field.value.value;
          if (value !== undefined && field.schema.enum) value = value === "" ? undefined : JSON.parse(value);
          else if (["number", "integer"].includes(field.schema.type)) value = value === undefined || String(value).trim() === "" ? undefined : Number(value);
          else if (field.schema.type === "array" && value !== undefined) {
            try { value = String(value).trim() === "" ? undefined : JSON.parse(value); }
            catch { throw new Error(field.label + " 必须是有效的 JSON 数组"); }
          }
          let parent = config;
          for (const key of field.path.slice(0, -1)) {
            if (value === undefined && parent[key] === undefined) { parent = null; break; }
            if (!parent[key] || typeof parent[key] !== "object" || Array.isArray(parent[key])) parent[key] = {};
            parent = parent[key];
          }
          if (parent === null) continue;
          const key = field.path.at(-1);
          if (value === undefined) delete parent[key];
          else parent[key] = value;
        }
        const value = script_config_value(current.value.config_schema, config);
        busy.set(true);
        await save(current.value.id, value);
        busy.set(false);
        methods.close();
        return true;
      } catch (failure) {
        error.set(failure.message || String(failure));
        return false;
      } finally { busy.set(false); }
    },
  };
  return { state: { current, fields, busy, error, open: computed(current, value => value !== null) }, methods };
}
