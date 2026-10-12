declare module "*.css"

// esbuild --define:APP_ENV 编译期注入的构建环境宏（"dev" / "prod"），
// dev / build / build:meta 三个 script 均显式 define，运行时代码可直接比较
declare const APP_ENV: string