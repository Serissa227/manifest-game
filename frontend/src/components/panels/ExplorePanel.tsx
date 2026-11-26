// 探险窗口：一本羊皮纸的探险日志。
// - 卷首：名声，以及下一档航海士的招募门槛（DiscoveriesView.mate_fame）；
// - 进度：已发现 / 总数、待报告数、六类发现（遗迹、奇观、沉船、遗物、海兽、地标）的统计，点击可按种类筛选；
// - 日志：已发现的发现物卡片（种类图章、名称、发现日期、海图坐标、简史、赏金与名声、是否已报告），
//   停靠港口时可向当地商会报告（ReportDiscovery），报告后显示领到的赏金与名声；
// - 尚未发现的只显示“？？？”与数量，不泄露名字与位置；
// - 海上传闻（组合事件“发现物传闻”）：“传闻：「某发现物」在某海区一带”，只有大致海区，找到后标为“已证实”；
// - 潜水点（B12）：选中舰队能潜的给“潜水”（Dive），不能的写后端给的原因；潜到了的进日志。
// 所有像素图标都对辅助技术隐藏，按钮的可访问名称只来自文字。
// 新界面（v2）：还没有任何发现时，空状态给“下一步”（打开航海图）；没有停靠港口、报告不了时就地写明原因（旧界面不变）。
import { useState } from "react";
import { drawDiscoveryMarker } from "../../art/map";
import { Sprite } from "../../art/Sprite";
import { useView } from "../../hooks/useView";
import { num, t, tk } from "../../i18n";
import { api } from "../../ipc/api";
import { discoveryById, locById } from "../../ipc/byId";
import type { DiscoveriesView, DiscoveryDefView, DiscoveryKind, DiveOptionView, FoundView, RumorView, StaticView } from "../../ipc/types";
import { flagship, useGame } from "../../store/game";
import { BiName } from "../BiName";
import { ActionButton, Empty, Select } from "../common";
import { EmptyState, InlineError } from "../feedback";
import { closeWindow } from "../shell/shellState";
import { diveCommand, diveName, divesOf } from "./diveKit";
import { Bar, Icon, PnSection } from "./PanelKit";

/** 发现物的六个种类（与 data/world/discoveries.toml 的 kind 一致，决定统计与筛选的顺序）。 */
const KINDS: readonly DiscoveryKind[] = ["ruins", "wonder", "wreck", "relic", "beast", "landmark", "animal", "plant", "fallen", "phantom"];

type Filter = DiscoveryKind | "all";

/** 一件已发现的发现物与它的目录条目。 */
interface Entry {
  def: DiscoveryDefView;
  found: FoundView;
}

/** 已发现的发现物：未报告的在前，其余按发现日从新到旧。 */
function entriesOf(statics: StaticView, data: DiscoveriesView): Entry[] {
  const list: Entry[] = [];
  for (const f of data.found) {
    const def = discoveryById(statics, f.id);
    if (def) list.push({ def, found: f });
  }
  return list.sort(
    (a, b) => Number(a.found.reported) - Number(b.found.reported) || b.found.day - a.found.day || a.def.id - b.def.id,
  );
}

/** 下一档还没达到的航海士名声门槛；全部达到时为 null。 */
function nextRung(fame: number, rungs: [number, number][]): [number, number] | null {
  const sorted = [...rungs].sort((a, b) => a[0] - b[0]);
  return sorted.find(([, need]) => need > fame) ?? null;
}

