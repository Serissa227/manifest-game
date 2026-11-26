// 测试里读仓库的二进制文件（寰宇的细图层 data/maps/earth/fine/*.bin）并用 zlib 解压、拼测试用的文件。
// 前端没有装 Node 的类型包，这里只声明用到的几个函数（与 node-fs.d.ts 的声明合并）；只在测试（Node 环境）里用。
declare module "node:fs" {
  /** 不给编码：读成字节 */
  export function readFileSync(path: URL | string): Uint8Array;
}

declare module "node:zlib" {
  export function inflateSync(data: Uint8Array): Uint8Array;
  export function deflateSync(data: Uint8Array): Uint8Array;
}
