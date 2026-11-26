// 译文表的类型：与中文模块的键完全相同——少一个键、多一个键都编译不过（运行时另有 i18n.test.ts 检查键与占位符）。
// 用法：`export const shell: Translation<typeof zhShell> = { ... }`。

/** 与中文模块 T 键集合相同的译文表。 */
export type Translation<T> = { readonly [K in keyof T]: string };
