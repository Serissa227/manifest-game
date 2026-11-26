// 标题画面的“继续”与等待提示。
import { useEffect, useState } from "react";
import { tz } from "../../i18n/zhOnly";
import type { SaveInfo } from "../../ipc/types";

/**
 * “继续”要读的存档：能读的存档里最近写入的那个（后端在存档列表里给出写入时刻 modified，秒）。
 * 一样新时取列表里靠前的。旧后端没有 modified 时：有自动存档就读它，否则不给“继续”（不知道哪个最近）。
 * retired：已下线、不能读的世界（与读档列表相同）。没有能读的存档时为 null（不显示“继续”）。
 */
export function continueSave(saves: readonly SaveInfo[], retired?: (worldKey: string) => boolean): SaveInfo | null {
  const usable = saves.filter((s) => !retired?.(s.world_key ?? "classic"));
  let best: SaveInfo | null = null;
  for (const s of usable) {
    if (typeof s.modified === "number" && (best === null || s.modified > (best.modified ?? -1))) best = s;
  }
  return best ?? usable.find((s) => s.slot === "autosave") ?? null;
}

/** “继续”下面的小字：主角（或船长）名 · 剧本名；没有名字时只写剧本名。 */
export function continueNote(save: SaveInfo): string {
  const name = save.captain?.name || save.hero;
  return name ? tz("start.continueNote", { name, scenario: save.scenario }) : save.scenario;
}

/** active 为真以来过了几秒（整秒，每秒更新一次）；不在等待时为 0。 */
export function useElapsed(active: boolean): number {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    setSec(0);
    if (!active) return;
    const started = Date.now();
    const id = setInterval(() => setSec(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [active]);
  return active ? sec : 0;
}

/** 等待提示：头几秒只写“正在……”，等久了写上已等几秒与原因（不让人以为卡死了）。 */
export function waitText(kind: "save" | "world", sec: number): string {
  if (kind === "save") return sec < 3 ? tz("start.loadingSave") : tz("start.loadingSaveLong", { sec });
  return sec < 3 ? tz("start.worldLoading") : tz("start.worldLoadingLong", { sec });
}
