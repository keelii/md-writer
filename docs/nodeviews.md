# NodeView 总览

MDWriter 的 WYSIWYG 渲染中，所有自定义 NodeView 按**渲染来源**分为三类（定义见 [kinds.ts](../src/prosemirror/nodeviews/kinds.ts) 与 [index.tsx](../src/index.tsx) 注册表注释）：

- **Content**：PM 拥有 contentDOM，内容编辑/选区/撤销完全由 PM 原生管理，NodeView 只叠加 UI
- **Raw**：用户书写的 HTML source → 浏览器 DOM，DOM 不受编辑器控制，维持原生交互边界
- **Widget**：DSL（Markdown/LaTeX/mermaid）→ renderer → DOM，只读预览

所有 NodeView **不建基类**，共享的只有两样东西：[raw-block-shell.tsx](../src/prosemirror/nodeviews/raw-block-shell.tsx) 外壳（三种 raw_block 预览共用 dom 结构）和 [NodeViewContext](../src/prosemirror/nodeviews/types.ts)（`{opts, view, getPos}` 统一上下文）。工厂签名统一为 `(node, ctx)`，分类间差异由各实现自行声明。

注册入口在 [index.tsx](../src/index.tsx)：`code_block` 按 info 参数分派（mermaid → Widget，其余 → Content）；`raw_inline` / `raw_block` 由 `opts.rawPreview` 开关控制，`raw_block` 再按文本内容分派 kind（math / iframe / frontmatter），跨 kind 变化时 update 返回 false 交回分派器重建。

## 块级 NodeView

| Markdown 元素 | HTML 元素 | 类型 | 继承/共享实现 | DecoMenu | OpButton |
| --- | --- | --- | --- | --- | --- |
| ` ``` ` 围栏代码块 | `<pre><code>` | Content | 独立实现（contentDOM = `code` 元素） | 语言切换 dropdown + 删除（code-block-menu，块前锚；主按钮显示当前语言扩展名，别名归一如 python→py，无语言为「文本」，语言写回 fence info `params`，候选来自 [code-highlight.ts](../src/prosemirror/code-highlight.ts) 的 `CODE_LANGUAGES`，切换即重新分词高亮） | 复制按钮（右上角角标） |
| ` ```mermaid ` 围栏 | mermaid 渲染的 `<svg>` 预览 | Widget | 独立实现（经 index.tsx 的 tracked 包装） | 复制源码 / 编辑源码 / 删除 dropdown（块前锚） | 最大化按钮（右上角角标，渲染成功后显示，进入全屏 + pan/zoom，Esc / 再点退出） |
| `$$…$$` 块级公式 | KaTeX 渲染的 `.katex-display` | Widget | **raw-block-shell** 外壳 | 复制源码 / 编辑源码 / 删除 dropdown（块前锚） | 无 |
| `---…---` YAML frontmatter | 无对应元素（仅编辑器预览壳） | Widget | **raw-block-shell** 外壳 | 复制源码 / 编辑源码 / 删除 dropdown（块前锚） | 无 |
| 无 Markdown 语法（HTML 直写） | `<iframe>` | Raw | **raw-block-shell** 外壳 | 复制源码 / 编辑源码 / 删除 dropdown（块前锚） | 无 |
| `![alt](src)` 独占段落的单图 | `<p><img>` | Content | 独立实现（contentDOM = dom） | 删除图片单按钮（image-rhythm 的图片菜单，块内锚） | 无 |
| 无 | 其余 HTML 源码块 | — | 无 NodeView（返回 null，PM 默认 `pre` 渲染） | 无 | 无 |

## 行内 NodeView

| Markdown 元素 | HTML 元素 | 类型 | 继承/共享实现 | DecoMenu | OpButton |
| --- | --- | --- | --- | --- | --- |
| `$…$` / `$$…$$` 行内公式 | KaTeX 渲染的 `.katex` | Widget | 独立实现 | 无（行内不挂块菜单） | 无 |

## DecoMenu（block-menu，块级 decoration 菜单）

块级交互载体按实现机制分两类，上表用其作列名：**DecoMenu**（由 ProseMirror Decoration.widget 渲染在块外的菜单）与 **OpButton**（NodeView 直接渲染进节点 DOM 的悬浮角标按钮，`contenteditable=false`，不占文档流）。

DecoMenu 不是 NodeView 的一部分，而是 [block-menu.ts](../src/prosemirror/block-menu.ts) 的 Decoration.widget 插件，按注册制工作（`BlockMenuRegistration`：anchorInside / matches / buildMenu）。hover 块时显示，点击外部自动关闭。

