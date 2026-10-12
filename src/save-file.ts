// Markdown 文件保存（Meta+S）：
//   - 首次保存：showSaveFilePicker 另存为，拿到 FileSystemFileHandle 后缓存
//   - 后续保存：直接 createWritable 覆盖写缓存 handle，不再弹窗
//   - 不支持 File System Access API 的浏览器（Safari / Firefox）：降级为下载 .md
// save 永不 reject，状态以返回值区分，宿主无需 try/catch。
export type SaveStatus = "saved" | "downloaded" | "cancelled" | "failed"

export interface MarkdownFileSaver {
  save: (markdown: string, suggestedName?: string) => Promise<SaveStatus>
  getTargetName: () => string | null
  reset: () => void
}

var MARKDOWN_ACCEPT_EXTENSIONS = [".md", ".markdown", ".mdown", ".mkd"]

function isSavePickerSupported() {
  return typeof (window as any).showSaveFilePicker === "function"
}

// 不支持 File System Access API 的浏览器：Blob + a[download] 下载兜底
function downloadMarkdown(markdown: string, fileName: string) {
  var blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" })
  var url = URL.createObjectURL(blob)
  var link = document.createElement("a")
  link.href = url
  link.download = fileName
  link.style.display = "none"
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(function () {
    URL.revokeObjectURL(url)
  }, 0)
}

function writeToHandle(handle: any, markdown: string) {
  return handle.createWritable().then(function (writable: any) {
    return writable.write(markdown).then(function () {
      return writable.close()
    })
  })
}

export function createMarkdownFileSaver(): MarkdownFileSaver {
  var fileHandle: any = null
  var targetName: string | null = null

  function save(markdown: string, suggestedName?: string): Promise<SaveStatus> {
    var fileName = suggestedName || targetName || "untitled.md"

    // 已有目标文件：覆盖写，不弹窗
    if (fileHandle) {
      return writeToHandle(fileHandle, markdown).then(function (): SaveStatus {
        return "saved"
      }).catch(function () {
        // 目标文件可能被移动 / 删除 / 权限失效：重置后重走另存为
        fileHandle = null
        return save(markdown, suggestedName)
      })
    }

    if (!isSavePickerSupported()) {
      downloadMarkdown(markdown, fileName)
      return Promise.resolve("downloaded" as SaveStatus)
    }

    var pickerOptions = {
      suggestedName: fileName,
      types: [
        {
          description: "Markdown",
          accept: { "text/markdown": MARKDOWN_ACCEPT_EXTENSIONS }
        }
      ]
    }

    return (window as any).showSaveFilePicker(pickerOptions).then(function (handle: any) {
      fileHandle = handle
      targetName = handle.name || fileName
      return writeToHandle(handle, markdown)
    }).then(function (): SaveStatus {
      return "saved"
    }).catch(function (error: any) {
      // handle 失效兜底：本次失败不残留坏 handle，下次保存重新选目标
      fileHandle = null
      targetName = null
      if (error && error.name === "AbortError") {
        return "cancelled" as SaveStatus
      }
      console.warn("MDWriter: save file failed", error)
      return "failed" as SaveStatus
    })
  }

  return {
    save: save,
    getTargetName: function () {
      return targetName
    },
    setTarget: function (handle: any, name?: string) {
      if (!handle) {
        fileHandle = null
        targetName = null
        return
      }
      fileHandle = handle
      targetName = (handle && handle.name) || name || null
    },
    reset: function () {
      fileHandle = null
      targetName = null
    }
  }
}