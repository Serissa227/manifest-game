import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { attachView, domainVersion, onDomains, reloadView, type ViewSnapshot, type ViewStatus } from "../store/views";

export interface ViewOptions {
  /** 跟随世界状态的变化重新查询（缺省 true）；false 时只在挂载与调用 reload 时查询 */
  follow?: boolean;
  /** 查询失败时不弹错误，data 置空（status 为 error，由使用者自己处理）；缺省弹错误、保留上一次的数据 */
  quiet?: boolean;
}

export interface ViewResult<T> {
  /** 最近的结果。换了 key、新结果还没到时仍是上一个 key 的结果（不闪成空白）；key 为 null 时为 null */
  data: T | null;
  /** 当前 key 的状态：idle（key 为 null）、loading（还没有结果）、ok、error */
  status: ViewStatus;
  reload: () => void;
}

/**
 * 按需查询一个视图（调度见 store/views.ts）：同一个 key 全局共用一份结果，每类查询同时只有一个在路上；
 * 世界的状态变了（换了日期、内容变了、本地的操作）时重新查询，只改了倍速时不查。
 * `key` 为 null 时不查询。第三个参数为 false 时不随世界更新，只在挂载与调用 `reload` 时查询
 * （用于开销较大、不需要实时刷新的视图，例如调试面板）；也可以给 { follow, quiet }。
 * 同一个 key 必须是同一个查询（取数函数相同）。
 */
export function useView<T>(key: string | null, fetcher: () => Promise<T>, options: boolean | ViewOptions = true): ViewResult<T> {
  const { follow = true, quiet = false } = typeof options === "boolean" ? { follow: options } : options;
  const ref = useRef(fetcher);
  useEffect(() => {
    ref.current = fetcher;
  });
  // shown：要显示的结果（换 key 时先留着上一个的）；status 属于当前的 key
  const [state, setState] = useState<{ key: string | null; data: T | null; status: ViewStatus }>({ key: null, data: null, status: "idle" });
  useEffect(() => {
    if (key === null) {
      setState({ key: null, data: null, status: "idle" });
      return;
    }
    setState((s) => (s.key === key ? s : { key, data: s.data, status: "loading" }));
    return attachView<T>(key, {
      follow,
      quiet,
      fetch: () => ref.current(),
      notify: (snap: ViewSnapshot<T>) =>
        setState((s) => ({
          key,
          // 出错时保留上一次的结果（quiet 的使用者在下面置空）
          data: snap.status === "ok" ? snap.data : s.data,
          status: snap.status,
        })),
    });
  }, [key, follow, quiet]);
  const reload = useCallback(() => {
    if (key !== null) reloadView(key);
  }, [key]);
  const status: ViewStatus = key === null ? "idle" : state.key === key ? state.status : "loading";
  const data = key === null || (quiet && status === "error") ? null : state.data;
  return { data, status, reload };
}

/** 世界状态的版本（store/views.ts 的领域版本）：只在世界的状态可能变了时加一，只改了倍速时不变。 */
export function useWorldVersion(): number {
  return useSyncExternalStore(onDomains, () => domainVersion("world"));
}
