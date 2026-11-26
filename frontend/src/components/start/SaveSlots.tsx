// 读档：存档列表做成一排“航海日志”，带船长头像、姓名、剧本、纪年日期（如“1502年2月1日”）与净资产。
// 每一行右边有“删除”：点了先在这一行里问一句（删掉之后找不回来），再点“删除”才删；“取消”或 Esc 收回。
// 新界面（v2，docs/UI-REDESIGN.md 第 8 节第 1 组）：删除改用共用的确认对话框（手机上从底部升起，主按钮写清删哪一个，
// 焦点先在“取消”）；没有存档时是共用的空状态，给一个“开始新的航程”。旧界面（v1）照旧。
import { useEffect, useRef, useState } from "react";
import { captainAssetId } from "../../art/portraitCast";
import { Sprite } from "../../art/Sprite";
import { dayDate, money, t } from "../../i18n";
import type { SaveInfo } from "../../ipc/types";
import { useIsV2 } from "../../ui/uiMode";
import { EmptyState, useConfirm } from "../feedback";
import { PortraitArt } from "../portrait/PortraitArt";
import { captainPortrait } from "./captain";
import { drawArrowIcon, drawSaveEmblem } from "./titleArt";

/** 存档信息：即后端的 SaveInfo（带主角，旧存档为空；保留旧名）。 */
export type SaveEntry = SaveInfo;

/** 这一行里的“真的要删吗”：删除（危险色）与取消；打开时焦点在“取消”上，免得一个回车就删掉。 */
function ConfirmDelete({ slot, busy, onYes, onNo }: { slot: string; busy: boolean; onYes: () => void; onNo: () => void }) {
  const no = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    no.current?.focus();
  }, []);
  return (
    <div
      className="ts-save-confirm"
      role="group"
      aria-label={t("start.saveDeleteAsk", { slot })}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onNo();
        }
      }}
    >
      <span className="ts-save-confirm-text">{t("start.saveDeleteAsk", { slot })}</span>
      <button type="button" className="btn danger" disabled={busy} onClick={onYes}>
        {t("start.saveDeleteYes")}
      </button>
      <button ref={no} type="button" className="btn" disabled={busy} onClick={onNo}>
        {t("start.saveDeleteNo")}
      </button>
    </div>
  );
}

export default function SaveSlots({
  saves,
  busy,
  onLoad,
  onDelete,
  onNew,
  worldName,
  retired,
  currentWorld,
  foreignName,
}: {
  saves: SaveEntry[];
  busy: boolean;
  onLoad: (slot: string) => void;
  /** 删除存档（没给时不显示“删除”）；返回 Promise 时确认对话框在办完之前写“正在办……” */
  onDelete?: (slot: string) => unknown;
  /** 没有存档时的下一步：开始新的航程（新界面空状态里的按钮；没给时不显示按钮） */
  onNew?: () => void;
  /** 第九批：存档所在世界的名字（世界多于一个时由开局画面按世界目录给出；查不到或不需要时为 undefined，不写世界） */
  worldName?: (key: string) => string | undefined;
  /** TITLE2：当前静态数据的世界；存档属于别的世界时这一行不写日期（别用这个世界的历法硬算），只写那个世界的名字 */
  currentWorld?: string;
  /** TITLE2：别的世界的名字（存档行不写日期时用） */
  foreignName?: (key: string) => string | undefined;
  /** 已下线的世界（旧剧本）：这一行不能读，只能删；存档文件不动 */
  retired?: (key: string) => boolean;
}) {
  const v2 = useIsV2();
  const confirm = useConfirm();
  // 正在问“真的要删吗”的那一行（旧界面：行内的确认条）
  const [asking, setAsking] = useState<string | null>(null);
  // 新界面：确认对话框（问 → 删 → 关；删除的回音由 onDelete 自己在提示条里报）
  const askDelete = (slot: string) => {
    if (!onDelete) return;
    if (!v2) return setAsking(slot);
    void confirm.run(
      { title: t("v2.start.deleteTitle", { slot }), body: t("v2.start.deleteBody"), confirmLabel: t("v2.start.deleteConfirm", { slot }) },
      () => onDelete(slot),
    );
  };
  if (saves.length === 0)
    return (
      <>
        <EmptyState
          text={t("startNoSaves")}
          hint={t("v2.start.noSavesHint")}
          action={onNew ? { label: t("v2.start.newVoyage"), onClick: onNew } : undefined}
          v1={<p className="ts-empty">{t("startNoSaves")}</p>}
        />
        {confirm.dialog}
      </>
    );
  return (
    <>
      <ul className="ts-saves">
        {saves.map((s) => {
          const world = worldName?.(s.world_key ?? "classic");
          const gone = retired?.(s.world_key ?? "classic") ?? false;
          const foreign = !!currentWorld && (s.world_key ?? "classic") !== currentWorld;
          return (
            <li key={s.slot} className={asking === s.slot ? "ts-save-row is-asking" : gone ? "ts-save-row is-retired" : "ts-save-row"}>
              <button
                type="button"
                className="ts-save"
                disabled={busy || gone}
                aria-label={t("start.saveOpen", { slot: s.slot })}
                onClick={() => onLoad(s.slot)}
              >
                <span className="ts-save-face">
                  {s.captain ? (
                    <PortraitArt asset={captainAssetId(s.captain.portrait)} fallback={() => captainPortrait(s.captain?.portrait ?? 0)} size={64} />
                  ) : (
                    <Sprite px={drawSaveEmblem()} scale={1} />
                  )}
                </span>
                <span className="ts-save-text">
                  <span className="ts-save-slot" title={s.slot}>{s.slot}</span>
                  <span className="ts-save-captain">
                    {s.captain
                      ? t("start.saveCaptain", { name: s.captain.name })
                      : s.hero
                        ? t("start.saveCaptain", { name: s.hero })
                        : t("start.saveNoCaptain")}
                  </span>
                  {gone && <span className="ts-save-retired">{t("start.saveRetired")}</span>}
                  <span className="ts-save-detail" data-foreign={foreign || undefined}>
                    {foreign
                      ? (foreignName?.(s.world_key ?? "classic") ?? world ?? s.scenario)
                      : t("start.saveDetail", {
                          scenario: world ? t("start.saveWorldScenario", { world, scenario: s.scenario }) : s.scenario,
                          day: dayDate(s.day),
                          worth: money(s.net_worth),
                        })}
                  </span>
                </span>
                <span className="ts-save-go">
                  <Sprite px={drawArrowIcon("right")} scale={3} />
                </span>
              </button>
              {onDelete &&
                (asking === s.slot ? (
                  <ConfirmDelete
                    slot={s.slot}
                    busy={busy}
                    onYes={() => {
                      setAsking(null);
                      onDelete(s.slot);
                    }}
                    onNo={() => setAsking(null)}
                  />
                ) : (
                  <button
                    type="button"
                    className="ts-save-del"
                    disabled={busy}
                    aria-label={t("start.saveDeleteLabel", { slot: s.slot })}
                    title={t("start.saveDeleteLabel", { slot: s.slot })}
                    onClick={() => askDelete(s.slot)}
                  >
                    {t("start.saveDelete")}
                  </button>
                ))}
            </li>
          );
        })}
      </ul>
      {confirm.dialog}
    </>
  );
}
