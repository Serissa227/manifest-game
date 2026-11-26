// 设施分页里的“卡片”：酒馆的航海士人物卡、造船厂的在售船型、商会的委托书。
// FE1：委托书接上 T04 的新字段——小单 / 大单、货在哪儿买得到（看不见的港后端隐藏）、距离与来回天数、声望、熟客、加急，
// 另有一行“这单接不接得下”：旗舰队的空舱、按基准价估的进货钱对现金、期限对来回天数，够的绿、不够的红。
// 人物卡与船型卡的名字是双行名字（EXPANSION.md §12.3：中文界面下方一小行英文原名）。
import type { ReactNode } from "react";
import { GoodGlyph } from "../panels/GoodGlyph";
import { mateAssetId } from "../../art/portraitCast";
import { drawPortrait, mateLook } from "../../art/portraits";
import { memo } from "../../art/render";
import { drawShipByKey, shipArtKey } from "../../art/ships";
import { Sprite } from "../../art/Sprite";
import { money, num, t, tk } from "../../i18n";
import { tz } from "../../i18n/zhOnly";
import { locById } from "../../ipc/byId";
import type { ContractView, MateView, ShipTypeView, StaticView } from "../../ipc/types";
import { geniusLine } from "../../forecast/labels";
import { flagship, useGame } from "../../store/game";
import { BiName } from "../BiName";
import { PortraitArt } from "../portrait/PortraitArt";

/** 一条能力条：名称、条、数值（0–100）。 */
export function StatBar({
  label,
  value,
  max = 100,
  tone,
  text,
}: {
  label: string;
  value: number;
  max?: number;
  tone?: string;
  /** 数值处显示的文字（缺省为 value） */
  text?: string;
}) {
  const w = Math.max(0, Math.min(100, Math.round((value / Math.max(1, max)) * 100)));
  return (
    <div className={tone ? `stat stat-${tone}` : "stat"}>
      <span className="stat-name">{label}</span>
      <span className="stat-bar" aria-hidden="true">
        <i style={{ width: `${w}%` }} />
      </span>
      <span className="stat-val">{text ?? value}</span>
    </div>
  );
}

/** 酒馆里可招募的航海士：头像 + 等级 + 四项能力条 + 月薪忠诚 + 小传 + 招募按钮。 */
export function MateCard({ mate, children }: { mate: MateView; children?: ReactNode }) {
  const statics = useGame((s) => s.statics);
  // 128 像素的时代肖像（mates.toml 的 key 对应 mate-<key>）；缺图时回退到放大两倍的程序头像
  // （按航海士所在港口的文化打扮，小传写明出身时以小传为准）
  return (
    <div className="card mate-card" data-testid={`tavern-mate-${mate.id}`}>
      <div className="mate-portrait">
        <PortraitArt asset={mateAssetId(mate)} fallback={() => drawPortrait(mateLook(statics, mate))} size={128} />
        <span className="mate-lv" aria-hidden="true">
          {t("portMateLevel", { level: mate.level })}
        </span>
      </div>
      <div className="mate-info">
        <div className="mate-head">
          <BiName as="strong" zh={mate.name} en={mate.name_en} testId={`mate-name-${mate.id}`} />
          <span className="sub">{t("mtLevel", { level: mate.level, xp: mate.xp })}</span>
        </div>
        <div className="stats">
          <StatBar label={t("portMateNav")} value={mate.navigation} tone="nav" />
          <StatBar label={t("portMateTrade")} value={mate.trade} tone="trade" />
          <StatBar label={t("portMateCombat")} value={mate.combat} tone="combat" />
          <StatBar label={t("portMateMgmt")} value={mate.management} tone="mgmt" />
        </div>
        <p className="sub">{t("mtSalary", { salary: mate.salary, loyalty: mate.loyalty })}</p>
        <p className="mate-bio">{mate.bio}</p>
        {geniusLine(mate.methods) && <p className="mate-genius">{geniusLine(mate.methods)}</p>}
        {children}
      </div>
    </div>
  );
}

function shipArt(ship: ShipTypeView): ReturnType<typeof drawShipByKey> {
  // 按船型 key 画（寰宇·十六世纪的新船型各有画法）；旧后端没有 key 时按经典世界的顺序取
  const key = ship.key || shipArtKey(null, ship.id);
  return memo(`port-offer-ship|${key}|${ship.sail}`, () => drawShipByKey(key, ship.sail, { size: "large" }).trimmed());
}

