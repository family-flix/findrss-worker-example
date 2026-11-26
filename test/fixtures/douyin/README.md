这些文件用于抖音动态 SDK 加载与签名的离线回归测试，不含 Cookie 或用户数据。

- `bdms.js.gz`：https://p-pc-weboff.byteimg.com/tos-cn-i-9r5gewecjs/bdms_1.0.1.19_fix.js
- `security.js.gz`：https://lf-security.bytegoofy.com/obj/security-secsdk/runtime_bundler_34.js
- `home.html`：2026-11-17 抖音首页的安全 SDK 标签与 BDMS 初始化脚本，已移除页面其他内容和 CSP nonce。
- `waf.html`：Cloudflare 出口收到的官方 WAF 页面，挑战值已替换为可重复验证的合成数据。
- `waf-sha256.js.gz`：https://lf-waf-js.byted-static.com/obj/waf-jschallenge/out-sha256.js ，保留原始 Chromium 作者版权注释。

SDK 下载于 2026-11-17。解压后 SHA-256：

- BDMS：`a0e46f84476d63a1fa57bdcb47223e0e545c6ce0c3dacdd2818180dfa087909e`
- 安全 SDK：`3fd5c4a8e910d2fbfb49e5b3d4c18fe64e72d9af6067e725317d9f198253638d`

生产运行时通过首页发现 SDK 地址，签名有效时复用整套签名与 SDK；上游拒绝签名或返回空包后重新访问页面、下载并重签，不固定版本或内容哈希。上面的哈希仅记录测试文件来源。下载仅允许代码声明的官方 HTTPS CDN，拒绝重定向；页面和 SDK 在无宿主网络能力的独立 QuickJS VM 内执行。

更新离线夹具时同步保存页面引用与对应 SDK。gzip 使用 `mtime=0`，保留下载字节原样；作品列表响应另用测试内的合成数据。`test/douyin_sdk.test.js` 覆盖前置校验、地址更新、SDK 缓存、重试和资源边界；`test/douyin_signature_cache.test.js` 覆盖签名复用、请求隔离、并发、失效刷新与生成失败恢复。
