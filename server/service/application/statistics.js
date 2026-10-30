import { DiscoverySourceModel } from "../../domain/discovery_source.js";
import { ScriptModel } from "../../domain/script.js";
import { RssRoutePatternModel } from "../../domain/rss_route.js";
import { SourceAddressModel } from "../../domain/source_address.js";
import { discovery_platforms } from "../../lib/discovery_platform.js";
import { rss_route_cache_key } from "../../infra/rss_cache.js";
import { do_error } from "./error.js";
const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;
export class ServiceStatistics {
  constructor({
    repo,
    app
  }) {
    this.repo = repo;
    this.app = app;
    this.source_index = null;
  }
  invalidate_sources() {
    this.source_index = null;
  }
  async record_call(pathname, query) {
    try {
      pathname = decodeURIComponent(pathname);
    } catch {
      return;
    }
    if (this.source_index === null) {
      this.source_index = new Map();
      for (const row of await this.repo.statistics.sources()) {
        const address = SourceAddressModel(row.feed_url);
        if (Number(row.enabled) !== 1 || !address.is_route()) continue;
        const url = new URL(address.resolve("https://statistics.invalid"));
        const key = rss_route_cache_key(address.route_pathname, url.searchParams);
        const ids = this.source_index.get(key) || [];
        ids.push(row.id);
        this.source_index.set(key, ids);
      }
    }
    await this.repo.statistics.record_calls(this.source_index.get(rss_route_cache_key(pathname, query)) || []);
  }
  async snapshot() {
    const row = await this.repo.statistics.get_snapshot();
    if (!row) throw do_error("概览快照尚未生成，请稍后刷新", 503);
    return JSON.parse(row.snapshot_json);
  }
  async next_snapshot_at() {
    const generated_at = await this.repo.statistics.snapshot_generated_at();
    return generated_at ? generated_at + SNAPSHOT_INTERVAL_MS : 0;
  }
  async refresh_snapshot(now = Date.now()) {
    if ((await this.next_snapshot_at()) > now) return;
    const {
      devices,
      task_counts
    } = await this.app.devices.summary();
    const online_count = devices.filter(device => device.status === "online" || device.status === "busy").length;
    await this.repo.statistics.put_snapshot({
      generated_at: now,
      statistics: {
        ...(await this.collect(now)),
        device_count: devices.length,
        online_count,
        offline_count: devices.length - online_count,
        task_count: task_counts.reduce((total, item) => total + Number(item.count || 0), 0),
        token_count: await this.repo.access_tokens.count_active()
      }
    });
  }
  async collect(now = Date.now()) {
    const rows = await this.repo.statistics.sources();
    const scripts = (await this.repo.statistics.scripts()).map(row => ScriptModel.fromRow(row));
    const sources = rows.map(row => {
      const source = DiscoverySourceModel.fromRow(row);
      return {
        id: source.id,
        title: source.title,
        feed_url: source.feed_url,
        enabled: source.enabled,
        call_count: Number(row.call_count || 0),
        tracked: SourceAddressModel(source.feed_url).is_route()
      };
    });
    return {
      generated_at: now,
      script_count: scripts.length,
      source_count: sources.length,
      source_call_count: sources.reduce((total, source) => total + source.call_count, 0),
      cookie_count: (await this.repo.rss_cookies.get()).length,
      route_count: new Set(scripts.flatMap(script => script.routes.map(route => route.path)).filter(path => RssRoutePatternModel.fromValue(path) !== null)).size,
      platform_count: discovery_platforms(scripts.flatMap(script => script.routes.map(route => route.platform)), rows).length,
      tag_count: new Set(rows.flatMap(row => DiscoverySourceModel.fromRow(row).discovery_tags())).size,
      sources
    };
  }
}
