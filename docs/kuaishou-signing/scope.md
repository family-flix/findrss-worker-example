# 快手作品请求调试范围

- auth：用户要求修复 `examples/scripts/rss/kuaishou.js`，提供 Cookie 和 `scraper_examples/kuaishou/261016/profile.har` 作为请求对照。
- in_scope：指定主页、`POST https://www.kuaishou.com/rest/v/profile/feed`、网页引用的公开签名模块及本项目运行时。
- network_profile：低频请求复现，使用用户提供的登录凭据；真实凭据仅用于临时请求，不写入项目文件。
- date：2026-10-16。
