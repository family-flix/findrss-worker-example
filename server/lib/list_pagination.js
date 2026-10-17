// 未传分页参数时保留内部调用及导出的全量读取行为。
export function list_pagination(url) {
  if (!url || !url.searchParams.has("limit") && !url.searchParams.has("offset")) return null;
  const requested_limit = Number(url.searchParams.get("limit") ?? 20);
  const requested_offset = Number(url.searchParams.get("offset") ?? 0);
  return {
    limit: Number.isFinite(requested_limit) ? Math.max(1, Math.min(100, Math.floor(requested_limit))) : 20,
    offset: Number.isFinite(requested_offset) ? Math.max(0, Math.min(1_000_000, Math.floor(requested_offset))) : 0,
  };
}

export function pagination_value(page, total_count) {
  return { ...page, total_count, has_more: page.offset + page.limit < total_count };
}
