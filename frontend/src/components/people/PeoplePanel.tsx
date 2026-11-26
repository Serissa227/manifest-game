// 人物（FRAMEWORK §9，docs/UI-CONTRACT.md I5）：见过的人——此刻在哪、情谊与心动、羁绊等级、关系、称呼、请托数；
// 点一位看小传（按羁绊解锁）、喜好、生日、记得你做过的事，在同一个港口时可以交谈（话题）、送礼（预期的反应）、招募。
// 另一页是关系图：主角与人物、人物与人物之间的线（只画主角知道的关系），GL / BL / BG / GB 都只是两个人之间的一条线。
// 第九批 I5b：第三页“见闻”（配角之间的事里主角知道的部分，NewsBook.tsx），详情里追加“人际”与“近况”，点对方的头像看对方；
// 后端支持见闻簿（概览里有 news_unread，或者问一次 gossip 成功）时才有“见闻”这一页——旧后端统一拒绝时与以前一样。
// A9：没被选中的主角此刻停在这里时，卡片与详情写一句她的船（persons.fleets）；真正一起上过学的人，详情里多一节“同窗”（school_memory）。
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useView } from "../../hooks/useView";
import { dayDate, t, tk } from "../../i18n";
import { api } from "../../ipc/api";
import { locById } from "../../ipc/byId";
import type { PersonCard, PersonDetail, RelationshipsView, SchoolMemory } from "../../ipc/types";
import { useGame } from "../../store/game";
import { useIsV2 } from "../../ui/uiMode";
import { EmptyState, Loading } from "../feedback";
import { PortraitArt } from "../portrait/PortraitArt";
import { graphFontSizes, placeEdgeLabels, textBox, textWidth, type Box } from "./graphLabels";
import { NewsBook, RecentSection, TiesSection } from "./NewsBook";
import { academyNames, circleLayout, fleetShips, peopleIndex, personFace, sortPersons, type PeopleIndex, type PersonSort } from "./peopleKit";
import { PersonChat } from "./PersonChat";
import { shownSources, shownWhere } from "../shownText";

type Page = "list" | "graph" | "news";

function Hearts({ p }: { p: Pick<PersonCard, "heart" | "heart_stage"> }) {
  if (p.heart === null || p.heart_stage === null) return null;
  return (
    <span className="ub-heart" aria-label={tk(`ub.heart.${p.heart_stage}`)} title={tk(`ub.heart.${p.heart_stage}`)}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={i <= p.heart_stage! ? "is-on" : undefined}>
          ♥
        </span>
      ))}
    </span>
  );
}

/** 船停在这里的一句话：认得船型时写船型名，否则只写艘数。 */
function fleetText(f: { names: string[]; count: number }): string {
  return f.names.length > 0 ? t("pp.fleetHere", { ships: f.names.join("、") }) : t("pp.fleetCount", { n: f.count });
}

/** A9 同窗记忆：在哪里一起上学、哪天结业、结业时的情谊与约定、后来有没有再见。学院名取开局目录。 */
function SchoolSection({ m }: { m: SchoolMemory }) {
  const catalog = useView("world_catalog", () => api.worldCatalog(), { quiet: true, follow: false }).data;
  const names = academyNames(catalog);
  const academies = m.academies.map((k) => names.get(k)).filter((n): n is string => !!n);
  const then = [
    t("pp.school.then", { n: m.affection.affinity }),
    m.affection.bond ? t("pp.school.bond", { rank: m.affection.bond }) : null,
    m.affection.experiences > 0 ? t("pp.school.experiences", { n: m.affection.experiences }) : null,
    m.promise ? t("pp.school.promise") : null,
  ].filter((x): x is string => !!x);
  const after = !m.parted ? t("pp.school.together") : m.reunited_on !== null ? t("pp.school.reunited", { date: dayDate(m.reunited_on) }) : t("pp.school.parted");
  return (
    <section className="pp-school" aria-label={t("pp.school")} data-testid="person-school">
      <h5>{t("pp.school")}</h5>
      <p>
        <span>{academies.length > 0 ? t("pp.school.where", { academies: academies.join("、") }) : t("pp.school.whereUnknown")}</span>
        <span>{t("pp.school.graduated", { date: dayDate(m.graduated_on) })}</span>
      </p>
      <p>
        {then.map((x) => (
          <span key={x}>{x}</span>
        ))}
      </p>
      <p className="pp-school-after">{after}</p>
    </section>
  );
}

