import { useId, useState, type ReactNode } from "react";
import { npcNamePair } from "../art/names";
import { pirateAssetId } from "../art/portraitCast";
import { portraitSpec } from "../art/portraits";
import { hash32 } from "../art/rng";
import { shipArtKey } from "../art/ships";
import { Sprite } from "../art/Sprite";
import { nameOf, t } from "../i18n";
import type { PendingView, StaticView } from "../ipc/types";
import { useGame } from "../store/game";
import { useIsV2 } from "../ui/uiMode";
import { BiName } from "./BiName";
import { ActionButton } from "./common";
import { Portrait } from "./panels/PanelKit";
import { pirateScene } from "./panels/panelArt";

/**
 * 新界面（v2）里的一个选择：按钮 + 下面一句“会发生什么”（读屏经 aria-describedby 念出来）。
 * 与 ActionButton 一样，办事的时候按钮不可用。旧界面不用它（v1 的 DOM 不变）。
 */
function Choice({ kind, hint, onClick, children }: { kind?: "primary"; hint: string; onClick: () => Promise<unknown>; children: ReactNode }) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  return (
    <div className={kind ? `bt-choice is-${kind}` : "bt-choice"}>
      <button
        type="button"
        className={kind ? `btn ${kind}` : "btn"}
        aria-describedby={id}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onClick();
          } finally {
            setBusy(false);
          }
        }}
      >
        {children}
      </button>
      <p id={id} className="bt-choice-hint">
        {hint}
      </p>
    </div>
  );
}

/** 按每船火炮数挑一个最接近的船型来画海盗船（遭遇信息里没有船型；独有船型不给海盗用）。 */
function pirateKind(statics: StaticView | null, p: PendingView): number {
  const ships = statics?.ships ?? [];
  if (ships.length === 0) return 0;
  const per = p.pirate_ships > 0 ? p.pirate_guns / p.pirate_ships : 0;
  let best = -1;
  for (let i = 0; i < ships.length; i++) {
    if (ships[i].unique) continue;
    if (best < 0 || Math.abs(ships[i].guns - per) < Math.abs(ships[best].guns - per)) best = i;
  }
  return best < 0 ? 0 : best;
}

const NO_BATTLES: PendingView[] = [];

/** 遭遇海盗时的对话框：海盗头目与海盗船，选择自动结算或战术海战（不选则次日自动结算）。 */
export default function BattleDialog() {
  const statics = useGame((s) => s.statics);
  // 只取待决的海战：没有遭遇时每天的概览更新不让它重渲染
  const pending = useGame((s) => (s.overview?.pending_battles.length ? s.overview.pending_battles : NO_BATTLES));
  const submit = useGame((s) => s.submit);
  const setTab = useGame((s) => s.setTab);
  const v2 = useIsV2();
  if (pending.length === 0) return null;
  return (
    <div className="modal pn-battle-modal" role="dialog" aria-label={t("btEncounter")} data-testid="battle-dialog">
      <div className="modal-body pn-battle-body">
        <h2 className="pn-battle-title">{t("btEncounter")}</h2>
        {pending.map((p) => {
          // 头目的性别由种子决定（约四分之一是女头目），头像与名字保持一致
          const female = hash32(`pirate-${p.id}`) % 4 === 0;
          const spec = portraitSpec(`pirate-${p.id}`, "pirate", { female });
          // 头目的肖像：二十位海盗头目（十男十女）里，在同性别的十位中按遭遇编号取一位（缺图时用上面的程序头像）
          const art = pirateAssetId(p.id, female);
          // 头目的名字：中文音译与英文原形成对（EXPANSION.md §12.3），按当前语言显示，中文界面下方一小行英文
          const pair = npcNamePair(`pirate-${p.id}`, female);
          const leader = nameOf({ name: pair.zh, name_en: pair.en });
          const kind = pirateKind(statics, p);
          const sail = statics?.ships[kind]?.sail ?? "square";
          return (
            <div key={p.id} className="card pn-encounter" data-testid={`encounter-${p.id}`}>
              <div className="pn-encounter-art">
                <figure className="pn-encounter-leader">
                  <Portrait spec={spec} asset={art} scale={2} label={t("pnPirateLeader", { name: leader })} className="iron" />
                  <figcaption aria-hidden="true">
                    <BiName zh={pair.zh} en={pair.en}>
                      {t("pnPirateLeader", { name: leader })}
                    </BiName>
                  </figcaption>
                </figure>
                <span className="pn-encounter-ship">
                  <Sprite px={pirateScene({ kind, key: shipArtKey(statics?.ships, kind), sail, pirate: true })} scale={2} label={t("pnPirateShip")} />
                </span>
              </div>
              <p className="pn-encounter-line">
                {t("btEncounterLine", { fleet: p.fleet, ships: p.pirate_ships, guns: p.pirate_guns, crew: p.pirate_crew })}
              </p>
              {v2 ? (
                // 新界面：两个等宽的选择，下面各写一句会发生什么；手机上主选择在下（拇指最近）
                <div className="bt-choices">
                  <Choice hint={t("v2.dialogs.battle.autoHint")} onClick={() => submit({ EngageBattle: { owner: "player", battle: p.id, tactical: false } })}>
                    {t("btAuto")}
                  </Choice>
                  <Choice
                    kind="primary"
                    hint={t("v2.dialogs.battle.tacticalHint")}
                    onClick={async () => {
                      const r = await submit({ EngageBattle: { owner: "player", battle: p.id, tactical: true } });
                      if (r) setTab("battle");
                    }}
                  >
                    {t("btTactical")}
                  </Choice>
                </div>
              ) : (
                <div className="row">
                  <ActionButton
                    onClick={() => submit({ EngageBattle: { owner: "player", battle: p.id, tactical: false } })}
                  >
                    {t("btAuto")}
                  </ActionButton>
                  <ActionButton
                    kind="primary"
                    onClick={async () => {
                      const r = await submit({ EngageBattle: { owner: "player", battle: p.id, tactical: true } });
                      if (r) setTab("battle");
                    }}
                  >
                    {t("btTactical")}
                  </ActionButton>
                </div>
              )}
            </div>
          );
        })}
        <p className="sub">{t("btLater")}</p>
      </div>
    </div>
  );
}
