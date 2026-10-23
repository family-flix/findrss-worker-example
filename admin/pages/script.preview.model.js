import { ScriptViewModel } from './script.model.js';
import { DEFAULT_RSS_SCRIPT, DEFAULT_HOT_SCRIPT } from './script.default.js';

export function ScriptPreviewModel({ empty = false } = {}) {
  const permissions = { cookies: [{ id: 'session', origin: 'https://example.com', path_prefix: '/articles', names: ['SID', 'CSRF_TOKEN'], purpose: '读取已登录账号可见的订阅文章' }] };
  const scripts = empty ? [] : [
    { id: 'preview-solidot', kind: 'rss', name: 'Solidot 科技资讯', path: '/solidot', example: '/solidot', url: 'https://www.solidot.org/', description: '收集最新科技新闻与开源动态。', tags: ['科技', '文章'], status: 'published', enabled: true, script: DEFAULT_RSS_SCRIPT },
    { id: 'preview-cookie', kind: 'rss', name: '会员文章订阅', path: '/members/:category', example: '/members/technology', parameters: { category: '文章分类' }, url: 'https://example.com', description: '使用共享 Cookie 库获取会员文章，发布前需要确认权限。', tags: ['文章'], status: 'published', enabled: true,
      cookie_authorization: { status: 'required', message: '此脚本版本需要管理员确认 Cookie 权限' },
      script: `export const version = '1.2.0';
export const kind = 'rss';
export const permissions = ${JSON.stringify(permissions, null, 2)};
export const route = { path: '/members/:category', name: '会员文章订阅', handler() { return Result.Ok({ title: '会员文章', items: [] }); } };` },
    { id: 'preview-draft', kind: 'rss', name: '设计周刊', path: '/design/weekly', example: '/design/weekly', url: 'https://example.com/design', description: '整理每周设计灵感，脚本仍在编写中。', tags: ['设计'], status: 'draft', enabled: false, script: DEFAULT_RSS_SCRIPT },
    { id: 'preview-hot', kind: 'hot', name: '今日热榜', path: '/hot/today', example: '/hot/today', description: '热门话题与实时排行。', tags: ['热榜'], status: 'published', enabled: true, script: DEFAULT_HOT_SCRIPT },
  ].map(script => ({ version: '1.2.0', platform: { name: '网页' }, maintainers: ['FindRSS'], created_at: 1792713600000, updated_at: 1792717200000, ...script }));
  const cookie_script = scripts.find(script => script.id === 'preview-cookie');
  const cookie_info = {
    script_id: 'preview-cookie', version: '1.2.0', script_hash: '8c4d2a97e13f6b05c9a4d8271e3b6f90a5c2d8147b9e6f032a1d5c8e4b7f6902',
    permissions, visibility: { routes: [{ path: '/members/:category', public: true }], subscribers: '持有效访问 token 的订阅者' },
    source: '管理员共享 Cookie 库（预览数据）', audience: '此路由的订阅者可读取脚本输出的会员文章。',
  };
  const store = ScriptViewModel({
    // shortcut: 仅模拟列表筛选和 Cookie 授权，预览其他操作时再补充接口。
    async fetch(input, options = {}) {
      const url = new URL(input, 'https://preview.invalid');
      const method = options.method || 'GET';
      if (url.pathname === '/admin/api/scripts' && method === 'GET') {
        const query = url.searchParams;
        const keyword = (query.get('q') || '').toLowerCase();
        const status = query.get('status');
        const matches = scripts.filter(script =>
          (!query.get('kind') || script.kind === query.get('kind')) &&
          (!query.get('id') || script.id === query.get('id')) &&
          (!status || status === 'all' || (['enabled', 'disabled'].includes(status) ? script.enabled === (status === 'enabled') : script.status === status)) &&
          [script.name, script.path, script.url, script.description].join(' ').toLowerCase().includes(keyword));
        const offset = Number(query.get('offset') || 0);
        return Response.json({ scripts: matches.slice(offset, offset + Number(query.get('limit') || 20)), total_count: matches.length });
      }
      if (url.pathname === '/admin/api/scripts/preview-cookie/cookie-permissions' && method === 'POST') {
        return cookie_script?.cookie_grant_id ? Response.json({ ok: true })
          : Response.json({ error: '需要确认 Cookie 权限', cookie_permissions: cookie_info }, { status: 409 });
      }
      if (url.pathname === '/admin/api/scripts/cookie-grants' && method === 'POST') {
        cookie_script.cookie_grant_id = 'preview-cookie-grant';
        cookie_script.cookie_authorization = { status: 'active', message: '已确认当前版本的 Cookie 权限（预览）' };
        return Response.json({ cookie_grant_id: cookie_script.cookie_grant_id });
      }
      return Response.json({ error: '此预览仅支持列表筛选和 Cookie 权限确认。' }, { status: 501 });
    },
  });
  store.methods.open_cookie_consent_preview = async () => {
    cookie_script.cookie_grant_id = '';
    cookie_script.cookie_authorization = { status: 'required', message: '此脚本版本需要管理员确认 Cookie 权限' };
    await store.methods.start();
    await store.methods.check_cookie_permissions(cookie_script.id);
  };
  return store;
}
