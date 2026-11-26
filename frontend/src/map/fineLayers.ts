// 细图层的加载（第九批 M01“细海图”）：寰宇另有三层只给显示用的细数据——细海岸、细高程、细河流，由后端的
// map_fine 命令原样下发（base64 的二进制文件，共约 6.5 MB）。这里取回、解压、解码成数组（art/map/fine.ts 的 FineLayers），
// 按地图 key 与地图资源的 hash 缓存；同一张图同时只取一次。
// 经典世界与测试地图没有细图层（后端返回空的一份）；取不到、解不开时一律按没有处理——海图照原来的画法画，不因此打不开。
import { decodeFineCoast, decodeFineElevation, decodeFineRivers, type FineLayers, type Inflate } from "../art/map/fine";
import { navApi } from "../ipc/api";
import type { MapFineResource } from "../ipc/types";

/** 内存里最多留几张图的细图层（一张约 18 MB）。 */
const MEMORY_MAPS = 2;
const memory = new Map<string, FineLayers | null>();
const inflight = new Map<string, Promise<FineLayers | null>>();

function cacheKey(key: string, mapHash?: string | null): string {
  return `${key}:${mapHash ?? ""}`;
}

/** base64 → 字节。 */
export function bytesOfBase64(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 解压 zlib 流：浏览器与 Node 自带的 DecompressionStream（桌面版的 WebView 与本机实测用的浏览器都有）。 */
export const inflateZlib: Inflate = async (data) => {
  const stream = new DecompressionStream("deflate");
  const writer = stream.writable.getWriter();
  // 写与读同时进行（只写不读会卡在背压上）
  const written = writer.write(data as Uint8Array<ArrayBuffer>).then(() => writer.close());
  const reader = stream.readable.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    total += value.length;
  }
  await written;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** 把后端给的细图层解码；没有（三项为空，或后端什么也没给）时为 null。格式不对时抛错。 */
export async function decodeFineResource(r: MapFineResource | null | undefined, inflate: Inflate = inflateZlib): Promise<FineLayers | null> {
  if (!r || !r.coast || !r.elevation || !r.rivers || !(r.cells > 0)) return null;
  const [coast, elevation, rivers] = await Promise.all([
    decodeFineCoast(bytesOfBase64(r.coast), inflate),
    decodeFineElevation(bytesOfBase64(r.elevation), inflate),
    decodeFineRivers(bytesOfBase64(r.rivers), inflate),
  ]);
  return { hash: r.hash, ...coast, ...elevation, rivers };
}

function remember(k: string, layers: FineLayers | null) {
  memory.delete(k);
  memory.set(k, layers);
  while (memory.size > MEMORY_MAPS) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
}

/**
 * 取一张地图的细图层（没有时为 null）。mapHash 是这张地图资源的 hash（换了图就重新取）。
 * 取不到、解不开都当作没有（记一条警告），不抛错。
 */
export function loadFineLayers(key: string, mapHash?: string | null): Promise<FineLayers | null> {
  const k = cacheKey(key, mapHash);
  if (memory.has(k)) return Promise.resolve(memory.get(k) ?? null);
  const pending = inflight.get(k);
  if (pending) return pending;
  const p = (async () => {
    let layers: FineLayers | null = null;
    try {
      layers = await decodeFineResource(await navApi.mapFine(key));
    } catch (e) {
      console.warn("[manifest] 细图层不可用，海图照原来的画法：", e);
    }
    remember(k, layers);
    return layers;
  })().finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
}

/** 内存里已经有结果的细图层：undefined 还没取过，null 这张图没有。 */
export function cachedFineLayers(key: string, mapHash?: string | null): FineLayers | null | undefined {
  const k = cacheKey(key, mapHash);
  return memory.has(k) ? (memory.get(k) ?? null) : undefined;
}

/** 清空内存缓存（测试用）。 */
export function clearFineLayers(): void {
  memory.clear();
  inflight.clear();
}
