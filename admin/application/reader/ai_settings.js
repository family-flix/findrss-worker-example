const { ref, computed, combine } = Timeless;

import {
  AI_PROVIDER_PRESETS,
  create_ai_provider_preset,
} from "@/domain/preferences/ai_presets.js";
import { AIProviderLogoModel } from "@/domain/preferences/ai_provider_logo.js";
import { AI_BUILTIN_ROLES } from "@/domain/preferences/ai_settings.js";

// Selection and filtering are local to the settings view; account data stays in SettingsModel.
export function AISettingsModel({ store }) {
  const draft = store.state.settings_draft;
  const provider_query = ref(""),
    model_query = ref(""),
    selected_provider = ref("");
  const role_query = ref("");
  const selected_role = ref(""),
    editing_model = ref(""),
    provider_advanced = ref(false);
  const key_drafts = ref({}),
    test_state = ref({ busy: false, message: "", error: "" }),
    test_model = ref("");
  let test_revision = 0;
  const clear_test = () => {
    test_revision++;
    test_state.set({ ...test_state.value, message: "", error: "" });
  };
  const stop_save = store.state.settings_message?.subscribe({
    onChange(message) {
      if (
        message.startsWith("已保存") ||
        message.startsWith("大模型已恢复默认值")
      ) {
        key_drafts.set({});
        clear_test();
      }
    },
  });
  const providers = computed(draft, (value) => value.ai_providers || []);
  const roles = computed(draft, (value) => value.ai_roles || []);
  const provider_entries = computed(providers, (values) => {
    const assigned = new Set();
    const entries = AI_PROVIDER_PRESETS.map((preset) => {
      const provider =
        values.find(
          (entry) =>
            entry.preset_id === preset.id && entry.type === preset.type,
        );
      if (provider) assigned.add(provider.id);
      return {
        id: `preset:${preset.id}`,
        preset_id: preset.id,
        name: provider?.name || preset.name,
        provider,
        enabled: provider?.enabled === true,
        configured: Boolean(provider),
        deletable: false,
      };
    });
    return [
      ...entries,
      ...values
        .filter((entry) => !assigned.has(entry.id))
        .map((provider) => ({
          id: `custom:${provider.id}`,
          name: provider.name,
          provider,
          enabled: provider.enabled,
          configured: true,
          deletable: true,
        })),
    ];
  });
  const active_entry = combine(
    { entries: provider_entries, selected: selected_provider },
    ({ entries, selected }) =>
      entries.find((entry) => entry.id === selected) ||
      entries.find((entry) => entry.enabled) ||
      entries[0],
  );
  const active_provider = computed(
    active_entry,
    (entry) =>
      entry?.provider || {
        ...create_ai_provider_preset(entry?.preset_id),
        enabled: false,
      },
  );
  const visible_providers = combine({ entries: provider_entries, query: provider_query }, ({ entries, query }) =>
    entries.filter(entry => entry.name.toLowerCase().includes(query.trim().toLowerCase())),
  );
  const visible_models = combine(
    { provider: active_provider, query: model_query },
    ({ provider, query }) =>
      (provider.models || []).filter((model) =>
        `${model.name} ${model.model}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      ),
  );
  const role_entries = combine({ roles, providers }, ({ roles, providers }) => roles.map(role => {
    const provider = providers.find(provider => provider.id === role.provider_id);
    const model = provider?.models.find(model => model.id === role.model_id);
    const model_label = model ? model.name || model.model : role.model_id ? "模型不可用" : "未选择模型";
    return { ...role,
      deletable: !AI_BUILTIN_ROLES.some(builtin => builtin.id === role.id),
      avatar_src: role.icon_url || `/avatars/roles/${AI_BUILTIN_ROLES.some(builtin => builtin.id === role.id) ? role.id : "custom"}.png`,
      model_label,
      model_title: provider ? `${provider.name} · ${model_label}` : model_label,
      provider_logo: provider ? AIProviderLogoModel(provider).toValue() : null,
    };
  }));
  const visible_roles = combine({ roles: role_entries, query: role_query }, ({ roles, query }) => {
    const keyword = query.trim().toLocaleLowerCase();
    return roles.filter(role => [role.name, role.id].some(value => String(value || "").toLocaleLowerCase().includes(keyword)));
  });
  const active_role = combine(
    { roles, selected: selected_role },
    ({ roles, selected }) =>
      roles.find((role) => role.id === selected) || roles[0] || null,
  );
  const model_choices = computed(providers, (entries) =>
    entries
      .filter((provider) => provider.enabled)
      .flatMap((provider) =>
        provider.models
          .filter((model) => model.enabled && model.model)
          .map((model) => ({
            value: JSON.stringify([provider.id, model.id]),
            label: model.name || model.model,
            group: provider.name,
            provider_id: provider.id,
            model_id: model.id,
            provider_logo: AIProviderLogoModel(provider).toValue(),
          })),
      ),
  );
  const key_value = combine(
    { provider: active_provider, keys: key_drafts },
    ({ provider, keys }) => keys[provider.id] || "",
  );
  const key_status = combine(
    { provider: active_provider, keys: key_drafts },
    ({ provider, keys }) => {
      if (keys[provider.id] === null) return "保存后删除 API Key";
      if (keys[provider.id]) return "新 API Key 尚未保存，可先测试";
      if (provider.api_key_source === "environment")
        return "使用部署环境的 API Key，可填写新密钥覆盖";
      return provider.api_key_configured
        ? "API Key 已保存，留空保持现有密钥"
        : "待配置 API Key";
    },
  );
  const test_choices = computed(active_provider, (provider) =>
    provider.models
      .filter((model) => model.enabled && model.model)
      .map((model) => ({
        value: model.id,
        label: model.name || model.model,
        group: provider.name,
      })),
  );
  const test_model_value = combine(
    { choices: test_choices, selected: test_model },
    ({ choices, selected }) =>
      choices.find((choice) => choice.value === selected)?.value ||
      choices[0]?.value ||
      "",
  );
  function current_provider() {
    return active_entry.value?.provider;
  }
  const methods = {
    select_provider(id) {
      selected_provider.set(id);
      model_query.set("");
      editing_model.set("");
      provider_advanced.set(false);
      test_model.set("");
      clear_test();
    },
    search_models(value) {
      model_query.set(value);
    },
    search_providers(value) { provider_query.set(value); },
    set_provider_enabled(id, enabled) {
      const entry = provider_entries.value.find(entry => entry.id === id);
      if (!entry) return;
      if (entry.id === active_entry.value.id) clear_test();
      if (!entry.provider)
        store.methods.add_ai_entry("provider", entry.preset_id);
      else
        store.methods.update_ai_entry("provider", entry.provider.id, {
          enabled,
        });
    },
    set_api_key(value) {
      const provider = current_provider();
      if (!provider) return;
      key_drafts.set({ ...key_drafts.value, [provider.id]: value });
      store.methods.set_ai_key(provider.id, value);
      clear_test();
    },
    select_test_model(value) {
      test_model.set(value);
      clear_test();
    },
    async test_connection() {
      if (test_state.value.busy || !test_model_value.value) return;
      if (key_drafts.value[current_provider()?.id] === null) {
        test_state.set({
          busy: false,
          message: "",
          error: "请先保存 API Key 删除操作，再测试连接",
        });
        return;
      }
      const revision = ++test_revision;
      test_state.set({ busy: true, message: "", error: "" });
      try {
        const result = await store.methods.test_ai_provider(
          current_provider(),
          test_model_value.value,
        );
        if (revision === test_revision)
          test_state.set({
            busy: true,
            error: "",
            message: `连接成功 · ${result.model} · ${result.elapsed_ms} ms`,
          });
      } catch (error) {
        if (revision === test_revision)
          test_state.set({
            busy: true,
            message: "",
            error:
              error.message || "测试失败，请检查 API Key、接口地址和模型权限",
          });
      } finally {
        test_state.set({ ...test_state.value, busy: false });
      }
    },
    update_provider(patch) {
      clear_test();
      const provider = current_provider();
      if (provider)
        store.methods.update_ai_entry("provider", provider.id, patch);
    },
    add_provider() {
      const before = new Set(providers.value.map((provider) => provider.id));
      store.methods.add_ai_entry("provider");
      const added = providers.value.find(
        (provider) => !before.has(provider.id),
      );
      if (added) {
        methods.select_provider(`custom:${added.id}`);
        provider_advanced.set(true);
      }
    },
    remove_provider(id = active_entry.value?.id) {
      const entry = provider_entries.value.find(entry => entry.id === id);
      if (entry?.deletable && !store.state.settings_busy.value)
        store.methods.remove_ai_entry("provider", entry.provider.id);
    },
    toggle_advanced() {
      provider_advanced.set(!provider_advanced.value);
    },
    configure_model(id) {
      editing_model.set(editing_model.value === id ? "" : id);
    },
    update_model(id, patch) {
      clear_test();
      const provider = current_provider();
      if (provider)
        store.methods.update_ai_entry("model", id, patch, provider.id);
    },
    set_model_option(id, key, value) {
      const model = current_provider()?.models.find((model) => model.id === id);
      if (!model) return;
      const options = { ...model.options };
      if (value === "") delete options[key];
      else options[key] = key === "reasoning_effort" ? value : Number(value);
      methods.update_model(id, { options });
    },
    add_model() {
      const provider = current_provider();
      if (!provider) return;
      const previous = new Set(provider.models.map((model) => model.id));
      store.methods.add_ai_entry("model", provider.id);
      const added = current_provider()?.models.find(
        (model) => !previous.has(model.id),
      );
      if (added) editing_model.set(added.id);
    },
    remove_model(id) {
      const provider = current_provider();
      if (provider) store.methods.remove_ai_entry("model", id, provider.id);
    },
    search_roles(value) { role_query.set(value); },
    select_role(id) {
      selected_role.set(id);
    },
    update_role(patch) {
      if (active_role.value)
        store.methods.update_ai_entry("role", active_role.value.id, patch);
    },
    set_role_icon_file(file) {
      if (active_role.value) return store.methods.set_role_icon_file(active_role.value.id, file);
    },
    set_role_enabled(id, enabled) { store.methods.update_ai_entry("role", id, { enabled }); },
    choose_role_model(value) {
      const choice = model_choices.value.find(
        (choice) => choice.value === value,
      );
      if (choice)
        methods.update_role({
          provider_id: choice.provider_id,
          model_id: choice.model_id,
        });
    },
    add_role() {
      role_query.set("");
      const before = new Set(roles.value.map((role) => role.id));
      store.methods.add_ai_entry("role");
      const added = roles.value.find((role) => !before.has(role.id));
      if (added) selected_role.set(added.id);
    },
    remove_role(id = active_role.value?.id) {
      const entry = role_entries.value.find(entry => entry.id === id);
      if (entry?.deletable && !store.state.settings_busy.value)
        store.methods.remove_ai_entry("role", id);
    },
  };
  return {
    state: {
      provider_query,
      model_query,
      provider_entries,
      visible_providers,
      active_entry,
      active_provider,
      visible_models,
      editing_model,
      provider_advanced,
      roles,
      role_entries,
      role_query,
      visible_roles,
      active_role,
      model_choices,
      key_value,
      key_status,
      test_state,
      test_choices,
      test_model_value,
    },
    methods,
    destroy() {
      stop_save?.();
      key_drafts.set({});
      test_revision++;
    },
  };
}
