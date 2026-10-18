# Agent instructions

## Go style

- When implementing functionality in Go, name unexported variables, methods, and functions using lowercase snake_case.

## Browser verification

- Never invoke or automate a browser. After implementation and non-browser checks are complete, tell the user the work is ready and let the user manually verify browser behavior.

## Commit message 准则

- 基于实际变更描述实现的功能、解决的问题及目的，让读者理解行为变化和价值。
- 不要罗列代码改动、文件名、函数名或实现步骤。
- 示例：使用「支持按来源筛选订阅，方便快速定位内容」，避免「修改筛选组件并新增查询参数」。

## 项目版本升级

- 升级 FindRSS 项目版本时，以下位置必须同步为同一个目标版本：
  - `README.md`：项目首页顶部展示的 `vX.Y.Z`。
  - `package.json`：根项目的 `version`。
  - `admin/pages/settings/about.model.js`：后台「设置 → 关于」的 `state.version`。
  - `server/lib/mcp.js`：MCP 初始化响应的 `serverInfo.version`，不是 MCP 协议版本。
  - `admin/README.md`：关于页说明中的 `vX.Y.Z`。
- JSON 和 JavaScript 中保存 `X.Y.Z`，文档展示保留 `vX.Y.Z`。
- 不修改 `package-lock.json` 或其他锁文件，也不要使用会自动更新锁文件的 `npm version` 命令。
- 内部包、依赖、Timeless 运行时、MCP 协议、Cloudflare 兼容日期、资源缓存和采集脚本各自的版本不随项目版本升级，除非用户另有要求。
- 修改后检查上述五个位置，确认版本一致；使用 Git diff 确认本次版本升级没有改动锁文件或无关版本。版本升级不需要启动或自动化浏览器。
