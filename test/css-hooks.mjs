// 让 tsx 运行测试时把 .css import 视为空模块（esbuild 构建时仍会正常打包 css）
export async function load(url, context, next) {
  if (url.startsWith("file:") && url.endsWith(".css")) {
    return { format: "module", shortCircuit: true, source: "export default {}" }
  }
  return next(url, context)
}