/** 造船厂的在售船型：大图 + 名称帆装 + 性能条（相对全部可出售船型的最大值；独有船型不算）+ 价格 + 购买按钮。 */
export function ShipOffer({ ship, statics, children }: { ship: ShipTypeView; statics: StaticView; children?: ReactNode }) {
  const art = shipArt(ship);
  const max = (f: (s: ShipTypeView) => number) => Math.max(1, ...statics.ships.filter((s) => !s.unique).map(f));
  return (
    <div className="card ship-card" data-testid={`ship-offer-${ship.id}`}>
      <div className="ship-art">
        <Sprite px={art} scale={art.w > 110 ? 1 : 2} />
      </div>
      <div className="ship-info">
        <div className="ship-head">
          <BiName as="strong" zh={ship.name} en={ship.name_en} />
          <span className="tag">{tk(`sail.${ship.sail}`)}</span>
          <span className="ship-price">{money(ship.price)}</span>
        </div>
        <div className="stats">
          <StatBar label={t("syCapacity")} value={ship.capacity} max={max((s) => s.capacity)} tone="trade" />
          <StatBar
            label={t("syCrew")}
            value={ship.crew_max}
            max={max((s) => s.crew_max)}
            tone="mgmt"
            text={t("portShipCrew", { min: ship.crew_min, max: ship.crew_max })}
          />
          <StatBar label={t("syGuns")} value={ship.guns} max={max((s) => s.guns)} tone="combat" />
          <StatBar label={t("syDurability")} value={ship.durability} max={max((s) => s.durability)} tone="nav" />
        </div>
        <div className="row">{children}</div>
      </div>
    </div>
  );
}

