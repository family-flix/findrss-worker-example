这两个 gzip 文件是 `server/infra/douyin_sdk.js` 固定版本的公开官方 SDK，供离线回归测试使用，不含 Cookie 或用户数据。测试下载替身仍须通过生产代码的 SHA-256 校验。

- `bdms.js.gz`：https://p-pc-weboff.byteimg.com/tos-cn-i-9r5gewecjs/bdms_1.0.1.19_fix.js
- `security.js.gz`：https://lf-security.bytegoofy.com/obj/security-secsdk-gray/runtime_bundler_34.js

更新 SDK 时同步更新生产哈希和这些 fixture。gzip 使用 `mtime=0`，保留下载字节原样；作品列表响应另用测试内的合成数据。
