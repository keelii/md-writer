// 图片高度按韵律行高倍数对齐验证（纯计算函数，无 DOM）：
// 1. 常规尺寸：高度向上取整到 28 倍数，放大后宽度不超容器
// 2. 宽图顶满容器：取整放大超宽时回退缩小到下一档
// 3. 极小图（不足一行）：返回 null（保持固有尺寸）
// 4. 非法输入：返回 null
import { computeImageRhythmHeight } from "../src/prosemirror/image-rhythm"

var failures = 0

function check(name: string, actual: any, expected: any) {
  if (actual === expected) {
    console.log("PASS: " + name)
  } else {
    failures += 1
    console.log("FAIL: " + name)
    console.log("  expected: " + JSON.stringify(expected))
    console.log("  actual:   " + JSON.stringify(actual))
  }
}

var U = 28

// 1. 竖图：固有尺寸 200x30（高 30 < 容器约束），ceil(30/28)=2 → 56px；
//    56 高对应宽 200*(56/30)=373 <= 800 → 取 56
check("small portrait rounds up", computeImageRhythmHeight(200, 30, 800, U), 56)

// 2. 高 100 → ceil(100/28)=4 → 112；112 高宽 200*1.12=224 <= 800 → 112
check("height 100 rounds to 112", computeImageRhythmHeight(200, 100, 800, U), 112)

// 3. 高恰好 84（3 倍）→ 不变 84
check("already aligned stays", computeImageRhythmHeight(200, 84, 800, U), 84)

// 4. 宽图顶满容器：固有 1600x900，容器 800 → 显示 800x450；
//    ceil(450/28)=17 → 476 高对应宽 846 > 800 超宽 → floor(450/28)=16 → 448
check("wide image shrinks to floor", computeImageRhythmHeight(1600, 900, 800, U), 448)

// 5. 宽图但取整后恰好不超：固有 840x840，容器 840 → 显示 840x840；
//    ceil(840/28)=30 → 840 高宽 840 <= 840 → 840（不变）
check("wide image exact fit keeps size", computeImageRhythmHeight(840, 840, 840, U), 840)

// 6. 极扁宽图：显示高 27px（不足一行），ceil → 28 但宽度超容器 → floor=0 → null
//    固有 2240x27，容器 800 → 显示 800x9.64... wait 高 27: 800*(27/2240)=9.64
//    ceil(9.64/28)=1 → 28 高宽 28/27*2240=2322 > 800 → floor=0 → null
check("tiny image under one line returns null", computeImageRhythmHeight(2240, 27, 800, U), null)

// 7. 非法输入
check("zero natural width returns null", computeImageRhythmHeight(0, 100, 800, U), null)
check("zero natural height returns null", computeImageRhythmHeight(200, 0, 800, U), null)
check("zero container returns null", computeImageRhythmHeight(200, 100, 0, U), null)
check("zero unit returns null", computeImageRhythmHeight(200, 100, 800, 0), null)

// 8. 图片比容器窄且高：固有 100x560，容器 800 → 显示 100x560；
//    ceil(560/28)=20 → 560 高宽 100 恰好 100 <= 800 → 560
check("narrow tall image aligns", computeImageRhythmHeight(100, 560, 800, U), 560)

// 9. 非整倍数窄高图：固有 100x550 → ceil(550/28)=20 → 560；
//    560 高宽 100*(560/550)=101.8 <= 800 → 560
check("narrow tall image rounds up", computeImageRhythmHeight(100, 550, 800, U), 560)

if (failures > 0) {
  console.log(failures + " test(s) failed")
  process.exit(1)
}
console.log("All image rhythm tests passed")