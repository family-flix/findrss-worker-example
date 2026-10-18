// Observe successful repository writes at the composition root. Notifications
// carry IDs only and perform no SQL; the transport batches committed changes.
export function observe_admin_changes(repo, events) {
  function observe(name, methods, topics, id = args => args[0]?.id ?? args[0]) {
    for (const method of methods) {
      const original = repo[name]?.[method];
      if (typeof original !== "function") continue;
      repo[name][method] = function (...args) {
        const result = original.apply(this, args);
        for (const topic of topics) events.invalidate(topic, id(args));
        return result;
      };
    }
  }
  observe("devices", ["upsert_connection", "set_offline", "set_stale_offline", "set_disabled", "delete"], ["devices.changed"], args => args[0]?.device_id ?? args[0]);
  observe("devices", ["insert_log", "delete_logs_for"], ["device.logs"], args => args[0]?.device_id ?? args[0]);
  observe("calls", ["insert", "assign", "set_running", "set_completed", "set_failed", "set_requeued", "release"], ["tasks.changed", "devices.changed"]);
  observe("discovery", ["insert", "update", "delete"], ["discovery.changed"], () => null);
  observe("discovery", ["snapshot_save", "snapshot_delete", "avatar_put", "avatar_delete", "set_avatar_ts"], ["discovery.changed"]);
  observe("clips", ["insert", "update", "save", "failure", "delete"], ["clips.changed"]);
  observe("statistics", ["put_snapshot"], ["overview.changed"], () => null);
  observe("access_tokens", ["insert", "set_balance_granted", "set_balance_used", "set_expiry", "revoke", "revoke_for_user"], ["tokens.changed"]);
  observe("script_logs", ["delete_errors_through"], ["messages.changed"], () => null);
  const insert = repo.script_logs?.insert;
  if (insert) repo.script_logs.insert = function (fields) {
    const result = insert.call(this, fields);
    if (fields.status === "error") events.invalidate("messages.changed");
    return result;
  };
}
