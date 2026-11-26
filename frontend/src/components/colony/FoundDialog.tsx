// “建立殖民地”对话框：命名（默认给一个建议名，可换）、选舰队、殖民者人数滑块（受船员限制）、建立条件逐项检查，
// 确认后提交 FoundColony；成功后切到殖民地街景并打开殖民地窗口。对话框挂在 document.body 上（模态）。
// 新界面（v2）：底部两个按钮与共用的确认对话框同一个顺序——“取消”在前、主按钮在后（桌面靠右并排、主按钮在最右；
// 手机竖排、“取消”在最下面），读屏与 Tab 的顺序与看到的一致。旧界面照旧是“立下界碑、取消”。
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Sprite } from "../../art/Sprite";
import { t } from "../../i18n";
import { locById } from "../../ipc/byId";
import type { SiteView } from "../../ipc/types";
import { useGame, useOverviewFields } from "../../store/game";
import { useIsV2 } from "../../ui/uiMode";
import { BiName } from "../BiName";
import { ActionButton, Select } from "../common";
import { iconPx } from "../panels/panelArt";
import { closeFoundDialog, openColony } from "./colonyUi";
import { COLONY_NAME_MAX, foundChecks, settlerRange, suggestName, validName } from "./model";

export function FoundDialog({ site }: { site: SiteView }) {
  const statics = useGame((s) => s.statics);
  // 按字段选取（P14a）：只取用到的顶层字段，没变就不重渲染
  const overview = useOverviewFields("fleets", "cash");
  const submit = useGame((s) => s.submit);
  const key = locById(statics, site.loc)?.key ?? String(site.loc);
  const [roll, setRoll] = useState(0);
  const [name, setName] = useState(() => suggestName(key, 0));
  const [picked, setPicked] = useState<number | null>(null);
  // 殖民者人数：玩家没动过滑块时默认取上限（船员减去最低船员），多留人手开荒
  const [settlers, setSettlers] = useState<number | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const v2 = useIsV2();

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  if (!statics || !overview) return null;
  const l = locById(statics, site.loc);
  const entry = site.fleets_here.find(([id]) => id === picked) ?? site.fleets_here[0];
  const fleet = entry ? overview.fleets.find((f) => f.id === entry[0]) : undefined;
  const fleetReason = entry ? entry[1] : null;
  const range = fleet ? settlerRange(fleet, site.min_settlers) : { min: site.min_settlers, max: site.min_settlers - 1 };
  const crewOk = range.max >= range.min;
  const n = Math.max(range.min, Math.min(Math.max(range.min, range.max), settlers ?? range.max));
  const checks = foundChecks(statics, overview, site, fleet);
  const can = site.can_found && !!fleet && fleetReason === null && crewOk && validName(name);
  const title = t("colony.foundTitle", { site: l?.name ?? "" });
  const cancelButton = (
    <button type="button" className="btn" onClick={closeFoundDialog}>
      {t("colony.cancel")}
    </button>
  );

  const confirm = async () => {
    if (!fleet) return;
    const trimmed = name.trim();
    const r = await submit({ FoundColony: { owner: "player", fleet: fleet.id, site: site.loc, name: trimmed, settlers: n } });
    if (!r) return;
    const o = r.outcome;
    const id = typeof o === "object" && "ColonyFounded" in o ? o.ColonyFounded.colony : null;
    closeFoundDialog();
    const g = useGame.getState();
    g.notify(t("colony.foundDone", { name: trimmed, n }));
    // 切到殖民地街景（新殖民地所在的殖民点），再打开殖民地窗口
    g.selectLoc(site.loc);
    g.setStage("town");
    if (id !== null) openColony(id);
  };

  return createPortal(
    <div
      className="modal colony-found-modal"
      onKeyDown={(e) => {
        if (e.key === "Escape") closeFoundDialog();
      }}
    >
      <div className="modal-body pn pn-colonies colony-found" role="dialog" aria-modal="true" aria-label={title} data-testid="found-dialog">
        <h2 className="colony-found-title">
          <Sprite px={iconPx("claim")} scale={2} />
          {/* 标题里的地名：中文界面下方一小行英文原名 */}
          <BiName zh={l?.name ?? ""} en={l?.name_en}>
            {title}
          </BiName>
        </h2>
        <p className="sub">{t("colony.foundIntro")}</p>

        <div className="colony-found-name">
          <label className="field">
            <span>{t("colony.foundName")}</span>
            <input
              ref={nameRef}
              aria-label={t("colony.foundName")}
              value={name}
              maxLength={COLONY_NAME_MAX}
              placeholder={t("colony.foundNameHint")}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setRoll(roll + 1);
              setName(suggestName(key, roll + 1));
            }}
          >
            {t("colony.foundReroll")}
          </button>
        </div>

        {site.fleets_here.length > 1 && (
          <Select
            label={t("colony.foundFleet")}
            value={entry?.[0] ?? 0}
            options={site.fleets_here.map(([id]) => ({ value: id, label: t("holder.fleet", { id }) }))}
            onChange={setPicked}
          />
        )}

        <label className="field colony-found-settlers">
          <span>{t("colony.foundSettlers")}</span>
          <input
            type="range"
            aria-label={t("colony.foundSettlers")}
            min={range.min}
            max={Math.max(range.min, range.max)}
            step={1}
            value={n}
            disabled={!crewOk}
            onChange={(e) => setSettlers(Math.trunc(Number(e.target.value)) || range.min)}
          />
          <output className="colony-found-count">{n}</output>
        </label>
        {fleet && crewOk && (
          <p className="colony-line">{t("colony.foundSettlersLine", { n, left: fleet.crew - n, min: fleet.crew_min })}</p>
        )}
        {fleet && !crewOk && (
          <p className="colony-reason">
            {t("colony.foundCrewShort", {
              need: site.min_settlers + fleet.crew_min,
              settlers: site.min_settlers,
              crewMin: fleet.crew_min,
              have: fleet.crew,
            })}
          </p>
        )}

        <ul className="colony-checks" aria-label={t("colony.siteConditions")}>
          {checks.map((c) => (
            <li key={c.key} className={c.ok ? "ok" : "bad"}>
              {c.label}
            </li>
          ))}
        </ul>
        {!fleet && <p className="colony-reason">{t("colony.condNoFleet")}</p>}
        {!site.can_found && site.reason && <p className="colony-reason">{site.reason}</p>}
        {site.can_found && fleetReason && <p className="colony-reason">{fleetReason}</p>}

        <footer className="row colony-found-actions">
          {v2 && cancelButton}
          <ActionButton kind="primary" disabled={!can} onClick={confirm}>
            {t("colony.foundConfirm")}
          </ActionButton>
          {!v2 && cancelButton}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
