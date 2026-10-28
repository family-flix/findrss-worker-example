// 编译与执行共用同一份沙箱基类，单独求值以保留用户脚本的行号。
export function script_classes_source() {
  return String.raw`(() => {
function script_error(message, code = "UPSTREAM_INVALID_RESPONSE") {
  return Object.assign(new Error(message), { name: "FeedError", code });
}

class RSSScript {
  async fetch(ctx) {
    return Result.Err("子类必须实现 fetch(ctx)，返回 Result<feed JSON>", "UPSTREAM_INVALID_RESPONSE");
  }

  static timestamp(value) {
    try {
      if (value === undefined || value === null || value === "" || value === 0 || value === "0") return Result.Ok(undefined);
      const ms = typeof value === "number" ? (value < 1e12 ? value * 1000 : value) : typeof value === "string" ? Date.parse(value) : NaN;
      const date = new Date(ms);
      if (!Number.isFinite(date.getTime()) || ms <= 0) throw script_error("发布时间或更新时间无效");
      return Result.Ok(date.toISOString());
    } catch (error) { return Result.Err(error); }
  }

  static item(item, ancestors = new Set()) {
    const path = new Set(ancestors).add(item);
    if (!item || typeof item.id !== "string" || !item.id || typeof item.title !== "string" || !item.title.trim()
      || !/^https?:\/\/[^\s<>"']+$/i.test(item.link)) throw script_error("RSS 条目需要稳定 ID、标题和原文链接");
    const result = { id: item.id, title: item.title.trim(), link: item.link };
    for (const field of ["description", "content", "image", "images", "live_photos", "media_group", "type", "kind", "author", "enclosure", "categories", "extra"]) {
      if (item[field] !== undefined) result[field] = item[field];
    }
    for (const field of ["published", "updated"]) {
      const value = RSSScript.timestamp(item[field]);
      if (value.error) throw value.error;
      if (value.data !== undefined) result[field] = value.data;
    }
    if (Array.isArray(item.references)) {
      const references = item.references.flatMap(reference => {
        if (!reference || !["reply", "repost", "quote"].includes(reference.relation)) return [];
        const id = typeof reference.id === "string" ? reference.id.trim() : reference.item?.id || "";
        const link = typeof reference.link === "string" ? reference.link.trim() : reference.item?.link || "";
        if (!id && !link) return [];
        const circular = [...path].some(parent => id ? parent.id === id : parent.link === link);
        const child = reference.unavailable !== true && reference.item && path.size <= 4 && !path.has(reference.item) && !circular
          ? RSSScript.item(reference.item, path) : null;
        return [{ relation: reference.relation, ...(id ? { id } : {}), ...(link ? { link } : {}),
          ...(reference.unavailable === true ? { unavailable: true } : {}), ...(child ? { item: child } : {}) }];
      });
      if (references.length) result.references = references;
    }
    return result;
  }

  async run(ctx) {
    try {
      const fetched = await this.fetch(ctx);
      if (!fetched || typeof fetched !== "object" || !("data" in fetched) || !("error" in fetched)) return Result.Err("fetch(ctx) 必须返回 Result", "UPSTREAM_INVALID_RESPONSE");
      if (fetched.error) return fetched;
      const feed = fetched.data;
      if (!feed || typeof feed.title !== "string" || !feed.title.trim()
        || !/^https?:\/\/[^\s<>"']+$/i.test(feed.link) || !Array.isArray(feed.items)) throw script_error("RSS 源必须返回标题、来源链接和 items 数组");
      const items = feed.items.map(item => RSSScript.item(item));
      // 置顶和热度不参与排序；无发布时间的条目保留在末尾，不猜日期。
      items.sort((left, right) => (Date.parse(right.published) || 0) - (Date.parse(left.published) || 0));
      const seen = new Set();
      const unique = items.filter(item => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
      const dates = unique.flatMap(item => [item.published, item.updated]).filter(Boolean).sort();
      const updated = RSSScript.timestamp(feed.updated);
      if (updated.error) return updated;
      if (updated.data) { dates.push(updated.data); dates.sort(); }
      ctx.log("RSS 内容完成", { count: unique.length, missing_published: unique.filter(item => !item.published).length });
      return Result.Ok({ kind: "rss", ...(feed.id ? { id: feed.id } : {}), title: feed.title, link: feed.link, description: feed.description || "",
        language: feed.language ?? "zh-CN", ...(feed.extra ? { extra: feed.extra } : {}), ...(feed.author ? { author: feed.author } : {}),
        ...(feed.image ? { image: feed.image } : {}), ...(dates.length ? { updated: dates.at(-1) } : {}), items: unique });
    } catch (error) { return Result.Err(error); }
  }
}

class HotRankScript {
  async fetch(ctx) {
    return Result.Err("子类必须实现 fetch(ctx)，返回 Result<{ title, link, entries }>", "UPSTREAM_INVALID_RESPONSE");
  }

  async run(ctx) {
    try {
      const fetched = await this.fetch(ctx);
      if (!fetched || typeof fetched !== "object" || !("data" in fetched) || !("error" in fetched)) return Result.Err("fetch(ctx) 必须返回 Result", "UPSTREAM_INVALID_RESPONSE");
      if (fetched.error) return fetched;
      const snapshot = fetched.data;
      if (
        !snapshot ||
        typeof snapshot.title !== "string" ||
        !snapshot.title.trim() ||
        !/^https?:\/\/[^\s<>"']+$/i.test(snapshot.link) ||
        !Array.isArray(snapshot.entries)
      ) {
        throw script_error("热榜必须返回标题、来源链接和 entries 数组");
      }
      const category = snapshot.category ?? "";
      if (typeof category !== "string" || category.trim().length > 32 || /[\u0000-\u001f\u007f]/.test(category)) {
        throw script_error("热榜 category 必须是最多 32 字符且不含控制字符的字符串");
      }
      const seen = new Set();
      const entries = snapshot.entries.map((entry) => {
        if (
          !entry ||
          typeof entry.id !== "string" ||
          !entry.id ||
          typeof entry.title !== "string" ||
          !entry.title.trim() ||
          !/^https?:\/\/[^\s<>"']+$/i.test(entry.link)
        ) {
          throw script_error("热榜条目需要稳定 ID、标题和网页链接");
        }
        if (seen.has(entry.id)) {
          throw script_error("热榜条目 ID 重复：" + entry.id);
        }
        seen.add(entry.id);
        const pinned = entry.pinned === true;
        if (
          pinned
            ? entry.rank !== null
            : entry.rank !== null && (!Number.isInteger(entry.rank) || entry.rank < 1)
        ) {
          throw script_error("非置顶条目必须保留上游正整数排名");
        }
        const heat = entry.heat;
        if (
          !heat ||
          typeof heat.unit !== "string" ||
          !heat.unit ||
          typeof heat.text !== "string" ||
          (heat.value !== null &&
            (!Number.isFinite(heat.value) || heat.value < 0))
        ) {
          throw script_error("热度需要 value（数字或 null）、unit、text");
        }
        const thumbnail = entry.thumbnail;
        if (thumbnail != null && thumbnail !== "" && (typeof thumbnail !== "string"
          || !/^https?:\/\/[^/?#@\s\\\u0000-\u001f\u007f<>"']+(?:[/?#][^\s\\\u0000-\u001f\u007f<>"']*)?$/i.test(thumbnail))) {
          throw script_error("热榜 thumbnail 必须是无凭据的 HTTP(S) 绝对地址");
        }
        return {
          id: entry.id,
          title: entry.title.trim(),
          link: entry.link,
          ...(thumbnail ? { thumbnail } : {}),
          rank: entry.rank,
          pinned,
          heat: { value: heat.value, unit: heat.unit, text: heat.text },
        };
      });
      const complete_ranks = entries.every(entry => entry.pinned || entry.rank !== null);
      entries.sort(
        (left, right) =>
          Number(right.pinned) - Number(left.pinned) ||
          (complete_ranks ? (left.rank ?? 0) - (right.rank ?? 0) : 0),
      );
      ctx.log("热榜快照完成", { count: entries.length });
      // 不产生 published/updated；排名和热度变化也不改变条目 ID。
      return Result.Ok({
        kind: "hot_rank",
        title: snapshot.title,
        link: snapshot.link,
        ...(category.trim() ? { category: category.trim() } : {}),
        observed_at: new Date().toISOString(),
        entries,
      });
    } catch (error) { return Result.Err(error); }
  }
}

class ClipScript {
  async fetch(ctx) { return Result.Err("子类必须实现 fetch(ctx)，返回 Result<{ title, link, html }>", "UPSTREAM_INVALID_RESPONSE"); }
  async run(ctx) {
    try {
      const result = await this.fetch(ctx);
      if (!result || typeof result !== "object" || !("data" in result) || !("error" in result)) throw script_error("fetch(ctx) 必须返回 Result");
      if (result.error) return result;
      const value = result.data;
      if (!value || typeof value.title !== "string" || !value.title.trim() || typeof value.link !== "string"
        || typeof value.html !== "string" || !value.html.trim()) throw script_error("剪藏必须返回标题、来源链接和 html");
      return Result.Ok({ kind: "clip", title: value.title.trim(), link: value.link, html: value.html,
        captured_at: new Date().toISOString(), ...(value.stats === undefined ? {} : { stats: value.stats }) });
    } catch (error) { return Result.Err(error); }
  }
}
class DetectScript {
  async fetch(ctx) { return Result.Err("子类必须实现 fetch(ctx)", "UPSTREAM_INVALID_RESPONSE"); }
  async normalize(data, ctx) { return Result.Ok(data); }
  async compare(previous, current, ctx) { return ctx.detect.compare(previous, current); }
  async run(ctx) {
    try {
      const fetched = await this.fetch(ctx);
      if (!fetched || typeof fetched !== "object" || !("data" in fetched) || !("error" in fetched)) throw script_error("fetch(ctx) 必须返回 Result");
      if (fetched.error) return fetched;
      const normalized = await this.normalize(fetched.data, ctx);
      if (!normalized || typeof normalized !== "object" || !("data" in normalized) || !("error" in normalized)) throw script_error("normalize(data, ctx) 必须返回 Result");
      if (normalized.error) return normalized;
      const data = normalized.data;
      const current = await ctx.detect.snapshot(data?.snapshot);
      if (current.error) return current;
      const previous = ctx.previous?.snapshot ?? null;
      let compared = await ctx.detect.compare(previous, current.data);
      if (compared.error) return compared;
      if (!["initialized", "inconclusive"].includes(compared.data.status) && this.compare !== DetectScript.prototype.compare) {
        compared = await this.compare(previous, current.data, ctx);
        if (!compared || typeof compared !== "object" || !("data" in compared) || !("error" in compared)) throw script_error("compare(previous,current,ctx) 必须返回 Result");
        if (compared.error) return compared;
      }
      if (!Array.isArray(compared.data?.changes)) throw script_error("compare 必须返回 { changes, matches? }");
      const status = ["initialized", "inconclusive"].includes(compared.data.status) ? compared.data.status : compared.data.changes.length ? "changed" : "unchanged";
      return Result.Ok({ kind: "detect", schema_version: 1, title: data.title, link: data.link, status,
        snapshot: current.data, changes: compared.data.changes, matches: compared.data.matches || [], issues: compared.data.issues || [] });
    } catch (error) { return Result.Err(error); }
  }
}

Object.defineProperties(globalThis, {
  RSSScript: { value: RSSScript },
  HotRankScript: { value: HotRankScript },
  ClipScript: { value: ClipScript },
  DetectScript: { value: DetectScript },
});
})();
`;
}
