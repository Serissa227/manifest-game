// 情报窗口：新闻与传闻、进行中的事件、大事记、事件日志、人物志、市场月报、编年史。
// 新界面（v2）的小改动（旧界面不变）：各处的空状态写明为什么空、什么时候会有（旧界面照旧是“暂无”）；
// 事件日志空着时不再画一个空框，换成一句话；勾了“只看与我有关”而筛完一条不剩时另说一句，并给一键“看全部”。
import { useEffect, useState } from "react";
import { drawSeal, drawTack } from "../../art/extras";
import type { IconName } from "../../art/icons";
import { Sprite } from "../../art/Sprite";
import { useView } from "../../hooks/useView";
import { listJoin, t, tk } from "../../i18n";
import { api } from "../../ipc/api";
import type { EventView, IntelView, LogView, NewsView } from "../../ipc/types";
import { useGame } from "../../store/game";
import { useIsV2 } from "../../ui/uiMode";
import { Empty } from "../common";
import { EmptyState } from "../feedback";
import { CastBadge } from "../portrait/CastBadge";
import { companyHeadOf, rulerOf } from "../portrait/castPeople";
import { effectText } from "./effectText";
import { Icon, PnSection } from "./PanelKit";

function logText(l: LogView): string {
  // 后端已出好句子（S02nZ2：文字表 [logs] 里有句子的种类）时直接用
  if (l.text) return l.text;
  const vars: Record<string, string> = {};
  for (const [k, v] of l.args) {
    // reason、reward 等直接传原值，由字符串表里的 {reason:@colonyLoss}、{reward:money} 格式化
    vars[k] =
      k === "owner" && v === "player"
        ? t("ownerPlayer")
        : k === "status"
          ? tk(`status.${v}`)
          : k === "result"
            ? tk(`battleResult.${v}`)
            : v;
  }
  return tk(`log.${l.kind}`, vars);
}

/** 消息来源的图标：酒馆传言、商人消息、官方公告。 */
const SOURCE_ICON: Record<NewsView["source"], IconName> = {
  tavern: "tavern",
  merchant: "guild",
  official: "office",
};

// ───────────────────────────── 组合事件卡片 ─────────────────────────────
// 效果的格式化（“对象 · 方向与幅度 · 持续”）见 effectText.ts，殖民地窗口的“事件影响”也用它。

/** 组合事件的标题（旧数据没有 title 时用 name）。 */
function titleOf(e: EventView): string {
  return e.title ?? e.name;
}

