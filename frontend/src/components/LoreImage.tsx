// 寰宇的场景插画（art/lore.ts）：按打开时的时辰与当地天气挑一版，打开期间不再换（时钟一天只有几秒，跟着换会一直闪、也费流量）。
// 挑中的一版没画出当地正在下的雨、雪、雾时，画面上叠一层天气（CSS，见 lore.css；减少动态效果时不动）。
import { useMemo } from "react";
import { loreOverlay, loreSeed, loreSrc, pickLore } from "../art/lore";
import type { SkyKind } from "../ipc/types";
import { useClockStore } from "../store/clock";
import { useGame } from "../store/game";
import { phaseOf } from "../time/daylight";
import { sceneWeather, voyageWeather } from "./port/sceneLook";
import { SceneImg } from "./scene/SceneImg";

export interface LoreImageProps {
  /** 插画 key（creature_…、ship_…、realm_…、port_…、event_…） */
  art: string | null | undefined;
  size: "large" | "medium";
  /** 图片的 class（原有的 sd-art、sc-art、port-lore-art 等） */
  className: string;
  /** 外框的 class */
  wrapClass?: string;
  testId?: string;
  /** 夜里的事件：按夜晚挑 */
  night?: boolean;
  /** 港口：天气按这个地点查（缺省按旗舰队所在处） */
  loc?: number | null;
  /** 只要时段与天况挑图、不叠天气（卡片缩略图） */
  noOverlay?: boolean;
  /** 不看时辰天气，用最早的一版（卡片缩略图） */
  plain?: boolean;
}

/** 打开时的时段、天况与轮换种子（不订阅：打开期间不换图）。 */
function snapshot(art: string, night: boolean | undefined, loc: number | null | undefined): { phase: ReturnType<typeof phaseOf>; sky: SkyKind | undefined; seed: number } {
  const { minute, day } = useClockStore.getState();
  const { statics, overview } = useGame.getState();
  const w = loc === undefined || loc === null ? voyageWeather(overview) : sceneWeather(statics, overview, loc);
  return { phase: night ? "night" : phaseOf(minute), sky: w.sky, seed: loreSeed(art, day) };
}

export default function LoreImage({ art, size, className, wrapClass, testId, night, loc, noOverlay, plain }: LoreImageProps) {
  const pick = useMemo(() => {
    if (!art) return null;
    const snap = plain ? null : snapshot(art, night, loc);
    const v = pickLore(art, snap ?? {});
    if (!v) return null;
    const src = loreSrc(v[0], size);
    if (!src) return null;
    const overlay = noOverlay || !snap ? null : loreOverlay(v, snap.sky);
    return { src, file: v[0], overlay };
  }, [art, size, night, loc, noOverlay, plain]);
  if (!pick) return null;
  return (
    <div className={wrapClass ? `lore-pic ${wrapClass}` : "lore-pic"} data-wx={pick.overlay ?? undefined}>
      {/* 大图在新界面里会动（有权重图的话）；卡片上的中图就是一张图 */}
      <SceneImg src={pick.src} file={size === "large" ? pick.file : null} className={className} testId={testId} variant={pick.file} />
    </div>
  );
}
