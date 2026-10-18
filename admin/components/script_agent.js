import { AISettingsStore } from "./ai_settings.js";

const tool_labels = { get_admin_context: "读取当前页面", list_discovery_sources: "查询订阅源", get_discovery_source: "读取订阅源", create_discovery_source: "新增订阅源", update_discovery_source: "编辑订阅源", delete_discovery_source: "删除订阅源", get_script_draft: "读取草稿", edit_script_draft: "更新代码", debug_script_draft: "运行 Debug", fetch_rsshub_route_js: "读取 RSSHub 路由源码" };

export function ScriptAgentModel({ ui, request_json, get_context, apply_script, apply_debug,
  on_finish = () => {}, on_event = () => {}, socket_path = "/admin/api/scripts/agent/ws",
  create_socket = url => window.FindRSSAdminRealtime?.socket(url) || new window.WebSocket(url), location = () => window.location.href,
  new_id = () => crypto.randomUUID() }) {
  const { ref, refarr, refobj } = ui;
  const settings = refobj({ providers: [], base_url: "", model: "", has_api_key: false, configured: false });
  const config = refobj({ open: false, loading: false });
  const prompt = ref("");
  const messages = refarr([]);
  const busy = ref(false), streaming = ref(""), error = ref(""), status = ref("");
  const connected = ref(false), model_key = ref("");
  let editor_revision = 0;
  const listeners = new Set();
  let model_cache = [], provider_cache;
  function available_models() {
    if (provider_cache === settings.value.providers) return model_cache;
    provider_cache = settings.value.providers;
    model_cache = (provider_cache || []).filter(p => p.enabled).flatMap(p => p.models.filter(m => m.enabled && m.model).map(m => ({
      key: JSON.stringify([p.id, m.id]), name: m.name || m.model, enabled: true, provider_id: p.id, model_id: m.id, provider_name: p.name,
      provider_logo: ui.AIProviderLogoModel?.(p).toValue() || {},
    })));
    return model_cache;
  }
  function sync_settings(value) {
    settings.as(value);
    const models = available_models();
    if (!model_key.value) {
      const preferred = models.find(m => value.providers?.find(p => p.id === m.provider_id)?.api_key_configured) || models[0];
      model_key.set(preferred?.key || "");
    }
  }
  let socket = null, run_id = "", pending = null, generation = 0, connection_timer = null;
  const clear_connection_timer = () => {
    if (connection_timer !== null) clearTimeout(connection_timer);
    connection_timer = null;
  };
  const commit_streaming = () => {
    if (streaming.value.trim()) messages.as([...messages.value, { id: new_id(), role: "assistant", content: streaming.value }]);
    streaming.set("");
  };
  const finish = reason => {
    commit_streaming(); busy.set(false); run_id = ""; pending = null;
    status.set(reason || "");
    on_finish();
  };
  function receive(event) {
    let value;
    try { value = JSON.parse(event.data); } catch { return; }
    if (value.type === "ready") { sync_settings(value.settings); return; }
    if (!run_id || value.run_id !== run_id) return;
    on_event(value);
    if (value.type === "start") status.set("模型正在处理…");
    if (value.type === "status") status.set(value.message);
    if (value.type === "delta") {
      if (streaming.value.length + String(value.text || "").length > 64 * 1024) { methods.cancel("回答过长，请新建对话"); return; }
      streaming.set(streaming.value + String(value.text || ""));
    }
    if (value.type === "tool_start") { commit_streaming(); status.set(tool_labels[value.tool] || "正在执行工具…"); }
    if (value.type === "tool_end" && !value.ok) status.set(value.error || "工具执行失败，模型将继续处理…");
    if (value.type === "draft") {
      if (!apply_script(value)) { methods.cancel("草稿已被手动修改，已停止 AI 更新"); return; }
      status.set("左侧代码已更新");
    }
    if (value.type === "debug") apply_debug(value);
    if (value.type === "done") {
      // 最终回答替换当前回合增量，工具之前的说明已经单独保留。
      streaming.set("");
      if (value.content) messages.as([...messages.value, { id: new_id(), role: "assistant", content: value.content }]);
      finish("对话完成");
    }
    if (value.type === "error") { error.set(value.error || "对话失败"); finish("对话已结束"); }
  }
  function connect() {
    if (socket?.readyState === 0 || socket?.readyState === 1) return;
    const url = new URL(socket_path, location());
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const current = create_socket(url.href);
    socket = current;
    clear_connection_timer();
    connection_timer = setTimeout(() => {
      connection_timer = null;
      if (socket === current && current.readyState !== 1) {
        error.set("对话连接超时，可重新发送继续对话"); methods.cancel("连接超时");
      }
    }, 10_000);
    current.onopen = () => {
      if (socket !== current) return;
      clear_connection_timer();
      connected.set(true);
      if (pending) { current.send(JSON.stringify(pending)); pending = null; }
    };
    current.onmessage = event => { if (socket === current) receive(event); };
    current.onclose = () => {
      if (socket !== current) return;
      clear_connection_timer();
      socket = null; connected.set(false);
      if (busy.value) { error.set("对话连接已断开，已停止自动更新；可重新发送继续对话"); finish(); }
    };
    current.onerror = () => current.close();
  }
  const methods = {
    async start() {
      const current = ++generation;
      config.as({ ...config.value, loading: true });
      try {
        const value = await request_json("/admin/api/scripts/agent/settings");
        if (current !== generation) return;
        sync_settings(value);
      } catch (failure) {
        if (current === generation) { config.as({ ...config.value, open: true }); settings_store.state.settings_error.set(failure.message); }
      } finally {
        if (current === generation) config.as({ ...config.value, loading: false });
      }
    },
    toggle_config() { if (config.value.open) settings_store.clear_keys(); config.as({ ...config.value, open: !config.value.open }); },
    set_prompt(value) { prompt.set(String(value)); },
    send() {
      if (busy.value || !prompt.value.trim()) return;
      if (!settings.value.configured) { config.as({ ...config.value, open: true }); error.set("先配置大模型再开始对话"); return; }
      const context = get_context();
      if (!context.ready) { error.set("等待当前保存或调试完成后再发送"); return; }
      const text = prompt.value.trim();
      if (text.length > 16 * 1024) { error.set("对话内容超过 16KB，请缩小任务范围"); return; }
      const selected = available_models().find(m => m.key === model_key.value);
      if (model_key.value && !selected) { error.set("所选模型不可用，请在左下角重新选择"); return; }
      error.set(""); streaming.set(""); busy.set(true); status.set("正在连接模型…");
      run_id = new_id();
      messages.as([...messages.value, { id: new_id(), role: "user", content: text }]);
      prompt.set("");
      pending = { type: "run", run_id, ...context, ...(selected ? { provider_id: selected.provider_id, model_id: selected.model_id } : {}), messages: messages.value.slice(-24).map(({ role, content }) => ({ role, content })) };
      delete pending.ready;
      try {
        if (socket?.readyState === 1) { socket.send(JSON.stringify(pending)); pending = null; }
        else connect();
      } catch (failure) { error.set(failure.message); finish(); }
    },
    cancel(reason = "已停止对话") {
      clear_connection_timer();
      if (run_id && socket?.readyState === 1) {
        try { socket.send(JSON.stringify({ type: "cancel", run_id })); } catch {}
      }
      finish(reason);
      // 断开当前通道，迟到事件无法污染下一轮会话。
      const previous = socket; socket = null; previous?.close(); connected.set(false);
    },
    new_chat() { editor_revision++; methods.cancel(); messages.as([]); prompt.set(""); error.set(""); status.set(""); },
    close() {
      generation++;
      settings_store.clear_keys();
      methods.new_chat();
      config.as({ open: false, loading: false });
    },
  };
  const pet = {
    dialogue: () => ({ messages: messages.value, draft: prompt.value, busy: busy.value, streaming: streaming.value,
      activity: status.value, error: error.value, connected: true, loading: config.value.loading, editor_revision,
      context: {}, artifacts: [], models: available_models(), model_key: model_key.value }),
    subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    set_draft: methods.set_prompt, send: methods.send,
    select_model(key) { if (!busy.value && available_models().some(m => m.key === key)) model_key.set(key); },
    reconnect: connect, close_dialogue: methods.cancel,
  };
  const detach = [settings, config, prompt, messages, busy, streaming, error, status, model_key].map(source =>
    source.subscribe?.({ onChange() { for (const listener of listeners) listener(pet.dialogue()); } }));
  const settings_store = AISettingsStore({ ui, settings, request_json, new_id, can_save: () => !busy.value, on_save: sync_settings });
  return { state: { settings, config, prompt, messages, busy, streaming, error, status, connected, model_key }, methods, pet, settings_store,
    destroy() { methods.close(); for (const stop of detach) stop?.(); listeners.clear(); settings_store.destroy(); } };

}

