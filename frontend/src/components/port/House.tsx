// 商馆（T01 阶梯 + T02 回报、风险与目标）：港口投资页。行会只把好货卖给熟客和在本地设了商馆的人——
// 你自己投在这座港口的钱越多，商馆越体面：每一级给商誉加成（买得到更高一档的货）、交易税的折扣与免费仓位，
// 投资同时抬高港口的发展度（市场更深：每天出的货、吃得下的货更多）。
// T02 重做成一屏看全：上面一行是现在的商馆、商誉与买得到哪一档；左栏是等级阶梯、到下一级还差多少、
// 一键“升到下一级”（就是“补到下一级”那一档）与几档常用金额；右栏是每月分红（上月分到多少、预计年收益率、被上限压住时的提示）、
// 遭劫的风险与上次损失、船厂的两个发展度台阶、本港投资者的前五名。没有这些字段的旧后端与规则关闭的世界只显示 T01 的部分。
// 数字全部来自内核（PortView.invest.house），这里只排版；提交的仍是 InvestPort 命令。
// E02：有 InvestView.growth（发展度 1–9999）时，市场深度的说明换成新尺度、船厂台阶带上阶段名、回落按“每月回落高出部分的若干分之一”说；
// 没有 growth 的旧后端与规则关着的世界照旧（1–100、“每 N 个月掉 1 点”）。
import { decimal, money, num, pct } from "../../i18n";
import { tz } from "../../i18n/zhOnly";
import type { DevGrowthView, DividendView, HouseView, InvestView, InvestorView, SackRiskView, YardStepView } from "../../ipc/types";
import { ActionButton } from "../common";
import { rankKey } from "../panels/trade";
import { stageName, stageOf, timesText } from "./devScale";

/** 货档的名字（粗货、行货、细货、珍货）。 */
function rankName(rank: number): string {
  return tz(rankKey(rank));
}

/** 交易税乘数（万分之一）写成“−15%”；不减时写“不减”。 */
function taxText(bp: number): string {
  return bp >= 10_000 ? tz("house.row.taxNone") : tz("house.row.tax", { pct: Math.round((10_000 - bp) / 100) });
}

/** 深度系数（万分之一）写成两位小数的倍数。 */
function times(bp: number): string {
  return decimal(Math.round(bp / 100) / 100);
}

/** 万分之一写成一位小数的百分数。 */
function pctText(bp: number): string {
  return decimal(Math.round(bp / 10) / 10);
}

export interface HouseLadderProps {
  invest: InvestView;
  house: HouseView;
  cash: number;
  /** 最低投资额（内核的 invest.min_amount）：升级差额比它小时按它投 */
  min: number;
  onInvest: (amount: number) => void;
  /** 船型的名字（船厂台阶用；缺省写编号） */
  shipName?: (id: number) => string;
}

/** 几档常用金额：最低额、5 倍、20 倍（与“升到下一级”那一档重复的不再列）。 */
function quickAmounts(min: number, upgrade: number | null): number[] {
  return [min, min * 5, min * 20].filter((v, i, all) => v > 0 && v !== upgrade && all.indexOf(v) === i);
}

