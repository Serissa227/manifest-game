// 港口窗口在殖民点（kind 为 site）的内容：殖民点没有市场与设施，所以不显示设施分页，而是——
// · 此地有你的殖民地：殖民地概况、在建工程、装卸，以及打开殖民地窗口的按钮；
// · 否则：殖民点详情（地形、肥力、险恶、资源、可建的生产建筑、归属）与建立条件、“建立殖民地”按钮和对话框。
// 殖民地窗口在选中殖民点、而此地没有你的殖民地时，在名册上方显示同一份详情（SiteCard）：
// 建立条件与“在此建立殖民地”放在最前面，抵达时一眼就能看到；对话框同样由它挂出。
import { useView } from "../../hooks/useView";
import { t, tk } from "../../i18n";
import { api } from "../../ipc/api";
import { locById } from "../../ipc/byId";
import type { Overview, SiteView, StaticView } from "../../ipc/types";
import { useGame, useOverviewFields } from "../../store/game";
import { BiName } from "../BiName";
import { ActionButton } from "../common";
import { EmptyState } from "../feedback";
import { Icon, PnSection } from "../panels/PanelKit";
import { BuildingIcon, GoodChip, Meter, Tile } from "./bits";
import { CargoTransfer } from "./CargoTransfer";
import { openColony, openFoundDialog, useColonyUi } from "./colonyUi";
import { FoundDialog } from "./FoundDialog";
import { claimAt, foundChecks, myColonyAt } from "./model";

/** 殖民点的小标题：你的殖民地 / 某势力的据点 / 其他商会的殖民地 / 未开拓之地。 */
function siteSubtitle(statics: StaticView, overview: Pick<Overview, "colonies" | "site_claims"> | null, loc: number): string {
  const l = locById(statics, loc);
  if (myColonyAt(overview, loc) !== null) return tk("tab.colonies");
  const claim = claimAt(overview, loc);
  if (claim && claim.faction !== null) return t("portSceneClaimed", { faction: statics.factions[claim.faction]?.name ?? "" });
  if (claim && claim.colony !== null && !claim.mine) return t("portSceneOtherColony");
  return tk(`loc.${l?.kind ?? "site"}`);
}

/** 港口窗口的殖民点版本（保留 data-testid="port-panel"）。 */
export function SitePanel({ loc }: { loc: number }) {
  const statics = useGame((s) => s.statics);
  // 按字段选取（P14a）：只取用到的顶层字段，没变就不重渲染
  const overview = useOverviewFields("colonies", "site_claims");
  const l = locById(statics, loc);
  // 没看见过的地点（已从静态数据里滤掉）不画
  if (!statics || !l) return null;
  const colony = myColonyAt(overview, loc);
  return (
    <div className="port port-site" data-testid="port-panel">
      <h2>
        <BiName zh={l.name} en={l.name_en} testId="site-name" /> <small>{siteSubtitle(statics, overview, loc)}</small>
      </h2>
      <div className="pn pn-colonies colony-in-port">
        {colony !== null ? <ColonyHere statics={statics} loc={loc} colony={colony} /> : <SiteDetails statics={statics} loc={loc} />}
      </div>
    </div>
  );
}

/**
 * 殖民地窗口里的殖民点卡片（名册上方）：选中了殖民点、而此地没有你的殖民地时显示——
 * 未开拓之地把建立条件与“在此建立殖民地”放在最前面；被势力占领或已有他人殖民地时说明归属。
 */
export function SiteCard({ loc }: { loc: number }) {
  const statics = useGame((s) => s.statics);
  // 按字段选取（P14a）：只取用到的顶层字段，没变就不重渲染
  const overview = useOverviewFields("colonies", "site_claims");
  const l = locById(statics, loc);
  if (!statics || !l) return null;
  return (
    <section className="colony-site-card" data-testid="colony-site-card" aria-label={l.name}>
      <header className="colony-site-head">
        <Icon name="site" scale={2} />
        <h3 className="colony-name">
          <BiName zh={l.name} en={l.name_en} /> <small>{siteSubtitle(statics, overview, loc)}</small>
        </h3>
      </header>
      <SiteDetails statics={statics} loc={loc} variant="colonies" />
    </section>
  );
}

