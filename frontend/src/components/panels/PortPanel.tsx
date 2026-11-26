// 港口窗口：设施分页（与街景里的建筑一一对应，当前分页即 store.facility）+ 设施掌柜的问候 + 分页内容。
// 内陆城市同样使用，只是没有造船厂等设施。殖民点（kind 为 site）没有设施：显示殖民点详情或你的殖民地（见 colony/SitePanel）。
// 新界面（v2，docs/UI-REDESIGN.md 第 8、9 节）只在 v2 下多几处小结构，v1 的 DOM 不变：空状态的说明与“下一步”（酒馆没有航海士 → 看看别处的航海士；
// 没有期货交易所 → 打开期货）、银行与港口投资的快捷金额、按钮上写清动作与金额（“存入 1,000 金币”“还 1,000 金币”）、按人数招募那一行的小标题，
// 以及给样式用的类名（tv-bargain、tv-charts、bk-loans、ex-link、of-war、of-relations）。
// v2 下手机与矮屏的设施分页排成一行左右滑动：当前设施的小签不在可见范围里时滚到中间（从街景点进来时一眼看得到开的是哪一页）。
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { drawIcon } from "../../art/icons";
import LoreImage from "../LoreImage";
import { loreVariants } from "../../art/lore";
import { Sprite } from "../../art/Sprite";
import { money, nameOf, num, pct, t, tk } from "../../i18n";
import { api } from "../../ipc/api";
import { exchangeById, locById } from "../../ipc/byId";
import type { BargainReply, Holder, PortView, StaticView } from "../../ipc/types";
import { useView } from "../../hooks/useView";
import { EXTRA_FACILITIES, FACILITIES, isFacility, useGame, type PortPage, useOverviewFields } from "../../store/game";
import AuctionPanel from "../items/AuctionPanel";
import ShopPanel from "../items/ShopPanel";
import { SitePanel } from "../colony/SitePanel";
import { BiName } from "../BiName";
import { ActionButton, Empty, NumInput, Section, TabBar, type TabItem } from "../common";
import { tz } from "../../i18n/zhOnly";
import InnPanel from "../port/Inn";
import { CrewHireButtons, CrewShortNote } from "../crew/CrewHire";
import { ContractCard, MateCard } from "../port/cards";
import { HouseLadder } from "../port/House";
import { DevGrowthCard, InvestPreviewLine } from "../port/DevGrowth";
import { devLabel, useStageUpNotice } from "../port/devScale";
import { Keeper } from "../port/Keeper";
import { TownLine, TownSection, Workshops } from "../port/Town";
import { CastBadge } from "../portrait/CastBadge";
import { informantOf, rulerOf, type CastPerson } from "../portrait/castPeople";
import { PortraitArt } from "../portrait/PortraitArt";
import Market from "./Market";
import { guaranteeRateBp, guaranteeShow } from "./bankGuarantee";
import ShipyardTab from "./ShipyardTab";
import WarehouseTab from "./WarehouseTab";
import { QtyStepper } from "./tradeKit";
import { Icon } from "./PanelKit";
import { methodName } from "../../forecast/labels";
import { EmptyState } from "../feedback";
import { closeWindow, hasFutures, openWindow } from "../shell/shellState";
import { useIsV2 } from "../../ui/uiMode";

/** 新增人物位：头像 + 名字 + 头衔（酒馆情报贩子、势力办事处的君主）。 */
function CastRow({ who, testId, size, className }: { who: CastPerson; testId: string; size: number; className?: string }) {
  return <CastBadge asset={who.asset} fallback={who.fallback} name={who.name} title={who.title} size={size} testId={testId} className={className} />;
}

/** 外交关系列表里对方君主的小头像（28 像素，装饰）。 */
function RulerFace({ statics, faction }: { statics: StaticView; faction: number }) {
  const who = rulerOf(statics, faction);
  return (
    <span className="cast-frame of-face" title={`${nameOf({ name: who.name.zh, name_en: who.name.en })} · ${who.title}`}>
      <PortraitArt asset={who.asset} fallback={who.fallback} size={28} />
    </span>
  );
}

/** 第九批的分页这个港口有没有：道具店看 PortView.shop，拍卖会看 PortView.auction。 */
function hasExtra(port: PortView | null | undefined, loc: number | null, k: PortPage): boolean {
  if (!port || port.loc !== loc) return false;
  return k === "shop" ? !!port.shop : k === "auction" ? !!port.auction : false;
}