/** 商馆的等级阶梯、一键升级与快捷投资。 */
function Ladder({ house, cash, min, onInvest }: Pick<HouseLadderProps, "house" | "cash" | "min" | "onInvest">) {
  const next = house.levels.find((l) => l.level === house.level + 1);
  const gap = house.next_cost ?? 0;
  // 差额不到最低投资额时按最低额投（内核不收更小的投资）
  const pay = next ? Math.max(min, gap) : 0;
  const short = Math.max(0, pay - cash);
  const quick = quickAmounts(min, next ? pay : null);
  return (
    <section className="house-card house-ladder-card" aria-label={tz("house.card.upgrade")}>
      <h4 className="house-card-title">{tz("house.card.upgrade")}</h4>
      <div role="table" className="house-ladder" aria-label={tz("house.title")}>
        <div role="row" className="house-head">
          <span role="columnheader">{tz("house.col.level")}</span>
          <span role="columnheader">{tz("house.col.cost")}</span>
          <span role="columnheader">{tz("house.col.goodwill")}</span>
          <span role="columnheader">{tz("house.col.buys")}</span>
          <span role="columnheader">{tz("house.col.tax")}</span>
          <span role="columnheader">{tz("house.col.storage")}</span>
        </div>
        {house.levels
          .filter((l) => l.level > 0)
          .map((l) => {
            const state = l.level === house.level ? "now" : l.level < house.level ? "done" : l.level === house.level + 1 ? "next" : "far";
            return (
              <div role="row" key={l.level} className={`house-row is-${state}`} data-testid={`house-row-${l.level}`}>
                <span role="cell" className="house-c-level">
                  {tz("house.row.level", { n: l.level })}
                  {state !== "far" && <em className="tag">{tz(`house.row.${state}`)}</em>}
                </span>
                <span role="cell" className="house-c-cost">
                  {num(l.cost)}
                </span>
                <span role="cell">{tz("house.row.goodwill", { n: l.goodwill })}</span>
                <span role="cell">{rankName(l.top_rank)}</span>
                <span role="cell">{taxText(l.tax_bp)}</span>
                <span role="cell">{l.storage > 0 ? num(l.storage) : tz("house.row.storageNone")}</span>
              </div>
            );
          })}
      </div>
      {next ? (
        <div className="house-next">
          <p className="house-gap" data-testid="house-gap">
            {tz("house.next", { n: next.level, cost: money(gap) })}
          </p>
          <ActionButton kind="primary" disabled={short > 0} onClick={() => onInvest(pay)}>
            {tz("house.upgrade", { n: next.level, cost: money(pay) })}
          </ActionButton>
          {house.agency?.orders_next != null && (
            <p className="sub house-agency-next" data-testid="house-agency-next">
              {house.agency.industry != null && house.agency.industry_next != null
                ? tz("house.agency.nextBoth", {
                    o: house.agency.orders,
                    on: house.agency.orders_next,
                    i: house.agency.industry,
                    in: house.agency.industry_next,
                  })
                : tz("house.agency.nextOrders", { o: house.agency.orders, on: house.agency.orders_next })}
            </p>
          )}
          {short > 0 && (
            <p className="hint house-short" data-testid="house-short">
              {tz("house.upgradeShort", { short: money(short) })}
            </p>
          )}
        </div>
      ) : (
        <p className="sub house-max" data-testid="house-max">
          {tz("house.max")}
        </p>
      )}
      {quick.length > 0 && (
        <div className="house-quick" data-testid="house-quick" title={tz("house.quickHint")}>
          <span className="house-quick-label">{tz("house.quick")}</span>
          {quick.map((v) => (
            <ActionButton key={v} disabled={v > cash} onClick={() => onInvest(v)}>
              {tz("house.quickItem", { cost: num(v) })}
            </ActionButton>
          ))}
        </div>
      )}
    </section>
  );
}

/** 回报：每月分红。 */
function Dividend({ d, depthBp }: { d: DividendView; depthBp: number }) {
  return (
    <section
      className="house-card house-div"
      data-testid="house-dividend"
      aria-label={tz("house.card.return")}
      title={tz("house.div.rule", { pct: d.hinterland_pct })}
    >
      <h4 className="house-card-title">{tz("house.card.return")}</h4>
      <dl className="house-facts">
        <dt>{tz("house.div.last")}</dt>
        <dd data-testid="house-div-last">
          {d.last > 0 ? tz("house.div.lastLine", { money: money(d.last), pct: pctText(d.last_yield_bp ?? 0) }) : tz("house.div.none")}
        </dd>
        <dt>{tz("house.div.yield")}</dt>
        <dd data-testid="house-div-yield">{tz("house.div.yieldLine", { pct: pctText(d.yield_bp), annual: d.annual_pct, depth: times(depthBp) })}</dd>
        <dt>{tz("house.div.next")}</dt>
        <dd>{tz("house.div.nextLine", { money: money(d.next_due) })}</dd>
      </dl>
      {d.cap !== "none" && (
        <p className="hint house-div-cap" data-testid="house-div-cap">
          {tz(`house.div.cap.${d.cap}`, { pct: d.hinterland_pct, due: money(d.pool_due), paid: money(d.pool_paid) })}
        </p>
      )}
    </section>
  );
}