/** 此地是你的殖民地：概况 + 装卸 + 打开殖民地窗口。 */
function ColonyHere({ statics, loc, colony }: { statics: StaticView; loc: number; colony: number }) {
  const summary = useGame((s) => s.overview?.colonies?.find((c) => c.id === colony));
  const today = useGame((s) => s.overview?.day ?? 0);
  const { data } = useView("colonies", () => api.colonies());
  const view = data?.colonies.find((c) => c.id === colony || c.loc === loc);
  const name = view?.name ?? summary?.name ?? "";
  const k = view?.construction ?? null;
  return (
    <div className="colony-here" data-testid="colony-here">
      <PnSection title={`${name} · ${t("colony.hereTitle")}`} icon="colony">
        <p className="colony-line">
          {t("colony.hereLine", {
            pop: view?.population ?? summary?.population ?? 0,
            morale: view?.morale ?? summary?.morale ?? 0,
            days: Math.max(0, view?.food_days ?? summary?.food_days ?? 0),
          })}
        </p>
        {view && (
          <div className="colony-tiles compact">
            <Tile icon="population" label={t("colony.tilePop")} value={`${view.population} / ${view.housing}`}>
              <Meter value={view.population} max={view.housing} tone="pop" />
            </Tile>
            <Tile icon="morale" label={t("colony.tileMorale")} value={view.morale}>
              <Meter value={view.morale} max={100} tone="morale" mark={50} />
            </Tile>
            <Tile
              icon="food"
              label={t("colony.tileFood")}
              value={t("colony.tileDays", { n: Math.max(0, view.food_days) })}
              tone={view.starving_days > 0 ? "bad" : "ok"}
            >
              <Meter value={view.food_days} max={60} tone="food" warn={view.starving_days > 0} />
            </Tile>
          </div>
        )}
        {k && (
          <p className="colony-line">
            <BuildingIcon statics={statics} building={k.building} scale={1} />
            {t("colony.constructing", { name: statics.colony_buildings[k.building]?.name ?? "", level: k.level })} ·{" "}
            {t("colony.constructDone", { day: k.done_day, days: Math.max(0, k.done_day - today) })}
          </p>
        )}
        <button type="button" className="btn primary" onClick={() => openColony(colony)}>
          {t("colony.openPanel")}
        </button>
      </PnSection>
      {view && (
        <PnSection title={t("colony.secCargo")} icon="cargo">
          <CargoTransfer colony={view} />
        </PnSection>
      )}
    </div>
  );
}

/**
 * 殖民点详情与建立条件。
 * variant 为 "port"（港口窗口）时先写自然条件、再写建立条件；为 "colonies"（殖民地窗口的殖民点卡片）时
 * 建立条件与“在此建立殖民地”放在最前面，并在可以建立时给一句提示。
 */
