// 旧示例文件保留原样；仅将测试副本中的 SDK 调用迁移到 Result 数据读取。
export function result_fixture_source(source) {
  return source.replaceAll("ctx.fetchText(", "__fixture_fetch(ctx, ")
    .replaceAll("ctx.invoke(", "__fixture_invoke(ctx, ")
    .replaceAll("ctx.cookies.get(", "__fixture_cookie(ctx, ") + `
function __fixture_data(result) {
  if (result.error) throw Object.assign(new Error(result.error.message), { name: "FeedError", code: result.error.code });
  return result.data;
}
async function __fixture_fetch(ctx, ...args) { return __fixture_data(await ctx.fetchText(...args)); }
async function __fixture_invoke(ctx, ...args) { return __fixture_data(await ctx.invoke(...args)); }
async function __fixture_cookie(ctx, ...args) { return __fixture_data(await ctx.cookies.get(...args)); }
`;
}
