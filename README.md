<p align="center">
  <img src="public/brand/apple-touch-icon.png" alt="FindRSS 标志" width="96" height="96">
</p>

<h1 align="center">FindRSS</h1>

<p align="center">v1.3.0</p>

<p align="center">一键部署到 Cloudflare，拥有自己的 RSS 采集工具<br>脚本随时添加、编辑，无需重新部署</p>

<p align="center">
  <a href="#快速开始">怎么使用</a> ·
  <a href="#界面预览">界面预览</a> ·
  <a href="#采集示例">采集示例</a> ·
  <a href="#fork-部署到-cloudflare-workers">部署（推荐）</a> ·
  <a href="#更新已部署的站点">更新站点</a>
</p>

FindRSS 是一个可以一键部署到自己 Cloudflare 账号的 RSS 采集工具，采集脚本和订阅数据由自己掌控。部署一次后，就能在网页后台随时添加、编辑采集脚本，将网站的文章、视频、动态等内容转换成 RSS 订阅源。

**新增网站、调整采集规则，都只需在后台修改脚本，发布后即可生效，无需重新构建或部署服务。** 网站改版导致采集失效时，也可以直接在后台调试、修复并发布。

## 能做什么

- **一键部署，自己掌控**：部署到自己的 Cloudflare 账号，采集脚本、订阅数据和公开范围都由自己管理。
- **采集网站内容**：提取你想关注的文章、视频、作者动态或小说章节。
- **随时添加、编辑脚本**：使用现成示例，自己编写，或让内置助手协助完成；在后台调试、发布即可生效，无需重新部署。
- **生成订阅地址**：发布后即可添加到阅读器，持续获取更新。

## 界面预览

**采集工作区**：编写规则、使用助手、预览采集结果，确认后发布。

![采集工作区：编写规则并预览结果](docs/images/script.png)

**订阅广场**：展示生成的订阅源，方便预览、查找和分享。

![订阅广场：展示采集内容并复制订阅地址](docs/images/discovery.png)

## 快速开始

从网站内容到订阅更新：

