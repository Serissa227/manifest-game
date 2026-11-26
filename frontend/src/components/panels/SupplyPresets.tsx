// 一键补给（新界面，V01）：“补到 10 天 · 约 9 金币”“补到 30 天 · 约 30 金币”点一下就买好（照旧提交 Resupply，由内核校验现金与舱位），
// 买完在提示条里回一句买了多少、花了多少、现在够几天。已经够了的写“已够 30 天”并且不可用；钱或舱位不够时不可用，下面一行写明为什么。
// 舰队页的“购买补给”与手动航行的出港框共用；买与回话在 supplyKit.ts 的 buySupplies（出航预估里的“就地补足”也用它）。
import { useId, useRef, useState } from "react";
import { money } from "../../i18n";
import { tz } from "../../i18n/zhOnly";
import type { FleetView } from "../../ipc/types";
import { useGame } from "../../store/game";
import { SUPPLY_PRESETS, buySupplies, presetBlockText, supplyBlock, supplyCost, supplyDays, topUpTo } from "./supplyKit";

export function SupplyPresets({ fleet, testId = "sp-quick" }: { fleet: FleetView; testId?: string }) {
  const rules = useGame((s) => s.statics?.rules);
  const cash = useGame((s) => s.overview?.cash ?? 0);
  const noteId = useId();
  // 正在买：按钮都不可用，连点两下也只发一次（ref 挡住同一帧里的第二下，state 让按钮画成灰的）
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const days = supplyDays(fleet);
  // 没有船员不消耗粮水：不给一键补给
  if (!rules || days === null) return null;
  const rows = SUPPLY_PRESETS.map((n) => {
    const buy = topUpTo(fleet, n);
    const done = days >= n || buy.food + buy.water === 0;
    const cost = supplyCost(rules, buy);
    const block = done ? null : supplyBlock(fleet, rules, buy, cash);
    return { n, buy, done, cost, block };
  });
  // 买不了的原因只写一行（两档都买不了时写较少的那一档：它都买不了，多的那档自然也不行）
  const blocked = rows.find((r) => r.block);
  const buy = (row: (typeof rows)[number]) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    void buySupplies(fleet.id, row.buy, row.cost).finally(() => {
      busyRef.current = false;
      setBusy(false);
    });
  };
  return (
    <div className="sp-quick" data-testid={testId}>
      <span className="sp-presets" role="group" aria-label={tz("sup.presetsLabel")}>
        {rows.map((r) =>
          r.done ? (
            <button key={r.n} type="button" className="btn small" disabled data-testid={`${testId}-${r.n}`}>
              {tz("sup.presetDone", { n: r.n })}
            </button>
          ) : (
            // 天数与钱数各自不折行（窄屏上两段上下排，不在“金币”中间断开）；读屏念整句
            <button
              key={r.n}
              type="button"
              className="btn small"
              disabled={!!r.block || busy}
              aria-label={tz("sup.preset", { n: r.n, cost: money(r.cost) })}
              aria-describedby={r.block ? noteId : undefined}
              data-testid={`${testId}-${r.n}`}
              onClick={() => buy(r)}
            >
              <span className="sp-preset-days">{tz("sup.presetDays", { n: r.n })}</span>
              <span className="sp-preset-cost">{tz("sup.presetCost", { cost: money(r.cost) })}</span>
            </button>
          ),
        )}
      </span>
      {blocked?.block && (
        <p className="sp-block" id={noteId} data-testid={`${testId}-why`}>
          {presetBlockText(blocked.n, blocked.block)}
        </p>
      )}
    </div>
  );
}
