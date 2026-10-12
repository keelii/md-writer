// Meta+S 保存到本地文件（createMarkdownFileSaver）验证：
// - 首次保存：showSaveFilePicker 另存为，写入成功后缓存 handle
// - 后续保存：不再弹 picker，直接 createWritable 覆盖写
// - 不支持 File System Access API：降级为 a[download] 下载
// - 用户取消（AbortError）/ handle 失效 / 写入失败的状态与 handle 重置
// Node 18 无 window/document/URL.createObjectURL，脚本内注入 stub。
import { createMarkdownFileSaver } from "../src/save-file"

var g = globalThis as any
var failures = 0

function assert(label: string, ok: boolean, extra?: string) {
  if (ok) {
    console.log("PASS: " + label)
  } else {
    failures += 1
    console.log("FAIL: " + label + (extra ? "  [" + extra + "]" : ""))
  }
}

// ---- stub 环境 ----

// fake FileSystemFileHandle：记录每次覆盖写内容与 close 次数
function fakeHandle(name: string, opts?: { failCreateWritable?: Error; failWrite?: Error }) {
  var handle: any = { name: name, writes: [] as string[], closeCount: 0 }
  handle.createWritable = function () {
    if (opts && opts.failCreateWritable) {
      return Promise.reject(opts.failCreateWritable)
    }
    return Promise.resolve({
      write: function (data: string) {
        if (opts && opts.failWrite) {
          return Promise.reject(opts.failWrite)
        }
        handle.writes.push(data)
        return Promise.resolve()
      },
      close: function () {
        handle.closeCount += 1
        return Promise.resolve()
      }
    })
  }
  return handle
}

// picker 环境：window.showSaveFilePicker 记录调用参数并返回指定 handle
function setupPickerEnv(handleResolver: (options: any, index: number) => any) {
  var calls: any[] = []
  var index = 0
  g.window = {
    showSaveFilePicker: function (options: any) {
      index += 1
      calls.push(options)
      var handle = handleResolver(options, index)
      if (handle && typeof handle.then === "function") {
        return handle
      }
      return Promise.resolve(handle)
    }
  }
  return {
    calls: calls,
    count: function () {
      return calls.length
    }
  }
}

// 下载环境：无 showSaveFilePicker + document/URL stub
function setupDownloadEnv() {
  var clicks: any[] = []
  var blobs: any[] = []
  g.window = {}
  g.document = {
    createElement: function () {
      var anchor: any = { style: {}, href: "", download: "" }
      anchor.click = function () {
        clicks.push(anchor)
      }
      return anchor
    },
    body: {
      appendChild: function () {},
      removeChild: function () {}
    }
  }
  g.URL = {
    createObjectURL: function (blob: any) {
      blobs.push(blob)
      return "blob:fake-" + blobs.length
    },
    revokeObjectURL: function () {}
  }
  return {
    clicks: clicks,
    blobs: blobs
  }
}

// ---- 用例 ----

// 1/2. 首次另存为 + 后续覆盖写
async function caseFirstSaveThenOverwrite() {
  var handle = fakeHandle("note.md")
  var picker = setupPickerEnv(function () {
    return handle
  })
  var saver = createMarkdownFileSaver()

  var status1 = await saver.save("# 一\n")
  assert("1a 首次保存返回 saved", status1 === "saved", String(status1))
  assert("1b picker 只调用一次", picker.count() === 1, String(picker.count()))
  assert(
    "1c suggestedName 默认 untitled.md",
    picker.calls[0] && picker.calls[0].suggestedName === "untitled.md",
    picker.calls[0] && String(picker.calls[0].suggestedName)
  )
  assert(
    "1d 首次内容写入 handle",
    handle.writes.join("|") === "# 一\n",
    handle.writes.join("|")
  )
  assert("1e 目标文件名已缓存", saver.getTargetName() === "note.md", String(saver.getTargetName()))

  var status2 = await saver.save("# 二\n\n新内容。\n")
  assert("2a 第二次保存返回 saved", status2 === "saved", String(status2))
  assert("2b 第二次不再弹 picker", picker.count() === 1, String(picker.count()))
  assert(
    "2c 覆盖写内容为第二次内容",
    handle.writes.length === 2 && handle.writes[1] === "# 二\n\n新内容。\n",
    JSON.stringify(handle.writes)
  )
  assert("2d writable 均已 close", handle.closeCount === 2, String(handle.closeCount))
}

