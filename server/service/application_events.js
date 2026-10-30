import { ScriptModel } from "../domain/script.js";
export function observe_application_changes(repo, {
  store,
  events,
  jobs,
  cache
}) {
  const watch = (name, methods, changed) => {
    for (const method of methods) {
      const original = repo[name]?.[method];
      if (!original) continue;
      repo[name][method] = async (...args) => {
        const value = await original.apply(repo[name], args);
        await store.after_commit(() => changed(args, value));
        return value;
      };
    }
  };
  for (const [name, kind, methods] of [['discovery', 'discovery', ['insert', 'update', 'delete', 'snapshot_attempt', 'snapshot_save', 'snapshot_delete', 'snapshot_adaptive']], ['clips', 'clip', ['insert', 'update', 'save', 'failure', 'delete', 'attempt']], ['detections', 'detect', ['insert', 'update', 'save', 'delete', 'attempt']]]) watch(name, methods, async args => {
    const id = typeof args[0] === 'object' ? args[0].id : args[0];
    await jobs.reschedule(kind, id);
    await events.invalidate(name === 'discovery' ? 'discovery.changed' : name + '.changed', id);
  });
  watch('discovery', ['avatar_put', 'avatar_delete', 'set_avatar_ts', 'snapshot_save_articles'], args => events.invalidate('discovery.changed', args[0]));
  watch('devices', ['insert_log', 'delete_logs_for'], args => events.invalidate('device.logs', args[0]?.device_id || args[0]));
  watch('script_logs', ['insert'], args => args[0].status === 'error' ? events.invalidate('messages.changed') : undefined);
  watch('script_logs', ['delete_errors_through'], () => events.invalidate('messages.changed'));
  watch('rss_route_cache', ['public_attempt', 'delete_public'], args => jobs.reschedule('rss', args[0]));
  for (const name of ['platforms', 'tags']) {
    const list = repo[name].list.bind(repo[name]);
    repo[name].list = () => cache.read(name, list);
    watch(name, ['collect', 'import_published'], async () => cache.put(name, await list()));
  }
  watch('snapshot_settings', ['put'], () => jobs.rebuild_schedule());
  const routes = repo.scripts.list_enabled.bind(repo.scripts);
  const candidates = async () => (await routes()).map(row => {
    const script = ScriptModel.fromRow(row);
    return {
      route: script.id,
      path: script.path,
      enabled: row.enabled,
      updated_at: row.updated_at,
      metadata_json: JSON.stringify({
        name: script.name,
        kind: script.kind,
        status: script.status,
        platform: script.platform,
        routes: script.routes.map(({
          path,
          name,
          example,
          parameters
        }) => ({
          path,
          name,
          example,
          parameters
        }))
      })
    };
  });
  repo.scripts.list_enabled = () => cache.read('script-routes', candidates);
  watch('scripts', ['insert', 'update', 'delete'], () => cache.put('script-routes', candidates()));
  for (const [name, methods, topic] of [['calls', ['insert', 'assign', 'set_running', 'set_completed', 'set_failed', 'set_requeued', 'release', 'fail_for_device', 'sweep_expired'], 'tasks.changed'], ['devices', ['upsert_connection', 'set_offline', 'set_disabled', 'delete'], 'devices.changed'], ['access_tokens', ['insert', 'set_balance_granted', 'set_balance_used', 'set_expiry', 'revoke', 'revoke_for_user'], 'tokens.changed']]) watch(name, methods, async () => {
    await events.invalidate(topic);
    if (name === 'calls') await events.invalidate('devices.changed');
  });
}
