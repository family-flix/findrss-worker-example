export function AISettingsStore({ ui, settings, request_json, new_id = () => crypto.randomUUID(),
  can_save = () => true, on_save = value => settings.as(value) }) {
  const { ref, ensure_ai_presets, add_ai_preset, ai_provider_preset } = ui;
  const settings_draft = ref({ ai_providers: [], ai_roles: [] });
  const settings_busy = ref(false), settings_error = ref(""), settings_message = ref("");
  let pending_keys = {}, generation = 0, previous;
  function load(value) {
    if (previous === value) return;
    previous = value;
    pending_keys = {};
    settings_draft.set({ ai_providers: ensure_ai_presets ? ensure_ai_presets(value.providers || []) : value.providers || [], ai_roles: [] });
  }
  const detach = settings.subscribe?.({ onChange: load });
  const clear = () => { settings_error.set(""); settings_message.set(""); };
  const update = providers => { settings_draft.set({ ...settings_draft.value, ai_providers: providers }); clear(); };
  const methods = {
    set_ai_key(id, key) { if (key === "") delete pending_keys[id]; else pending_keys[id] = key; clear(); },
    add_ai_entry(kind, provider_id) {
      const providers = settings_draft.value.ai_providers;
      if (kind === "provider") {
        if (providers.length >= 16) { settings_error.set("最多配置 16 个厂商。"); return; }
        update(ai_provider_preset?.(provider_id) ? add_ai_preset(providers, provider_id) : [...providers, {
          id: new_id(), name: "新厂商", type: "openai_compat", enabled: true, base_url: "", api_key_secret_name: "", models: [],
        }]);
      } else if (kind === "model") update(providers.map(p => p.id !== provider_id || p.models.length >= 32 ? p : { ...p, models: [...p.models, { id: new_id(), name: "新模型", model: "", enabled: true, options: {} }] }));
    },
    update_ai_entry(kind, id, patch, provider_id) {
      update(settings_draft.value.ai_providers.map(p => kind === "model" ? (p.id !== provider_id ? p : { ...p, models: p.models.map(m => m.id === id ? { ...m, ...patch } : m) }) : p.id === id ? { ...p, ...patch } : p));
    },
    remove_ai_entry(kind, id, provider_id) {
      const providers = settings_draft.value.ai_providers;
      if (kind === "provider") {
        const provider = providers.find(p => p.id === id);
        if (provider && ai_provider_preset?.(provider.preset_id)) return;
        delete pending_keys[id]; update(providers.filter(p => p.id !== id));
      } else update(providers.map(p => p.id !== provider_id ? p : { ...p, models: p.models.filter(m => m.id !== id) }));
    },
    test_ai_provider(provider, model_id) {
      return request_json("/admin/api/scripts/agent/test", { method: "POST", body: JSON.stringify({ provider, model_id,
        ...(typeof pending_keys[provider.id] === "string" ? { api_key: pending_keys[provider.id] } : {}) }) });
    },
    async save_settings() {
      if (settings_busy.value || !can_save()) return;
      const current = generation;
      settings_busy.set(true); clear();
      try {
        const value = await request_json("/admin/api/scripts/agent/settings", { method: "PUT", body: JSON.stringify({ providers: settings_draft.value.ai_providers, ai_keys: { ...pending_keys } }) });
        if (current !== generation) return;
        on_save(value); load(value); settings_message.set("已保存大模型设置");
      } catch (failure) { if (current === generation) settings_error.set(failure.message); }
      finally { if (current === generation) settings_busy.set(false); }
    },
    reset_settings() {
      if (settings_busy.value) return;
      pending_keys = {};
      settings_draft.set({ ai_providers: ensure_ai_presets ? ensure_ai_presets([]) : [], ai_roles: [] });
      clear(); settings_message.set("大模型已恢复默认值，保存后生效");
    },
  };
  load(settings.value);
  return { state: { settings_draft, settings_busy, settings_error, settings_message }, methods,
    destroy() { generation++; pending_keys = {}; settings_busy.set(false); detach?.(); },
    clear_keys() { generation++; pending_keys = {}; previous = undefined; load(settings.value); settings_busy.set(false); clear(); },
  };
}
