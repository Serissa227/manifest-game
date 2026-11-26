// E03F 投资页发展度卡里的“每一档开什么”：读 DevGrowthView.unlocks，按档排成一行一档。
// 已到的档标“已开”，下一档突出（玩家投钱的目标），更远的档淡一些。默认只展开当前档与下一档，
// 前面已开的、往后更远的各收成一行，点一下全部列出。unlocks 缺省或为空时什么都不画。
// kind 的取值以 views.rs 的 stage_unlock_views 为准：shop / shelf / books / agency / industry / yard / goods / eligible。
import { useState } from "react";
import { nameOf } from "../../i18n";
import { tz, type ZhOnlyKey } from "../../i18n/zhOnly";
import { goodVisible } from "../../ipc/goodsVisible";
import type { GoodView, StageUnlockView } from "../../ipc/types";
import { useGame } from "../../store/game";
import { stageName } from "./devScale";

const ELIGIBLE = new Set(["academy", "auction", "exchange"]);

/** 一条阶段内容写成一句话；认不出的 kind（新后端多出来的）返回 null，不画。 */
function unlockText(u: StageUnlockView, good: (id: number) => GoodView | undefined, stageNow: number): string | null {
  let text: string;
  switch (u.kind) {
    case "shop":
      text = tz("dev.unlock.shop");
      break;
    case "shelf":
    case "books":
    case "agency":
    case "industry":
    case "yard":
      text = tz(`dev.unlock.${u.kind}` as ZhOnlyKey, { n: u.n });
      break;
    case "goods": {
      const g = u.good != null ? good(u.good) : undefined;
      if (!g) return null;
      text = tz("dev.unlock.goods", { good: nameOf(g) });
      break;
    }
    case "eligible":
      if (!u.key || !ELIGIBLE.has(u.key)) return null;
      text = tz("dev.unlock.eligible", { place: tz(`dev.unlock.place.${u.key}` as ZhOnlyKey) });
      break;
    default:
      return null;
  }
  // 代办、产业位的加成要本港有商馆：阶段到了但还没设商馆时补一句
  if ((u.kind === "agency" || u.kind === "industry") && !u.reached && u.stage <= stageNow) text += tz("dev.unlock.needHouse");
  return text;
}

type Row = { stage: number; texts: string[] };

export function StageUnlocks({ unlocks, stage }: { unlocks?: StageUnlockView[] | null; stage: number }) {
  const statics = useGame((s) => s.statics);
  const revealed = useGame((s) => s.overview?.revealed);
  const [all, setAll] = useState(false);
  if (!unlocks || unlocks.length === 0) return null;
  const good = (id: number) => {
    const g = statics?.goods[id];
    return g && goodVisible(g, revealed) ? g : undefined;
  };
  const byStage = new Map<number, string[]>();
  for (const u of unlocks) {
    const text = unlockText(u, good, stage);
    if (text == null) continue;
    const list = byStage.get(u.stage) ?? [];
    list.push(text);
    byStage.set(u.stage, list);
  }
  const rows: Row[] = [...byStage.entries()].sort((a, b) => a[0] - b[0]).map(([s, texts]) => ({ stage: s, texts }));
  if (rows.length === 0) return null;
  // 默认可见：当前档与紧接着的那一档（没有当前档的内容时，取往后最近的一档作“下一档”）
  const nextStage = rows.find((r) => r.stage > stage)?.stage;
  const shown = (r: Row) => all || r.stage === stage || r.stage === nextStage;
  const earlier = rows.filter((r) => r.stage < stage && !shown(r)).length;
  const later = rows.filter((r) => r.stage > stage && !shown(r)).length;
  return (
    <div className="dev-unlocks" data-testid="dev-unlocks">
      <p className="dev-unlocks-title">{tz("dev.unlock.title")}</p>
      {earlier > 0 && (
        <button type="button" className="btn small dev-unlocks-more" data-testid="dev-unlocks-earlier" onClick={() => setAll(true)}>
          {tz("dev.unlock.earlier", { n: earlier })}
        </button>
      )}
      <ul className="dev-unlock-list">
        {rows.filter(shown).map((r) => {
          const state = r.stage <= stage ? "done" : r.stage === nextStage ? "next" : "far";
          return (
            <li key={r.stage} className={`dev-unlock is-${state}`} data-testid={`dev-unlock-${r.stage}`}>
              <strong className="dev-unlock-stage">{stageName(r.stage)}</strong>
              {state !== "far" && <em className="tag">{tz(state === "done" ? "dev.unlock.done" : "dev.unlock.next")}</em>}{" "}
              <span>{r.texts.join(tz("dev.unlock.sep"))}</span>
            </li>
          );
        })}
      </ul>
      {later > 0 && (
        <button type="button" className="btn small dev-unlocks-more" data-testid="dev-unlocks-later" onClick={() => setAll(true)}>
          {tz("dev.unlock.later", { n: later })}
        </button>
      )}
      {all && (
        <button type="button" className="btn small dev-unlocks-more" onClick={() => setAll(false)}>
          {tz("dev.unlock.fold")}
        </button>
      )}
    </div>
  );
}