export function ScriptAgentPanelView({ ui, agent, title = "脚本助手", context_label, on_close, style = {}, placeholder = "描述脚本需求，或让助手修改代码并运行 Debug…" }) {
  const { View, Button, Show, computed, combine, Icon, AIPreferencesView, XiaoxunDialogueView, XiaoxunComposerModel } = ui;
  const { state, methods, pet, settings_store } = agent;
  const composer = XiaoxunComposerModel(pet, { reference_commands: [] });
  const dialogue = { model: pet, composer, toValue: () => ({ error: "", older_loading: false }), subscribe: () => () => {} };
  return View({ class: "box-border flex flex-col min-w-0 min-h-0 overflow-hidden bg-surface flex-1 border-0 max-1100-height max-760-border-right", style: {
    "border-right": "1px solid var(--frui-color-border-soft)",
    "--max-1100-height": "70dvh",
    "--max-760-border-right": "0",
    ...style
  }, attributes: { n: "script-agent-pane" }, onMounted: methods.start,
    onUnmounted() { composer.destroy(); } }, [
    View({ class: "box-border flex-none flex items-center justify-between flex-wrap gap-space-2 p-space-4", style: {
      "border-bottom": "1px solid var(--frui-color-border-soft)"
    }, attributes: { n: "script-agent-header" } }, [
      View({class: "box-border m-0 text-sm",  as: "h2", attributes: { n: "script-agent-title" } }, [title]),
      View({ class: "box-border flex flex-wrap gap-space-1", attributes: { n: "script-agent-header-actions" } }, [
        Button({class: "box-border",  variant: "ghost", size: "small", icon: Icon("settings", 16), disabled: combine({ busy: state.busy, config: state.config }, ({ busy, config }) => busy || config.loading),
          attributes: { n: "script-agent-config-button" }, onClick: methods.toggle_config }, ["大模型设置"]),
        Button({class: "box-border",  variant: "ghost", size: "small", disabled: state.busy,
          attributes: { n: "script-agent-reset-button" }, onClick: methods.new_chat }, ["新对话"]),
        Show({ when: state.busy, ok: () => Button({class: "box-border",  variant: "ghost", size: "small", attributes: { n: "script-agent-stop-button" }, onClick: () => methods.cancel() }, ["停止"]) }),
        ...(on_close ? [Button({class: "box-border",  variant: "ghost", size: "small", attributes: { n: "admin-global-agent-close", "aria-label": "关闭小讯对话" }, onClick: on_close }, [Icon("x", 16)])] : []),
      ]),
    ]),
    ...(context_label ? [View({ class: "box-border m-var-frui-space-3-var-frui-space-4-0", attributes: { n: "admin-global-agent-context" } }, [context_label])] : []),
    XiaoxunDialogueView({style: {
      position: "relative",
      width: "100%",
      height: "auto",
      flex: "1",
      "min-height": "0",
      "z-index": "auto",
      border: "0",
      "border-radius": "0",
      "box-shadow": "none",
      overflow: "hidden"
    }, composerProps: { style: {
      "border-radius": "var(--frui-radius-card)"
    } },  dialogue, page: true, composer_options: { editorStyle: { "max-height": "min(240px, 30dvh)" }, label: on_close ? "向小讯提问" : "向脚本助手提问", placeholder } }),
    Show({ when: computed(state.config, value => value.open), ok: () => View({ class: "box-border fixed inset-0 flex flex-col bg-canvas p-space-4", style: {
      "z-index": "10001",
      "height": "100dvh"
    }, attributes: { n: "script-agent-config", role: "dialog", "aria-modal": "true", "aria-label": "大模型设置", tabindex: "-1" },
      onKeyDown(event) { if (event.key === "Escape") { event.stopPropagation(); methods.toggle_config(); } },
      onMounted(event) { (event.target?.get$elm?.() || event.target)?.focus?.(); },
    }, [
      View({ class: "box-border flex-none flex items-center justify-between flex-wrap gap-space-2 p-space-4", style: {
        "border-bottom": "1px solid var(--frui-color-border-soft)"
      }, attributes: { n: "script-model-settings-header" } }, [
        View({class: "box-border m-0 text-sm",  as: "h2" }, ["大模型"]),
        Button({class: "box-border",  variant: "ghost", attributes: { n: "script-agent-config-close", "aria-label": on_close ? "返回对话" : "返回脚本工作区" }, onClick: methods.toggle_config }, [on_close ? "返回对话" : "返回脚本工作区"]),
      ]),
      AIPreferencesView({style: {
        flex: "1",
        "min-height": "0",
        "margin-top": "var(--frui-space-4)",
        "--frui-floating-z-index": "10003"
      },  store: settings_store }),
      View({ class: "box-border text-muted", style: {
        "font-size": "11px",
        "line-height": "1.6"
      }, attributes: { n: "settings-message", role: "status" } }, [settings_store.state.settings_message]),
    ]) }),
  ]);
}
