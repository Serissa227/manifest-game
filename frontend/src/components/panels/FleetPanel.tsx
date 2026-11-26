import { GoodGlyphOf } from "./GoodGlyph";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { captainAssetId, mateAssetId } from "../../art/portraitCast";
import { captainPortraitSpec, mateLook } from "../../art/portraits";
import { PixelStage, Sprite } from "../../art/Sprite";
import { isManualWorld } from "../../hooks/useNavigation";
import { useRequestSeq } from "../../hooks/useRequestSeq";
import { beginDeparture } from "../../hooks/useVoyage";
import { useView } from "../../hooks/useView";
import { decimal, listJoin, money, otherName, t } from "../../i18n";
import { tz } from "../../i18n/zhOnly";
import { api } from "../../ipc/api";
import { locById } from "../../ipc/byId";
import type { FleetView, SailPreview, StaticView } from "../../ipc/types";
import { currentFleet, flagship, useGame, useOverviewFields } from "../../store/game";
import { useIsV2 } from "../../ui/uiMode";
import { BiName } from "../BiName";
import { ActionButton, Select } from "../common";
import { CrewHireButtons, CrewShortNote } from "../crew/CrewHire";
import { crewPlan } from "../crew/crewPlan";
import { EmptyState, InlineError } from "../feedback";
import { goFacility } from "./goFacility";
import SupplyDesk from "./SupplyDesk";
import {
  buySupplies,
  dailyUse,
  fillNote,
  fillPlan,
  haveText,
  shortText,
  stockDays,
  supplyDays,
  supplyTarget,
  tripShort,
} from "./supplyKit";
import { LegendShipTag } from "./LegendShipTag";
import { roleName } from "./mateRoles";
import { Bar, Icon, PnSection, Portrait, Stat } from "./PanelKit";
import {
  fleetLooks,
  fleetScene,
  fleetSceneHeight,
  shipPx,
} from "./panelArt";

/** 舰队画面：天空、海面与这支舰队的船（会随浪起伏）。 */
function FleetScene({
  statics,
  fleet,
  season,
}: {
  statics: StaticView;
  fleet: FleetView;
  season: number;
}) {
  const looks = useMemo(() => fleetLooks(statics, fleet), [statics, fleet]);
  // 画面逻辑高度随最高的船变化，按 2 倍显示
  const height = fleetSceneHeight(looks);
  const draw = useCallback(
    (frame: number, layout: { width: number; height: number }) =>
      fleetScene(looks, season, layout.width, layout.height, frame),
    [looks, season],
  );
  const names = listJoin(
    fleet.ships.map((s) => s.legend?.name ?? statics.ships[s.kind]?.name ?? ""),
  );
  return (
    <div
      className="pn-fleet-view"
      data-testid={`fleet-ships-${fleet.id}`}
      style={{ height: height * 2 }}
    >
      <PixelStage
        height={height}
        minScale={2}
        minWidth={160}
        fps={6}
        draw={draw}
        className="pn-fleet-stage"
        label={t("pnFleetShips", { id: fleet.id, ships: names })}
      />
    </div>
  );
}

/** 新界面（v2）里最多几支舰队时选舰队用一排按钮（一次点击）；再多就照旧用下拉框。 */
const PICK_MAX = 6;

/**
 * 贴底的航行条最多占滚动区高度的几成；再高（横屏手机、矮的竖屏手机，或缺员时多了一段说明）就不再贴底，
 * 排在它本来的位置（窗口的最后一节，滚到底就是），免得上面的正文只剩一条缝。
 */
const SAIL_PIN_MAX = 0.4;

