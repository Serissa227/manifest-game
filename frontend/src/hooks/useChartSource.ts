// 海图的数据来源：经典世界直接用静态数据（返回同一个对象，渲染器不会因此重建）；
// 第九批的大地图（StaticView.map.external）先按 hash 取地图资源（map/mapResource.ts），并进静态数据后再画。
// M01“细海图”：大地图再取一份细图层（map/fineLayers.ts；只有寰宇有，没有的地图得到 null），两样都到了才画——
// 免得先按旧海岸画一遍、细图层到了又整张重画。
import { useEffect, useMemo, useState } from "react";
import { chartInput, type ChartInput } from "../art/map";
import type { FineLayers } from "../art/map/fine";
import type { MapResource, StaticView } from "../ipc/types";
import { chartHubKey } from "../map/chartHub";
import { fogMapKey } from "../map/fogStore";
import { cachedFineLayers, loadFineLayers } from "../map/fineLayers";
import { cachedMapResource, isExternalMap, loadMapResource, withMapResource } from "../map/mapResource";

export interface ChartSource {
  /** 图层齐全的静态数据（经典世界就是原来的对象） */
  statics: StaticView;
  /** 地图资源（经典世界为 null） */
  resource: MapResource | null;
  /** 海图输入（含投影与环绕） */
  input: ChartInput;
  /** 共用后台线程的键：数据与地图 */
  hubKey: string;
  /** 东西相连 */
  wrap: boolean;
  /** 迷雾属于哪张地图（map/fogStore.ts 的键；按并入资源之前的静态数据算，与航海图取迷雾时的键相同） */
  fogMap: string;
}

function sourceOf(statics: StaticView, resource: MapResource | null, fine: FineLayers | null): ChartSource {
  const merged = resource ? withMapResource(statics, resource) : statics;
  const input = chartInput(merged, resource?.projection ?? null);
  if (fine) input.fine = fine;
  return {
    statics: merged,
    resource,
    input,
    // 细图层换了，海图也要重画：并进共用后台线程的键
    hubKey: chartHubKey(merged) + (fine ? `:fine:${fine.hash}` : ""),
    wrap: merged.map.wrap_x === true,
    fogMap: fogMapKey(statics),
  };
}

/** 海图的数据来源；大地图的资源还没取到时为 null（取失败时 failed 为 true）。 */
export function useChartSource(statics: StaticView | null): { source: ChartSource | null; failed: boolean } {
  const external = isExternalMap(statics);
  const key = statics?.map.key ?? statics?.world.map_key ?? "";
  const hash = statics?.map.hash ?? null;
  const [loaded, setLoaded] = useState<{ key: string; hash: string | null; res: MapResource } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!external) return;
    if (cachedMapResource(key, hash)) return;
    let alive = true;
    loadMapResource(key, hash)
      .then((res) => {
        if (alive) setLoaded({ key, hash, res });
      })
      .catch(() => {
        if (alive) setFailed(`${key}:${hash ?? ""}`);
      });
    return () => {
      alive = false;
    };
  }, [external, key, hash]);
  const res = external ? (cachedMapResource(key, hash) ?? (loaded && loaded.key === key && loaded.hash === hash ? loaded.res : null)) : null;
  // 细图层：大地图的资源到了再取；undefined 表示还没有结果（没有细图层的地图结果是 null）
  const [fineAt, setFineAt] = useState<string | null>(null);
  const fineKey = `${key}:${hash ?? ""}`;
  const wantFine = external && !!res;
  useEffect(() => {
    if (!wantFine || cachedFineLayers(key, hash) !== undefined) return;
    let alive = true;
    void loadFineLayers(key, hash).then(() => {
      if (alive) setFineAt(`${key}:${hash ?? ""}`);
    });
    return () => {
      alive = false;
    };
  }, [wantFine, key, hash]);
  const fine = wantFine ? cachedFineLayers(key, hash) : null;
  // fineAt 只用来在细图层到了以后重新渲染（结果从缓存里取）
  const fineReady = !wantFine || fine !== undefined || fineAt === fineKey;
  const source = useMemo(
    () => (statics && (!external || res) && fineReady && fine !== undefined ? sourceOf(statics, res, fine) : null),
    [statics, external, res, fine, fineReady],
  );
  return { source, failed: external && !res && failed === `${key}:${hash ?? ""}` };
}
