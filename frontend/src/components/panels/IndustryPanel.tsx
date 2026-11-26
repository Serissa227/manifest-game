// 产业窗口：我的产业（配方、投入库存、每日估算、升级 / 管理人 / 换配方 / 出售）与建设新产业。
// 新界面（v2）只在样式之外做了几处小的结构调整（旧界面不变）：每日估算拆成四项小数字（日盈亏最醒目）；
// 出售前先确认并写明能得多少（内核按账面价值的一半）；“建设”是主按钮；没有可建设的地方时空状态给“下一步”
// （先选好一个港口再去它的仓库页；一个港口也定不下来时打开航海图去点一个）。
import { GoodGlyphOf } from "./GoodGlyph";
import { useState } from "react";
import { Sprite } from "../../art/Sprite";
import { useView } from "../../hooks/useView";
import { listJoin, money, t } from "../../i18n";
import { api } from "../../ipc/api";
import { locById } from "../../ipc/byId";
import type { IndustryView, StaticView } from "../../ipc/types";
import { type GameStore, useGame } from "../../store/game";
import { useIsV2 } from "../../ui/uiMode";
import { ActionButton, Empty, Select } from "../common";
import { EmptyState, useConfirm } from "../feedback";
import { closeWindow, openWindow } from "../shell/shellState";
import { PnSection } from "./PanelKit";
import { industryPx } from "./panelArt";

/** 一串带图标的商品：谷物×2、丝绸×1…… */
function Goods({ statics, list }: { statics: StaticView; list: [number, number][] }) {
  if (list.length === 0) return <span className="pn-goods-inline pn-none">{t("none")}</span>;
  return (
    <span className="pn-goods-inline">
      {list.map(([g, q]) => (
        <span key={g} className="pn-good-chip">
          <GoodGlyphOf statics={statics} good={g} scale={1} className="pn-good-icon" />
          {statics.goods[g]?.name}×{q}
        </span>
      ))}
    </span>
  );
}