/**
 * 新界面：设施分页一行放不下、可以左右滑动时（手机与矮屏，见 compact.css），当前设施的小签不在可见范围里就把它滚到中间——
 * 两边各露出一点别的分页，看得出还能滑。只改分页条自己的 scrollLeft（不用 scrollIntoView：它会连带滚动窗口等外层容器）；
 * 放得下（桌面上折行）时什么也不做。
 */
function revealActiveTab(root: HTMLElement | null): void {
  const bar = root?.querySelector<HTMLElement>(":scope > .tabbar");
  const active = bar?.querySelector<HTMLElement>(".tab.active");
  if (!bar || !active || bar.scrollWidth <= bar.clientWidth) return;
  const b = bar.getBoundingClientRect();
  const a = active.getBoundingClientRect();
  const edge = 16; // 离分页条两端不到这么远也算“看不全”
  if (a.left >= b.left + edge && a.right <= b.right - edge) return;
  const target = bar.scrollLeft + (a.left - b.left) - (b.width - a.width) / 2;
  bar.scrollLeft = Math.max(0, Math.min(target, bar.scrollWidth - bar.clientWidth));
}

/** 港口（内陆城市同样使用，只是没有船厂等设施）。 */
export default function PortPanel() {
  const statics = useGame((s) => s.statics);
  const loc = useGame((s) => s.selectedLoc);
  const picked = useGame((s) => s.facility);
  const setTab = useGame((s) => s.setFacility);
  // 旅店（11-03 在港暂停）：只在旗舰队停着、时间不走的那座港口出现，排在酒馆后面
  const hold = useGame((s) => s.overview?.port_hold ?? null);
  const innHere = hold !== null && hold.loc === loc;
  // 没有期货的世界（寰宇）不出“期货交易所”一页；原先停在这一页时落回交易所（旅店同样：旗舰队不在这里时落回交易所）
  const futures = hasFutures(statics);
  const tab = (picked === "exchange" && !futures) || (picked === "inn" && !innHere) ? "market" : picked;
  const l = locById(statics, loc);
  const isSite = l?.kind === "site";
  const { data: port } = useView(loc === null || isSite ? null : `port:${loc}`, () => api.port(loc ?? 0));
  const v2 = useIsV2();
  const root = useRef<HTMLDivElement>(null);
  // 道具店、拍卖会两页要等港口数据到了才出现，分页条随之变长
  const extras = EXTRA_FACILITIES.filter((k) => hasExtra(port, loc, k)).join(",");
  // 新界面：打开窗口、换设施、换港口时把当前设施的小签滚进可见范围（画之前做，不闪一下）；v1 不动
  useLayoutEffect(() => {
    if (v2) revealActiveTab(root.current);
  }, [v2, tab, loc, extras]);
  // E02：港口升了一个阶段时提示一句（窗口开着、数字刷新后；旧后端没有 growth，不提示）
  useStageUpNotice(port && port.loc === loc ? loc : null, l?.name ?? "", port && port.loc === loc ? port.invest.growth : null);
  // 分页前的设施小图标（对辅助技术隐藏，不改变分页的可访问名称）
  const icons = useMemo(() => new Map(FACILITIES.map((f) => [f, <Sprite px={drawIcon(f)} scale={1} />] as const)), []);
  // 还没选港口（或选中的地点不在静态数据里：没看见过）：新界面给“下一步”打开航海图（在那里点一个港口）；旧界面照旧一行字
  if (!statics || loc === null || !l)
    return (
      <EmptyState
        text={t("portSelect")}
        action={{
          label: t("v2.port.toChart"),
          onClick: () => {
            useGame.getState().setStage("chart");
            closeWindow();
          },
        }}
      />
    );
  if (isSite) return <SitePanel loc={loc} />;
  // 港口的城市插画：标题下一整幅，按打开时的时辰与此地天气挑一版（art/lore.ts）；秘境港口用秘境街景（realm_<港口 key>），其余用 port_<港口 key>
  const portArt = loreVariants(`realm_${l.key}`).length > 0 ? `realm_${l.key}` : `port_${l.key}`;
  return (
    <div className="port" data-testid="port-panel" ref={root}>
      <h2>
        {/* 港口窗口标题里的地名：双行名字 */}
        <BiName zh={l.name} en={l.name_en} testId="port-title-name" /> <small>{tk(`loc.${l.kind}`)}</small>
      </h2>
      <LoreImage art={portArt} size="large" className="port-lore-art" wrapClass="port-lore" testId="port-lore-art" loc={loc} />
      <p className="sub">
        {t("portFaction", { name: statics.factions[l.faction]?.name ?? "" })}
        {port && <> · {t("portTax", { pct: pct(port.tax_bp) })}</>}
        {/* E02：阶段名与发展度（旧后端、规则关着的世界不写） */}
        {port && port.loc === loc && port.invest.growth && (
          <>
            {" · "}
            <span data-testid="port-dev">{devLabel(port.invest.growth)}</span>
          </>
        )}
        {port && port.loc === loc && <TownLine people={port.people} />}
      </p>
      <TabBar
        label={l.name}
        items={[
          ...FACILITIES.filter((k) => k !== "exchange" || futures).flatMap((k) => {
            const item: TabItem<PortPage> = { key: k, label: tk(`port.${k}`), icon: icons.get(k) };
            return k === "tavern" && innHere ? [item, { key: "inn" as const, label: tz("inn.tab"), icon: icons.get("tavern") }] : [item];
          }),
          ...EXTRA_FACILITIES.filter((k) => hasExtra(port, loc, k)).map((k) => ({ key: k, label: tk(`port.${k}`) })),
        ]}
        active={tab}
        onSelect={setTab}
      />
      {port && port.loc === loc && isFacility(tab) && <Keeper loc={l} facility={tab} port={port} />}
      {port && port.loc === loc && (
        <div className="tab-body">
          {tab === "market" && (
            <>
              <Market port={port} />
              <Workshops port={port} />
            </>
          )}
          {tab === "shipyard" && <ShipyardTab port={port} />}
          {tab === "tavern" && <Tavern port={port} />}
          {tab === "inn" && hold && innHere && <InnPanel hold={hold} />}
          {tab === "guild" && <Guild port={port} />}
          {tab === "bank" && <Bank port={port} />}
          {tab === "exchange" && <ExchangeLink port={port} />}
          {tab === "warehouse" && <WarehouseTab port={port} />}
          {tab === "invest" && <Invest port={port} />}
          {tab === "office" && <Office port={port} />}
          {tab === "shop" && hasExtra(port, loc, "shop") && <ShopPanel loc={loc} />}
          {tab === "auction" && hasExtra(port, loc, "auction") && <AuctionPanel loc={loc} />}
        </div>
      )}
    </div>
  );
}

