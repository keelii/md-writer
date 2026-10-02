# AGENTS.md

面向 AI 编码代理（以及新成员）的项目约定。本文件总结了 md-writer 的架构、构建方式和历次协作中沉淀的硬性规则，动手前必读。

讨论与文档中描述 UI 时，统一使用 [docs/glossary.md](docs/glossary.md) 的术语表（编辑器根/工具栏/命令组/视图组/编辑区/源码区/目录面板，块级交互载体 DecoMenu/OpButton）。

## 项目概述

MDWriter（`@swaves/md-editor`）是一个纯浏览器端的轻量 Markdown WYSIWYG 编辑器库：

- 基于 ProseMirror（WYSIWYG 主编辑器）+ CodeMirror（源码模式）+ prosemirror-markdown（序列化/解析）
- 暴露单一全局 API `MDWriter.init()`，内容通过 `getMarkdown()` / `onChange` 回调获取
- 入口 `src/index.tsx`，IIFE 打包为全局 `MDWriter`
- **纯浏览器库**：不存在 SSR / Node 运行场景（测试用 fake document stub，不靠环境守卫）

## 目录结构

```
src/
├── index.tsx            # 入口：MDWriter.init()、refreshControls、view/format bar 绑定
├── jsx.ts               # 自研极简 JSX 运行时（h/Fragment，产出真实 DOM）
├── types.ts             # 对外 Options 等类型
├── utils.tsx
├── icons.ts
├── codemirror/
│   └── source-editor.ts # 源码模式编辑器
├── prosemirror/
│   ├── schema.ts        # 文档 schema
│   ├── markdown.ts      # Markdown 解析/序列化
│   ├── plugins.ts       # 插件与 keymap
│   ├── commands.ts      # 纯 Command 层（(state, dispatch?) => boolean）
│   ├── actions.ts       # Action 层（Dialog / 异步等产品交互）
│   ├── buttons.tsx      # 工具栏按钮（commandByName / actionByName 双轨绑定）
│   ├── table.ts         # 表格功能
│   ├── block-menu.ts    # 块级左侧 hover 菜单（Decoration.widget 注册制）
│   ├── code-highlight.ts
│   ├── dialog.tsx / link-dialog.tsx / image-dialog.tsx / help-dialog.tsx
│   ├── heading-menu.tsx / toc.tsx / image-*.tsx
│   └── nodeviews/       # NodeView，见下方「NodeView 分类」
└── styles/              # reset / layout / print / toc / toolbar + themes/(default|classic)
```

约定：组件样式以 `*.css` 放在对应 TS/TSX 模块旁（如 `heading-menu.css`），通过 `import "./xxx.css"` 引入，esbuild 汇总为 `dist/index.css`。

## NodeView 分类

自定义 NodeView 按内容控制权分为三类：

### ContentNodeView

ProseMirror 负责内容，NodeView 只负责外壳/装饰。

例如：`code_block`。

必须使用 `contentDOM`，不得把 PM 管理的内容转移到独立编辑器。

### RawNodeView

Node 中保存 HTML source，由浏览器负责 HTML 渲染。

例如：`raw_block`、`raw_inline`。

Raw 是编辑器中最不受控的内容。未来如果需要建立 HTML 与编辑器之间的 interaction boundary，应在 RawNodeView 中处理，而不是抽成 Widget 行为。

### WidgetNodeView

Node 保存结构化数据或 DSL，由专门 renderer / 第三方解析器负责渲染。

例如：image、mermaid、formula、future embeds。

Widget 不默认要求「先选中再交互」。Widget 的原生交互由具体 renderer 决定。

不要为了这三类建立复杂继承体系，优先使用 interface + composition。

## 规约（历次协作确定，违反即返工）

### 1. 不做环境存在性判断

禁止 `typeof window === "undefined"` 之类守卫，已有的全部删掉。新代码直接用 `window` / `document` / `navigator`。对可选宿主能力（如 `window.DashAppUI`、`navigator.clipboard`）保留存在性检查即可，但不要外层再包 `typeof window`。

### 2. 构建 DOM 一律用 JSX

不要直接调用 `h("div", {...})`，也不要 `children.push(<div/>)` 命令式拼接。列表用 `.map()` 内联到 JSX children，多根用 `<></>`（Fragment 需 import）。`h()` 仅作为 JSX 工厂存在于 import 中，不出现在调用点。

### 3. Action / Command / Transaction 三层分离

- `commands.ts` 中的 Command 不得依赖 Dialog、Promise、UI DOM 或产品层 options；只接收 PM state / dispatch / 必要的纯参数，保持 `(state, dispatch?) => boolean` 的同步契约（省缺 dispatch 仅探测可行性）
- 弹 Dialog / 等待 Promise 的产品交互归 `actions.ts` 的 Action 层（可 async），完成后以最新 `view.state` 调用纯 Command
- 链路：UI → Action → Dialog → Command → Transaction。同名命令经 `commandByName` / `actionByName` 分流，`buttons.tsx` 双轨绑定
- 新增弹窗/异步功能时，交互编排写 actions.ts，文档变更提取为 commands.ts 纯命令