// 3. suggestedName 透传 + reset 后重新另存为
async function caseSuggestedNameAndReset() {
  var handle = fakeHandle("自定义.md")
  var picker = setupPickerEnv(function () {
    return handle
  })
  var saver = createMarkdownFileSaver()

  await saver.save("内容", "my-doc.md")
  assert("3a suggestedName 透传给 picker", picker.calls[0].suggestedName === "my-doc.md")

  saver.reset()
  assert("3b reset 后目标文件名清空", saver.getTargetName() === null)
  await saver.save("内容")
  assert("3c reset 后重新弹 picker", picker.count() === 2, String(picker.count()))
}

// 4. 不支持 File System Access API → 下载降级
async function caseDownloadFallback() {
  var env = setupDownloadEnv()
  var saver = createMarkdownFileSaver()

  var status = await saver.save("# 降级\n\n正文", "fallback.md")
  assert("4a 不支持时返回 downloaded", status === "downloaded", String(status))
  assert("4b 触发 a[download] 点击", env.clicks.length === 1, String(env.clicks.length))
  assert("4c download 文件名正确", env.clicks[0].download === "fallback.md", env.clicks[0].download)
  var text = env.blobs.length === 1 ? await env.blobs[0].text() : ""
  assert("4d Blob 内容为 markdown 原文", text === "# 降级\n\n正文", text)
}

// 5. 用户取消（AbortError）→ cancelled，handle 未缓存
async function caseUserCancel() {
  var picker = setupPickerEnv(function () {
    var error: any = new Error("user cancelled")
    error.name = "AbortError"
    return Promise.reject(error)
  })
  var saver = createMarkdownFileSaver()

  var status = await saver.save("内容")
  assert("5a 取消返回 cancelled", status === "cancelled", String(status))
  assert("5b 取消后无目标文件名", saver.getTargetName() === null)
  await saver.save("内容")
  assert("5c 下次保存重新弹 picker", picker.count() === 2, String(picker.count()))
}

// 6. 缓存 handle 失效（createWritable 失败）→ 重置后重走另存为
async function caseStaleHandleRecovery() {
  // stale handle：首次 createWritable 成功，之后失效（模拟文件被移动/删除）
  var staleHandle = fakeHandle("旧.md")
  var originalCreate = staleHandle.createWritable
  var createCount = 0
  staleHandle.createWritable = function () {
    createCount += 1
    if (createCount > 1) {
      return Promise.reject(new Error("NotFoundError: file gone"))
    }
    return originalCreate()
  }
  var freshHandle = fakeHandle("新.md")
  var picker = setupPickerEnv(function (_options: any, index: number) {
    return index === 1 ? staleHandle : freshHandle
  })
  var saver = createMarkdownFileSaver()

  await saver.save("第一次")
  var status = await saver.save("第二次")
  assert("6a handle 失效后恢复返回 saved", status === "saved", String(status))
  assert("6b 恢复过程重新弹了 picker", picker.count() === 2, String(picker.count()))
  assert(
    "6c 最终写入新 handle",
    freshHandle.writes.join("|") === "第二次",
    freshHandle.writes.join("|")
  )
  assert("6d 目标文件名更新为新 handle", saver.getTargetName() === "新.md", String(saver.getTargetName()))
}

// 7. 写入失败（非取消）→ failed，坏 handle 不残留
async function caseWriteFailure() {
  var handle = fakeHandle("bad.md", { failWrite: new Error("QuotaExceededError") })
  var picker = setupPickerEnv(function () {
    return handle
  })
  var saver = createMarkdownFileSaver()

  var status = await saver.save("内容")
  assert("7a 写入失败返回 failed", status === "failed", String(status))
  assert("7b 失败后无目标文件名", saver.getTargetName() === null)
  await saver.save("内容")
  assert("7c 下次保存重新弹 picker", picker.count() === 2, String(picker.count()))
}

async function main() {
  await caseFirstSaveThenOverwrite()
  await caseSuggestedNameAndReset()
  await caseDownloadFallback()
  await caseUserCancel()
  await caseStaleHandleRecovery()
  await caseWriteFailure()
  if (failures > 0) {
    console.log("RESULT: " + failures + " FAILED")
    process.exit(1)
  }
  console.log("RESULT: ALL PASS")
}

main()