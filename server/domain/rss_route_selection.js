// 脚本路由选择域：把「哪些已启用脚本能覆盖这个 pathname、谁最具体」收成一个集合模型。
//
// 与 `ScriptModel.covers` 同源（都走 `RssRoutePatternModel.match`），但集合模型多一个
// 打分决策：`best()` 回分数最高的那一行，分数相同则先出现者胜——与组合根既有的遍历
// 顺序（`ORDER BY updated_at DESC` 之后的第一个最高分）逐字一致。
//
// 纯模块，可在 node --test 下直接覆盖。

import { RssRoutePatternModel } from "./rss_route.js";
import { ScriptModel } from "./script.js";

/**
 * 一批候选脚本对一个 pathname 的匹配结果集合。`best()` 返回分数最高的匹配，
 * 一个都没命中时返回 null。`toValue()` 回匹配到的脚本列表（不含分数）。
 * @param {Array<Record<string, unknown>>} [rows]
 * @param {string} [pathname]
 */
export function RssRouteSelectionModel(rows, pathname) {
  const target = String(pathname ?? "");
  const matches = Object.freeze(
    (Array.isArray(rows) ? rows : [])
      .flatMap((row) => ScriptModel.fromRow(row).routes.map(metadata => {
        const path_match = RssRoutePatternModel.fromValue(metadata.path)?.match(target) ?? null;
        return path_match === null ? null : Object.freeze({ row, metadata, path_match });
      }))
      .filter((match) => match !== null),
  );
  return Object.freeze({
    matches,
    count: () => matches.length,
    /**
     * 分数最高的匹配；无命中时 null。
     * @returns {{ row: Record<string, unknown>, path_match: { params: Record<string, string>, score: number } } | null}
     */
    best: () =>
      matches.reduce(
        (selected, match) =>
          selected === null || match.path_match.score > selected.path_match.score ? match : selected,
        null,
      ),
    toValue: () => matches.map((match) => ScriptModel.fromRow(match.row).toValue()),
  });
}

RssRouteSelectionModel.of = RssRouteSelectionModel;