/**
 * 舰队：船长与舰长、船只与耐久、货舱与补给状态，航行规划（目的地、天数、建议补给）、补给与出航。
 * 新界面（v2）另有（docs/UI-REDESIGN.md 第 4、9 节；旧界面不变）：选舰队是一排按钮（只有一支时不出现）；货舱空时的空状态写明在哪儿、
 * 停在港口时一键“去交易所”（殖民点没有交易所，照在海上的说法）；航行一节贴在窗口下沿、排在“购买补给”后面（窗口的最后一节），
 * 船员不够时在“出航”旁就地写原因并给一键补到最低人数，招不到、钱不够时写明为什么（“出航”此时不可用并指向原因；船员一节不再重复
 * 同一句原因与同一个按钮）；滚动区的下内边距跟着贴底那一条的实际高度，键盘焦点不会落在它后面；那一条超过滚动区的四成时不再贴底。
 * 粮水（V01）：小仪表里粮水合成一项“粮 X / 水 Y，够 N 天”（细条是能撑的天数，30 天为满），下面一行写每天各用多少；
 * 航行条写“预计 N 天 · 粮水够 M 天”，撑不到这趟走完时下面一条写清还差多少粮、多少水，就地“补给到建议量”（钱或舱位不够时只补齐缺口），
 * 买完提示条里回一句（旧界面照旧两行粮、水与“每日各需”，数字照 V01 的字段算）。
 */