/** 风险：港口遭劫。 */
function Risk({ r }: { r: SackRiskView }) {
  return (
    <section className="house-card house-risk" data-testid="house-risk" aria-label={tz("house.card.risk")}>
      <h4 className="house-card-title">{tz("house.card.risk")}</h4>
      <p className="house-risk-rule">{tz("house.risk.rule", { pct: r.loss_pct, level: r.house_level, house: r.house_pct })}</p>
      <p data-testid="house-risk-exposure">{r.exposure > 0 ? tz("house.risk.exposure", { money: money(r.exposure) }) : tz("house.risk.exposureNone")}</p>
      {r.last_day != null ? (
        <p className="warn house-risk-last" data-testid="house-risk-last">
          {tz("house.risk.last", { day: r.last_day, mine: money(r.last_loss), total: money(r.last_total) })}
        </p>
      ) : (
        <p className="sub">{tz("house.risk.never")}</p>
      )}
    </section>
  );
}

/** 目标：船厂的发展度台阶。growth 缺省时是旧尺度（不写阶段名）。 */
function YardSteps({
  steps,
  dev,
  months,
  growth,
  shipName,
}: {
  steps: YardStepView[];
  dev: number;
  months: number;
  growth?: DevGrowthView | null;
  shipName: (id: number) => string;
}) {
  const title = growth
    ? tz("house.yard.nowGrowth", { stage: stageName(growth.stage), dev: growth.value, pct: timesText(growth.decay_bp * 100) })
    : tz("house.yard.now", { dev, months });
  return (
    <section className="house-card house-yard" data-testid="house-yard" aria-label={tz("house.card.yard")} title={title}>
      <h4 className="house-card-title">{tz("house.card.yard")}</h4>
      <ul className="house-steps">
        {steps.map((s) => (
          <li key={s.development} className={s.reached ? "is-reached" : undefined} data-testid={`house-yard-${s.development}`}>
            <strong>
              {growth
                ? tz("house.yard.stepStage", { dev: s.development, stage: stageName(stageOf(s.development)) })
                : tz("house.yard.step", { dev: s.development })}
            </strong>{" "}
            <em className="tag">{s.reached ? tz("house.yard.reached") : tz("house.yard.short", { n: s.development - dev })}</em>{" "}
            {s.ships.length > 0 && <span>{tz("house.yard.ships", { list: s.ships.map(shipName).join("、") })}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 本港投资者的前五名。 */
function Investors({ list }: { list: InvestorView[] }) {
  return (
    <section className="house-card house-investors" data-testid="house-investors" aria-label={tz("house.card.investors")}>
      <h4 className="house-card-title">{tz("house.card.investors")}</h4>
      <ol className="house-inv-list">
        {list.map((v, i) => (
          <li key={`${v.name}-${i}`} className={v.me ? "is-me" : undefined}>
            <span className="house-inv-rank">{tz("house.inv.rank", { n: i + 1 })}</span>
            <span className="house-inv-name">{v.me ? tz("house.inv.me") : v.name}</span>
            <span className="house-inv-amount">{num(v.amount)}</span>
            <span className="house-inv-level">{v.level > 0 ? tz("house.inv.level", { n: v.level }) : tz("house.inv.levelNone")}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** 商馆：一屏看全的投资页（T01 阶梯 + T02 回报、风险、目标、排名）。 */
export function HouseLadder({ invest, house, cash, min, onInvest, shipName }: HouseLadderProps) {
  const all = house.top_rank >= house.rank_goodwill.length - 1;
  const bonus = house.levels.find((l) => l.level === house.level)?.goodwill ?? 0;
  const name = shipName ?? ((id: number) => `#${id}`);
  // E02：市场深度的说明（新尺度不再提“每 N 个月掉 1 点”，回落写在发展度卡上）
  const depthHint = invest.growth ? tz("dev.depthHint") : tz("house.depthHint", { months: house.decay_months });
  const side = !!house.dividend || !!house.risk || (house.yard_steps?.length ?? 0) > 0 || (house.investors?.length ?? 0) > 0;
  // 市场深度与同盟港：没有右栏时照旧排在阶梯下面；有右栏时收进右栏末尾的一张小卡
  const more = (
    <dl className={side ? "house-facts house-more" : "kv house-more"}>
      <dt title={depthHint}>{tz("house.depth")}</dt>
      <dd data-testid="house-depth" title={depthHint}>
        {house.depth_next_bp != null && house.depth_next_bp !== house.depth_bp
          ? tz("house.depthNext", { now: times(house.depth_bp), next: times(house.depth_next_bp) })
          : tz("house.depthLine", { now: times(house.depth_bp) })}
      </dd>
      {house.agency && (
        <>
          <dt>{tz("house.agency.orders")}</dt>
          <dd data-testid="house-agency-orders">
            {house.agency.orders_next != null
              ? tz("house.agency.ordersNext", { n: house.agency.orders, next: house.agency.orders_next })
              : tz("house.agency.ordersLine", { n: house.agency.orders })}
          </dd>
          {house.agency.industry != null && (
            <>
              <dt>{tz("house.agency.industry")}</dt>
              <dd data-testid="house-agency-industry">
                {house.agency.industry_next != null
                  ? tz("house.agency.industryNext", { n: house.agency.industry, used: house.agency.industries, next: house.agency.industry_next })
                  : tz("house.agency.industryLine", { n: house.agency.industry, used: house.agency.industries })}
                {(house.agency.stage_bonus ?? 0) > 0 && tz("house.agency.industryStage", { n: house.agency.stage_bonus ?? 0 })}
              </dd>
            </>
          )}
        </>
      )}
      <dt>{tz("house.ally")}</dt>
      <dd data-testid="house-ally">
        {invest.ally_is_me ? (
          tz("house.allyMine")
        ) : (
          <>
            {tz("house.allyRule", { share: Math.round(house.ally_share_bp / 100), level: house.ally_house })}{" "}
            {tz("house.allyNow", { share: pct(invest.share_bp, 0), level: house.level })}
            {invest.ally && <> {tz("house.allyOther", { name: invest.ally })}</>}
          </>
        )}
      </dd>
    </dl>
  );
  return (
    <div className={side ? "house house-t02" : "house"} data-testid="house">
      {/* T02 一屏看全：介绍收进标题提示，现在的商馆、商誉、买得到哪一档排成一行 */}
      {!side && <p className="house-intro sub">{tz("house.intro")}</p>}
      <dl className={side ? "house-facts house-now-row" : "kv house-now"} title={side ? tz("house.intro") : undefined}>
        <dt>{tz("house.title")}</dt>
        <dd data-testid="house-level">{house.level > 0 ? tz("house.level", { n: house.level }) : tz("house.none")}</dd>
        <dt>{tz("house.goodwill")}</dt>
        <dd data-testid="house-goodwill">{tz("house.goodwillLine", { goodwill: house.goodwill, rep: house.reputation, house: bonus })}</dd>
        <dt>{tz("house.canBuy")}</dt>
        <dd data-testid="house-top">{all ? tz("house.canBuyAll") : tz("house.canBuyLine", { top: rankName(house.top_rank) })}</dd>
      </dl>
      <p className="sub house-ranks">
        {tz("house.ranks", {
          list: house.rank_goodwill
            .map((need, r) => ({ need, r }))
            .filter((x) => x.r > 0)
            .map((x) => tz("house.rankItem", { name: rankName(x.r), need: x.need }))
            .join("、"),
        })}
      </p>
      {house.grace_left != null && (
        <p className="hint house-grace" data-testid="house-grace">
          {tz("mk.rank.grace", { n: house.grace_left })}
        </p>
      )}
      <div className="house-grid">
        <div className="house-col">
          <Ladder house={house} cash={cash} min={min} onInvest={onInvest} />
          {!side && more}
          {!side && <p className="sub house-depth-hint">{depthHint}</p>}
        </div>
        {side && (
          <div className="house-col house-side">
            {house.dividend && <Dividend d={house.dividend} depthBp={house.depth_bp} />}
            {house.risk && <Risk r={house.risk} />}
            {house.yard_steps && house.yard_steps.length > 0 && (
              <YardSteps steps={house.yard_steps} dev={invest.development} months={house.decay_months} growth={invest.growth} shipName={name} />
            )}
            {house.investors && house.investors.length > 0 && <Investors list={house.investors} />}
            <section className="house-card house-port">{more}</section>
          </div>
        )}
      </div>
    </div>
  );
}