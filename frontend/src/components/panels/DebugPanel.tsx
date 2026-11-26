import { t } from "../../i18n";
import { api } from "../../ipc/api";
import { useView } from "../../hooks/useView";
import { useGame } from "../../store/game";
import { Icon, PnSection } from "./PanelKit";

/** 调试面板（开发模式）：AI 审计日志（提案原文、裁决、校验结果）、世界状态哈希。 */
export default function DebugPanel() {
  // 状态哈希要序列化整个世界：只在打开面板与点“刷新”时计算，不随每天的推进刷新
  const { data, reload } = useView("debug", () => api.debug(), false);
  const today = useGame((s) => s.overview?.day ?? null);
  if (!data) return null;
  return (
    <div data-testid="debug-panel" className="pn pn-debug">
      <button className="btn" onClick={reload}>
        <Icon name="load" />
        {t("dbRefresh")}
      </button>
      <p className="sub" data-testid="debug-asof">
        {t("dbAsOf", { day: data.day })}
        {today !== null && today !== data.day && <strong className="warn">{t("dbStale")}</strong>}
      </p>
      <dl className="kv pn-debug-kv">
        <dt>{t("dbHash")}</dt>
        <dd>
          <code>{data.state_hash}</code>
        </dd>
      </dl>
      <p>{t("dbLog", { n: data.log_len, ai: data.ai_commands })}</p>
      <p>{t("dbMoney", { ok: data.money_conserved ? t("yes") : t("no") })}</p>
      <PnSection title={t("dbAudit")} icon="debug">
        <ol className="audit pn-audit">
          {[...data.audit].reverse().map((a, i) => (
            <li key={i}>
              <small>
                {t("dayN", { day: a.day })} · {a.kind} · {a.stage}
              </small>
              <pre>{a.detail}</pre>
            </li>
          ))}
        </ol>
      </PnSection>
    </div>
  );
}
