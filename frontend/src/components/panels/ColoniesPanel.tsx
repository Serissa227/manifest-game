// 殖民地窗口：左侧名册（每个殖民地一张小卡：人口、士气、存粮、工程进度、断粮 / 袭击警示），
// 右侧选中殖民地的详情（见 components/colony/ColonyDetail.tsx）。选中状态放在全局 store 的 selectedColony，
// 街景里点殖民建筑时由 colonyUi.openColony 选中并定位到那座建筑。
// 在海图上点了殖民点或抵达殖民点时（hooks/useVoyage.ts 的 focusSite：selectedLoc = 殖民点、selectedColony = null），
// 若此地没有你的殖民地，就在名册上方显示这处殖民点的卡片（与港口窗口同一份详情与“建立殖民地”对话框），
// 名册里暂不选中任何殖民地；点名册里的殖民地再看它的详情，卡片上方的按钮可以回到这处殖民点。
// 新界面（v2）：还没有殖民地时，空状态给“下一步”——打开航海图去找殖民点（旧界面照旧只有一句话）。
import { useView } from "../../hooks/useView";
import { otherName, t } from "../../i18n";
import { api } from "../../ipc/api";
import { locById } from "../../ipc/byId";
import type { ColonyView, StaticView } from "../../ipc/types";
import { useGame, useOverviewFields } from "../../store/game";
import { ColonyDetail } from "../colony/ColonyDetail";
import { Meter } from "../colony/bits";
import { clearColonyFocus } from "../colony/colonyUi";
import { myColonyAt, raidRisk } from "../colony/model";
import { SiteCard } from "../colony/SitePanel";
import { Empty } from "../common";
import { EmptyState } from "../feedback";
import { COLONY_LOW_FOOD_DAYS, closeWindow } from "../shell/shellState";
import { Icon, PnSection } from "./PanelKit";

export default function ColoniesPanel() {
  const statics = useGame((s) => s.statics);
  // 按字段选取（P14a）：只取用到的顶层字段，没变就不重渲染
  const overview = useOverviewFields("colonies", "site_claims");
  const selected = useGame((s) => s.selectedColony);
  const selectedLoc = useGame((s) => s.selectedLoc);
  const { data } = useView("colonies", () => api.colonies());
  const list = data?.colonies ?? [];
  // 选中的地点是殖民点、而那里没有你的殖民地：显示殖民点卡片
  const siteLoc =
    statics && selectedLoc !== null && locById(statics, selectedLoc)?.kind === "site" &&
    myColonyAt(overview, selectedLoc) === null && !list.some((c) => c.loc === selectedLoc)
      ? selectedLoc
      : null;
  const showSite = siteLoc !== null && selected === null;
  const current = showSite
    ? undefined
    : (list.find((c) => c.id === selected) ?? list.find((c) => c.loc === selectedLoc) ?? list[0]);
  return (
    <div data-testid="colonies-panel" className="pn pn-colonies">
      {showSite && siteLoc !== null && <SiteCard loc={siteLoc} />}
      <PnSection title={t("colony.panelTitle")} icon="colony">
        {statics && data && (
          <p className="colony-slots">
            <Icon name="claim" />
            {t("colony.slots", { n: data.slots_left, max: statics.rules.colony_max })}
          </p>
        )}
        {statics && siteLoc !== null && !showSite && (
          <button
            type="button"
            className="btn colony-back-site"
            onClick={() => {
              useGame.getState().selectColony(null);
              clearColonyFocus();
            }}
          >
            <Icon name="site" />
            {t("colony.backToSite", { site: locById(statics, siteLoc)?.name ?? "" })}
          </button>
        )}
        {data && list.length === 0 && (
          <EmptyState
            text={t("v2.business.col.empty")}
            hint={t("v2.business.col.emptyHint")}
            action={{
              label: t("v2.business.col.emptyAction"),
              onClick: () => {
                useGame.getState().setStage("chart");
                closeWindow();
              },
            }}
            v1={<Empty text={t("colony.empty")} />}
          />
        )}
      </PnSection>
      {statics && list.length > 0 && (current || showSite) && (
        <div className={current ? "colony-layout" : "colony-layout is-roster-only"}>
          <Roster statics={statics} colonies={list} current={current?.id ?? null} />
          {current && <ColonyDetail colony={current} />}
        </div>
      )}
    </div>
  );
}

/** 殖民地名册：按钮列表，当前选中的按下（显示殖民点卡片时都不按下）。 */
function Roster({ statics, colonies, current }: { statics: StaticView; colonies: ColonyView[]; current: number | null }) {
  const today = useGame((s) => s.overview?.day ?? 0);
  const select = (id: number) => {
    useGame.getState().selectColony(id);
    clearColonyFocus();
  };
  return (
    <nav className="colony-roster" aria-label={t("colony.listLabel")}>
      <ul>
        {colonies.map((c) => {
          const starving = c.starving_days > 0;
          const low = !starving && c.food_days < COLONY_LOW_FOOD_DAYS;
          const k = c.construction;
          const on = c.id === current;
          const cls = ["colony-roster-item", on ? "is-on" : "", starving ? "is-bad" : low ? "is-warn" : ""].filter(Boolean).join(" ");
          return (
            <li key={c.id}>
              <button type="button" className={cls} aria-pressed={on} onClick={() => select(c.id)} data-testid={`colony-roster-${c.id}`}>
                <span className="colony-roster-name">{c.name}</span>
                <small className="colony-roster-site" title={otherName(locById(statics, c.loc))}>
                  {locById(statics, c.loc)?.name ?? ""}
                </small>
                <span className="colony-roster-stats">
                  <span>
                    <Icon name="population" />
                    {t("colony.listPop", { n: c.population })}
                  </span>
                  <span>
                    <Icon name="morale" />
                    {t("colony.listMorale", { n: c.morale })}
                  </span>
                  <span>
                    <Icon name="food" />
                    {t("colony.listFood", { n: Math.max(0, c.food_days) })}
                  </span>
                </span>
                <Meter value={c.morale} max={100} tone="morale" mark={50} />
                {k && (
                  <span className="colony-roster-build">
                    <Icon name="build" />
                    {t("colony.chipBuilding")}
                    <Meter value={Math.max(0, today - k.start_day)} max={Math.max(1, k.done_day - k.start_day)} tone="build" />
                  </span>
                )}
                <span className="colony-chips">
                  {starving && <em className="colony-chip bad">{t("colony.chipStarving", { days: c.starving_days })}</em>}
                  {low && <em className="colony-chip warn">{t("colony.chipLowFood")}</em>}
                  {raidRisk(c.raid_bp) === "high" && <em className="colony-chip bad">{t("colony.chipRaid")}</em>}
                  {(c.effects?.length ?? 0) > 0 && <em className="colony-chip event">{t("colony.chipEvent")}</em>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