### 4. refreshControls 不做中央调度

`refreshControls()`（index.tsx）只容纳 toolbar / view buttons / TOC 三类既有刷新。新增 UI（word count / outline / 状态栏 / 选区信息 / link preview 等）不要塞进去，应组织为「Editor State → 各 UI 域」的独立消费者，沿用 dispatchTransaction 的分流信号：

- `tr.docChanged` → serialize + onChange
- `tr.docChanged || tr.selectionSet` → 需要响应文档/选区变化的 UI 刷新

### 5. nodeviews 目录不使用 barrel

`src/prosemirror/nodeviews/` 及其子目录（content/ raw/ widgets/）不得有 index.ts。import 一律直连具体文件（如 `nodeviews/kinds`、`nodeviews/widgets/mermaid`）。

### 6. 当前预览块不主动拦截原生交互（2026-10-06）

当前所有预览块（公式 / frontmatter / iframe / mermaid）的「mousedown → preventDefault + NodeSelection 整块选中」交互已全部移除，iframe 透明遮罩也一并删除。

当前行为必须保持：

- 点击预览块放行原生事件
- 不主动通过 mousedown 创建 NodeSelection
- 整块删除依赖现有 PM 的 joinBackward 行为
- `selectNode` / `deselectNode` 仅负责视觉状态，不主动改变交互模型
- 不要重新添加透明遮罩、mousedown 拦截或「先选中、再交互」的机制

如果未来重新设计预览块选择/交互模型，优先区分：

- RawNodeView：HTML source，允许 NodeView 建立 HTML 与编辑器之间的 interaction boundary
- WidgetNodeView：DSL / structured model，不默认要求先选中才能交互

此类交互设计属于产品行为变更，先与用户确认。

### 7. 代码块 NodeView 只做轻量装饰

不要为 code_block 引入内嵌编辑器类 NodeView（如 CodeMirror 实例）——CM 拦截原生选择，导致全选复制无法带上代码块内容。代码块 NodeView 只保留复制按钮（`code-block-copy.tsx`），内容由 ProseMirror 原生 contentDOM 管理。若未来做语法高亮，优先不劫持 contentDOM 的方案（渲染层高亮、只读装饰），动手前先与用户确认选择/复制不受影响。

### 8. 表格保留真实 1px 边框

不为垂直韵律牺牲表格原生形态：不采用「box-shadow 画线不占高度」方案。行分隔线、纵向 padding（`calc(var(--line-height) / 4)`）保持常规做法。若再涉及表格与韵律，可提方案但需说明视觉/结构代价，由用户拍板。

### 9. 预览块操作按钮走 block-menu

块级左侧 hover 菜单核心在 `src/prosemirror/block-menu.ts`（Decoration.widget 注册制）。文本块锚 `pos+1`；atom/无 contentDOM 块锚 `pos` 渲染为前置兄弟。预览块的操作按钮一律通过 `previewBlockOpMenuRegistration` 追加，**不回 NodeView 内嵌菜单方案**（iframe 不可行，已被用户否决）。

## 排版与垂直韵律

项目以 `--line-height: 28px` 为垂直节奏基准：

- 行内 code/kbd/samp 用 `line-height: normal`（不是 `var(--line-height)`）。根因：baseline 对齐的 inline box，行盒取各字体 leading 并集，不同字体 ascent−descent 不同必超出 LH；`lh: normal` 让 code 的自然内容盒落进 strut 行盒，精确 28px
- 例外：default h1 与 classic h1/h2 保留显式行高（比率不足，内容盒装不进 strut）
- `pre code` 有更高优先级 `line-height: 1em`，不受影响
- 测量方法：无头 Chrome `--dump-dom` 跑 `test/rhythm-measure.html`；字体度量用 `test/font-metrics.cjs` 解析 OTF hhea/OS2 表

## 对外 API 快照

`MDWriter.init(options)` 主要选项：`mount`、`initialMarkdown`、`placeholder`、`onChange`、`viewBarRoot`、`formatBarRoot`、`rawPreview`、`mermaidAssets`、`katexAssets`、`onImageUpload`。

工具栏通过 `data-md-editor-command="..."` 绑定（bold / italic / inline_code / link / image_upload / blockquote / bullet_list / ordered_list / table_insert / undo / redo）；视图控件通过 `data-md-editor-view="toggle_source"`（快捷键 Meta+E）。

## 工作习惯

- 改动后用 tsc 检查改动的文件（命令见 README「Type checking」一节），用对应 `test/verify-*.ts` 验证行为
- 涉及交互设计（选中、菜单、弹窗）的方案，先说明取舍再落地，用户拍板
- 大的方向性回退有 git 历史可查（如 code-block-editor 的回退在 56152ce 附近）