/** 卷首：名声与航海士招募门槛。 */
function FameHeader({ data }: { data: DiscoveriesView }) {
  const next = nextRung(data.fame, data.mate_fame);
  const rungs = [...data.mate_fame].sort((a, b) => a[0] - b[0]);
  return (
    <header className="ex-head">
      <div className="ex-fame" data-testid="explore-fame">
        <Icon name="fame" scale={2} />
        <span className="ex-fame-label">{t("explore.fame")}</span>
        <strong className="ex-fame-value">{num(data.fame)}</strong>
      </div>
      <div className="ex-head-text">
        <p className="ex-subtitle">{t("explore.subtitle")}</p>
        {rungs.length > 0 && (
          <p className="ex-next">
            {next ? t("explore.fameNext", { need: next[1] - data.fame, level: next[0] }) : t("explore.fameAll")}
          </p>
        )}
        {rungs.length > 0 && (
          <ul className="ex-ladder" aria-label={t("explore.ladder")}>
            {rungs.map(([level, fame]) => {
              const ok = data.fame >= fame;
              return (
                <li key={level} className={ok ? "ex-rung is-ok" : "ex-rung"}>
                  <span>{t("explore.rung", { level, fame })}</span>
                  <em>{ok ? t("explore.rungOk") : t("explore.rungNo")}</em>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </header>
  );
}

/** 海上传闻：未证实的在前，其余按听闻日从新到旧。 */
function rumorsOf(data: DiscoveriesView): RumorView[] {
  return [...(data.rumors ?? [])].sort((a, b) => Number(a.found) - Number(b.found) || b.day - a.day || a.id - b.id);
}

/** 海上传闻：发现物名与大致海区、听闻日期、是否已证实（找到后）。传闻所指的发现物名来自目录。 */
function Rumors({ statics, rumors }: { statics: StaticView; rumors: RumorView[] }) {
  return (
    <PnSection title={t("explore.rumors")} icon="intel" className="ex-rumors" testId="explore-rumors">
      <p className="ex-rumor-hint">{t("explore.rumorHint")}</p>
      <ul className="ex-rumor-list">
        {rumors.map((r) => {
          const def = discoveryById(statics, r.id);
          return (
            <li key={r.id} className={r.found ? "ex-rumor is-found" : "ex-rumor"} data-testid={`rumor-${r.id}`}>
              <Sprite px={drawDiscoveryMarker(r.found && def ? def.kind : "unknown")} scale={1} className="ex-rumor-mark" />
              <span className="ex-rumor-text">
                {t("explore.rumorLine", { name: def?.name ?? t("explore.unknownName"), region: r.region_name || t("explore.rumorFar") })}
              </span>
              <small className="ex-rumor-day">{t("explore.rumorHeard", { day: r.day })}</small>
              <em className={r.found ? "ex-rumor-tag is-found" : "ex-rumor-tag"}>
                {r.found ? t("explore.rumorConfirmed") : t("explore.rumorOpen")}
              </em>
            </li>
          );
        })}
      </ul>
    </PnSection>
  );
}

/**
 * 潜水点（B12）：选中舰队的潜水入口（diveKit.divesOf）。能潜的给“潜水”按钮；不能的按钮灰着，
 * 旁边写后端给的原因（当前语言的一句话，例如还没收帆），按钮用 aria-describedby 指过去。
 */
function DiveSites({
  statics,
  data,
  dives,
  onDive,
}: {
  statics: StaticView;
  data: DiscoveriesView;
  dives: DiveOptionView[];
  onDive: (d: DiveOptionView) => Promise<unknown>;
}) {
  return (
    <PnSection title={t("explore.dives")} icon="discovery" className="ex-dives" testId="explore-dives">
      <p className="ex-rumor-hint">{t("explore.diveHint")}</p>
      <ul className="ex-rumor-list">
        {dives.map((d) => {
          const why = !d.enabled && d.blocked_reason ? d.blocked_reason : null;
          const whyId = `ex-dive-why-${d.fleet}-${d.discovery}`;
          return (
            <li key={d.discovery} className={d.enabled ? "ex-rumor ex-dive is-ready" : "ex-rumor ex-dive"} data-testid={`dive-${d.discovery}`}>
              <Sprite px={drawDiscoveryMarker("unknown")} scale={1} className="ex-rumor-mark" />
              <span className="ex-rumor-text">{diveName(statics, data, d.discovery)}</span>
              <ActionButton kind="primary" disabled={!d.enabled} describedBy={why ? whyId : undefined} onClick={() => onDive(d)}>
                {t("explore.dive")}
              </ActionButton>
              {why && <InlineError tone="blocked" compact id={whyId} reason={why} v1={<small className="ex-dive-why" id={whyId}>{why}</small>} />}
            </li>
          );
        })}
      </ul>
    </PnSection>
  );
}

/** 一张已发现的发现物卡片。 */
function FoundCard({ entry, onReport }: { entry: Entry; onReport: (() => Promise<unknown>) | null }) {
  const { def, found } = entry;
  return (
    <li className={found.reported ? `ex-card ex-kind-${def.kind} is-reported` : `ex-card ex-kind-${def.kind}`} data-testid={`discovery-${def.id}`}>
      <span className="ex-card-mark">
        <Sprite px={drawDiscoveryMarker(def.kind)} scale={3} />
      </span>
      <div className="ex-card-body">
        <header className="ex-card-head">
          <BiName as="h4" className="ex-card-name" zh={def.name} en={def.name_en} testId={`discovery-name-${def.id}`} />
          <span className="ex-kind">{tk(`discoveryKind.${def.kind}`)}</span>
        </header>
        <p className="ex-card-meta">
          <span>
            <Icon name="calendar" />
            {t("explore.foundOn", { day: found.day })}
          </span>
          <span>
            <Icon name="map" />
            {t("explore.coords", { x: found.x, y: found.y })}
          </span>
        </p>
        {def.lore && <blockquote className="ex-lore">{t("explore.lore", { text: def.lore })}</blockquote>}
        <footer className="ex-card-foot">
          <span className="ex-bounty">
            <Icon name="coin" />
            {t("explore.bounty", { value: def.value, fame: def.fame })}
          </span>
          <span className={found.reported ? "ex-seal is-done" : "ex-seal"}>
            {found.reported ? t("explore.reported") : t("explore.unreported")}
          </span>
          {!found.reported && onReport && (
            <ActionButton kind="primary" onClick={onReport}>
              {t("explore.report")}
            </ActionButton>
          )}
        </footer>
      </div>
    </li>
  );
}

/** 探险记录窗口。 */
export default function ExplorePanel() {
  const statics = useGame((s) => s.statics);
  const selectedLoc = useGame((s) => s.selectedLoc);
  // 潜水按选中的舰队（没选时按旗舰队）
  const diveFleet = useGame((s) => s.selectedFleet ?? flagship(s.overview)?.id ?? null);
  const submit = useGame((s) => s.submit);
  const { data } = useView("discoveries", () => api.discoveries());
  const [filter, setFilter] = useState<Filter>("all");
  const [portChoice, setPortChoice] = useState<number | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);

  if (!statics || !data) {
    return <div data-testid="explore-panel" className="pn pn-explore" />;
  }

  const entries = entriesOf(statics, data);
  const pending = entries.filter((e) => !e.found.reported);
  const total = Math.max(data.total, statics.discoveries.length, entries.length);
  const shown = filter === "all" ? entries : entries.filter((e) => e.def.kind === filter);
  const kindTotal = (k: DiscoveryKind) => statics.discoveries.filter((d) => d.kind === k).length;
  const kindFound = (k: DiscoveryKind) => entries.filter((e) => e.def.kind === k).length;
  const unknown = filter === "all" ? Math.max(0, total - entries.length) : Math.max(0, kindTotal(filter) - kindFound(filter));
  const rumors = rumorsOf(data);
  const dives = divesOf(data, diveFleet);

  // 报告港口：优先用玩家手选的，其次是当前选中的地点，最后取第一个可报告的港口
  const reportAt = data.report_at;
  const port =
    portChoice !== null && reportAt.includes(portChoice)
      ? portChoice
      : selectedLoc !== null && reportAt.includes(selectedLoc)
        ? selectedLoc
        : reportAt[0];
  const portName = (loc: number) => locById(statics, loc)?.name ?? String(loc);

  /** 报告一件发现；成功时返回（赏金, 名声）。 */
  const reportOne = async (id: number): Promise<[number, number] | null> => {
    if (port === undefined) return null;
    const r = await submit({ ReportDiscovery: { owner: "player", discovery: id, loc: port } });
    const o = r?.outcome;
    if (o && typeof o === "object" && "DiscoveryReported" in o) return [o.DiscoveryReported.reward, o.DiscoveryReported.fame];
    return r ? [0, 0] : null;
  };
  const report = async (e: Entry) => {
    if (port === undefined) return;
    const got = await reportOne(e.def.id);
    if (got) setReceipt(t("explore.reportDone", { port: portName(port), name: e.def.name, reward: got[0], fame: got[1] }));
  };
  const reportAll = async () => {
    if (port === undefined) return;
    let n = 0;
    let reward = 0;
    let fame = 0;
    for (const e of pending) {
      const got = await reportOne(e.def.id);
      if (!got) break;
      n += 1;
      reward += got[0];
      fame += got[1];
    }
    if (n > 0) setReceipt(t("explore.reportAllDone", { port: portName(port), n, reward, fame }));
  };
  /** 潜水：成功后视图跟着刷新（submit 之后），找到的发现物出现在日志里；回执用潜之前的称呼。 */
  const dive = async (d: DiveOptionView) => {
    const name = diveName(statics, data, d.discovery);
    const r = await submit(diveCommand(d.fleet, d.discovery));
    if (r) setReceipt(t("explore.diveDone", { name }));
  };

  return (
    <div data-testid="explore-panel" className="pn pn-explore">
      <div className="ex-journal">
        <h3 className="ex-title">
          <Icon name="discovery" scale={2} />
          {t("explore.journal")}
        </h3>
        <FameHeader data={data} />

        <PnSection title={t("explore.kinds")} icon="star" className="ex-stats">
          <div className="ex-progress">
            <span>{t("explore.progress", { found: entries.length, total })}</span>
            <Bar value={entries.length} max={total} tone="nav" />
            {pending.length > 0 && <span className="ex-pending">{t("explore.pending", { n: pending.length })}</span>}
          </div>
          <div className="ex-kinds" role="group" aria-label={t("explore.kinds")}>
            <button
              type="button"
              className={filter === "all" ? "ex-kind-btn is-on" : "ex-kind-btn"}
              aria-pressed={filter === "all"}
              onClick={() => setFilter("all")}
            >
              {t("explore.filterAll")}
            </button>
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                className={filter === k ? "ex-kind-btn is-on" : "ex-kind-btn"}
                aria-pressed={filter === k}
                onClick={() => setFilter(filter === k ? "all" : k)}
              >
                <Sprite px={drawDiscoveryMarker(k)} scale={1} className="ex-kind-mark" />
                <span className="ex-kind-name">{tk(`discoveryKind.${k}`)}</span>
                <span className="ex-kind-count">{t("explore.kindCount", { found: kindFound(k), total: kindTotal(k) })}</span>
              </button>
            ))}
          </div>
        </PnSection>

        {rumors.length > 0 && <Rumors statics={statics} rumors={rumors} />}

        {dives.length > 0 && <DiveSites statics={statics} data={data} dives={dives} onDive={dive} />}

        <PnSection title={t("explore.panelTitle")} icon="discovery" className="ex-log">
          {pending.length > 0 && (
            <div className="ex-report-bar">
              {port === undefined ? (
                <InlineError tone="blocked" reason={t("explore.reportNoPort")} v1={<p className="ex-report-hint">{t("explore.reportNoPort")}</p>} />
              ) : (
                <>
                  <p className="ex-report-hint">{t("explore.reportHere", { port: portName(port) })}</p>
                  {reportAt.length > 1 && (
                    <Select
                      label={t("explore.reportAt")}
                      value={port}
                      options={reportAt.map((l) => ({ value: l, label: portName(l) }))}
                      onChange={setPortChoice}
                    />
                  )}
                  {pending.length > 1 && (
                    <ActionButton onClick={reportAll}>{t("explore.reportAll", { n: pending.length })}</ActionButton>
                  )}
                </>
              )}
            </div>
          )}
          {receipt && (
            <p className="ex-receipt" role="status">
              <Icon name="coin" />
              {receipt}
            </p>
          )}
          {entries.length === 0 ? (
            <EmptyState
              text={t("v2.business.ex.empty")}
              hint={t("v2.business.ex.emptyHint")}
              action={{
                label: t("v2.business.ex.emptyAction"),
                onClick: () => {
                  useGame.getState().setStage("chart");
                  closeWindow();
                },
              }}
              v1={<Empty text={t("explore.empty")} />}
            />
          ) : shown.length === 0 ? (
            // 新界面：这一类还没有发现时，“下一步”清掉筛选、看全部的发现；旧界面照旧一行字
            <EmptyState text={t("explore.noneOfKind")} action={{ label: t("v2.business.ex.showAll"), onClick: () => setFilter("all") }} />
          ) : null}
          <ul className="ex-cards">
            {shown.map((e) => (
              <FoundCard key={e.def.id} entry={e} onReport={port === undefined ? null : () => report(e)} />
            ))}
            {unknown > 0 && (
              <li className="ex-card ex-unknown" data-testid="discovery-unknown">
                <span className="ex-card-mark">
                  <Sprite px={drawDiscoveryMarker("unknown")} scale={3} />
                </span>
                <div className="ex-card-body">
                  <header className="ex-card-head">
                    <h4 className="ex-card-name">{t("explore.unknownName")}</h4>
                    <span className="ex-kind">{t("explore.unknownCount", { n: unknown })}</span>
                  </header>
                  <p className="ex-card-meta">{t("explore.unknownHint", { n: unknown })}</p>
                </div>
              </li>
            )}
          </ul>
        </PnSection>
      </div>
    </div>
  );
}