/** 组合事件：标题、叙事（引号体）、逐条效果、来源（AI / 离线模板）、进行中 / 已结束。 */
function ComposedCard({ e }: { e: EventView }) {
  const active = e.active ?? true;
  const source = e.source ?? "template";
  const narrative = e.narrative ?? e.description;
  const effects = e.effects ?? [];
  const title = titleOf(e);
  return (
    <li className={active ? "pn-ce is-active" : "pn-ce is-ended"} data-testid={`composed-${e.id ?? title}`}>
      <header className="pn-ce-head">
        <Icon name={source === "ai" ? "ai_event" : "quest"} />
        <h4 className="pn-ce-title">{title}</h4>
        <span className={`pn-ce-tag pn-ce-src-${source}`}>{tk(`pnCeSource.${source}`)}</span>
        <span className={active ? "pn-ce-tag pn-ce-live" : "pn-ce-tag pn-ce-over"}>{active ? t("pnCeActive") : t("pnCeEnded")}</span>
      </header>
      <p className="pn-ce-span">
        <Icon name="calendar" />
        {t("pnCeSpan", { start: e.start, end: e.end })}
      </p>
      {narrative && <blockquote className="pn-ce-narrative">{t("pnCeNarrative", { text: narrative })}</blockquote>}
      {effects.length > 0 && (
        <ul className="pn-ce-effects" aria-label={t("pnCeEffects", { title })}>
          {effects.map((x, i) => (
            <li key={i} className="pn-ce-effect" title={x.end !== null && x.end !== undefined ? t("pnCeEndsOn", { end: x.end }) : undefined}>
              <span className="pn-ce-label">{x.label}</span>
              <span className="pn-ce-text">{effectText(x)}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** 大事记：最近的组合事件（新的在前）；旧后端没有 composed 时从进行中的事件里取。 */
function composedOf(data: IntelView): EventView[] {
  const list = [...(data.composed ?? [])];
  for (const e of data.events) {
    if (e.origin !== "composed") continue;
    if (!list.some((x) => (x.id ?? null) === (e.id ?? null) && titleOf(x) === titleOf(e))) list.unshift(e);
  }
  return list;
}

/** 人物志：列国君主与各商会会长（肖像 + 程序生成的名字 + 头衔），排在编年史之前。 */
function Roster() {
  const statics = useGame((s) => s.statics);
  if (!statics || (statics.factions.length === 0 && statics.companies.length === 0)) return null;
  return (
    <PnSection title={t("cast.roster")} icon="guild" testId="intel-roster" className="pn-roster">
      {statics.factions.length > 0 && (
        <>
          <h4 className="cast-subhead">{t("cast.rosterRulers")}</h4>
          <div className="cast-grid">
            {statics.factions.map((f, i) => {
              const who = rulerOf(statics, i);
              return <CastBadge key={f.key} asset={who.asset} fallback={who.fallback} name={who.name} title={who.title} testId={`roster-ruler-${f.key}`} />;
            })}
          </div>
        </>
      )}
      {statics.companies.length > 0 && (
        <>
          <h4 className="cast-subhead">{t("cast.rosterCompanies")}</h4>
          <div className="cast-grid">
            {statics.companies.map((c, i) => {
              const who = companyHeadOf(statics, i);
              return <CastBadge key={c.id} asset={who.asset} fallback={who.fallback} name={who.name} title={who.title} testId={`roster-company-${i}`} />;
            })}
          </div>
        </>
      )}
    </PnSection>
  );
}

/** 情报：新闻与传闻流（标注来源与可信度，不揭示真假）、进行中的事件、大事记（组合事件卡片）、事件日志、人物志（列国君主与商会会长）、编年史。 */
/** 主角的身世序章（ECONOMY.md 8.7）：有身世时从后端取一次（AI 写的或离线模板拼的）。 */
function Prologue() {
  const hasProfile = useGame((s) => !!s.overview?.profile);
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (!hasProfile) return;
    let alive = true;
    api
      .prologue()
      .then((t) => {
        if (alive) setText(t);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [hasProfile]);
  if (!text) return null;
  return (
    <article className="pn-scroll" data-testid="intel-prologue">
      <h4>{t("itPrologue")}</h4>
      <p>{text}</p>
    </article>
  );
}

export default function IntelPanel() {
  const statics = useGame((s) => s.statics);
  const { data } = useView("intel", () => api.intel());
  const [onlyMine, setOnlyMine] = useState(false);
  const v2 = useIsV2();
  if (!data) return null;
  const log = onlyMine ? data.log.filter((l) => l.mine) : data.log;
  // 目录事件照旧逐条列出；组合事件做成卡片放进“大事记”
  const catalog = data.events.filter((e) => e.origin !== "composed");
  const composed = composedOf(data);
  return (
    <div data-testid="intel-panel" className="pn pn-intel">
      <PnSection title={t("itNews")} icon="intel">
        {data.news.length === 0 ? (
          <EmptyState className="an-quiet" text={t("v2.analysis.it.newsEmpty")} hint={t("v2.analysis.it.newsHint")} v1={<Empty text={t("itNone")} />} />
        ) : (
          <ul className="news pn-board-notes">
            {data.news.map((n) => (
              <li key={n.id} className={`pn-notice pn-src-${n.source}`}>
                <Sprite px={drawTack()} scale={2} className="pn-tack" />
                <span className="pn-notice-head">
                  <Icon name={SOURCE_ICON[n.source] ?? "intel"} />
                  <small>{t("pnDate", { day: n.day })}</small>
                </span>
                <span className="pn-notice-text">
                  {t("itNewsLine", { source: tk(`source.${n.source}`), cred: n.credibility, text: n.text })}
                </span>
                <Sprite px={drawSeal(n.credibility)} scale={2} className="pn-seal" />
              </li>
            ))}
          </ul>
        )}
      </PnSection>
      <PnSection title={t("itEvents")} icon="calendar">
        {catalog.length === 0 ? (
          <EmptyState className="an-quiet" text={t("v2.analysis.it.eventsEmpty")} v1={<Empty text={t("itNone")} />} />
        ) : (
          <ul className="pn-events">
            {catalog.map((e, i) => (
              <li key={i} title={e.description} className="pn-event">
                <Icon name="star" />
                <span>{t("itEventLine", { name: e.name, place: listJoin(e.place), start: e.start, end: e.end })}</span>
              </li>
            ))}
          </ul>
        )}
      </PnSection>
      <PnSection title={t("pnCeTitle")} icon="ai_event" testId="intel-composed">
        {composed.length === 0 ? (
          <EmptyState className="an-quiet" text={t("pnCeNone")} />
        ) : (
          <ul className="pn-ce-list">
            {composed.map((e, i) => (
              <ComposedCard key={`${e.id ?? "x"}-${i}`} e={e} />
            ))}
          </ul>
        )}
      </PnSection>
      <PnSection title={t("itLog")} icon="quest">
        <label className="field">
          <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
          <span>{t("itOnlyMine")}</span>
        </label>
        {v2 && log.length === 0 ? (
          // 日志本身空着，与“只看与我有关”筛完一条不剩，是两回事：后者说清楚，并给一键“看全部”
          data.log.length === 0 ? (
            <EmptyState className="an-quiet" text={t("v2.analysis.it.logEmpty")} />
          ) : (
            <EmptyState
              className="an-quiet"
              text={t("v2.analysis.it.logMineEmpty")}
              hint={t("v2.analysis.it.logMineHint")}
              action={{ label: t("v2.analysis.it.logShowAll"), onClick: () => setOnlyMine(false) }}
            />
          )
        ) : (
          <ul className="log pn-logbook">
            {log.map((l, i) => (
              <li key={i} className={l.mine ? "mine" : ""}>
                <small>{t("pnDate", { day: l.day })}</small> {logText(l)}
              </li>
            ))}
          </ul>
        )}
      </PnSection>
      <Roster />
      {(data.reports ?? []).length > 0 && (
        <PnSection title={t("itReports")} icon="report">
          <ul className="pn-reports" data-testid="intel-reports">
            {(data.reports ?? []).map((r) => (
              <li key={`${r.region}-${r.month}`}>
                <h4>{t("itReportTitle", { region: statics?.regions[r.region]?.name ?? String(r.region), day: r.day })}</h4>
                <p>{r.text}</p>
              </li>
            ))}
          </ul>
        </PnSection>
      )}
      <PnSection title={t("itChronicle")} icon="report">
        <Prologue />
        {data.chronicles.length === 0 ? (
          <EmptyState className="an-quiet" text={t("v2.analysis.it.chronicleEmpty")} hint={t("v2.analysis.it.chronicleHint")} v1={<Empty text={t("itNone")} />} />
        ) : (
          data.chronicles.map((c) => (
            <article key={c.year} className="pn-scroll">
              {/* 年序从 0 起算，+1 后由字符串表的 {year:cal} 转成纪年年份 */}
              <h4>{t("itChronicleYear", { year: c.year + 1 })}</h4>
              <p>{c.text}</p>
            </article>
          ))
        )}
      </PnSection>
    </div>
  );
}
