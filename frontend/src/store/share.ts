// 概览的结构共享（P14a）：每份概览都是后端新序列化、前端新解析出来的对象，哪怕内容没变，里面的数组与对象也全是新的引用——
// 按字段选取（zustand 的 selector + useShallow）也挡不住重渲染。放进 store 之前，把内容与上一份相同的部分换回上一份的对象：
// 没变的字段引用不变，选取它的组件不重渲染；视图调度（store/views.ts）判断“世界变没变”也只需比较引用，不再整份序列化。
// 只处理 JSON 能表示的值（普通对象、数组、字符串、数字、布尔、null）；别的对象照原样留下。不修改传入的对象。

function plain(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v) as unknown;
  return p === Object.prototype || p === null;
}

/**
 * 把 next 里与 prev 内容相同的部分换成 prev 里的对象。整个相同时返回 prev 本身；
 * 部分相同时返回新的容器（相同的子项是 prev 的、不同的是 next 的）；毫无共同之处时返回 next。
 */
export function share<T>(prev: unknown, next: T): T {
  if (Object.is(prev, next)) return next;
  if (Array.isArray(next)) {
    if (!Array.isArray(prev)) return next;
    let same = prev.length === next.length;
    let reused = false;
    const out: unknown[] = new Array<unknown>(next.length);
    for (let i = 0; i < next.length; i++) {
      const v = i < prev.length ? share(prev[i], next[i] as unknown) : (next[i] as unknown);
      out[i] = v;
      if (i < prev.length && v === prev[i]) reused = true;
      else same = false;
    }
    if (same) return prev as T;
    return (reused ? out : next) as T;
  }
  if (plain(next)) {
    if (!plain(prev)) return next;
    const keys = Object.keys(next);
    let same = keys.length === Object.keys(prev).length;
    let reused = false;
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      const has = Object.prototype.hasOwnProperty.call(prev, k);
      const v = has ? share(prev[k], next[k]) : next[k];
      out[k] = v;
      if (has && v === prev[k]) reused = true;
      else same = false;
    }
    if (same) return prev as T;
    return (reused ? out : next) as T;
  }
  return next;
}

/** 两个 JSON 值的内容是否相同（引用相同直接算相同：结构共享之后没变的部分都是同一个对象，只有引用不同的才逐项比）。 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameValue(a[i], b[i])) return false;
    return true;
  }
  if (plain(a)) {
    if (!plain(b)) return false;
    // 与 JSON 一样：值为 undefined 的键当作没有
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    if (ka.length !== Object.keys(b).filter((k) => b[k] !== undefined).length) return false;
    for (const k of ka) if (!sameValue(a[k], b[k])) return false;
    return true;
  }
  return false;
}