/** v2：每日估算的四项——产出、原料、人工维护，最后是日盈亏（最醒目，正绿负红）。 */
function DailyFigures({ i }: { i: IndustryView }) {
  const items: [string, number, string][] = [
    [t("v2.business.in.revenue"), i.daily_revenue, ""],
    [t("v2.business.in.inputs"), i.daily_inputs, ""],
    [t("v2.business.in.costs"), i.daily_costs, ""],
    [t("v2.business.in.profit"), i.daily_profit, i.daily_profit >= 0 ? "is-profit up" : "is-profit down"],
  ];
  return (
    <dl className="v2-in-daily" aria-label={t("v2.business.in.dailyLabel")}>
      {items.map(([label, v, cls]) => (
        <div key={label} className={cls || undefined}>
          <dt>{label}</dt>
          <dd>{money(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * “去港口仓库”要去哪个港口（租仓库不必停靠在那里）：此刻选中的是港口或城市就用它；没选、或选的是殖民点
 * （殖民点没有仓库页，港口窗口会换成殖民点的面板）时，依次换成旗舰、选中的舰队、其余舰队停靠的港口，
 * 再是它们正驶往的港口。一个也没有（都在海上漂着）时为 null。
 */
function warehousePortOf(s: GameStore): number | null {
  const isPort = (l: number | null | undefined): l is number => {
    const place = locById(s.statics, l);
    return !!place && place.kind !== "site";
  };
  if (isPort(s.selectedLoc)) return s.selectedLoc;
  const fleets = s.overview?.fleets ?? [];
  const ordered = [...fleets.slice(0, 1), ...fleets.filter((f, i) => i > 0 && f.id === s.selectedFleet), ...fleets.filter((f, i) => i > 0 && f.id !== s.selectedFleet)];
  for (const f of ordered) if (isPort(f.docked)) return f.docked;
  for (const f of ordered) if (isPort(f.dest)) return f.dest;
  return null;
}

/** 产业：产业列表、配方、库存、盈亏；建设与管理。 */
export default function IndustryPanel() {
  const statics = useGame((s) => s.statics);
  const submit = useGame((s) => s.submit);
  const { data } = useView("industries", () => api.industries());
  const [site, setSite] = useState<number | null>(null);
  const [kind, setKind] = useState(0);
  const [recipe, setRecipe] = useState<number | null>(null);
  const v2 = useIsV2();
  const confirm = useConfirm();
  const warehousePort = useGame(warehousePortOf);
  if (!statics || !data) return null;
  const recipesOf = (k: number) => statics.recipes.filter((r) => r.industry === k);
  const chosenSite = site ?? data.sites[0] ?? null;
  const chosenRecipe = recipe ?? recipesOf(kind)[0]?.id ?? null;
  const goods = (list: [number, number][]) => listJoin(list.map(([g, q]) => `${statics.goods[g]?.name}×${q}`));
  const picked = chosenRecipe === null ? undefined : statics.recipes[chosenRecipe];
  const sell = (i: IndustryView) => {
    const act = () => submit({ SellIndustry: { owner: "player", industry: i.id } });
    if (!v2) return act();
    const label = t("paren", { text: statics.industry_types[i.kind]?.name ?? "", note: locById(statics, i.loc)?.name ?? "" });
    const v = money(Math.trunc(i.book_value / 2)); // 与内核的整数除法（向零取整）一致
    return confirm.run(
      {
        title: t("v2.business.in.sellAsk", { name: label }),
        body: t("v2.business.in.sellBody", { v }),
        confirmLabel: t("v2.business.in.sellConfirm", { v }),
        done: t("v2.business.in.sellDone", { name: label, v }),
      },
      act,
    );
  };
  return (
    <div data-testid="industry-panel" className="pn pn-industry">
      <PnSection title={t("inList")} icon="industry">
        {data.industries.length === 0 ? (
          // 建设表单就在下面（这一处的主按钮是“建设”）：空状态只写一句怎么开始，不再放第二个主按钮
          <EmptyState text={t("inNone")} hint={t(data.sites.length > 0 ? "v2.business.in.emptyHintBuild" : "v2.business.in.emptyHint")} />
        ) : (
          data.industries.map((i) => {
            const rc = statics.recipes[i.recipe];
            return (
              <article key={i.id} className={i.stalled ? "pn-card pn-works stalled" : "pn-card pn-works"}>
                <div className="pn-works-icon">
                  <Sprite px={industryPx(i.kind)} scale={2} />
                  <span className="pn-level small">{t("pnLevelBadge", { level: i.level })}</span>
                </div>
                <div className="pn-works-main">
                  <header className="pn-works-head">
                    <strong>
                      {statics.industry_types[i.kind]?.name} · {locById(statics, i.loc)?.name}
                    </strong>{" "}
                    · {t("inLevel", { level: i.level })}
                    {i.stalled && <em className="tag hot pn-stamp">{t("inStalled")}</em>}
                  </header>
                  <p className="pn-recipe">
                    <span className="pn-recipe-name">{rc?.name}</span>
                    <Goods statics={statics} list={rc?.inputs ?? []} />
                    <span className="pn-arrow">{t("pnRecipeArrow")}</span>
                    <Goods statics={statics} list={rc?.outputs ?? []} />
                  </p>
                  <p className="pn-stock">
                    {t("inInputs")}
                    {t("labelSep")}
                    <Goods statics={statics} list={i.input_stock} />
                  </p>
                  {v2 ? (
                    <DailyFigures i={i} />
                  ) : (
                    <p className={i.daily_profit >= 0 ? "pn-pnl up" : "pn-pnl down"}>
                      {t("inDaily", {
                        rev: money(i.daily_revenue),
                        inp: money(i.daily_inputs),
                        cost: money(i.daily_costs),
                        profit: money(i.daily_profit),
                      })}
                    </p>
                  )}
                  <div className="row">
                    <ActionButton onClick={() => submit({ UpgradeIndustry: { owner: "player", industry: i.id } })}>
                      {t("inUpgrade")}
                    </ActionButton>
                    <ActionButton
                      onClick={() => submit({ SetManager: { owner: "player", industry: i.id, hired: !i.manager } })}
                    >
                      {i.manager ? t("inFire") : t("inHire")}
                    </ActionButton>
                    <Select
                      label={t("inChange")}
                      value={i.recipe}
                      options={recipesOf(i.kind).map((r) => ({ value: r.id, label: r.name }))}
                      onChange={(r) => void submit({ ChangeRecipe: { owner: "player", industry: i.id, recipe: r } })}
                    />
                    {v2 ? (
                      // v2 用普通按钮：ActionButton 会一直“忙”到对话框关掉，禁用的按钮接不回焦点（取消后焦点掉到 body）
                      <button type="button" className="btn danger" onClick={() => void sell(i)}>
                        {t("inSellBtn")}
                      </button>
                    ) : (
                      <ActionButton kind="danger" onClick={() => sell(i)}>
                        {t("inSellBtn")}
                      </ActionButton>
                    )}
                  </div>
                </div>
              </article>
            );
          })
        )}
      </PnSection>
      <PnSection title={t("inBuild")} icon="invest">
        {chosenSite === null ? (
          <EmptyState
            text={t("v2.business.in.noSite")}
            hint={t("v2.business.in.noSiteHint")}
            action={
              warehousePort === null
                ? {
                    label: t("v2.business.in.noSiteChart"),
                    onClick: () => {
                      useGame.getState().setStage("chart");
                      closeWindow();
                    },
                  }
                : {
                    label: t("v2.business.in.noSiteAction"),
                    onClick: () => {
                      const g = useGame.getState();
                      g.selectLoc(warehousePort);
                      g.setFacility("warehouse");
                      openWindow("port");
                    },
                  }
            }
            v1={<Empty text={t("inSite")} />}
          />
        ) : (
          <div className="pn-build">
            <div className="pn-works-icon">
              <Sprite px={industryPx(kind)} scale={2} />
            </div>
            <div className="pn-build-form">
              <Select
                label={t("inSite")}
                value={chosenSite}
                options={data.sites.map((s) => ({ value: s, label: locById(statics, s)?.name ?? String(s) }))}
                onChange={setSite}
              />
              <Select
                label={t("inType")}
                value={kind}
                options={statics.industry_types.map((k) => ({ value: k.id, label: k.name }))}
                onChange={(k) => {
                  setKind(k);
                  setRecipe(null);
                }}
              />
              {chosenRecipe !== null && (
                <Select
                  label={t("inRecipe")}
                  value={chosenRecipe}
                  options={recipesOf(kind).map((r) => ({
                    value: r.id,
                    label: t("labelValue", { label: r.name, value: `${goods(r.inputs)} → ${goods(r.outputs)}` }),
                  }))}
                  onChange={setRecipe}
                />
              )}
              {picked && (
                <p className="pn-recipe">
                  <Goods statics={statics} list={picked.inputs} />
                  <span className="pn-arrow">{t("pnRecipeArrow")}</span>
                  <Goods statics={statics} list={picked.outputs} />
                </p>
              )}
              <ActionButton
                kind={v2 ? "primary" : undefined}
                disabled={chosenRecipe === null}
                onClick={() =>
                  submit({
                    BuildIndustry: { owner: "player", loc: chosenSite, kind, recipe: chosenRecipe ?? 0 },
                  })
                }
              >
                {t("inBuildBtn", { cost: statics.industry_types[kind]?.build_cost ?? 0 })}
              </ActionButton>
            </div>
          </div>
        )}
      </PnSection>
      {confirm.dialog}
    </div>
  );
}