/** 新界面：金额的快捷按钮（银行、港口投资）；选中的那个 aria-pressed。extra 是另加的一个（“全部存款 6,000”）。 */
function QuickAmounts({
  values,
  value,
  onPick,
  extra,
  className,
}: {
  values: number[];
  value: number;
  onPick: (v: number) => void;
  extra?: { label: string; value: number } | null;
  className: string;
}) {
  return (
    <div className={className} role="group" aria-label={t("v2.port.quick")}>
      {[...new Set(values)].map((v) => (
        <button key={v} type="button" className="btn small" aria-pressed={value === v} onClick={() => onPick(v)}>
          {num(v)}
        </button>
      ))}
      {extra && (
        <button type="button" className="btn small" aria-pressed={value === extra.value} onClick={() => onPick(extra.value)}>
          {extra.label}
        </button>
      )}
    </div>
  );
}

/** 招募某等级航海士所需的名声（mate_fame 只列出需要名声的等级）；不需要或数据未到时为 0。 */
function mateFameNeed(level: number, rungs: [number, number][] | undefined): number {
  return rungs?.find(([l]) => l === level)?.[1] ?? 0;
}

/** 酒馆：可招募的航海士（名声不足时招募按钮禁用并说明）、新闻、议价、海图、船员招募与解雇。 */
function Tavern({ port }: { port: PortView }) {
  const statics = useGame((s) => s.statics);
  // 按字段选取（P14a）：只取用到的顶层字段，没变就不重渲染
  const overview = useOverviewFields("fleets", "fame", "cash");
  const submit = useGame((s) => s.submit);
  const [text, setText] = useState("");
  const [reply, setReply] = useState<BargainReply | null>(null);
  const [crew, setCrew] = useState(5);
  const v2 = useIsV2();
  const bargainHintId = useId();
  const { data: intel } = useView("intel", () => api.intel());
  // 高等级航海士的名声门槛（与航海士窗口一致：DiscoveriesView.mate_fame，名声取探险记录，没有时取概览）
  const { data: explore } = useView("discoveries", () => api.discoveries());
  if (!statics || !overview) return null;
  const here = overview.fleets.filter((f) => port.fleets_here.includes(f.id));
  const place = locById(statics, port.loc);
  const fame = explore?.fame ?? overview.fame ?? 0;
  return (
    <div>
      {/* 招募船员放在酒馆最上面（玩家反馈“不知道船员如何补充”）：每支在港的舰队一键补到最低人数或补满，也可以按数量招募或解雇 */}
      {here.length > 0 && (
        <Section title={t("tvCrew")}>
          <div className="tv-crew" data-testid="tavern-crew">
            <p className="sub">{t("crewHelp", { wage: money(statics.rules.crew_wage), cost: money(statics.rules.crew_hire_cost) })}</p>
            {here.map((f) => (
              <div key={f.id} className="tv-crew-fleet" data-testid={`tavern-crew-${f.id}`}>
                <span className="tv-crew-line">
                  {t("holder.fleet", { id: f.id })} · {t("flCrew", { crew: f.crew, min: f.crew_min, max: f.crew_max })}
                </span>
                <CrewShortNote fleet={f} />
                <CrewHireButtons fleet={f} testId={`tavern-crew-hire-${f.id}`} />
              </div>
            ))}
            <div className="row tv-crew-custom">
              {/* 按人数招募或解雇：与交易所同样的加减（长按连发、Shift ×10）；招不到、钱不够、人数不够时按钮灰掉 */}
              {v2 && <span className="tv-crew-by">{t("v2.port.crewBy")}</span>}
              <QtyStepper
                value={crew}
                max={Math.max(1, ...here.map((f) => Math.max(f.crew, f.hire_max ?? f.crew_max - f.crew)))}
                onChange={setCrew}
                label={t("cr.qty")}
                decLabel={t("cr.dec")}
                incLabel={t("cr.inc")}
                testId="tavern-crew-qty"
              />
              {here.map((f) => (
                <span key={f.id} className="tv-crew-custom-btns">
                  {here.length > 1 && <span className="sub">{t("holder.fleet", { id: f.id })}</span>}
                  <ActionButton
                    disabled={crew <= 0 || crew > (f.hire_max ?? f.crew_max - f.crew) || crew * statics.rules.crew_hire_cost > overview.cash}
                    onClick={() => submit({ HireCrew: { owner: "player", fleet: f.id, count: crew } })}
                  >
                    {/* 新界面：整句走字符串表（全角括号）；v1 照旧是“招募 (n 金币)” */}
                    {v2 ? (
                      t("v2.port.crewHire", { v: money(crew * statics.rules.crew_hire_cost) })
                    ) : (
                      <>
                        {t("tvHire")} ({money(crew * statics.rules.crew_hire_cost)})
                      </>
                    )}
                  </ActionButton>
                  <ActionButton disabled={crew <= 0 || crew > f.crew} onClick={() => submit({ DismissCrew: { owner: "player", fleet: f.id, count: crew } })}>
                    {t("tvDismiss")}
                  </ActionButton>
                </span>
              ))}
            </div>
          </div>
        </Section>
      )}
      <Section title={t("mtHere")}>
        {port.mates_here.length === 0 ? (
          // 新界面：说明航海士会走动，下一步去“航海士”窗口看别处酒馆里的人（v1 照旧只有一句）
          <EmptyState text={t("mtNoneHere")} hint={t("v2.port.mtNoneHint")} action={{ label: t("v2.port.mtNoneGo"), onClick: () => openWindow("mates") }} />
        ) : (
          <div className="mate-cards">
            {port.mates_here.map((m) => {
              const need = mateFameNeed(m.level, explore?.mate_fame);
              const short = fame < need;
              return (
                <MateCard key={m.id} mate={m}>
                  {need > 0 && (
                    <p className={short ? "mate-fame short" : "mate-fame"} data-testid={`tavern-fame-${m.id}`}>
                      <Icon name="fame" />
                      {t("pnFameNeed", { fame: need })}
                    </p>
                  )}
                  {short && <p className="mate-fame-short">{t("pnFameShort", { need, fame })}</p>}
                  <ActionButton
                    kind="primary"
                    disabled={short}
                    onClick={() => submit({ HireMate: { owner: "player", mate: m.id } })}
                  >
                    {t("mtHire", { cost: v2 ? num(m.hire_cost) : m.hire_cost })}
                  </ActionButton>
                </MateCard>
              );
            })}
          </div>
        )}
      </Section>
      <Section title={t("tvNews")}>
        <div className="tv-news">
          {/* 酒馆角落里的情报贩子（按港口的文化；纯装饰的头像 + 名字） */}
          {place && <CastRow who={informantOf(statics, place)} testId="tavern-informant" size={56} />}
          {/* 算学奇才每季换一处酒馆，这里偶尔听得到去向 */}
          {port.genius_rumor && (
            <p className="tv-genius" data-testid="tavern-genius">
              <Icon name="forecast" />
              {t("fc.geniusRumor", {
                name: port.genius_rumor.name,
                port: locById(statics, port.genius_rumor.loc)?.name ?? "?",
                methods: port.genius_rumor.methods.map((m) => methodName(m)).join(t("listSep")),
              })}
            </p>
          )}
          {/* 商会的展望：真实的动向（ECONOMY.md 8.2） */}
          {(port.outlooks ?? []).length > 0 && (
            <ul className="tv-outlooks" data-testid="tavern-outlooks">
              {(port.outlooks ?? []).map((o) => (
                <li key={o.company}>
                  <Icon name="tavern" />
                  {t("tvOutlook", { company: o.company, memo: o.memo })}
                </li>
              ))}
            </ul>
          )}
          <ul className="news">
            {(intel?.news ?? []).slice(0, 6).map((n) => (
              <li key={n.id}>{t("itNewsLine", { source: tk(`source.${n.source}`), cred: n.credibility, text: n.text })}</li>
            ))}
          </ul>
        </div>
      </Section>
      <Section title={t("tvBargain")}>
        <div className={v2 ? "row tv-bargain" : "row"}>
          {/* 新界面：输入框里只写一句短的（手机上整句放不下、被截断），能试的说法写在下面的小字里 */}
          <input
            aria-label={v2 ? t("v2.port.bargainPh") : t("tvBargainHint")}
            aria-describedby={v2 ? bargainHintId : undefined}
            placeholder={v2 ? t("v2.port.bargainPh") : t("tvBargainHint")}
            value={text}
            maxLength={200}
            onChange={(e) => setText(e.target.value)}
          />
          <ActionButton
            disabled={!text.trim()}
            onClick={async () => {
              try {
                const r = await api.bargain(port.loc, text);
                setReply(r);
                setText("");
              } catch (e) {
                useGame.getState().fail(e);
              }
            }}
          >
            {t("tvSay")}
          </ActionButton>
        </div>
        {v2 && (
          <p className="tv-bargain-hint" id={bargainHintId}>
            {t("v2.port.bargainHint")}
          </p>
        )}
        {reply && (
          <p className="reply">
            {t("tvReply", { reply: reply.reply })}
            {t("tvIntent", { intent: tk(`intent.${reply.intent}`), pct: pct(reply.discount_bp) })}
          </p>
        )}
        <ul className="dialogs">
          {port.dialogs.map((d, i) => (
            <li key={i}>
              {t("tvDialogLine", { day: t("dayN", { day: d.day }), said: d.player_text, reply: d.reply, intent: tk(`intent.${d.intent}`) })}
            </li>
          ))}
        </ul>
      </Section>
      {port.charts.length > 0 && (
        <Section title={t("exCharts")}>
          <ul className={v2 ? "tv-charts" : undefined}>
            {port.charts.map((c) => (
              <li key={c.region}>
                {t("exChartLine", { region: statics.regions[c.region]?.name ?? "" })}{" "}
                {c.owned ? (
                  <em className="tag">{t("exOwned")}</em>
                ) : (
                  <ActionButton onClick={() => submit({ BuyChart: { owner: "player", region: c.region } })}>
                    {t("exBuyChart", { price: v2 ? num(c.price) : c.price })}
                  </ActionButton>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Guild({ port }: { port: PortView }) {
  const statics = useGame((s) => s.statics);
  const today = useGame((s) => s.overview?.day ?? 0);
  const submit = useGame((s) => s.submit);
  if (!statics) return null;
  const holders: Holder[] = [
    ...port.fleets_here.map((id) => ({ Fleet: id })),
    ...port.caravans_here.map((id) => ({ Caravan: id })),
    ...(port.warehouse.capacity > 0 ? [{ Warehouse: port.loc }] : []),
  ];
  if (port.contracts.length === 0) return <EmptyState text={t("gdNone")} hint={t("v2.port.gdNoneHint")} />;
  return (
    <div className="contracts" aria-label={t("gdContracts")} role="list">
      {port.contracts.map((c) => (
        <div role="listitem" key={c.id}>
          <ContractCard contract={c} statics={statics} today={today}>
            {c.status === "open" && (
              <ActionButton kind="primary" onClick={() => submit({ AcceptContract: { owner: "player", contract: c.id } })}>
                {t("gdAccept")}
              </ActionButton>
            )}
            {c.status === "mine" &&
              c.to === port.loc &&
              holders.map((h, i) => (
                <ActionButton
                  key={i}
                  kind="primary"
                  onClick={() => submit({ DeliverContract: { owner: "player", contract: c.id, holder: h } })}
                >
                  {t("gdDeliver")}
                </ActionButton>
              ))}
          </ContractCard>
        </div>
      ))}
    </div>
  );
}

function Bank({ port }: { port: PortView }) {
  const statics = useGame((s) => s.statics);
  const submit = useGame((s) => s.submit);
  const [amount, setAmount] = useState(1000);
  const [months, setMonths] = useState(6);
  const v2 = useIsV2();
  if (!statics) return null;
  const b = port.bank;
  const deposit = () => submit({ Deposit: { owner: "player", amount } });
  const withdraw = () => submit({ Withdraw: { owner: "player", amount } });
  const borrow = () => submit({ Borrow: { owner: "player", amount, months } });
  // R10-FE4：家里作保（银行视图的 guarantee；没有这一段什么都不加，见 bankGuarantee.ts 的真值表）
  const g = b.guarantee;
  const gs = guaranteeShow(g, amount);
  const guaranteeBlock =
    g && gs.kind !== "none" ? (
      <Section title={tz("bank.guarantee.title")} testId="bank-guarantee">
        {gs.kind === "offer" ? (
          <>
            <p className="sub">{tz("bank.guarantee.terms", { amount: money(g.amount), pct: g.rate_pct })}</p>
            <div className="row">
              <ActionButton onClick={() => setAmount(g.amount)}>{tz("bank.guarantee.fill", { amount: num(g.amount) })}</ActionButton>
            </div>
          </>
        ) : (
          <p className="sub" data-testid={`bank-guarantee-${gs.kind}`}>
            {gs.kind === "used" ? tz("bank.guarantee.used") : tz("bank.guarantee.homeBare")}
          </p>
        )}
      </Section>
    ) : null;
  // 借款按钮下的小字：柜台这一笔走家里的保时写出走保的年息与平常的年息
  const appliesLine =
    g && gs.applies ? (
      <p className="sub" data-testid="bank-guarantee-applies">
        {tz("bank.guarantee.applies", { rate: pct(guaranteeRateBp(b.rate_bp, g.rate_pct)), base: pct(b.rate_bp) })}
      </p>
    ) : null;
  const fields = (
    <>
      <NumInput label={t("bkAmount")} value={amount} min={1} onChange={setAmount} />
      <NumInput
        label={t("bkMonths")}
        value={months}
        min={1}
        max={statics.rules.loan_max_months}
        onChange={setMonths}
      />
    </>
  );
  return (
    <div data-testid="bank">
      <dl className="kv">
        <dt>{t("bkDeposit")}</dt>
        <dd>{money(b.deposit)}</dd>
        <dt>{t("bkCredit")}</dt>
        <dd>{t("bkCreditLine", { grade: b.grade, score: b.credit_score, defaults: b.defaults })}</dd>
        <dt>{t("bkLimit")}</dt>
        <dd>{money(b.limit)}</dd>
        <dt>{t("bkRate")}</dt>
        <dd>{t("unitPct", { v: pct(b.rate_bp) })}</dd>
        <dt>{t("bkDepositRate")}</dt>
        <dd>{t("unitPct", { v: pct(b.deposit_rate_bp) })}</dd>
      </dl>
      {guaranteeBlock}
      {v2 ? (
        // 新界面：一张“柜台”——金额与期限、快捷金额，三个按钮写清动作与金额（命令与 v1 相同）
        <div className="bk-desk">
          <div className="bk-desk-fields">{fields}</div>
          <QuickAmounts
            className="bk-quick"
            values={[1000, 5000, 10000]}
            value={amount}
            onPick={setAmount}
            extra={b.deposit > 0 ? { label: t("v2.port.allDeposit", { v: num(b.deposit) }), value: b.deposit } : null}
          />
          <div className="row">
            <ActionButton onClick={deposit}>{t("v2.port.bkDo", { v: money(amount) })}</ActionButton>
            <ActionButton onClick={withdraw}>{t("v2.port.bkWithdraw", { v: money(amount) })}</ActionButton>
            <ActionButton onClick={borrow}>{t("v2.port.bkBorrow", { v: money(amount), m: months })}</ActionButton>
          </div>
          {appliesLine}
        </div>
      ) : (
        <>
          {fields}
          <div className="row">
            <ActionButton onClick={deposit}>{t("bkDo")}</ActionButton>
            <ActionButton onClick={withdraw}>{t("bkWithdraw")}</ActionButton>
            <ActionButton onClick={borrow}>{t("bkBorrow")}</ActionButton>
          </div>
          {appliesLine}
        </>
      )}
      <Section title={t("bkLoans")}>
        {b.loans.length === 0 ? (
          // 新界面：一小块空状态写清“没有借款”与上面的柜台怎么借；旧界面照旧是“无”
          <EmptyState className="is-compact" text={t("v2.port.bk.noLoans")} hint={t("v2.port.bk.noLoansHint")} v1={<Empty text={t("none")} />} />
        ) : (
          <ul className={v2 ? "bk-loans" : undefined}>
            {b.loans.map((l) => {
              // 新界面：按钮写着这一笔实际会还的数——柜台金额超过本金时封顶为本金（内核不收超过本金的还款）；
              // 还完这一笔就清了（金额不小于本金）时写“还清 n”，否则写“还 n”。旧界面照旧用柜台金额、按钮只写“还款”
              const repay = v2 && amount > l.principal ? l.principal : amount;
              const clears = v2 && amount >= l.principal;
              return (
                <li key={l.id}>
                  #{l.id} · {money(l.principal)} · {t("unitPct", { v: pct(l.rate_bp) })} · {t("bkDue", { day: l.due_day })}
                  {l.overdue && <em className="tag hot">{t("bkOverdue")}</em>}
                  <ActionButton onClick={() => submit({ Repay: { owner: "player", loan: l.id, amount: repay } })}>
                    {v2 ? t(clears ? "v2.port.bkRepayAll" : "v2.port.bkRepay", { v: money(repay) }) : t("bkRepay")}
                  </ActionButton>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}

function ExchangeLink({ port }: { port: PortView }) {
  const statics = useGame((s) => s.statics);
  const setTab = useGame((s) => s.setTab);
  const v2 = useIsV2();
  if (!statics) return null;
  if (port.exchange === null)
    return (
      <EmptyState
        text={t("v2.port.exNone")}
        hint={t("v2.port.exNoneHint")}
        action={{ label: t("v2.port.exGo"), onClick: () => setTab("futures") }}
        v1={<Empty text={t("none")} />}
      />
    );
  return (
    <div className={v2 ? "ex-link" : undefined}>
      <p>{exchangeById(statics, port.exchange)?.name}</p>
      <button className="btn primary" onClick={() => setTab("futures")}>
        {/* 新界面：按钮写清动作（“打开期货”），v1 照旧是窗口名 */}
        {v2 ? t("v2.port.exGo") : t("tab.futures")}
      </button>
    </div>
  );
}

function Invest({ port }: { port: PortView }) {
  const statics = useGame((s) => s.statics);
  const submit = useGame((s) => s.submit);
  const cash = useGame((s) => s.overview?.cash ?? 0);
  const [amount, setAmount] = useState(statics?.rules.invest_min ?? 1000);
  const v2 = useIsV2();
  if (!statics) return null;
  const v = port.invest;
  const min = statics.rules.invest_min;
  const invest = () => submit({ InvestPort: { owner: "player", loc: port.loc, amount } });
  return (
    <div>
      {/* 商馆（T01）：等级阶梯与一键升级排在最上面；下面照旧是港口的数字与自己定金额的柜台。两种界面同一份内容 */}
      {/* E02：发展度卡（阶段、进度、上月为什么涨、再投会怎样）排在最上面；旧后端与规则关着的世界没有 */}
      {v.growth && <DevGrowthCard growth={v.growth} yardSteps={v.house?.yard_steps} />}
      {v.house && v.house.max_level > 0 && (
        <HouseLadder
          invest={v}
          house={v.house}
          cash={cash}
          min={min}
          onInvest={(n) => void submit({ InvestPort: { owner: "player", loc: port.loc, amount: n } })}
          shipName={(id) => (statics.ships[id] ? nameOf(statics.ships[id]) : `#${id}`)}
        />
      )}
      {v.house && v.house.max_level > 0 && <h3 className="house-custom-title">{tz("house.custom")}</h3>}
      <dl className="kv">
        <dt>{t("ivDevelopment")}</dt>
        <dd data-testid="iv-development">{v.growth ? devLabel(v.growth) : v.development}</dd>
        <dt>{t("ivMine")}</dt>
        <dd>{money(v.mine)}</dd>
        <dt>{t("ivShare")}</dt>
        <dd>{t("unitPct", { v: pct(v.share_bp) })}</dd>
        <dt>{t("ivAlly")}</dt>
        <dd>{v.ally_is_me ? t("ivAllyMe") : (v.ally ?? t("none"))}</dd>
      </dl>
      {v2 ? (
        // 新界面：最低额、金额与快捷金额、写清金额的“投资”放在一张柜台里（命令与 v1 相同）
        <div className="iv-desk">
          <p className="sub">{t("ivMin", { min: num(min) })}</p>
          <NumInput label={t("bkAmount")} value={amount} min={min} onChange={setAmount} />
          <QuickAmounts className="iv-quick" values={[min, min * 5, min * 10]} value={amount} onPick={setAmount} />
          {v.growth && <InvestPreviewLine growth={v.growth} amount={amount} />}
          <ActionButton kind="primary" onClick={invest}>
            {t("v2.port.ivInvest", { v: money(amount) })}
          </ActionButton>
        </div>
      ) : (
        <>
          <p className="sub">{t("ivMin", { min })}</p>
          <NumInput label={t("bkAmount")} value={amount} min={min} onChange={setAmount} />
          {v.growth && <InvestPreviewLine growth={v.growth} amount={amount} />}
          <ActionButton onClick={invest}>{t("ivInvest")}</ActionButton>
        </>
      )}
      <TownSection people={port.people} />
    </div>
  );
}

function Office({ port }: { port: PortView }) {
  const statics = useGame((s) => s.statics);
  const submit = useGame((s) => s.submit);
  const v2 = useIsV2();
  if (!statics) return null;
  const o = port.office;
  const f = statics.factions[o.faction];
  return (
    <div>
      {/* 这个势力的君主（外交一页的小头像位） */}
      {f && <CastRow who={rulerOf(statics, o.faction)} testId="office-ruler" size={56} className="of-ruler" />}
      <dl className="kv">
        <dt>{t("ofReputation")}</dt>
        <dd>{o.reputation}</dd>
        <dt>{t("ofLicense")}</dt>
        <dd>
          {o.license ? (
            t("ofHave")
          ) : (
            <ActionButton onClick={() => submit({ BuyLicense: { owner: "player", faction: o.faction } })}>
              {t("ofBuyLicense", { price: v2 ? num(f?.license_price ?? 0) : (f?.license_price ?? 0) })}
            </ActionButton>
          )}
        </dd>
        <dt>{t("ofMarque")}</dt>
        <dd>
          {o.marque ? (
            t("ofHave")
          ) : (
            <ActionButton onClick={() => submit({ BuyMarque: { owner: "player", faction: o.faction } })}>
              {t("ofBuyMarque", { price: v2 ? num(f?.marque_price ?? 0) : (f?.marque_price ?? 0) })}
            </ActionButton>
          )}
        </dd>
      </dl>
      {o.at_war && <p className={v2 ? "warn of-war" : "warn"}>{t("ofAtWar")}</p>}
      <Section title={t("ofRelations")}>
        <ul className={v2 ? "of-relations" : undefined}>
          {o.relations.map((r) => (
            <li key={r.other} className="of-relation">
              {/* 对方君主的小头像（装饰） */}
              <RulerFace statics={statics} faction={r.other} />
              {t("labelValue", {
                label: statics.factions[r.other]?.name ?? "",
                value: t("paren", { text: tk(`status.${r.status}`), note: r.value }),
              })}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
