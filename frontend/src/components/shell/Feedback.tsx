// 舞台上的反馈：左下角的航海日志（每日提醒）、卷轴式提示（操作结果与错误）、居中的结局横幅。
import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Sprite } from "../../art/Sprite";
import { drawSeal } from "../../art/ui";
import { t, tk } from "../../i18n";
import { memo } from "../../art/render";
import { useGame } from "../../store/game";
import { ShellIcon } from "./ShellIcon";
import { noticeIcon } from "./shellArt";
import { shellNotices } from "./shellState";

/** 航海日志：每条提醒一行，带图标，新条目淡入。 */
export function Notices() {
  // 按字段选取（P14a）：只看提醒与殖民地（shellNotices 只读这两项）
  const o = useGame(useShallow((s) => (s.overview ? { notices: s.overview.notices, colonies: s.overview.colonies } : null)));
  const notices = o ? shellNotices(o) : [];
  if (notices.length === 0) return null;
  const seen = new Map<string, number>();
  return (
    <section className="gamelog" aria-label={t("shellLog")}>
      <h2 className="gamelog-title">
        <ShellIcon name="report" scale={1} />
        {t("shellLog")}
      </h2>
      <ul className="notices" role="status">
        {notices.map((n) => {
          // 以内容为键：同一条提醒在后续几天保持同一个元素，不会反复淡入
          const base = `${n.kind}:${n.args.map(([k, v]) => `${k}=${v}`).join(",")}`;
          const k = seen.get(base) ?? 0;
          seen.set(base, k + 1);
          return (
            <li key={`${base}#${k}`} className={`notice notice-${n.kind}`}>
              <ShellIcon name={noticeIcon(n.kind)} scale={1} />
              <span>{tk(`notice.${n.kind}`, Object.fromEntries(n.args))}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** 普通提示自动收起的时间（毫秒）；错误一直显示到玩家点“知道了”。 */
const MESSAGE_MS = 5000;

/** 卷轴式提示：操作结果或错误（错误带红色蜡封），点“知道了”收起。 */
export function Messages() {
  const message = useGame((s) => s.message);
  const error = useGame((s) => s.error);
  const clear = useGame((s) => s.clearMessages);
  useEffect(() => {
    if (!message || error) return;
    const id = setTimeout(() => {
      if (useGame.getState().message === message) clear();
    }, MESSAGE_MS);
    return () => clearTimeout(id);
  }, [message, error, clear]);
  if (!message && !error) return null;
  return (
    <div className={error ? "toast error" : "toast"} role={error ? "alert" : "status"}>
      {error && <Sprite px={memo("shell-seal", drawSeal)} scale={2} className="toast-seal" />}
      <span className="toast-text">{error ? t("error", { message: error }) : message}</span>
      <button type="button" onClick={clear}>
        {t("dismiss")}
      </button>
    </div>
  );
}

/** 结局横幅：首次出现时居中展开，点“继续经营”后收成舞台左上角的小缎带，可再次展开。 */
export function OutcomeBanner() {
  // 按字段选取（P14a）：只看结局
  const outcome = useGame((s) => s.overview?.outcome ?? null);
  const [collapsed, setCollapsed] = useState<string | null>(null);
  if (!outcome) return null;
  const { kind, reason, day } = outcome;
  const key = `${kind}-${reason}-${day}`;
  const cls = kind === "Won" ? "won" : "lost";
  const title = tk(`outcome.${kind}`);
  if (collapsed === key) {
    return (
      <div className={`outcome-chip ${cls}`} role="status" data-testid="outcome">
        <button type="button" className="outcome-chip-btn" onClick={() => setCollapsed(null)} aria-label={t("shellOutcomeShow", { title })}>
          <ShellIcon name="star" scale={1} />
          {title}
        </button>
      </div>
    );
  }
  return (
    <div className="outcome-overlay">
      <div className={`outcome ${cls}`} role="status" data-testid="outcome">
        <div className="outcome-ribbon">
          <strong>{title}</strong>
        </div>
        <div className="outcome-card parchment">
          <p>{tk(`outcomeReason.${reason}`, { day })}</p>
          <button type="button" className="btn primary" onClick={() => setCollapsed(key)}>
            {t("shellOutcomeContinue")}
          </button>
        </div>
      </div>
    </div>
  );
}
