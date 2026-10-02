# UI 术语表

md-writer 编辑器 UI 区域与块级交互载体的统一叫法（2026-10-07 与用户确认）。**仅用于文档与讨论，不改代码**——引用代码时使用对照的现有标识符（现状保持不变）。

## UI 区域

| 统一叫法 | 现有 CSS 类 | 现有 API 选项 / 变量 |
|---|---|---|
| 编辑器根（宿主容器） | `.md-editor`（JS 另加 `.md-editor-root`） | `mount` |
| 工具栏（顶部整条） | `.md-controls`（内含 `.inner` / `.left`） | `controlsRoot` |
| 命令组（格式按钮） | `.buttons .md-editor-cmd` | `formatBarRoot` / `commandBarHost` |
| 视图组（视图切换按钮） | `.buttons .md-editor-view` | `viewBarRoot` / `viewBarHost` |
| 编辑区（富文本） | `.ProseMirror` | `view` |
| 源码区（CodeMirror） | `.md-editor-source-host` | `sourceHost` |
| 目录面板 | `.md-editor-toc` | `tocRoot` |

后缀约定（若未来改名，按此执行）：API 选项用 `*Root`（外部可挂载容器），内部创建的宿主用 `*Host`，控制器刷新句柄用 `*Controls`。

## 块级交互载体

| 统一叫法 | 现有实现 / CSS 类 | 说明 |
|---|---|---|
| DecoMenu（decoration 菜单） | `block-menu` 家族：标题菜单（heading-menu）、段落菜单（paragraph-menu）、表格菜单（table-menu）、列表菜单（list-menu）、引用块菜单（blockquote-menu）、代码块菜单（code-block-menu）、图片菜单（image-rhythm）、`node-op-menu.tsx`（`md-editor-block-menu` / `md-editor-node-op-menu`）；多操作 dropdown 由 `block-op-menu.tsx` 的 `buildBlockOpMenuDom` 统一构建 | 由 ProseMirror Decoration.widget 渲染在块外的菜单。注意：node-op-menu 虽服务于预览块 NodeView，实现上仍是 DecoMenu。约定：每个 DecoMenu 必有至少一个删除按钮；操作多于一个时呈 dropdown，主按钮默认 ⋯，但列表/引用等有明确块类型的菜单显示当前类型 icon，代码块显示当前语言扩展名（别名归一，如 python→py）；面板行统一样式，通用操作用 icon（带 title），表达不准确用文字（最多两字） |
| OpButton（节点操作按钮） | NodeView 直接渲染进节点 DOM 的角标：`code-block-copy.tsx`（复制按钮）、mermaid/svg 最大化按钮；共用样式 `.md-editor-overlay-button`（`.md-editor-code-block-copy` / `.md-editor-preview-button`） | 悬浮在块右上角、`contenteditable=false`、不占文档流。代码块语言切换已迁至 code-block-menu DecoMenu（2026-10-07），OpButton 不再承担多操作 dropdown |

二者实现机制不同（decoration widget vs NodeView 内 DOM），讨论删除/选中/悬浮交互时按此区分。NodeView 各节点对应的 DecoMenu / OpButton 明细见 [nodeviews.md](nodeviews.md)。