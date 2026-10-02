// 韵律高度取整验证（无头，fake DOM）：
// 1. resolveRhythmLineHeight：computed line-height 正常解析 / "normal" 回退兜底值
// 2. snapMinHeightToRhythm：自然高度向上取整到行高整数倍（math/mermaid 预览共用）
//    恰好对齐不变 / 高度 0 不动 / 先清上一轮 min-height 再测量
import { RHYTHM_UNIT_FALLBACK, resolveRhythmLineHeight, snapMinHeightToRhythm } from "../src/utils"

var failures = 0
function assert(label: string, ok: boolean, extra?: string) {
  if (ok) {
    console.log("PASS: " + label)
  } else {
    failures += 1
    console.log("FAIL: " + label + (extra ? "  [" + extra + "]" : ""))
  }
}

// ---------- 极简 DOM 桩：仅覆盖 utils 中用到的接口 ----------
class FakeEl {
  style: Record<string, string> = {}
  offsetHeight = 0
  lineHeight = "28px"
}

;(globalThis as any).window = {
  getComputedStyle: function (el: FakeEl) {
    return { lineHeight: el.lineHeight }
  }
}

var el: FakeEl

// 1. 兜底常量为 28（与 --line-height: 1.75rem 对应）
assert("fallback constant is 28", RHYTHM_UNIT_FALLBACK === 28)

// 2. line-height 正常解析
el = new FakeEl()
el.lineHeight = "43.5px"
assert("resolve parses px lineHeight", resolveRhythmLineHeight(el as any) === 43.5)

// 3. line-height 为 normal（parseFloat 得 NaN）时回退 28
el = new FakeEl()
el.lineHeight = "normal"
assert("resolve falls back on normal", resolveRhythmLineHeight(el as any) === RHYTHM_UNIT_FALLBACK)

// 4. 自然高度 30 向上取整到 56
el = new FakeEl()
el.offsetHeight = 30
snapMinHeightToRhythm(el as any)
assert("30 snaps to 56", el.style.minHeight === "56px", el.style.minHeight)

// 5. 恰好对齐（56）保持不变
el = new FakeEl()
el.offsetHeight = 56
snapMinHeightToRhythm(el as any)
assert("56 stays 56", el.style.minHeight === "56px", el.style.minHeight)

// 6. 高度 100 取整到 112（KaTeX 公式典型场景）
el = new FakeEl()
el.offsetHeight = 100
snapMinHeightToRhythm(el as any)
assert("100 snaps to 112", el.style.minHeight === "112px", el.style.minHeight)

// 7. 高度 0（未挂载）不动
el = new FakeEl()
el.offsetHeight = 0
snapMinHeightToRhythm(el as any)
assert("zero height untouched", el.style.minHeight === "", el.style.minHeight)

// 8. 先清上一轮 min-height 再测量：旧值 84px 不影响新一轮取整
el = new FakeEl()
el.style.minHeight = "84px"
el.offsetHeight = 30
snapMinHeightToRhythm(el as any)
assert("stale min-height cleared before measure", el.style.minHeight === "56px", el.style.minHeight)

// 9. 自定义行高 24 时按 24 取整
el = new FakeEl()
el.lineHeight = "24px"
el.offsetHeight = 30
snapMinHeightToRhythm(el as any)
assert("custom unit 24 -> 48", el.style.minHeight === "48px", el.style.minHeight)

if (failures > 0) {
  console.log(failures + " test(s) failed")
  process.exit(1)
}
console.log("All rhythm snap tests passed")