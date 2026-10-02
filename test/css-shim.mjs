// 注册 css-hooks：npx tsx --import ./test/css-shim.mjs <file>
import { register } from "node:module"
register(new URL("./css-hooks.mjs", import.meta.url))