export default function FleetPanel() {
  const statics = useGame((s) => s.statics);
  // 按字段选取（P14a）：只取用到的顶层字段，没变就不重渲染
  const overview = useOverviewFields("fleets", "captain", "cash", "season");
  const selected = useGame((s) => s.selectedFleet);
  const selectFleet = useGame((s) => s.selectFleet);
  const submit = useGame((s) => s.submit);
  const v2 = useIsV2();
  const manual = isManualWorld(statics);
  const { data: mates } = useView("mates", () => api.mates());
  const fleet = currentFleet(overview, selected);
  const ports = statics?.locations.filter((l) => l.kind === "port") ?? [];
  const [dest, setDest] = useState<number>(ports[0]?.id ?? 0);
  const [preview, setPreview] = useState<SailPreview | null | undefined>(
    undefined,
  );
  const fleetId = fleet?.id;
  const crewWhyId = useId();
  const supplyWhyId = useId();
  // “补给到建议量 / 补齐缺口”正在办（同补员：连点两下也只发一次）
  const fillingRef = useRef(false);
  const [filling, setFilling] = useState(false);
  // “补到最低人数”正在办：按钮不可用，连点两下也只发一次 HireCrew（ref 挡住同一帧里的第二下，state 让按钮画成灰的）
  const hiringRef = useRef(false);
  const [hiring, setHiring] = useState(false);
  const hireToMin = useCallback(
    (fleetNo: number, count: number) => {
      if (hiringRef.current) return;
      hiringRef.current = true;
      setHiring(true);
      void submit({
        HireCrew: { owner: "player", fleet: fleetNo, count },
      }).finally(() => {
        hiringRef.current = false;
        setHiring(false);
      });
    },
    [submit],
  );
  // 新界面：贴底的航行条有多高，滚动区（.gw-body）的 scroll-padding-bottom 就留多少（styles/ui-v2/fleet.css 读 --fleet-sail-h）；
  // 它高过滚动区的四成（SAIL_PIN_MAX）时不再贴底（loose）。不贴底不改变它的高度，所以不会来回跳
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [loose, setLoose] = useState(false);
  useEffect(() => {
    if (!v2 || !root || typeof ResizeObserver === "undefined") return;
    const sail = root.querySelector<HTMLElement>(":scope > .pn-sail");
    const body = root.closest<HTMLElement>(".gw-body");
    if (!sail || !body) return;
    const set = () => {
      const h = Math.ceil(sail.getBoundingClientRect().height);
      body.style.setProperty("--fleet-sail-h", `${h}px`);
      setLoose(body.clientHeight > 0 && h > body.clientHeight * SAIL_PIN_MAX);
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(sail);
    // 窗口变矮、转屏时滚动区变了，也要重新判断
    ro.observe(body);
    return () => {
      ro.disconnect();
      body.style.removeProperty("--fleet-sail-h");
    };
  }, [v2, root]);

  // 换了一局 / 重连之后重新问（在路上的回复不再采用，P03）
  const reqSeq = useRequestSeq();
  useEffect(() => {
    if (fleetId === undefined) return;
    let alive = true;
    api
      .sailPreview(fleetId, dest)
      .then((p) => {
        if (alive) setPreview(p);
      })
      .catch(() => {
        if (alive) setPreview(null);
      });
    return () => {
      alive = false;
    };
  }, [fleetId, dest, reqSeq]);

  if (!statics || !overview) return null;
  if (!fleet) {
    // 新界面：说明怎么再有一支舰队，“下一步”去造船厂（所选的港口有造船厂就去那里，否则去第一处有造船厂的港口）
    const sel = useGame.getState().selectedLoc;
    const yard =
      sel !== null && locById(statics, sel)?.shipyard
        ? sel
        : (statics.locations.find((l) => l.shipyard)?.id ?? null);
    return (
      <EmptyState
        text={t("flNoFleet")}
        hint={t("v2.fleet.noFleetHint")}
        action={
          yard !== null
            ? {
                label: t("v2.fleet.toShipyard"),
                onClick: () => goFacility(yard, "shipyard"),
              }
            : undefined
        }
      />
    );
  }
  const locName = (id: number | null) =>
    id === null ? "" : (locById(statics, id)?.name ?? "");
  // 停在港口（不是锚泊在殖民点）：只有港口有交易所与酒馆（殖民点打开的是殖民点面板）
  const atPort =
    fleet.docked !== null && locById(statics, fleet.docked)?.kind === "port"
      ? fleet.docked
      : null;
  const need = (have: number) => Math.max(0, (preview?.supplies ?? 0) - have);
  const isFlagship = flagship(overview)?.id === fleet.id;
  const captain = overview.captain ?? null;
  const captainName = captain?.name.trim() || t("pnCaptainDefaultName");
  // 这支舰队的舰长；第九批的世界里任命到这支舰队的岗位（如“领航员”）也列在这里，写岗位名
  const skippers = (mates?.hired ?? []).filter(
    (m) =>
      (m.role.kind === "captain" ||
        (m.role.kind === "assigned" && m.role.scope === "fleet")) &&
      m.role.target === fleet.id,
  );
  // 补给可支撑的天数（V01：后端按船员人日算好的 supplies_days）；状态条以 30 天为满
  const days = (v: number) => stockDays(fleet, statics.rules, v);
  const supplyMax = Math.max(
    supplyTarget(fleet, 30),
    fleet.food,
    fleet.water,
    1,
  );
  const canLast = supplyDays(fleet);
  // 新界面：撑不到这趟走完（预估的缺口），就地补足（先补到建议量，钱或舱位不够时只补齐缺口）
  const supplyRisk = v2 && !!preview && tripShort(fleet, preview);
  const fill =
    supplyRisk && preview
      ? fillPlan(fleet, statics.rules, preview, overview.cash)
      : null;
  const fillNow = (buy: { food: number; water: number }, cost: number) => {
    if (fillingRef.current) return;
    fillingRef.current = true;
    setFilling(true);
    void buySupplies(fleet.id, buy, cost).finally(() => {
      fillingRef.current = false;
      setFilling(false);
    });
  };
  const looks = fleetLooks(statics, fleet);
  const fleetOptions = overview.fleets.map((f) => ({
    value: f.id,
    label: t("holder.fleet", { id: f.id }),
  }));
  const fleetSelect = (
    <Select
      label={t("flSelect")}
      value={fleet.id}
      options={fleetOptions}
      onChange={selectFleet}
    />
  );
  // 船员不够时“出航”旁的一键补员（与“船员”一节的按钮同一个人数）
  const crewUnit = statics.rules.crew_hire_cost;
  const crew = crewPlan(fleet, overview.cash, crewUnit);
  // 新界面：少于最低人数时内核会拒绝 SetSail（CrewBelowMinimum，在港在海上都一样），“出航”不可用、原因在旁边
  const crewBlocked = v2 && fleet.crew < fleet.crew_min;
  // 新界面：“出航”旁边写着的原因（做不了的船员不足在前，有风险的粮水不够在后）
  const sailDescribedBy =
    [crewBlocked ? crewWhyId : null, supplyRisk ? supplyWhyId : null]
      .filter(Boolean)
      .join(" ") || undefined;
  // 一键补员补不到最低人数时写明为什么：在海上；这里招不到人手 / 现金不够（一个都招不了，或只招得到几个）
  const crewFix =
    fleet.docked === null
      ? t("v2.fleet.crewBlockedSea")
      : crew.limit === "hands"
        ? crew.toMin > 0
          ? t("crewFewHands", { n: crew.toMin })
          : t("crewNoHands")
        : crew.limit === "cash"
          ? crew.toMin > 0
            ? t("crewFewCash", { n: crew.toMin })
            : t("crewNoCash")
          : undefined;
  // 购买补给：新界面排在航行条前面（航行条是窗口的最后一节，贴底时、滚到底时都在最下面）；旧界面照旧在后面
  const supplies = fleet.docked !== null && (
    <PnSection title={t("flBuySupplies")} icon="food">
      {/* 粮水各一个数量加减，写明约花多少、占多少舱位、补完够几天（见 SupplyDesk.tsx） */}
      <SupplyDesk fleet={fleet} />
    </PnSection>
  );
  const picker = !v2 ? (
    fleetSelect
  ) : fleetOptions.length > PICK_MAX ? (
    fleetSelect
  ) : fleetOptions.length > 1 ? (
    <div
      className="pn-fleet-pick"
      role="group"
      aria-label={t("v2.fleet.pick")}
    >
      {fleetOptions.map((o) => (
        <button
          key={o.value}
          type="button"
          className="pn-fleet-pick-btn"
          aria-pressed={o.value === fleet.id}
          onClick={() => selectFleet(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  ) : null;
  return (
    <div data-testid="fleet-panel" className="pn pn-fleet" ref={setRoot}>
      {picker}
      <article
        className={
          isFlagship
            ? "pn-card pn-fleet-card flagship"
            : "pn-card pn-fleet-card"
        }
      >
        {isFlagship && (
          <header className="pn-captain" data-testid="fleet-captain">
            <Portrait
              spec={captainPortraitSpec(captain?.portrait ?? 0)}
              asset={captainAssetId(captain?.portrait ?? 0)}
              scale={2}
              label={t("pnCaptainPortrait", { name: captainName })}
              className="gold"
            />
            <div className="pn-captain-text">
              <span className="pn-ribbon">{t("pnFlagship")}</span>
              <strong className="pn-captain-title">
                {captain?.name.trim()
                  ? t("pnCaptainLead", { name: captain.name.trim() })
                  : t("pnCaptainLeadDefault")}
              </strong>
              {fleet.name ? (
                // 有名字的舰队：双行名字（EXPANSION.md §12.3）
                <BiName
                  className="pn-captain-sub"
                  zh={fleet.name}
                  en={fleet.name_en}
                />
              ) : (
                <span className="pn-captain-sub">
                  {t("pnFleetTitle", { id: fleet.id })}
                </span>
              )}
            </div>
          </header>
        )}
        {skippers.length > 0 && (
          <div className="pn-skippers">
            {skippers.map((m) => (
              <span key={m.id} className="pn-skipper" title={otherName(m)}>
                <Portrait
                  spec={mateLook(statics, m)}
                  asset={mateAssetId(m)}
                  label={t("pnMatePortrait", { name: m.name })}
                />
                <span>
                  {m.role.kind === "assigned"
                    ? t("cap.role.onFleet", {
                        role: roleName(
                          statics.captain?.roles,
                          m.role.role ?? 0,
                        ),
                        name: m.name,
                      })
                    : t("pnMateCaptain", { name: m.name })}
                </span>
              </span>
            ))}
          </div>
        )}
        <p className="pn-fleet-where">
          <Icon name={fleet.docked !== null ? "anchor" : "sail"} />
          {fleet.docked !== null
            ? t("flDocked", { loc: locName(fleet.docked) })
            : t("flAtSea", {
                dest: locName(fleet.dest),
                days: fleet.days_at_sea,
              })}
        </p>
        <FleetScene statics={statics} fleet={fleet} season={overview.season} />
        <ul className="pn-ships" aria-label={t("flShips")}>
          {fleet.ships.map((s, i) => {
            const type = statics.ships[s.kind];
            const look = looks[i];
            return (
              <li key={i} className="pn-ship">
                <span className="pn-ship-art">
                  <Sprite px={shipPx(look, "small")} scale={2} />
                </span>
                <span className="pn-ship-name">
                  {/* 船名：传说之船用它的名字（当前语言，带“传说之船”标签），有名字的船用船名，普通的船用船型名；双行名字 */}
                  {s.legend ? (
                    <BiName
                      zh={s.legend.name}
                      testId={`ship-legend-${s.legend.key}`}
                    />
                  ) : (
                    <BiName
                      zh={s.name ?? type?.name ?? ""}
                      en={s.name ? s.name_en : type?.name_en}
                    />
                  )}
                  {s.legend && <LegendShipTag />}
                  {look.damaged && (
                    <em className="pn-chip bad">{t("pnShipDamaged")}</em>
                  )}
                </span>
                <Bar value={s.durability} max={s.max_durability} tone="hp" />
                <span className="pn-ship-stats">
                  {/* 传说之船的名字占了船名一栏，船型写在数值前面 */}
                  {s.legend && type && (
                    <span className="pn-ship-hull">{type.name}</span>
                  )}
                  <span>
                    {t("pnShipDurability", {
                      v: s.durability,
                      max: s.max_durability,
                    })}
                  </span>
                  <span>
                    <Icon name="cannon" />
                    {t("pnShipGuns", { v: s.guns })}
                  </span>
                  <span>
                    <Icon name="cargo" />
                    {t("pnShipCapacity", { v: s.capacity })}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
        <div className="pn-stats">
          <Stat
            icon="cargo"
            label={t("pnStatCargo")}
            value={fleet.used}
            max={fleet.capacity}
            tone="cargo"
          >
            {t("flCargo", { used: fleet.used, capacity: fleet.capacity })}
          </Stat>
          {v2 ? (
            // 新界面：粮水合成一项（细条是能撑的天数，30 天为满）
            <Stat
              icon="food"
              label={t("chartHudSupply")}
              value={Math.min(canLast ?? 0, 30)}
              max={30}
              tone="food"
            >
              <span data-testid="fleet-supplies">{haveText(fleet)}</span>
            </Stat>
          ) : (
            <>
              <Stat
                icon="food"
                label={t("pnStatFood")}
                value={fleet.food}
                max={supplyMax}
                tone="food"
              >
                {t("pnFoodLine", { v: fleet.food, days: days(fleet.food) })}
              </Stat>
              <Stat
                icon="water"
                label={t("pnStatWater")}
                value={fleet.water}
                max={supplyMax}
                tone="water"
              >
                {t("pnWaterLine", { v: fleet.water, days: days(fleet.water) })}
              </Stat>
            </>
          )}
          <Stat
            icon="morale"
            label={t("pnStatMorale")}
            value={fleet.morale}
            max={100}
            tone="morale"
          >
            {t("flMorale", { v: fleet.morale })}
          </Stat>
          <Stat
            icon="crew"
            label={t("pnStatCrew")}
            value={fleet.crew}
            max={fleet.crew_max}
            mark={fleet.crew_min}
            tone="crew"
          >
            {t("flCrew", {
              crew: fleet.crew,
              min: fleet.crew_min,
              max: fleet.crew_max,
            })}
          </Stat>
          <p className="pn-note">
            {v2
              ? tz("sup.daily", { n: decimal(dailyUse(fleet)) })
              : t("pnDailyNeed", { need: decimal(dailyUse(fleet)) })}
          </p>
        </div>
        <div className="pn-cargo">
          <h4 className="pn-h4">
            <Icon name="cargo" />
            {t("pnCargoTitle")}
          </h4>
          {fleet.cargo.length === 0 ? (
            // 新界面：写明在哪儿，停在港口时一键去本港的交易所（在海上、在殖民点只写靠港以后）；旧界面照旧一行字
            <EmptyState
              text={t("pnCargoEmpty")}
              hint={
                atPort !== null
                  ? t("v2.fleet.cargoHint", { loc: locName(atPort) })
                  : t("v2.fleet.cargoHintSea")
              }
              action={
                atPort !== null
                  ? {
                      label: t("v2.fleet.goMarket"),
                      onClick: () => goFacility(atPort, "market"),
                    }
                  : undefined
              }
            />
          ) : (
            <ul className="pn-goods">
              {fleet.cargo.map((c) => (
                <li key={c.good}>
                  <GoodGlyphOf statics={statics} good={c.good} scale={1} className="pn-good-icon" />
                  <span className="pn-good-name">
                    {t("pnCargoLine", {
                      name: statics.goods[c.good]?.name ?? "",
                      qty: c.qty,
                    })}
                  </span>
                  <small>
                    {t("pnCargoCost", {
                      label: t("mkAvgCost"),
                      cost: c.avg_cost,
                    })}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </div>
      </article>
      {/* 船员：少于最低人数开不了船；在港时一键补到最低人数或补满（与酒馆、出港确认框同一个按钮组）。
          新界面：缺员的原因、“补到最低人数”与补不到的原因已在航行条里紧挨着“出航”，这里只留说明与“补满” */}
      <PnSection
        title={t("crewTitle")}
        icon="crew"
        testId="fleet-crew"
        className="pn-crew"
      >
        <p className="sub">
          {t("crewHelp", {
            wage: money(statics.rules.crew_wage),
            cost: money(statics.rules.crew_hire_cost),
          })}
        </p>
        {!v2 && <CrewShortNote fleet={fleet} />}
        <CrewHireButtons
          fleet={fleet}
          hideMin={v2}
          hideNote={crewBlocked}
          testId="fleet-crew-hire"
        />
      </PnSection>
      {v2 && supplies}
      {/* 新界面：这一节贴在窗口下沿（.pn-sail，见 styles/ui-v2/fleet.css）；太高时不贴底（.is-loose） */}
      <PnSection
        title={manual ? t("portSceneDepart") : t("flSailTo")}
        icon="sail"
        className={v2 ? (loose ? "pn-sail is-loose" : "pn-sail") : undefined}
      >
        {manual ? (
          // 手动航行的世界：内核只认手动出港与操舵（玩家的 SetSail 会被 navigation.manual_only 拒绝），
          // 这里改成打开出港罗经盘，与港口街景的“出港”同一条路（beginDeparture → Depart，驾驶的是旗舰队）
          <>
            <p data-testid="sail-manual" className="pn-sail-preview">
              {fleet.docked === null
                ? tz("fl.manual.sea")
                : fleet.id !== flagship(overview)?.id
                  ? tz("fl.manual.notFlag")
                  : tz("fl.manual.hint")}
            </p>
            <div className="row">
              <ActionButton
                kind="primary"
                disabled={
                  fleet.docked === null ||
                  fleet.id !== flagship(overview)?.id ||
                  crewBlocked
                }
                describedBy={v2 && crewBlocked ? crewWhyId : undefined}
                onClick={() => beginDeparture()}
              >
                {t("portSceneDepart")}
              </ActionButton>
            </div>
          </>
        ) : (
          <>
            <Select
              label={t("flSailTo")}
              value={dest}
              options={ports.map((p) => ({ value: p.id, label: p.name }))}
              onChange={setDest}
            />
            <p data-testid="sail-preview" className="pn-sail-preview">
              {preview === undefined
                ? t("loading")
                : preview === null
                  ? t("flNoRoute")
                  : !v2
                    ? t("flPreview", {
                        days: preview.days,
                        supplies: preview.supplies,
                      })
                    : supplyRisk
                      ? tz("sup.tripDays", { days: preview.days })
                      : canLast === null
                        ? tz("sup.tripIdle", { days: preview.days })
                        : tz("sup.trip", { days: preview.days, n: canLast })}
            </p>
            <div className="row">
              {/* 新界面：粮水不够这趟时，补给按钮在下面写着缺口的那一条里 */}
              {fleet.docked !== null && preview && !supplyRisk && (
                <ActionButton
                  disabled={need(fleet.food) + need(fleet.water) === 0}
                  title={t("flResupplyHint")}
                  onClick={() =>
                    submit({
                      Resupply: {
                        owner: "player",
                        fleet: fleet.id,
                        food: need(fleet.food),
                        water: need(fleet.water),
                      },
                    })
                  }
                >
                  {t("paren", {
                    text: t("flResupply"),
                    note: money(
                      need(fleet.food) * statics.rules.food_price +
                        need(fleet.water) * statics.rules.water_price,
                    ),
                  })}
                </ActionButton>
              )}
              <ActionButton
                kind="primary"
                disabled={!preview || crewBlocked}
                describedBy={v2 ? sailDescribedBy : undefined}
                onClick={() =>
                  submit({
                    SetSail: { owner: "player", fleet: fleet.id, dest },
                  })
                }
              >
                {t("flSail")}
              </ActionButton>
            </div>
          </>
        )}
        {/* 新界面：开不了船的原因就地写在“出航”旁（少于最低人数，内核会拒绝 SetSail），停靠时一键补到最低人数 */}
        {crewBlocked && (
          <div className="pn-sail-warn" data-testid="fleet-sail-crew">
            <InlineError
              tone="blocked"
              id={crewWhyId}
              reason={t("v2.fleet.crewBlocked", {
                min: fleet.crew_min,
                crew: fleet.crew,
              })}
              fix={crewFix}
              action={
                crew.toMin > 0
                  ? {
                      label: t("crewHireToMin", {
                        n: crew.toMin,
                        cost: money(crew.toMin * crewUnit),
                      }),
                      disabled: hiring,
                      onClick: () => hireToMin(fleet.id, crew.toMin),
                    }
                  : undefined
              }
            />
          </div>
        )}
        {/* 新界面：粮水撑不到这趟走完——是风险、不是做不了（照样能出航）：写清这趟几天、够几天、还差多少粮水；停靠时就地补足 */}
        {!manual && supplyRisk && preview && fill && (
          <div
            className="pn-sail-warn pn-sail-risk"
            data-testid="fleet-sail-supply"
          >
            <InlineError
              tone="blocked"
              id={supplyWhyId}
              className="v2-supply-risk"
              reason={shortText(fleet, preview)}
              fix={
                fleet.docked !== null
                  ? fillNote(fill, preview.supplies)
                  : t("v2.voyage.shortFixSea")
              }
              action={
                fleet.docked !== null
                  ? {
                      label: fill.margin
                        ? t("chartResupply", { cost: money(fill.cost) })
                        : tz("sup.fillGap", { cost: money(fill.cost) }),
                      disabled: filling || !!fill.block,
                      onClick: () => fillNow(fill.buy, fill.cost),
                    }
                  : undefined
              }
            />
          </div>
        )}
      </PnSection>
      {!v2 && supplies}
    </div>
  );
}
