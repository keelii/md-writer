// 小屏适配纯 CSS 实现验证（styles/small-screen.css @media (max-width: 480px)）：
// 1. JS 机制已移除：src/styles/small-screen.ts 不存在；index.tsx 无 attach/detach 引用
// 2. 源码收拢：small-screen.css 以 @media (max-width: 480px) 包裹全部窄屏规则、
//    无 .md-screen-sm 类前缀；layout/toolbar/block-menu/block-op-menu 四个原文件
//    仍不含分散的 480px media query（仅注释提及除外）
// 3. dist 产物：index.css 含 480px media query 且无 .md-screen-sm；
//    index.js 不含 md-screen-sm / 480px 断点字符串（JS 侧机制编译后不存在）
// 运行：npx --yes tsx --import ./test/css-shim.mjs test/verify-small-screen.ts
// （2/3 节读 dist 产物，需先 npm run build）
import { readFileSync, existsSync } from "fs"

var passed = 0
var failed = 0
function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++
    console.log("PASS: " + msg)
  } else {
    failed++
    console.log("FAIL: " + msg)
  }
}

var media480 = /@media\s*\(max-width:\s*480px\)/

console.log("--- 1. JS 机制已移除 ---")

assert(!existsSync("src/styles/small-screen.ts"), "1a src/styles/small-screen.ts 已删除")
var indexTsx = readFileSync("src/index.tsx", "utf-8")
assert(indexTsx.indexOf("attachSmallScreen") === -1 && indexTsx.indexOf("detachSmallScreen") === -1,
  "1b index.tsx 无 attach/detachSmallScreen 调用")
assert(indexTsx.indexOf("SCREEN_SM_MAX") === -1 && indexTsx.indexOf("md-screen-sm") === -1,
  "1c index.tsx 无断点常量与窄屏类引用")
assert(indexTsx.indexOf("./styles/small-screen.css") !== -1,
  "1d index.tsx 仍引入 small-screen.css（样式保留）")

console.log("")
console.log("--- 2. 源码收拢 ---")

var smallScreenCss = readFileSync("src/styles/small-screen.css", "utf-8")
assert(media480.test(smallScreenCss), "2a small-screen.css 含 @media (max-width: 480px) 断点")
var noComments = smallScreenCss.replace(/\/\*[\s\S]*?\*\//g, "")
assert(noComments.indexOf(".md-screen-sm") === -1, "2b small-screen.css 无 .md-screen-sm 类前缀")
// 规则主体必须都在 media query 内：去掉 @media 块后应只剩空白
var outsideMedia = noComments.replace(/@media\s*\(max-width:\s*480px\)\s*\{[\s\S]*$/, "")
assert(outsideMedia.trim() === "", "2c 窄屏规则全部位于 media query 块内")
assert(noComments.indexOf(".ProseMirror:not(.md-editor-tooltip .ProseMirror)") !== -1,
  "2d 含编辑区窄屏边距规则（排除 tooltip 子编辑器）")
assert(noComments.indexOf("button.md-editor-more-toggle") !== -1, "2e 含 ⋯ 按钮窄屏显示规则")
assert(noComments.indexOf(".md-editor-block-op-menu-panel") !== -1, "2f 含块操作面板窄屏左对齐规则")
assert(noComments.indexOf(".md-editor-block-menu") !== -1, "2g 含块级悬浮菜单窄屏轨道规则")

var layoutCss = readFileSync("src/styles/layout.css", "utf-8")
var toolbarCss = readFileSync("src/styles/toolbar.css", "utf-8")
var blockMenuCss = readFileSync("src/prosemirror/block-menu.css", "utf-8")
var blockOpMenuCss = readFileSync("src/prosemirror/block-op-menu.css", "utf-8")
var stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "")
assert(!media480.test(stripComments(layoutCss)), "2h layout.css 无 480px media query（注释除外）")
assert(!media480.test(stripComments(toolbarCss)), "2i toolbar.css 无 480px media query（注释除外）")
assert(!media480.test(stripComments(blockMenuCss)), "2j block-menu.css 无 480px media query（注释除外）")
assert(!media480.test(stripComments(blockOpMenuCss)), "2k block-op-menu.css 无 480px media query（注释除外）")

console.log("")
console.log("--- 3. dist 产物 ---")

try {
  var distCss = readFileSync("dist/index.css", "utf-8")
  assert(media480.test(distCss), "3a dist/index.css 含 480px 窄屏 media query")
  assert(distCss.indexOf(".md-screen-sm") === -1, "3b dist/index.css 无 .md-screen-sm 前缀")
  var distJs = readFileSync("dist/index.js", "utf-8")
  // matchMedia 本身可能来自第三方库（如 svg-pan-zoom 的 print 查询），故只断言小屏机制专属痕迹不存在
  assert(distJs.indexOf("md-screen-sm") === -1 && distJs.indexOf("max-width: 480px") === -1,
    "3c dist/index.js 无小屏 JS 机制（md-screen-sm / 480px 断点字符串）")
} catch (e) {
  assert(false, "读取 dist 产物失败（请先 npm run build）: " + String(e))
}

console.log("")
console.log("passed=" + passed + " failed=" + failed)
if (failed > 0) {
  process.exit(1)
}
console.log("RESULT: ALL PASS")