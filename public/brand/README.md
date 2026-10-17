# FindRSS 品牌状态图形

状态图形均沿用 `logo.svg` 的原始路径、4° 倾角和 RSS 图形。

| 资产 | 效果与用途 |
| --- | --- |
| `watermark.svg` | 透明背景，蓝色标记 20% 不透明度、圆角底 3.5%；用于空状态和内容背景。画布 560 × 376，建议显示为 280 × 188 或 160 × 108。 |
| `empty.svg` | 淡蓝描边卡片与 F / RSS 标记，用于页面级 EmptyCard；画布 560 × 376，默认显示为 280 × 188。 |
| `select-file.svg` | 带原始蓝白 logo 的折角文件与选择指针，用于 `/admin/storage` 的“请选择文件” EmptyCard；画布 560 × 376，显示为 280 × 188。 |
| `loading.svg` | 蓝色圆角底与 F 保持静止；圆点先亮、RSS 弧线随后响应，1.8 秒循环。建议显示为 40、64 或 96 像素。 |

加载动画只改变透明度；系统开启“减少动态效果”时显示完整静态 logo。独立 SVG 可以直接通过 `<img>` 使用，不需要 JavaScript。

```html
<!-- 装饰性水印交由旁边的标题说明内容。 -->
<img src="/brand/watermark.svg" width="280" height="188" alt="">

<!-- 状态文案供辅助技术读取，图形本身不重复播报。 -->
<span role="status" aria-label="正在加载">
  <img src="/brand/loading.svg" width="64" height="64" alt="">
</span>
```

后台 `EmptyCard` 页面模式默认使用 `empty.svg`，`inline` 模式使用水印；卡片文字、背景和边框使用主题 token，支持标题、说明与操作按钮。`Loading` 使用同源的内联 SVG 图形；保留已有的 `small`、`medium`、`large` 尺寸与状态标签接口。内联图形使用现有 `--frui-brand-blue`、`--frui-brand-white` 和间距变量，兼容后台深浅主题。

调整 logo 时，同步 `watermark.svg`、`empty.svg`、`select-file.svg`、`loading.svg` 与 `admin/components/frui/loading-art.js` 的路径；调整动画时，同步 `loading.svg` 与 `admin/style.css` 中的 `findrss-dot`、`findrss-signal` 关键帧。
