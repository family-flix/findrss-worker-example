# 快手作品接口签名修复记录

2026-10-16。范围见 [scope.md](kuaishou-signing/scope.md)。本次是请求兼容修复，未判定站点存在安全漏洞。

主页返回 HTTP 200 不能证明作品接口可用。原脚本的 POST 缺少动态签名，会收到 HTTP 200 和 `result=50`。已按当前网页调用链接入固定版本官方 SDK，并补齐 Cookie 权限声明。QuickJS 生成的签名配合授权 Cookie，实际返回 `result=1`、21 条作品；该响应在完整订阅沙箱中输出 21 条带视频地址的条目。

## 请求与调用链

目标为 `POST https://www.kuaishou.com/rest/v/profile/feed`，JSON 请求体为 `{"user_id":"3xuxw5yhgr6f4um","pcursor":"","page":"profile"}`。签名参数位于查询串：`__NS_hxfalcon`、`caver`。

网页 `index-tD5zqbs9.js` 中的 `sig4Adapter` 调用 `getSig4`，后者执行 `Jose.call('$encode', [input, callbacks])`。版本由 `Jose.call('$getCatVersion')` 返回，本次为 `2`。输入包括接口路径、含 `caver` 的查询参数、空 form 和实际 JSON 请求体。宿主复用官方模块，不复制 HAR 的签名，也不另行实现其内部虚拟机算法。

SDK 地址与 SHA-256 固定在 [kuaishou_sdk.js](../server/infra/kuaishou_sdk.js)。下载内容不匹配时明确失败。签名在独立 QuickJS wasm 实例执行，限制内存与执行时间；订阅脚本只持有 Cookie 句柄。仅允许对指定作品接口 POST 签名。

## Evidence → Finding → Path

| ID | source_ref | 观察 | content_hash | repro_command |
| --- | --- | --- | --- | --- |
| E-001 | 用户提供的 `scraper_examples/kuaishou/261016/profile.har`，`log.entries[63]` | 浏览器 POST 的请求体与原脚本一致，查询串额外含两个签名参数；HTTP 200。HAR 未保存响应正文或 Cookie。 | SHA-256 `9981093d797fd39bac0117a29f52ade427f7a0518eef3d0df8b069fe419317db` | 对本地 HAR 检查该 entry；文件需由用户保留。 |
| E-002 | 官方网页模块及 `test/fixtures/kuaishou/web-sdk.js.gz` | `sig4Adapter → getSig4 → Jose.call('$encode')`；固定版 SDK 可在 QuickJS 生成签名。 | 解压后 SHA-256 `ce3ba2c5b1ab5e907ce0c1116c22dca5a3aa45d1dc86f213c4d79f96a07a27b6` | 运行下方离线测试。 |
| E-003 | 2026-10-16 实际请求复现与响应回放 | 未签名返回 `result=50`；QuickJS 动态签名加授权 Cookie 返回 `result=1, feeds.length=21`；订阅回放输出 21 条视频。 | n/a（网络观察，临时响应未收入仓库） | 在线复现需当前有效的授权 Cookie；离线测试验证请求构造和转换。 |

F-001：severity=n/a_re，status=validated，confidence=high，evidence_ids=[E-001,E-002,E-003]，location=`examples/scripts/rss/kuaishou.js` / `server/infra/script_sandbox.js`。根因是作品请求缺少动态签名，原 Cookie 白名单还会丢弃 `webday7_st/ph` 等凭据；补齐 Cookie 本身不能解决签名错误。

P-001（path_type=callflow）：授权 Cookie 句柄 → `fetchText(..., {kuaishou_sign:true})` → 宿主按名称选择 Cookie → 校验固定版 SDK → 独立 QuickJS 为当前 JSON 请求体签名 → POST 带签名 URL → 检查 `result===1` 和 `feeds` → 转换 RSS 条目。视频地址兼容 `photo.photoUrl` 和实测的 `photo.photoUrls[0].url`。

时间记录：2026-10-16 先复现未签名错误；随后用 HAR 确认查询串差异和官方调用链；最后完成 QuickJS 实现、实际接口验证与订阅响应回放。

## 验证和使用

在仓库根目录执行，需本机 Node 22.19.0 和已安装项目依赖：

```sh
mise exec node@22.19.0 -- node --test test/kuaishou_sdk.test.js test/kuaishou_script.test.js test/script_cookie_permissions.test.js test/rss_fetch_headers.test.js test/script_agent_runtime_knowledge.test.js test/imports_audit.test.js
```

上述 28 项测试通过，覆盖真实 SDK、请求体与查询参数绑定、错误恢复、目标与方法限制、重定向、Cookie 范围和输出不泄漏凭据。

另用 Node 22.19.0 检查现有抖音 SDK 的 5 项测试，全部通过；`mise exec node@22.19.0 -- npm run build` 构建通过。

使用时同时更新宿主和快手示例脚本，在后台重新确认该版本脚本的 Cookie 权限。固定 SDK 地址失效、SDK 校验规则变更或 Cookie 过期仍可能影响后续抓取，需要按明确错误更新对应内容。未进行线上部署或全量回归；示例迁移测试当前缺少仓库已有的 `examples/scripts/fixtures/newsnow_sources.json`，无法启动。
