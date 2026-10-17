export function OauthModel({ ui, request_json = async (url, options = {}) => {
  const response = await window.FindRSSAdminAuth.fetch(url, {
    credentials: "same-origin", cache: "no-store", ...options, headers: { "Content-Type": "application/json" },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error_description || result.error || "请求失败：HTTP " + response.status);
  return result;
}, request_id = () => new URLSearchParams(window.location.search).get("request"),
  redirect = url => window.location.assign(url) }) {
  const authorization = ui.ref(null), subscriptions = ui.ref(false), scripts = ui.ref(false);
  const loading = ui.ref(false), busy = ui.ref(false), error = ui.ref(""), message = ui.ref("");
  let generation = 0;
  const methods = {
    async start() {
      if (loading.value || busy.value) return;
      const current = ++generation;
      loading.set(true); authorization.set(null); error.set(""); message.set("");
      try {
        const id = request_id();
        if (!id) throw new Error("缺少授权申请，请从 MCP 客户端重新发起连接。");
        const result = await request_json("/admin/api/mcp-oauth/requests/" + encodeURIComponent(id));
        if (current !== generation) return;
        subscriptions.set(result.authorization.scopes.includes("discovery:create"));
        scripts.set(result.authorization.scopes.includes("scripts:create"));
        authorization.set(result.authorization);
      } catch (failure) { if (current === generation) error.set(failure.message); }
      finally { if (current === generation) loading.set(false); }
    },
    set_subscriptions(value) { if (!busy.value && authorization.value?.scopes.includes("discovery:create")) subscriptions.set(value); },
    set_scripts(value) { if (!busy.value && authorization.value?.scopes.includes("scripts:create")) scripts.set(value); },
    async decide(approved) {
      const consent = authorization.value, current = generation;
      if (!consent || loading.value || busy.value) return;
      const scopes = [subscriptions.value && "discovery:create", scripts.value && "scripts:create"].filter(Boolean);
      if (approved && !scopes.length) { error.set("至少选择一项申请的权限，或拒绝授权"); return; }
      busy.set(true); error.set(""); message.set("");
      try {
        const result = await request_json("/admin/api/mcp-oauth/requests/" + encodeURIComponent(consent.id) + "/decision", {
          method: "POST", body: JSON.stringify({ approved, scopes: approved ? scopes : [] }),
        });
        if (current !== generation) return;
        authorization.set(null); message.set(approved ? "已同意授权，正在返回客户端…" : "已拒绝授权，正在返回客户端…");
        redirect(result.redirect_uri);
      } catch (failure) { if (current === generation) error.set(failure.message); }
      finally { busy.set(false); }
    },
    leave() {
      generation++; authorization.set(null); subscriptions.set(false); scripts.set(false);
      loading.set(false); error.set(""); message.set("");
    },
  };
  return { state: { authorization, subscriptions, scripts, loading, busy, error, message }, methods };
}