1. **部署工具**：推荐按照下方 [Fork 部署流程](#fork-部署到-cloudflare-workers)创建自己的站点，方便后续同步更新。
2. **配置采集**：进入后台「脚本」，新建采集规则。可以复制下方的[常用脚本](#采集示例)，也可以配置内置助手，告诉它网站地址和想采集的内容。
3. **预览并发布**：点击「运行调试」查看结果，确认后发布正式版本并启用。
4. **添加订阅源**：在后台「订阅源」中添加与已发布规则对应的订阅地址。
5. **开始订阅**：复制地址，添加到阅读器，以后就能集中查看新内容。

RSS 是供阅读器获取更新的订阅格式。阅读器是用来集中查看这些更新的应用。

详细操作见[创建自己的订阅源](docs/setup.md#创建自己的订阅源)。

## MCP 授权

在支持 OAuth 的 MCP 客户端中添加服务地址：

```text
线上：https://你的域名/mcp
本地：http://127.0.0.1:8787/mcp
```

客户端访问服务后自动发现授权入口，打开网页。登录管理后台，检查申请方、回调地址和申请的权限，选择「同意授权」或「拒绝授权」。同意后网页携带一次性授权码返回客户端，客户端通过 PKCE 换取访问与刷新凭据，并保存到自己的凭据存储中，无需复制 Token。FindRSS 不会把管理员密码或访问凭据放入回调链接。

未指定权限时默认只申请 `discovery:create`（添加订阅源，`add_subscription`）；需要编译并发布脚本时，客户端申请 `scripts:create`（`add_script`），并由用户明确同意。确认页允许取消部分申请的权限，不会新增未申请的权限。

「设置 → MCP 授权」可查看已授权客户端、权限、状态、到期和最近使用时间，并随时撤销。访问凭据有效期 1 小时，客户端可自动刷新；授权最长持续 90 天，到期后重新确认。撤销同时阻止后续 MCP 请求和刷新凭据，已经开始执行的调用不会回滚。

服务提供标准 MCP 受保护资源发现、OAuth 授权服务器发现、动态客户端注册及 Authorization Code + PKCE S256 流程。线上使用 HTTPS；本地开发支持 HTTP 回环回调。旧的独立 MCP Token 在到期或撤销前仍可使用，后台不再手动签发 Token；`ADMIN_PASSWORD` 和 Basic 认证不能直接调用 `/mcp`。

## 采集示例

项目提供以下常用脚本。**点击脚本名称直接打开原始代码（Raw），复制全部内容**，粘贴到后台「脚本」中调试、发布。

| 脚本（点击打开 Raw） | 采集内容 |
| --- | --- |
| <img src="public/platform-icons/bilibili.svg" width="24" height="24" alt=""> [哔哩哔哩](https://raw.githubusercontent.com/ltaoo/findrss-worker/master/examples/scripts/rss/bilibili.js) | UP 主视频与动态 |
| <img src="public/platform-icons/youtube.svg" width="24" height="24" alt=""> [YouTube](https://raw.githubusercontent.com/ltaoo/findrss-worker/master/examples/scripts/rss/youtube.js) | 频道视频、Shorts |
| <img src="public/platform-icons/zhihu.svg" width="24" height="24" alt=""> [知乎](https://raw.githubusercontent.com/ltaoo/findrss-worker/master/examples/scripts/rss/zhihu.js) | 动态、回答、文章、视频等 |
| <img src="public/platform-icons/weibo.svg" width="24" height="24" alt=""> [微博](https://raw.githubusercontent.com/ltaoo/findrss-worker/master/examples/scripts/rss/weibo.js) | 用户微博 |
| <img src="public/platform-icons/x.svg" width="24" height="24" alt=""> [X](https://raw.githubusercontent.com/ltaoo/findrss-worker/master/examples/scripts/rss/x.js) | 用户推文 |
| <img data-n="instagram-example-icon" src="public/platform-icons/instagram.svg" width="24" height="24" alt=""> [Instagram](https://raw.githubusercontent.com/ltaoo/findrss-worker/master/examples/scripts/rss/instagram.js) | 用户图片、视频与多图作品 |
| <img src="public/platform-icons/douyin.svg" width="24" height="24" alt=""> [抖音](https://raw.githubusercontent.com/ltaoo/findrss-worker/master/examples/scripts/rss/douyin.js) | 作者视频与图集 |
| <img src="public/platform-icons/kuaishou.svg" width="24" height="24" alt=""> [快手](https://raw.githubusercontent.com/ltaoo/findrss-worker/master/examples/scripts/rss/kuaishou.js) | 作者作品 |
| <img src="public/platform-icons/xiaohongshu.svg" width="24" height="24" alt=""> [小红书](https://raw.githubusercontent.com/ltaoo/findrss-worker/master/examples/scripts/rss/xiaohongshu.js) | 用户笔记 |
| <img src="public/platform-icons/telegram.svg" width="24" height="24" alt=""> [Telegram](https://raw.githubusercontent.com/ltaoo/findrss-worker/master/examples/scripts/rss/telegram.js) | 公开频道消息 |
| <img src="public/platform-icons/fanqienovel.svg" width="24" height="24" alt=""> [番茄小说](https://raw.githubusercontent.com/ltaoo/findrss-worker/master/examples/scripts/rss/fanqienovel.js) | 章节目录与正文 |
| <img src="public/platform-icons/qidian.svg" width="24" height="24" alt=""> [起点中文网](https://raw.githubusercontent.com/ltaoo/findrss-worker/master/examples/scripts/rss/qidian.js) | 章节目录与正文 |
| <img src="public/platform-icons/website.svg" width="24" height="24" alt=""> [69 书吧](https://raw.githubusercontent.com/ltaoo/findrss-worker/master/examples/scripts/rss/69shuba.js) | 章节目录 |
| <img src="public/platform-icons/website.svg" width="24" height="24" alt=""> [天天看书](https://raw.githubusercontent.com/ltaoo/findrss-worker/master/examples/scripts/rss/ttk.js) | 章节目录 |
| <img src="public/platform-icons/website.svg" width="24" height="24" alt=""> [Apple App Store](https://raw.githubusercontent.com/ltaoo/findrss-worker/master/examples/scripts/rss/apple.js) | 应用版本更新 |

也可以编写其他网站的采集规则。部分脚本需要登录账号或连接设备，具体要求见[示例说明](examples/scripts/README.md)。

> 可以配合 [dm-extension 浏览器插件](https://github.com/ltaoo/dm-extension)，将 Cookie 提交到自己部署的 FindRSS，供采集脚本使用。

## Fork 部署到 Cloudflare Workers

**推荐使用此流程**：先 Fork 项目，再让 Cloudflare 连接你的 Fork 仓库。后续在 GitHub 点击 **Sync fork → Update branch** 即可同步新版，Cloudflare 自动构建并部署。

1. 点击 [Fork 本项目](https://github.com/ltaoo/findrss-worker/fork)，将仓库 Fork 到自己的 GitHub 账号，保留 `master` 分支。
2. 按[部署指南](docs/setup.md#fork-部署到-cloudflare-workers)在 Cloudflare 创建 Worker，设置后台密码 `ADMIN_PASSWORD`，并准备 R2 桶。
3. 在 Worker 的 **Settings → Builds → Connect** 中连接自己的 Fork 仓库，生产分支选择 `master`，**Build command 留空，Deploy command 填写 `npm run deploy`**。若部署命令是 `npx wrangler deploy`，需手动替换，否则会跳过静态资源构建。
4. 等待部署成功，打开站点地址；在地址后加 `/admin/` 进入后台。

完整步骤与构建设置见 [Fork 部署指南](docs/setup.md#fork-部署到-cloudflare-workers)。空库首次启动会自动创建 Apple 应用更新脚本和一条公开订阅源。

## 一键部署到 Cloudflare Workers

也可以使用下方按钮部署。此方式会创建独立仓库，后续通过「更新 FindRSS」工作流更新；推荐优先使用上方的 Fork 流程。

<p>
  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/ltaoo/findrss-worker">
    <img src="https://deploy.workers.cloudflare.com/button" alt="在 Cloudflare 创建站点">
  </a>
</p>

1. 准备 GitHub 和 Cloudflare 账号，点击按钮并按提示授权。
2. 按提示填写站点名称，将 `ADMIN_PASSWORD` 设置为你的后台登录密码。
3. 等待完成，打开生成的站点地址；在地址后加 `/admin/` 进入后台。

空库首次启动会自动创建 Apple 应用更新脚本和一条公开订阅源，可在后台修改或删除。遇到配置问题，查看[安装与配置指南](docs/setup.md)。

## 更新已部署的站点

**Fork 部署的站点**：打开自己的 GitHub 仓库，选择 `master` 分支，点击 **Sync fork → Update branch**，等待 Cloudflare 自动构建、部署。如果修改过仓库中的部署配置，可使用下方工作流保留实例配置并更新。

**一键部署创建的独立仓库**：使用项目提供的更新工作流，无需安装 Git 或重新创建站点：

1. 打开 Cloudflare 中该 Worker 的 **Settings → Builds**，进入绑定的 GitHub 仓库。
2. 在仓库选择 **Actions → 更新 FindRSS → Run workflow**，点击运行。
3. 等待工作流成功，再到 Cloudflare 查看构建与部署结果。

更新会保留原 Worker 名称、现有 R2 桶、自定义域名和配置变量，应用代码跟随原项目更新。已有脚本和订阅仍使用原来的存储。

**旧部署没有「更新 FindRSS」入口？** 只需在 GitHub 网页中补一个工作流文件，详见[更新指南](docs/setup.md#更新已部署的站点)。也可以按指南开启每天自动更新。

## 更多文档

- [安装与配置](docs/setup.md)：创建站点、本地运行和常用设置。
- [采集示例](examples/scripts/README.md)：各来源的使用要求与示例。
- [管理后台](admin/README.md)：来源管理、助手和设备设置。
- [技术指南](docs/technical-guide.md)：开发与扩展说明。

反馈问题时，请附上操作步骤、错误提示或截图，并隐藏密码等个人信息。

## 许可证

本项目采用 [MIT 许可证](LICENSE)。第三方资源遵循其各自的许可证。