/** 从别人的详情跳过来时的“回到某某”。 */
function BackTo({ back, onBack }: { back: { key: string; name: string } | null; onBack: () => void }) {
  if (!back) return null;
  return (
    <button type="button" className="pp-back" onClick={onBack} data-testid="person-back">
      <span aria-hidden="true">{"◂ "}</span>
      {t("pp.back", { name: back.name })}
    </button>
  );
}

function Detail({
  p,
  fleet,
  here,
  busy,
  index,
  back,
  onBack,
  onPick,
  onTalk,
  onGift,
  onRecruit,
  onSay,
}: {
  p: PersonDetail;
  /** A9：这位此刻停在这里的船 */
  fleet: { names: string[]; count: number } | null;
  here: boolean;
  busy: boolean;
  index: PeopleIndex;
  back: { key: string; name: string } | null;
  onBack: () => void;
  onPick: (key: string) => void;
  onTalk: (topic: string) => void;
  onGift: (item: string) => void;
  onRecruit: () => void;
  onSay: (text: string) => void;
}) {
  // 换了一位时把详情滚进视野（手机上详情在列表下面；桌面上并排时不动）
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [p.key]);
  return (
    <article className="pp-detail" aria-label={p.name} data-testid="person-detail" ref={ref}>
      <BackTo back={back} onBack={onBack} />
      <header className="pp-detail-head">
        <PortraitArt {...personFace(p.key, p.portrait)} size={96} variant="full" className="pp-detail-face" />
        <div>
          <h4 className="pp-name">
            {p.name}
            {p.bond && <span className={`ub-rank ub-rank-${p.bond}`}>{p.bond}</span>}
            <Hearts p={p} />
          </h4>
          <p className="pp-role">{p.summary || p.role}</p>
          <p className="pp-line">
            {p.relation.length > 0 && <span>{p.relation.join("、")}</span>}
            <span>{t("ub.callsYou", { name: p.call_name })}</span>
            {shownWhere(p.where) && <span>{t("ub.whereNow", { place: shownWhere(p.where) ?? "" })}</span>}
            {p.birthday && <span>{t("ub.birthdayOn", { m: p.birthday[0], d: p.birthday[1] })}</span>}
            {fleet && <span data-testid="person-fleet">{fleetText(fleet)}</span>}
          </p>
        </div>
      </header>
      <span className="ub-aff" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.affinity} aria-label={t("ub.affinityOf", { name: p.name })}>
        <span style={{ width: `${p.affinity}%` }} />
      </span>
      {(p.likes_known.length > 0 || p.dislikes_known.length > 0) && (
        <p className="pp-likes">
          {p.likes_known.length > 0 && <span>{t("ub.likes", { list: p.likes_known.join("、") })}</span>}
          {p.dislikes_known.length > 0 && <span>{t("pp.dislikes", { list: p.dislikes_known.join("、") })}</span>}
        </p>
      )}
      {p.bio_pages.map((b) => (
        <section key={b.title} className="pp-bio">
          <h5>{b.title}</h5>
          <p>{b.text}</p>
        </section>
      ))}
      {p.memories.length > 0 && (
        <ul className="pp-memories" aria-label={t("pp.memories")}>
          {p.memories.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
      {p.school_memory && <SchoolSection m={p.school_memory} />}
      <TiesSection ties={p.ties} onPick={onPick} />
      <RecentSection news={p.news} index={index} onPick={onPick} />
      {here && (
        <div className="pp-actions">
          {p.topics.map((x) => (
            <button key={x.key} type="button" className="ts-btn ts-btn-small" disabled={busy || !x.enabled} title={x.blocked_reason} onClick={() => onTalk(x.key)}>
              {x.name}
            </button>
          ))}
          {p.gifts.length > 0 && (
            <select aria-label={t("pp.gift")} value="" disabled={busy} onChange={(e) => e.target.value && onGift(e.target.value)}>
              <option value="">{t("pp.gift")}</option>
              {p.gifts.map((g) => (
                <option key={g.item} value={g.item}>
                  {t("pp.giftOption", { name: g.name, qty: g.qty, reaction: tk(`pp.reaction.${g.reaction}`) })}
                </option>
              ))}
            </select>
          )}
          {p.can_recruit && (
            <button type="button" className="ts-btn ts-btn-small" disabled={busy} onClick={onRecruit}>
              {t("pp.recruit")}
            </button>
          )}
        </div>
      )}
      {here && <PersonChat person={p} busy={busy} onSay={onSay} />}
      {!here && <p className="pp-away">{t("pp.notHere")}</p>}
      {(p.basis || shownSources(p.sources).length > 0) && (
        <p className="it-source">
          {p.basis && <span className="it-basis">{tk(`it.basis.${p.basis}`)}</span>}
          {shownSources(p.sources).join("；")}
        </p>
      )}
    </article>
  );
}

/** 关系图的图例（新界面）：线的颜色说明是什么关系（类名对应 pp-edge--<种类>）。 */
const LEGEND: { key: "love" | "bond" | "rival" | "mentor"; label: "v2.fleet.edge.love" | "v2.fleet.edge.bond" | "v2.fleet.edge.rival" | "v2.fleet.edge.mentor" }[] = [
  { key: "love", label: "v2.fleet.edge.love" },
  { key: "bond", label: "v2.fleet.edge.bond" },
  { key: "rival", label: "v2.fleet.edge.rival" },
  { key: "mentor", label: "v2.fleet.edge.mentor" },
];

/**
 * 关系图：节点在圆周上，主角在圆心；线的颜色按关系的种类。
 * 新界面（v2；旧界面不变）：上面一句提示、下面线的颜色图例；人物的圆点可以用 Tab 选到、回车或空格打开详情；一个人都没有时是空状态。
 * 另外按 svg 实际显示的宽度折算字号（手机上缩到约 0.7 倍时字仍不小于 12 px，见 graphLabels.ts）；
 * 线上的标签躲开圆点、名字与别的标签；名字不出 svg 的左右边；每个圆点外有一圈透明的点击区（显示约 44 px，触屏好点）。
 */
function Graph({ rel, onPick }: { rel: RelationshipsView; onPick: (key: string) => void }) {
  const layout = useMemo(() => circleLayout(rel), [rel]);
  const v2 = useIsV2();
  const W = 520;
  const H = 420;
  // 新界面：量 svg 显示的宽度（缩放 k = 显示宽 ÷ W）；量不到（jsdom）时按桌面
  const [svgEl, setSvgEl] = useState<SVGSVGElement | null>(null);
  const [k, setK] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!svgEl) return;
    const measure = () => {
      const w = svgEl.getBoundingClientRect().width;
      setK(w > 0 ? w / W : null);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(svgEl);
    return () => ro.disconnect();
  }, [svgEl]);
  if (v2 && !rel.nodes.some((n) => n.kind === "person")) {
    return <EmptyState text={t("v2.fleet.graphEmpty")} hint={t("v2.fleet.graphEmptyHint")} />;
  }
  const fs = graphFontSizes(v2 ? k : null);
  const radius = (kind: string) => (kind === "protagonist" ? 22 : 16);
  // 名字的基线：旧界面照旧 38 / 30；新界面按字号放在圆点下面，字大了也不压住圆点
  const nameDy = (kind: string) => (v2 ? Math.round(radius(kind) + 4 + fs.node * 0.8) : kind === "protagonist" ? 38 : 30);
  const pos = (key: string) => {
    const p = layout.get(key);
    return p ? { x: p.x * W, y: p.y * H } : null;
  };
  // 名字水平方向挪进 svg 里（长名字在最左、最右的圆点下会被裁掉）：相对圆点的 x 偏移
  const nameDx = (name: string, x: number) => {
    if (!v2) return 0;
    const half = textWidth(name, fs.node) / 2 + 2;
    return Math.min(Math.max(x, half), W - half) - x;
  };
  const edges = rel.edges.flatMap((e) => {
    const na = layout.get(e.a);
    const nb = layout.get(e.b);
    // mid：旧界面的标签位置（中点上方 4），算法与原来一字不差
    return na && nb ? [{ e, a: { x: na.x * W, y: na.y * H }, b: { x: nb.x * W, y: nb.y * H }, mid: { x: ((na.x + nb.x) / 2) * W, y: ((na.y + nb.y) / 2) * H - 4 } }] : [];
  });
  // 新界面：线上标签的位置（躲开圆点、名字与别的标签）；旧界面在中点上方 4
  let labelAt = edges.map(({ mid }) => mid);
  // 圆点外透明点击区的半径：显示约 44 px，但不超过两点距离的一半（不抢旁边的人）
  let hitR = 0;
  if (v2) {
    const obstacles: Box[] = [];
    const points: { x: number; y: number }[] = [];
    for (const n of rel.nodes) {
      const p = pos(n.key);
      if (!p) continue;
      points.push(p);
      const r = radius(n.kind) + 2;
      obstacles.push({ x0: p.x - r, x1: p.x + r, y0: p.y - r, y1: p.y + r });
      obstacles.push(textBox(n.name, p.x + nameDx(n.name, p.x), p.y + nameDy(n.kind), fs.node));
    }
    labelAt = placeEdgeLabels(
      edges.map(({ e, a, b }) => ({ a, b, label: e.label })),
      obstacles,
      fs.edge,
    );
    let near = Infinity;
    for (let i = 0; i < points.length; i++)
      for (let j = i + 1; j < points.length; j++) near = Math.min(near, Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y));
    hitR = Math.min(22 / (k ?? 1), near / 2);
  }
  // 新界面里人物的圆点是按钮（Tab 可达、读屏念名字）：role="img" 的子元素对读屏是“装饰”、会被整个吞掉，所以 v2 用 group；v1 照旧是 img
  const svg = (
    <svg className="pp-graph" viewBox={`0 0 ${W} ${H}`} role={v2 ? "group" : "img"} aria-label={t("pp.graph")} ref={v2 ? setSvgEl : undefined}>
      {edges.map(({ e, a, b }, i) => (
        <g key={i} className={`pp-edge pp-edge--${e.kind}`}>
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
          <text x={labelAt[i].x} y={labelAt[i].y} textAnchor="middle" style={v2 ? { fontSize: fs.edge } : undefined}>
            {e.label}
          </text>
        </g>
      ))}
      {rel.nodes.map((n) => {
        const p = pos(n.key);
        if (!p) return null;
        const person = n.kind === "person";
        const r = radius(n.kind);
        const dx = nameDx(n.name, p.x);
        return (
          <g
            key={n.key}
            className={`pp-node pp-node--${n.kind}`}
            transform={`translate(${p.x} ${p.y})`}
            onClick={() => person && onPick(n.key)}
            role={person ? "button" : undefined}
            aria-label={n.name}
            tabIndex={v2 && person ? 0 : undefined}
            onKeyDown={
              v2 && person
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onPick(n.key);
                    }
                  }
                : undefined
            }
          >
            {v2 && person && hitR > r && <circle className="pp-node-hit" r={hitR} />}
            <circle r={r} />
            <text x={dx || undefined} y={nameDy(n.kind)} textAnchor="middle" style={v2 ? { fontSize: fs.node } : undefined}>
              {n.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
  if (!v2) return svg;
  return (
    <div className="pp-graph-wrap">
      <p className="pp-graph-hint">{t("v2.fleet.graphHint")}</p>
      {svg}
      <ul className="pp-graph-legend" aria-label={t("v2.fleet.graphLegend")}>
        {LEGEND.map((l) => (
          <li key={l.key}>
            <span className={`pp-graph-swatch is-${l.key}`} aria-hidden="true" />
            {t(l.label)}
          </li>
        ))}
      </ul>
    </div>
  );
}

const EMPTY: PersonCard[] = [];

export default function PeoplePanel() {
  const loc = useGame((s) => s.selectedLoc);
  const shipTypes = useGame((s) => s.statics?.ships);
  const submit = useGame((s) => s.submit);
  const portName = useGame((s) => (s.selectedLoc !== null ? locById(s.statics, s.selectedLoc)?.name : undefined));
  const newsUnread = useGame((s) => s.overview?.story?.news_unread);
  const [onlyHere, setOnlyHere] = useState(false);
  const [onlyPort, setOnlyPort] = useState(false);
  const [sort, setSort] = useState<PersonSort>("affinity");
  const [sel, setSel] = useState<string | null>(null);
  // 从别人的详情（人际、见闻里的头像）跳过来时记下来处，详情顶上给“回到某某”
  const [back, setBack] = useState<{ key: string; name: string } | null>(null);
  const [page, setPage] = useState<Page>("list");
  const [busy, setBusy] = useState(false);

  // 见过的人（只看这里的：按所选港口）；取不到时当作没有
  const here0 = onlyHere && loc !== null ? loc : undefined;
  const persons = useView(`persons:${here0 ?? ""}`, () => api.persons(here0), { quiet: true });
  const list0: PersonCard[] | null = persons.status === "error" ? EMPTY : (persons.data?.persons ?? null);
  const fleets = persons.status === "error" ? undefined : persons.data?.fleets;
  const detailView = useView(sel ? `person:${sel}` : null, () => api.person(sel ?? ""), { quiet: true });
  const rel0: RelationshipsView | null = useView(page === "graph" ? "relationships" : null, () => api.relationships(), { quiet: true }).data;
  const list = list0;
  const detail = detailView.data;
  const rel = rel0;
  // 后端支持见闻簿吗：概览里有 news_unread 就是支持；没有时问一次 gossip（旧后端统一拒绝 → 不出现“见闻”这一页）
  const known = typeof newsUnread === "number";
  const probe = useView(known ? null : "gossip:probe", () => api.gossip({ limit: 1 }), { quiet: true, follow: false });
  const newsOn = known || probe.status === "ok";
  const unread = known ? newsUnread : (probe.data?.unread ?? 0);
  const shown: Page = page === "news" && !newsOn ? "list" : page;
  const index = useMemo(() => peopleIndex(list, detail), [list, detail]);

  if (!list) return <Loading v1={<p className="ts-empty">{t("loading")}</p>} />;
  const sorted = sortPersons(list, sort);
  const pages: Page[] = newsOn ? ["list", "graph", "news"] : ["list", "graph"];
  // 看另一位：从详情（人际、近况）或见闻簿里点头像
  const pick = (key: string) => {
    if (key === sel && shown === "list") return;
    setBack(sel && detail && shown === "list" ? { key: detail.key, name: detail.name } : null);
    setSel(key);
    setPage("list");
  };
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  // 人在同一个港口才能交谈、送礼与招募（后端判断：detail.here）
  const here = !!detail?.here;

  return (
    <div className="pp-panel" data-testid="people">
      <div className="ub-tabs" role="tablist" aria-label={t("pp.pages")}>
        {pages.map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={shown === p}
            className={shown === p ? "ub-tab is-on" : "ub-tab"}
            title={p === "news" && unread > 0 ? t("pp.newsUnread", { n: unread }) : undefined}
            onClick={() => setPage(p)}
            data-testid={`pp-page-${p}`}
          >
            {tk(`pp.page.${p}`)}
            {p === "news" && unread > 0 && (
              <span className="pp-tab-count" aria-hidden="true">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </button>
        ))}
        {shown === "news" && (
          <label className="pp-here">
            <input type="checkbox" checked={onlyPort && loc !== null} disabled={loc === null} onChange={(e) => setOnlyPort(e.target.checked)} />
            {portName ? t("pp.news.onlyPort", { port: portName }) : t("pp.news.onlyPortNone")}
          </label>
        )}
        {shown === "list" && (
          <>
            <label className="pp-here">
              <input type="checkbox" checked={onlyHere} onChange={(e) => setOnlyHere(e.target.checked)} />
              {t("pp.onlyHere")}
            </label>
            <select aria-label={t("pp.sort")} value={sort} onChange={(e) => setSort(e.target.value as PersonSort)}>
              {(["affinity", "name", "recent"] as const).map((k) => (
                <option key={k} value={k}>
                  {tk(`pp.sort.${k}`)}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
      {shown === "list" ? (
        <div className="pp-body">
          {sorted.length === 0 ? (
            // 新界面：只看此地时“下一步”是显示全部的人；一个人都不认识时说一句去哪里结识；旧界面照旧一行字
            <EmptyState
              text={onlyHere ? t("pp.nobodyHere") : t("pp.nobody")}
              hint={onlyHere ? t("v2.fleet.pp.nobodyHereHint") : t("v2.fleet.pp.nobodyHint")}
              action={onlyHere ? { label: t("v2.fleet.pp.showAll"), onClick: () => setOnlyHere(false) } : undefined}
              v1={<p className="ts-empty">{onlyHere ? t("pp.nobodyHere") : t("pp.nobody")}</p>}
            />
          ) : (
            <ul className="pp-list">
              {sorted.map((p) => (
                <li key={p.key}>
                  <button
                    type="button"
                    className={p.key === sel ? "pp-card is-on" : "pp-card"}
                    aria-pressed={p.key === sel}
                    onClick={() => {
                      setBack(null);
                      setSel(p.key);
                    }}
                    data-testid={`person-${p.key}`}
                  >
                    <PortraitArt {...personFace(p.key, p.portrait)} size={48} className="pp-face" />
                    <span className="pp-card-body">
                      <span className="pp-card-name">
                        {p.name}
                        {p.bond && <span className={`ub-rank ub-rank-${p.bond}`}>{p.bond}</span>}
                        <Hearts p={p} />
                        {p.requests > 0 && <span className="pp-req">{t("pp.requests", { n: p.requests })}</span>}
                      </span>
                      <span className="pp-card-role">{p.summary || p.role}</span>
                      <span className="pp-card-where">{shownWhere(p.where) ?? t("pp.whereUnknown")}</span>
                      {(() => {
                        const f = fleetShips(fleets, p.key, shipTypes);
                        return f && <span className="pp-card-fleet">{fleetText(f)}</span>;
                      })()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {detail ? (
            <Detail
              p={detail}
              fleet={fleetShips(fleets, detail.key, shipTypes)}
              here={here}
              busy={busy}
              index={index}
              back={back}
              onBack={() => {
                if (!back) return;
                setSel(back.key);
                setBack(null);
              }}
              onPick={pick}
              onTalk={(topic) => void run(() => submit({ Talk: { owner: "player", person: detail.key, topic } }))}
              onSay={(text) => void run(() => submit({ TalkFree: { owner: "player", person: detail.key, text } }))}
              onGift={(it) => void run(() => submit({ GiveItem: { owner: "player", person: detail.key, item: it, qty: 1 } }))}
              onRecruit={() => void run(() => submit({ RecruitPerson: { owner: "player", person: detail.key } }))}
            />
          ) : (
            sel &&
            detailView.status === "error" && (
              // 跳到一位还看不到详情的人（例如只听说过）：写明，留着回去的路
              <div className="pp-detail pp-missing" data-testid="person-missing">
                <BackTo
                  back={back}
                  onBack={() => {
                    if (!back) return;
                    setSel(back.key);
                    setBack(null);
                  }}
                />
                <p className="pp-away">{t("pp.unknownPerson")}</p>
              </div>
            )
          )}
        </div>
      ) : shown === "news" ? (
        <NewsBook at={onlyPort && loc !== null ? loc : undefined} onPick={pick} onShowAll={() => setOnlyPort(false)} />
      ) : rel ? (
        <Graph
          rel={rel}
          onPick={(k) => {
            setBack(null);
            setSel(k);
            setPage("list");
          }}
        />
      ) : (
        <Loading v1={<p className="ts-empty">{t("loading")}</p>} />
      )}
    </div>
  );
}

