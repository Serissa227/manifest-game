// R10-FIX8：这支舰队眼下去不了的港（名船的禁港、王国的进港限制……）——任务表与信的“驶往”事先灰掉用。
// 后端在目的地清单的每一项上带 blocked: { code, text }（与真去时被拒的是同一句）。在海上用航行视图的 known_dests；
// 在港里按需问一次 navigation_dests（旗舰队、按天与概览版本缓存，同一时刻只问一次；问不到时当作没有限制，照旧按下去由内核拒）。
import { useEffect } from "react";
import { create } from "zustand";
import { useNavStore } from "../../hooks/useNavigation";
import { navApi } from "../../ipc/api";
import type { NavDest } from "../../ipc/types";
import { flagship, useGame } from "../../store/game";

interface BlockedCache {
  key: string;
  blocked: ReadonlyMap<number, string>;
}

const EMPTY: ReadonlyMap<number, string> = new Map();
const useCache = create<BlockedCache>(() => ({ key: "", blocked: EMPTY }));
let asking = "";

/** 清单里去不了的那几座：港 → 原因。 */
export function blockedOf(dests: readonly NavDest[] | null | undefined): ReadonlyMap<number, string> {
  const out = new Map<number, string>();
  for (const d of dests ?? []) if (d.blocked?.text) out.set(d.loc, d.blocked.text);
  return out.size > 0 ? out : EMPTY;
}

/** 旗舰队眼下去不了的港 → 原因（不知道时为空表）。 */
export function useBlockedPorts(): ReadonlyMap<number, string> {
  const nav = useNavStore((s) => s.nav);
  const f = useGame((s) => flagship(s.overview));
  const day = useGame((s) => s.overview?.day ?? 0);
  const fleet = f?.id ?? null;
  const docked = f?.docked ?? null;
  const key = fleet !== null && docked !== null ? `${fleet}:${docked}:${day}` : "";
  const cache = useCache();
  useEffect(() => {
    if (!key || fleet === null || cache.key === key || asking === key) return;
    asking = key;
    navApi
      .navigationDests(fleet)
      .then((v) => useCache.setState({ key, blocked: blockedOf(v?.dests) }))
      .catch(() => useCache.setState({ key, blocked: EMPTY }))
      .finally(() => {
        if (asking === key) asking = "";
      });
  }, [key, fleet, cache.key]);
  if (nav && nav.fleet === fleet) return blockedOf(nav.known_dests);
  return key && cache.key === key ? cache.blocked : EMPTY;
}
