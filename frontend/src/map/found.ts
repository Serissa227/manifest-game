// 已发现的发现物：海图上的发现物标记、新发现的闪现与“发现：XXX”提示、航行状态里的本次航程新发现数。
//
// 发现物的位置只在发现后由 api.discoveries().found 给出。概览里“已发现总数”（discovered_count，只增不减）
// 或“未报告的发现数”（报告后刷新已报告标记）变化时重新查询一次，与上一次的结果比较得出新发现；
// 旧后端没有 discovered_count 时退回“未报告数:名声”（同一天既报告又发现时未报告数可能不变，名声会变）。
// 新开局、读档或换了世界时重新取基准，不算新发现。
// 由 useVoyage()（外壳在 App 中调用一次）启动 watchDiscoveries()。
import { create } from "zustand";
import { listJoin, t } from "../i18n";
import { api } from "../ipc/api";
import type { FoundView } from "../ipc/types";
import { flagship, useGame, type GameStore } from "../store/game";
import { discoveryDefs, hasDiscoveries } from "./marks";

export interface FoundState {
  /** 已发现的发现物（含已报告的） */
  found: FoundView[];
  /** 最近一批新发现的发现物 id（海图据此闪现标记） */
  fresh: number[];
  /** 每有一批新发现加一（海图据此开始闪现） */
  freshSeq: number;
  /** 旗舰队本次航程（离港起）的新发现数 */
  voyage: number;
}

export const useFoundStore = create<FoundState>(() => ({ found: [], fresh: [], freshSeq: 0, voyage: 0 }));

interface Snap {
  fleet: number;
  day: number;
  docked: number | null;
}

/**
 * 开始跟踪发现物，返回停止跟踪的函数。
 * 世界里没有发现物（旧数据）时什么也不查询。
 */
export function watchDiscoveries(): () => void {
  /** 查询序号：只采用最新一次查询的结果 */
  let req = 0;
  /** 上一次结果里的发现物 id；null 表示还没有基准（不宣布新发现） */
  let baseline: Set<number> | null = null;
  /** 上一次查询时的触发计数（“已发现总数:未报告数”，旧后端为“未报告数:名声”） */
  let counter: string | null = null;
  let prev: Snap | null = null;

  const reset = () => {
    req++;
    baseline = null;
    counter = null;
    const s = useFoundStore.getState();
    if (s.found.length > 0 || s.fresh.length > 0 || s.voyage > 0) useFoundStore.setState({ found: [], fresh: [], voyage: 0 });
  };

  const refresh = (announce: boolean) => {
    const my = ++req;
    api
      .discoveries()
      .then((v) => {
        if (my !== req || !v || !Array.isArray(v.found)) return;
        const before = baseline;
        baseline = new Set(v.found.map((f) => f.id));
        const fresh = announce && before ? v.found.filter((f) => !before.has(f.id)).map((f) => f.id) : [];
        if (fresh.length === 0) {
          useFoundStore.setState({ found: v.found });
          return;
        }
        const g = useGame.getState();
        const atSea = flagship(g.overview)?.docked === null;
        useFoundStore.setState((s) => ({
          found: v.found,
          fresh,
          freshSeq: s.freshSeq + 1,
          voyage: s.voyage + (atSea ? fresh.length : 0),
        }));
        const defs = discoveryDefs(g.statics);
        const names = fresh.map((id) => defs.get(id)?.name).filter((n): n is string => !!n);
        if (names.length > 0) g.notify(t("chartFoundNotice", { name: listJoin(names) }));
      })
      .catch(() => {});
  };

  const sync = (s: GameStore, worldChanged: boolean) => {
    const o = s.overview;
    if (!o || !hasDiscoveries(s.statics)) {
      reset();
      prev = null;
      return;
    }
    const f = flagship(o);
    const cur: Snap = { fleet: f?.id ?? -1, day: o.day, docked: f ? f.docked : null };
    const count =
      typeof o.discovered_count === "number"
        ? `n${o.discovered_count}:${o.discoveries_unreported ?? 0}`
        : `${o.discoveries_unreported ?? 0}:${o.fame ?? 0}`;
    // 新开局、读档（换了舰队或日期倒退）、换了世界：重新取基准
    if (worldChanged || !prev || prev.fleet !== cur.fleet || cur.day < prev.day) {
      reset();
      counter = count;
      refresh(false);
    } else {
      // 旗舰队离港：本次航程的新发现从零算起
      if (prev.docked !== null && cur.docked === null && useFoundStore.getState().voyage !== 0) useFoundStore.setState({ voyage: 0 });
      if (count !== counter) {
        counter = count;
        refresh(true);
      }
    }
    prev = cur;
  };

  sync(useGame.getState(), true);
  const unsub = useGame.subscribe((s, old) => {
    if (s.statics === old.statics && s.overview === old.overview) return;
    sync(s, s.statics !== old.statics);
  });
  return () => {
    req++;
    unsub();
  };
}
