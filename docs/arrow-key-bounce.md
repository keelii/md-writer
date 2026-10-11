# 块边界垂直方向键接管（ArrowUp / ArrowDown）

> 记录 2026-10 弹回 bug 的根因与修复方案。实现见 `src/prosemirror/commands.ts` 的 `moveSelectionAcrossBlock` 与 `src/prosemirror/plugins.ts` 的 keyBindings。

## 1. 现象

文档首节点为只读预览块（frontmatter / `$$` 公式 / iframe / mermaid 任一）时，光标置于其后第一个可编辑块行首按 ArrowUp：caret 先跳到上一行，约 50ms 后弹回原位。

## 2. 根因链

1. keymap 未拦截 ArrowUp，浏览器默认动作把 caret 原生移到上一文本块开头；
2. PM view 的同步移动路径失败：块首贴着的 DecoMenu widget（`contentEditable:false`）被 skipIgnoredNodesBefore 判为 ignorable，焦点定位改挂 50ms 定时器（setSelFocus）；
3. selectionchange → flush 时 FOCUS-RESET 分支做等价性比较：`TextSelection.near(文档起点)` 与 `posFromDOM(原生移过去的 DOM 选区)` —— 首节点是只读块时两者恰好相等，PM 误判 DOM 选区已正确，把 state 里的旧选区写回 DOM → 弹回；
4. 即使未触发 FOCUS-RESET，50ms 定时器到期也会用旧 selection 重设 DOM → 弹回。

结论：触发条件全部源自本项目的架构选择（只读预览块 + 块菜单 widget），属应用层责任；PM 的 FOCUS-RESET 误等价是真实缺陷但是 edge case，不等上游。

## 3. 修复方案（机制无关，应用层接管）

keymap 在块边界同步接管方向键，返回 true 短路 PM 整条弹回链：

- `moveSelectionAcrossBlock(dir)`（commands.ts，纯 Command）：dir=-1 对应 ArrowUp，dir=1 对应 ArrowDown；
- 接管条件（全部满足才接管）：
  - 空选区 TextSelection，父节点是 textblock，且不在只读预览块内；
  - 不在 table 内（表格导航交还原生，由 Tab/Enter 命令链负责）；
  - ArrowUp 时 `parentOffset === 0`；ArrowDown 时 `parentOffset === parent.content.size`；
  - `Selection.findFrom(textOnly)` 能找到相邻文本位置；目标落在只读预览块内则跳过整块继续找；
- dispatch 同步 setSelection + scrollIntoView。

返回 true → keydown 默认行为被阻止 → 原生跨块移动不存在 → FOCUS-RESET 与 50ms 定时器两条弹回路径同时消灭。

## 4. 影响面评估

| 场景 | 结论 |
|---|---|
| Shift-ArrowUp/Down 扩选 | 键名带 Shift 前缀不匹配绑定，不受影响 |
| 表格内方向键 | 显式跳过 table 祖先，格内导航保持原生 |
| 块内折行逐行移动 | `parentOffset > 0` 不接管，原生行为与水平位置记忆保留 |
| NodeSelection（图片等） | selection 非空即返回 false，不接管 |
| 文档首/尾边界 | 找不到相邻位置返回 false，走原生 |
| 相邻普通块跨块 | dispatch 结果与原生跨块一致，仅从异步变同步 |
| 撤销历史 | setSelection 无 step，不入 history |
| 跨只读预览块 | 唯一可感知变化：光标直接跳过预览块落到相邻可编辑块（预期行为） |

## 5. 已知边界与摘除条件

- IME 合成态恰在块首按方向键：keymap 不感知 composition，理论上 preventDefault 可能干扰候选窗导航；场景极窄未复现，暂不加 `view.composing` 守卫，复现后补；
- 若未来移除"文档首节点只读预览块"设计，或 prosemirror-view 上游修复 FOCUS-RESET 误等价，可整体摘除 keyBindings 里的 ArrowUp/ArrowDown 两条绑定，无其他耦合。