/** 委托书的 T04 部分：货的出处与来回天数、声望 / 熟客 / 加急，和“接不接得下”的一行（只对可承接与自己接下的）。 */
function ContractMore({ contract: c, statics, left, faction }: { contract: ContractView; statics: StaticView; left: number; faction: string }) {
  const fleet = useGame((s) => {
    const o = s.overview;
    // 停在交货港或起运地的舰队优先，其次旗舰队
    return o?.fleets.find((f) => f.docked !== null && (f.docked === c.to || f.docked === c.source)) ?? flagship(o) ?? null;
  });
  const cash = useGame((s) => s.overview?.cash ?? 0);
  const cells = c.cells ?? 0;
  const days = c.need_days ?? 0;
  const urgent = Math.max(0, Math.round(((c.urgency_bp ?? 10_000) - 10_000) / 100));
  const source = c.source != null ? (locById(statics, c.source)?.name ?? null) : null;
  const active = c.status === "open" || c.status === "mine";
  const carried = fleet?.cargo.find((x) => x.good === c.good)?.qty ?? 0;
  const toLoad = Math.max(0, c.qty - (c.status === "mine" ? carried : 0));
  const free = fleet ? Math.max(0, fleet.capacity - fleet.used) : 0;
  const cost = toLoad * (statics.goods[c.good]?.base_price ?? 0);
  const loaded = c.status === "mine" && toLoad === 0;
  const fits: { key: string; ok: boolean; text: string; tip: string }[] = !active
    ? []
    : loaded
      ? // 自己接下、货已装齐：只剩送到
        [{ key: "loaded", ok: true, text: tz("ct.fit.loaded", { have: num(carried), qty: num(c.qty) }), tip: tz("ct.fit.holdHint") }]
      : [
        fleet
          ? { key: "hold", ok: free >= toLoad, text: tz("ct.fit.hold", { free: num(free), qty: num(toLoad) }), tip: tz("ct.fit.holdHint") }
          : { key: "hold", ok: false, text: tz("ct.fit.noFleet"), tip: tz("ct.fit.holdHint") },
        { key: "cash", ok: cash >= cost, text: tz("ct.fit.cash", { cost: money(cost), cash: money(cash) }), tip: tz("ct.fit.cashHint") },
        ...(days > 0 ? [{ key: "time", ok: left >= days, text: tz("ct.fit.time", { left: Math.max(0, left), need: days }), tip: tz("ct.fit.timeHint") }] : []),
      ];
  return (
    <>
      {cells > 0 && (
        <p className="contract-route" data-testid={`contract-${c.id}-route`}>
          {source ? tz("ct.route", { source, cells, days }) : tz("ct.routeHidden", { cells, days })}
        </p>
      )}
      <p className="contract-extra" data-testid={`contract-${c.id}-extra`}>
        <span title={tz("ct.repHint", { faction })}>
          {tz("ct.rep")} <b>{tz("ct.repValue", { n: c.rep ?? 0 })}</b>
        </span>
        <span title={tz("ct.passHint", { n: c.pass_days ?? 0, faction })}>
          {tz("ct.pass")} <b>{tz("ct.passValue", { n: c.pass_days ?? 0 })}</b>
        </span>
        <span title={tz("ct.urgentHint")} className={urgent > 0 ? "contract-urgent" : undefined}>
          {urgent > 0 ? (
            <>
              {tz("ct.urgent")} <b>{tz("ct.urgentValue", { n: urgent })}</b>
            </>
          ) : (
            tz("ct.urgentNone")
          )}
        </span>
      </p>
      {fits.length > 0 && (
        <ul className="contract-fit" data-testid={`contract-${c.id}-fit`}>
          {fits.map((f) => (
            <li key={f.key} className={f.ok ? "is-ok" : "is-short"} title={f.tip}>
              <span aria-hidden>{f.ok ? "✓" : "✗"}</span> {f.text}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** 委托书上的交货港：看得见时写港名；没望见过（to 为 null）时只写方向。 */
function contractDest(statics: StaticView, c: Pick<ContractView, "to" | "direction">): string {
  if (c.to !== null) return locById(statics, c.to)?.name ?? "";
  return c.direction ? t("portContractDirection", { dir: c.direction }) : "";
}

/** 商会的委托书：编号、状态、货物与目的地、报酬与违约金、期限、发布方印章与操作按钮。 */
export function ContractCard({
  contract: c,
  statics,
  today,
  children,
}: {
  contract: ContractView;
  statics: StaticView;
  today: number;
  children?: ReactNode;
}) {
  const good = statics.goods[c.good];
  const issuer = statics.factions[c.issuer];
  const left = c.deadline - today;
  const v2 = c.size === "small" || c.size === "regular";
  return (
    <article className={`contract-card status-${c.status}`} data-testid={`contract-${c.id}`} data-size={c.size}>
      <header className="contract-head">
        <span className="contract-title">{t("portContractTitle", { id: c.id })}</span>
        {v2 && c.size && (
          <span className={`tag contract-size contract-size--${c.size}`} title={tz(`ct.sizeHint.${c.size}`)} data-testid={`contract-${c.id}-size`}>
            {tz(`ct.size.${c.size}`)}
          </span>
        )}
        <span className={c.status === "open" ? "tag" : "tag hot"}>{tk(`contract.${c.status}`)}</span>
      </header>
      <div className="contract-body">
        <GoodGlyph goodKey={good?.key ?? String(c.good)} category={good?.category} scale={2} className="contract-good" />
        <p>
          {t("portContractBody", {
            good: good?.name ?? String(c.good),
            qty: c.qty,
            day: c.deadline,
            to: contractDest(statics, c),
          })}
        </p>
      </div>
      <dl className="contract-terms">
        <dt>{t("gdReward")}</dt>
        <dd className="reward">{money(c.reward)}</dd>
        <dt>{t("gdPenalty")}</dt>
        <dd>{money(c.penalty)}</dd>
        <dt>{t("gdDeadline")}</dt>
        <dd>
          {t("paren", {
            text: t("dayN", { day: c.deadline }),
            note: left >= 0 ? t("portContractDaysLeft", { days: left }) : t("portContractOverdue"),
          })}
        </dd>
      </dl>
      {v2 && <ContractMore contract={c} statics={statics} left={left} faction={issuer?.name ?? ""} />}
      <footer className="contract-foot">
        <span className="contract-issuer">
          {t("portContractIssuer", { issuer: issuer?.name ?? "" })}
          {c.ai && t("gdAi")}
        </span>
        <span className="contract-seal" style={{ borderColor: issuer?.color, color: issuer?.color }} aria-hidden="true">
          {(issuer?.name ?? t("portContractSeal")).slice(0, 2)}
        </span>
        <span className="contract-actions">{children}</span>
      </footer>
    </article>
  );
}
