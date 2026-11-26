// 招募船员（一键补足）：舰队页、酒馆与出港确认框共用。
// 船员少于最低人数时开不了船（SetSail 校验 CrewBelowMinimum）。玩家反馈“不知道船员如何补充”——以前只有酒馆最底下一个数量框，
// 所以在需要的地方都放上一键按钮：“补到最低人数”（不够时是主按钮）与“补满船员”，按此刻还能招到的人手
// （后端的 hire_max：船员上限、当地人手、自己殖民地的殖民者）与现金封顶，按钮上写明人数与花费；招不了时写明原因。
import { money, t } from "../../i18n";
import type { FleetView } from "../../ipc/types";
import { useGame } from "../../store/game";
import { ActionButton } from "../common";
import { crewPlan } from "./crewPlan";

/**
 * 一键补员的按钮组（在港时才有按钮；compact 时只放“补到最低人数”或“补满”其中一个）。
 * hideMin：“补到最低人数”已经放在别处（新界面舰队页的航行条里，紧挨着“出航”）时不再重复；与它人数相同的“补满”也不出现。
 * hideNote：招不满的原因（在海上、招不到人手、现金不够）已经写在别处（新界面舰队页缺员时的航行条里）时不再重复。
 */
export function CrewHireButtons({
  fleet,
  compact = false,
  hideMin = false,
  hideNote = false,
  testId = "crew-hire",
}: {
  fleet: FleetView;
  compact?: boolean;
  hideMin?: boolean;
  hideNote?: boolean;
  testId?: string;
}) {
  const statics = useGame((s) => s.statics);
  const cash = useGame((s) => s.overview?.cash ?? 0);
  const submit = useGame((s) => s.submit);
  if (!statics) return null;
  const unit = statics.rules.crew_hire_cost;
  const p = crewPlan(fleet, cash, unit);
  const hire = (n: number) => submit({ HireCrew: { owner: "player", fleet: fleet.id, count: n } });
  const note =
    p.limit === "sea"
      ? t("crewAtSea")
      : p.limit === "hands" && p.toFull === 0
        ? t("crewNoHands")
        : p.limit === "cash" && p.toFull === 0
          ? t("crewNoCash")
          : p.limit === "hands"
            ? t("crewFewHands", { n: p.toFull })
            : p.limit === "cash"
              ? t("crewFewCash", { n: p.toFull })
              : fleet.crew >= fleet.crew_max
                ? t("crewFull")
                : null;
  // 有“补到最低人数”这一步（缺员且招得到人）；hideMin 时它在别处，这里不画，但仍按它算“补满”是不是重复
  const minStep = p.short > 0 && p.toMin > 0;
  const showMin = minStep && !hideMin;
  const showFull = p.toFull > 0 && (!compact || !showMin) && !(minStep && p.toFull === p.toMin);
  return (
    <div className="crew-hire" data-testid={testId}>
      {(showMin || showFull) && (
        <div className="row crew-hire-row">
          {showMin && (
            <ActionButton kind="primary" onClick={() => hire(p.toMin)}>
              {t("crewHireToMin", { n: p.toMin, cost: money(p.toMin * unit) })}
            </ActionButton>
          )}
          {showFull && (
            <ActionButton kind={minStep ? undefined : p.short > 0 ? "primary" : undefined} onClick={() => hire(p.toFull)}>
              {t("crewHireToFull", { n: p.toFull, cost: money(p.toFull * unit) })}
            </ActionButton>
          )}
        </div>
      )}
      {note && !hideNote && <p className="sub crew-hire-note">{note}</p>}
    </div>
  );
}

/** 船员不足的提示（少于最低人数开不了船）。 */
export function CrewShortNote({ fleet }: { fleet: FleetView }) {
  if (fleet.crew >= fleet.crew_min) return null;
  return (
    <p className="warn crew-short" data-testid="crew-short">
      {t("crewShort", { crew: fleet.crew, min: fleet.crew_min })}
    </p>
  );
}
