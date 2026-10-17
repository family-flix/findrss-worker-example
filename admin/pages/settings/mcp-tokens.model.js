export function McpTokensModel({ ui, request_json = async (url, options = {}) => {
  const response = await window.FindRSSAdminAuth.fetch(url, {
    credentials: "same-origin", cache: "no-store", ...options, headers: { "Content-Type": "application/json" },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error_description || result.error || "请求失败：HTTP " + response.status);
  return result;
} }) {
  const resource = ui.ref(""), tokens = ui.ref([]), page = ui.ref(1), revoke_target = ui.ref(null);
  const loading = ui.ref(false), loaded = ui.ref(false), busy = ui.ref(false), error = ui.ref(""), message = ui.ref("");
  let generation = 0, pending_mutation;
  const editable = () => loaded.value && !loading.value && !busy.value;
  function mutate(action) {
    if (!editable()) return;
    const current = generation;
    busy.set(true); error.set(""); message.set("");
    pending_mutation = (async () => {
      try { await action(current); }
      catch (failure) { if (current === generation) error.set(failure.message); }
      finally { busy.set(false); }
    })();
    return pending_mutation;
  }
  const methods = {
    async start() {
      if (loading.value) return;
      const current = ++generation;
      loading.set(true); loaded.set(false); error.set(""); message.set("");
      try {
        if (pending_mutation) await pending_mutation;
        if (current !== generation) return;
        const result = await request_json("/admin/api/mcp-tokens");
        if (current !== generation) return;
        tokens.set(result.mcp_tokens); page.set(1); resource.set(result.resource);
        loaded.set(true);
      } catch (failure) { if (current === generation) error.set(failure.message); }
      finally { if (current === generation) loading.set(false); }
    },
    set_page(value) { if (editable()) page.set(Math.max(1, Math.min(Math.max(1, Math.ceil(tokens.value.length / 20)), value))); },
    request_revoke(token) { if (editable() && token.status === "active") { error.set(""); revoke_target.set(token); } },
    cancel_revoke() { if (!busy.value) { revoke_target.set(null); error.set(""); } },
    confirm_revoke() {
      const target = revoke_target.value;
      if (!target) return;
      return mutate(async current => {
        const result = await request_json("/admin/api/mcp-tokens/" + encodeURIComponent(target.id) + "/revoke", { method: "POST" });
        if (current !== generation) return;
        tokens.set(tokens.value.map(token => token.id === target.id ? result.mcp_token : token));
        revoke_target.set(null); message.set("授权已撤销，客户端无法继续访问或刷新凭据");
      });
    },
    leave() {
      generation++; resource.set(""); tokens.set([]); page.set(1); revoke_target.set(null);
      loading.set(false); loaded.set(false); error.set(""); message.set("");
    },
  };
  return { state: { resource, tokens, page, revoke_target, loading, loaded, busy, error, message }, methods };
}