function SiteDetails({ statics, loc, variant = "port" }: { statics: StaticView; loc: number; variant?: "port" | "colonies" }) {
  // 按字段选取（P14a）：只取用到的顶层字段，没变就不重渲染
  const overview = useOverviewFields("fleets");
  const foundSite = useColonyUi((s) => s.foundSite);
  const { data: site } = useView(`site:${loc}`, () => api.site(loc));
  if (!site || site.loc !== loc) return null;
  const l = locById(statics, loc);
  const claimFaction = site.claim?.faction ?? null;
  const claimOther = site.claim !== null && site.claim.colony !== null && !site.claim.mine;
  const entry = site.fleets_here[0];
  const fleet = entry ? overview?.fleets.find((f) => f.id === entry[0]) : undefined;
  const blocked = claimFaction !== null || claimOther;
  const inColonies = variant === "colonies";
  const ready = site.can_found && !!fleet && entry?.[1] === null;
  const conditions = !blocked && (
    <PnSection title={inColonies ? t("colony.foundHere") : t("colony.siteConditions")} icon="claim" className={inColonies ? "colony-found-cta" : undefined}>
      {inColonies && ready && <p className="colony-line colony-found-ready">{t("colony.foundReady", { site: l?.name ?? "" })}</p>}
      <FoundConditions statics={statics} site={site} />
      <ActionButton kind="primary" disabled={!site.can_found || !fleet} onClick={() => openFoundDialog(loc)}>
        {inColonies ? t("colony.foundHere") : t("colony.foundBtn")}
      </ActionButton>
    </PnSection>
  );
  return (
    <div className="colony-site" data-testid="site-details">
      {site.lore && <p className="colony-lore">{site.lore}</p>}
      {!site.known && <p className="colony-alert warn">{t("colony.siteUnknown")}</p>}
      {claimFaction !== null && (
        <p className="colony-alert bad" data-testid="site-claim">
          <span className="colony-flag" style={{ background: statics.factions[claimFaction]?.color ?? "#888" }} aria-hidden="true" />
          {t("colony.siteClaimFaction", { faction: statics.factions[claimFaction]?.name ?? "" })}
        </p>
      )}
      {claimOther && (
        <p className="colony-alert bad" data-testid="site-claim">
          {t("colony.siteClaimOther")}
        </p>
      )}
      {inColonies && conditions}

      <PnSection title={t("colony.siteNature")} icon="site">
        <p className="colony-line">
          <Icon name="map" />
          {t("colony.siteTerrain", { name: tk(`terrain.${site.info.terrain}`) })}
        </p>
        <div className="colony-site-meters">
          <span title={t("colony.siteFertilityHint")}>
            {t("colony.siteFertility", { n: site.info.fertility })}
            <Meter value={site.info.fertility} max={100} tone="fertile" />
          </span>
          <span title={t("colony.siteHazardHint")}>
            {t("colony.siteHazard", { n: site.info.hazard })}
            <Meter value={site.info.hazard} max={100} tone="hazard" />
          </span>
        </div>
        <h4 className="pn-h4">{t("colony.siteResources")}</h4>
        <ul className="colony-resources">
          {site.info.resources.map(([g, rich]) => (
            <li key={g}>
              <GoodChip statics={statics} good={g} />
              <small>{t("colony.siteRichness", { n: rich })}</small>
              <Meter value={rich} max={100} tone="rich" />
            </li>
          ))}
        </ul>
        {site.producible.length > 0 && (
          <>
            <h4 className="pn-h4">{t("colony.siteProducible")}</h4>
            <ul className="colony-producible">
              {site.producible.map(([b, g, p]) => (
                <li key={`${b}-${g}`}>
                  <BuildingIcon statics={statics} building={b} scale={1} />
                  <span>
                    {t("colony.siteProduceLine", {
                      building: statics.colony_buildings[b]?.name ?? "",
                      good: statics.goods[g]?.name ?? "",
                    })}
                  </span>
                  <small className={p >= 50 ? "up" : p < 30 ? "down" : ""}>{t("colony.siteProducePct", { pct: p })}</small>
                </li>
              ))}
            </ul>
          </>
        )}
      </PnSection>

      {!inColonies && conditions}
      {foundSite === loc && !blocked && <FoundDialog key={l?.key ?? String(loc)} site={site} />}
    </div>
  );
}

/** 建立条件逐项列出，并列出停在此地的舰队能否建立。 */
function FoundConditions({ statics, site }: { statics: StaticView; site: SiteView }) {
  // 按字段选取（P14a）：只取用到的顶层字段，没变就不重渲染
  const overview = useOverviewFields("fleets", "cash");
  const entry = site.fleets_here[0];
  const fleet = entry ? overview?.fleets.find((f) => f.id === entry[0]) : undefined;
  return (
    <>
      <ul className="colony-checks">
        {foundChecks(statics, overview, site, fleet).map((c) => (
          <li key={c.key} className={c.ok ? "ok" : "bad"}>
            {c.label}
          </li>
        ))}
      </ul>
      {site.fleets_here.length === 0 ? (
        // 新界面：一小块空状态说清怎样满足这一条（下面的“建立殖民地”是这一处的主按钮，不再放第二个）
        <EmptyState className="is-compact" text={t("colony.condNoFleet")} hint={t("v2.business.col.siteNoFleetHint")} />
      ) : (
        <ul className="colony-fleets">
          {site.fleets_here.map(([id, why]) => (
            <li key={id} className={why === null ? "ok" : "bad"}>
              {t("colony.condFleet", { id, status: why ?? t("colony.condFleetOk") })}
            </li>
          ))}
        </ul>
      )}
      {!site.can_found && site.reason && <p className="colony-reason">{site.reason}</p>}
    </>
  );
}