| 注册项 | 目标块 | 菜单内容 | 锚点形态 |
| --- | --- | --- | --- |
| `headingMenuRegistration`（[heading-menu.tsx](../src/prosemirror/heading-menu.tsx)） | 顶层 heading | H1–H6 / 正文切换面板（setBlockType）+ 删除项（唯一块时清空为空段落）；主按钮显示当前级别文字（H1–H6） | 块内（pos+1，渲染为块第一个子元素） |
| `paragraphMenuRegistration`（[paragraph-menu.tsx](../src/prosemirror/paragraph-menu.tsx)） | 顶层 paragraph（**非 NodeView 的普通文本块**，单图段落由图片菜单接管、不命中） | H1–H6 / 正文切换面板（setBlockType，与 heading-menu 共用 `buildBlockTypeMenuDom`）+ 删除项（文档仅剩此段时省略，删除会被空文档兜底重置为空段落、无意义）；主按钮显示段落 icon（pilcrow） | 块内（pos+1，渲染为块第一个子元素） |
| `tableMenuRegistration`（[table-menu.tsx](../src/prosemirror/table-menu.tsx)） | 顶层 table | 8 个行列命令（commandByName 分发）+ 删除表格，跟随光标语义：光标不在本表时选区退化为末行末列 | 块前（pos——thead 只接受 tr，块内锚会被 foster parenting 挪走） |
| `previewBlockOpMenuRegistration`（[node-op-menu.tsx](../src/prosemirror/nodeviews/node-op-menu.tsx)） | 预览块（math / iframe / frontmatter 的 raw_block + mermaid code_block，`isPreviewBlock` 判定） | 复制源码 + 编辑源码 + 删除（三项 dropdown，math 主按钮显示公式 icon sigma，其余默认 ⋯）。编辑源码弹 Dialog 直接编辑原始 md 文本（`$$` 公式 / iframe / frontmatter / svg / mermaid 均为 text* 内容），confirm 后经 actions.ts 的 `editPreviewBlockSource` 走 commands.ts 的 `createPreviewSourceReplaceCommand` 纯命令替换；源码改到不再匹配预览形态时 NodeView update 返回 false、PM 重建为普通节点 | 块前（pos，渲染为块的前置兄弟——块内锚会被 prosemirror-view 丢弃） |
| `listMenuRegistration`（[list-menu.tsx](../src/prosemirror/list-menu.tsx)） | 顶层 bullet_list / ordered_list | 有序/无序切换（replaceWith 互换类型、保留 attrs 与内容，与 `createListCommand` 就地转换分支同构）+ 删除列表（唯一块时清空为空段落）；主按钮显示当前列表类型 icon（无序 list / 有序 listOrdered） | 块前（pos——块内 widget 渲染进 li 子树，非来源块 DOM 直接子元素，hover 选择器无法命中） |
| `blockquoteMenuRegistration`（[blockquote-menu.tsx](../src/prosemirror/blockquote-menu.tsx)） | 顶层 blockquote | 转为正文（引用子块整体上提为顶层块，与 blockquote 命令 lift 分支语义一致）+ 删除引用；主按钮显示引用 icon（quote） | 块前（pos，同上——块内 widget 渲染进 p 子树） |
| `codeBlockMenuRegistration`（[code-block-menu.tsx](../src/prosemirror/code-block-menu.tsx)） | 顶层非 mermaid code_block | 语言切换 dropdown（主按钮显示当前语言扩展名，`fenceWordShort` 别名归一如 python→py，无语言为「文本」；`setNodeMarkup` 写回 fence info `params`，空存 null；候选 = `CODE_LANGUAGES`，当前项高亮）+ 删除代码块（唯一块时清空为空段落）；mermaid 由 `previewBlockOpMenuRegistration` 负责，两边 matches 互斥 | 块前（pos——NodeView 把内容包在 pre>code 里，块内 widget 非来源块直接子元素） |

菜单形态统一由 [block-op-menu.tsx](../src/prosemirror/block-op-menu.tsx) 的 `buildBlockOpMenuDom` 约定：**每个 DecoMenu 必有至少一个删除按钮；操作多于一个时呈 dropdown（toggle 主按钮 + 下拉面板）**，单项则为直按钮；主按钮默认 ⋯，有明确块类型的菜单（列表/引用/段落/公式）传 `toggleIcon` 显示当前类型 icon，需要显示当前值的菜单（代码块语言）传 `toggleLabel` 显示文字；面板互斥由 `closeAllOpenBlockMenus` 负责。面板行统一样式，不为删除类操作单独配色：通用操作用 icon（必须带 title），icon 表达不准确时用文字（最多两个字）。

## 选中与删除约定

- 所有预览块**不再自定义** selectNode/deselectNode，PM 原生默认生效（`.ProseMirror-selectednode` 类 + `draggable`）
- 块级点击整块选中交互已全面取消，mousedown 放行原生事件
- 整块删除两条路：键盘（光标到块边界按 Backspace，含 `deletePreviewRawBlockOnBackspace/OnDelete` 边界整删命令），鼠标（DecoMenu 删除按钮，与键盘走同一删除链路）