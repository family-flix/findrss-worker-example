// 浏览器侧的 Timeless 平台 shim。广场视图只 import "timeless"，
// 构建时由 build.js 分别指向这里（client）或版本目录的 lite ESM（worker）。
//
// 走 UMD 全局而不是把核心打进 bundle：DOM 运行时（hydrate）本来就要靠
// `timeless.dom.umd.min.js` 提供，把核心再打包一份只会让页面多下载 500KB。
const Timeless = globalThis.Timeless;
if (!Timeless || !Timeless.DOM) {
  throw new Error("FindRSS 订阅广场无法启动：Timeless 运行时未加载");
}

export const {
  View,
  Show,
  For,
  Match,
  Fragment,
  Text,
  Row,
  Button,
  Link,
  Img,
  Input,
  Label,
  Checkbox,
} = Timeless;
export const { ref, computed, combine } = Timeless;
export const DOM = Timeless.DOM;
