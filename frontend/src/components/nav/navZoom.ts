// 航行视图的缩放（每格的屏幕像素）。
//
// H10a（第十轮）起改成连续缩放：
// - 带细图层的地图（寰宇）：每格 96–240 像素，缺省 144；96 就是最远——再远看海图（Tab）。滚轮连续缩放，按钮按 1.25 倍步进。
// - 没有细图层的地图（经典世界）：每格 8–24 像素，缺省 18（与原来的档位同一范围）。
// - 记住上次的值（本机存储，按两种地图分开记；读写失败时按缺省值）。
//
// 下面的 CLASSIC_NAV_ZOOMS / NAV_DETAIL_ZOOMS / navZoomsOf 是改动前的整数倍档位（24 / 48 / 72），界面已不再用；
// 留着是因为已有测试还在引用它们（守则：已有测试不删、不改期望）。
import { create } from "zustand";
import type { ChartInput } from "../../art/map";

export const CLASSIC_NAV_ZOOMS = [8, 12, 18, 24] as const;
export const CLASSIC_NAV_DEFAULT_ZOOM: (typeof CLASSIC_NAV_ZOOMS)[number] = 18;
export const NAV_DETAIL_ZOOMS = [24, 48, 72] as const;
export const NAV_DETAIL_DEFAULT_ZOOM: (typeof NAV_DETAIL_ZOOMS)[number] = 48;

/** 改动前的档位（见文件开头；界面已不用）。 */
export function navZoomsOf(source: { input: Pick<ChartInput, "fine"> } | null | undefined): { zooms: readonly number[]; initial: number } {
  return source?.input.fine ? { zooms: NAV_DETAIL_ZOOMS, initial: NAV_DETAIL_DEFAULT_ZOOM } : { zooms: CLASSIC_NAV_ZOOMS, initial: CLASSIC_NAV_DEFAULT_ZOOM };
}

/** 两种地图。 */
export type NavZoomKind = "detail" | "classic";

/** 连续缩放的范围：最近、最远与缺省（每格像素）。 */
export interface NavZoomRange {
  min: number;
  max: number;
  initial: number;
}

export const NAV_ZOOM_RANGES: Record<NavZoomKind, NavZoomRange> = {
  detail: { min: 96, max: 240, initial: 144 },
  classic: { min: 8, max: 24, initial: 18 },
};

/** 按钮一下放大 / 缩小的倍数。 */
export const NAV_ZOOM_STEP = 1.25;
/** 滚轮：每 100 个单位（大约一格滚轮）放大 / 缩小的倍数。 */
export const NAV_WHEEL_STEP = 1.15;

export function navZoomKind(source: { input: Pick<ChartInput, "fine"> } | null | undefined): NavZoomKind {
  return source?.input.fine ? "detail" : "classic";
}

/** 夹进范围（不是有限数时取缺省）。 */
export function clampZoom(kind: NavZoomKind, z: number): number {
  const r = NAV_ZOOM_RANGES[kind];
  if (!Number.isFinite(z)) return r.initial;
  return Math.max(r.min, Math.min(r.max, z));
}

const KEY = (kind: NavZoomKind) => `manifest.navZoom.${kind}`;

function load(kind: NavZoomKind): number {
  try {
    const raw = globalThis.localStorage?.getItem(KEY(kind));
    return raw === null || raw === undefined ? NAV_ZOOM_RANGES[kind].initial : clampZoom(kind, Number(raw));
  } catch {
    return NAV_ZOOM_RANGES[kind].initial;
  }
}

export interface NavZoomStore {
  /** 两种地图各自的目标缩放（每格像素）：画面朝它缓动过去 */
  detail: number;
  classic: number;
}

export const useNavZoom = create<NavZoomStore>(() => ({ detail: load("detail"), classic: load("classic") }));

/** 设定目标缩放（夹进范围，记到本机）。 */
export function setNavZoom(kind: NavZoomKind, z: number): void {
  const v = clampZoom(kind, z);
  if (useNavZoom.getState()[kind] === v) return;
  useNavZoom.setState({ [kind]: v } as Pick<NavZoomStore, NavZoomKind>);
  try {
    globalThis.localStorage?.setItem(KEY(kind), String(Math.round(v * 100) / 100));
  } catch {
    // 本机存储不可用时只在本次运行中生效
  }
}

/** 按钮：放大（dir = 1）或缩小（dir = −1）一步。 */
export function stepNavZoom(kind: NavZoomKind, dir: 1 | -1): void {
  setNavZoom(kind, useNavZoom.getState()[kind] * NAV_ZOOM_STEP ** dir);
}

/** 滚轮：deltaY 向下为正（缩小）。按像素滚动的触控板也连续。 */
export function wheelNavZoom(kind: NavZoomKind, deltaY: number): void {
  if (!Number.isFinite(deltaY) || deltaY === 0) return;
  // 一次最多算三格，免得某些鼠标一下给出上千的 deltaY
  const d = Math.max(-300, Math.min(300, deltaY));
  setNavZoom(kind, useNavZoom.getState()[kind] * NAV_WHEEL_STEP ** (-d / 100));
}

/** 是否已到最近 / 最远（按钮的禁用状态）。 */
export function zoomAtLimit(kind: NavZoomKind, z: number): { inMax: boolean; outMax: boolean } {
  const r = NAV_ZOOM_RANGES[kind];
  return { inMax: z >= r.max - 1e-6, outMax: z <= r.min + 1e-6 };
}

/** 屏上自己的船长（像素）：0.3 格，夹在 36–64 像素（经典世界照每格 18 像素时的 2 倍图，约 58 像素，同样夹住）。 */
export function shipLengthPx(cellPx: number): number {
  return Math.max(36, Math.min(64, cellPx * 0.3));
}

/** 屏上别的船的长度（像素）：约 0.25 格，夹在 28–52 像素。 */
export function otherShipLengthPx(cellPx: number): number {
  return Math.max(28, Math.min(52, cellPx * 0.25));
}
