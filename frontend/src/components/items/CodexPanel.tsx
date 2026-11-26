// 图鉴（FRAMEWORK §8.6，docs/UI-CONTRACT.md I4）：按类别（物品、书目、人物、港口、发现物、地标、怪异、时间线事件、结局……）列出见过与得到过的，
// 每类显示完成度；点一条看说明、出处与"本世界线的改动"。没见过的条目只显示问号。
// 新界面（v2）：桌面上条目在左、详情在右（styles/ui-v2/fleet.css；右边一栏一开始就留着、写一句提示，点第一下时格子不会重排）；
// 手机上（竖屏、横屏）详情从底部升起（抽屉），条目停在原处不滚走。旧界面不变。
import { useEffect, useRef, useState } from "react";
import { isCompact, useLayout } from "../../hooks/useViewport";
import { useView } from "../../hooks/useView";
import { t, tk } from "../../i18n";
import { api } from "../../ipc/api";
import { useIsV2 } from "../../ui/uiMode";
import Sheet from "../shell/Sheet";
import { Loading } from "../feedback";
import { shownSources } from "../shownText";

export default function CodexPanel() {
  const [cat, setCat] = useState<string | undefined>(undefined);
  const [open, setOpen] = useState<string | null>(null);
  const view = useView(`codex:${cat ?? ""}`, () => api.codex(cat), { quiet: true }).data;
  const v2 = useIsV2();
  const layout = useLayout();
  const sheet = v2 && isCompact(layout);
  // 不用抽屉的布局：打开时把详情滚进视野（只在窄到详情排到条目下面时才会动）
  const detailRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (v2 && !sheet && open) detailRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [v2, sheet, open]);

  if (!view) return <Loading v1={<p className="ts-empty">{t("loading")}</p>} />;
  const shown = view.entries.find((e) => e.key === open) ?? null;
  const detail = shown && (
    <article className="cx-detail" aria-label={shown.name} ref={detailRef}>
      <h4>{shown.name}</h4>
      <p className="cx-state">{tk(`cx.state.${shown.state}`)}</p>
      {shown.desc && <p>{shown.desc}</p>}
      {shown.changed && <p className="cx-changed">{t("cx.changed", { text: shown.changed })}</p>}
      {(shown.basis || shownSources(shown.sources).length > 0) && (
        <p className="it-source">
          {shown.basis && <span className="it-basis">{tk(`it.basis.${shown.basis}`)}</span>}
          {shownSources(shown.sources).join("；")}
        </p>
      )}
    </article>
  );
  return (
    <div className="cx-panel" data-testid="codex">
      <ul className="cx-cats" role="tablist" aria-label={t("cx.categories")}>
        {view.categories.map((c) => (
          <li key={c.key}>
            <button type="button" role="tab" aria-selected={c.key === view.category} className={c.key === view.category ? "cx-cat is-on" : "cx-cat"} onClick={() => setCat(c.key)}>
              <span>{c.name}</span>
              <small>{t("cx.progress", { got: c.got, total: c.total })}</small>
              <span className="cx-bar">
                <span style={{ width: `${c.total > 0 ? Math.round((c.got / c.total) * 100) : 0}%` }} />
              </span>
            </button>
          </li>
        ))}
      </ul>
      <ul className="cx-grid">
        {view.entries.map((e) => (
          <li key={e.key} className={`cx-entry cx-entry--${e.state}`}>
            <button type="button" disabled={e.state === "unknown"} aria-pressed={open === e.key} onClick={() => setOpen(e.key)}>
              {e.state === "unknown" ? "？" : e.name}
            </button>
          </li>
        ))}
      </ul>
      {!sheet && detail}
      {/* 新界面·桌面：还没打开时也留着右边一栏 */}
      {v2 && !sheet && !detail && <p className="cx-hint">{t("v2.fleet.codexPick")}</p>}
      {/* 新界面·手机：详情在底部升起的抽屉里（收起时取消选中，焦点回到点的那一格） */}
      {sheet && shown && detail && (
        <Sheet title={shown.name} onClose={() => setOpen(null)} className="cx-sheet" testId="codex-sheet">
          {detail}
        </Sheet>
      )}
    </div>
  );
}
