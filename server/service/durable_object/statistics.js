import { DiscoverySourceModel } from "../../domain/discovery_source.js";
import { ScriptModel } from "../../domain/script.js";
import { RssRoutePatternModel } from "../../domain/rss_route.js";
import { SourceAddressModel } from "../../domain/source_address.js";
import { discovery_platforms } from "../../lib/discovery_platform.js";
import { rss_route_cache_key } from "../../infra/rss_cache.js";

export class ServiceStatistics {
  constructor({ repo }) {
    this.repo = repo;
    this.source_index = null;
  }

  invalidate_sources() {
    this.source_index = null;
  }

  record_call(pathname, query) {
    try { pathname = decodeURIComponent(pathname); } catch { return; }
    if (this.source_index === null) {
      this.source_index = new Map();
      for (const row of this.repo.statistics.sources()) {
        const address = SourceAddressModel(row.feed_url);
        if (Number(row.enabled) !== 1 || !address.is_route()) continue;
        const url = new URL(address.resolve("https://statistics.invalid"));
        const key = rss_route_cache_key(address.route_pathname, url.searchParams);
        const ids = this.source_index.get(key) || [];
        ids.push(row.id);
        this.source_index.set(key, ids);
      }
    }
    this.repo.statistics.record_calls(this.source_index.get(rss_route_cache_key(pathname, query)) || []);
  }

  snapshot() {
    const rows = this.repo.statistics.sources();
    const scripts = this.repo.statistics.scripts().map(row => ScriptModel.fromRow(row));
    const sources = rows.map(row => {
      const source = DiscoverySourceModel.fromRow(row);
      return { id: source.id, title: source.title, feed_url: source.feed_url, enabled: source.enabled,
        call_count: Number(row.call_count || 0), tracked: SourceAddressModel(source.feed_url).is_route() };
    });
    return {
      generated_at: Date.now(),
      script_count: scripts.length,
      source_count: sources.length,
      source_call_count: sources.reduce((total, source) => total + source.call_count, 0),
      cookie_count: this.repo.rss_cookies.get().length,
      route_count: new Set(scripts.flatMap(script => script.routes.map(route => route.path))
        .filter(path => RssRoutePatternModel.fromValue(path) !== null)).size,
      platform_count: discovery_platforms(scripts.flatMap(script => script.routes.map(route => route.platform)), rows).length,
      tag_count: new Set(rows.flatMap(row => DiscoverySourceModel.fromRow(row).discovery_tags())).size,
      sources,
    };
  }
}
