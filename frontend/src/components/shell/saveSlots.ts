// 存档与读档（顶栏菜单与养成画面的菜单共用）：成功时在提示条里回一句，失败时报错。
import { t } from "../../i18n";
import { tz } from "../../i18n/zhOnly";
import { api, errorText } from "../../ipc/api";
import { useGame } from "../../store/game";
import { gameSwitchFailed } from "../../store/gameSwitch";

/** 存档到槽位，成功时提示。 */
export async function saveTo(slot: string) {
  try {
    const info = await api.saveGame(slot);
    useGame.getState().notify(t("saved", { slot: info.slot }));
  } catch (e) {
    // S02nF7：没存上（存档槽满、写不进去）要说清楚是存档没成
    useGame.getState().fail(tz("save.failed", { slot, why: errorText(e) }));
  }
}

/**
 * FE2：读档失败是不是“存档不存在”。有错误码就认错误码（WebError 一类带 code：not_found / missing / save_missing），
 * 没有再认报错文字（Windows 的“找不到指定的文件”、os error 2、No such file 等）；认不出来算别的原因。
 */
export function loadMissing(e: unknown): boolean {
  const code = typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "";
  if (code) return /^(not_found|missing|save_missing|enoent)$/i.test(code) || /not_found|missing/i.test(code);
  return /找不到(?:指定的)?文件|os error 2(?!\d)|no such file|cannot find the file|ENOENT/i.test(errorText(e));
}

/** 从槽位读档，成功时提示；读完之前先在提示条里写“正在读档……”（别的世界的存档要先把世界读进来，11-03）。 */
export async function loadFrom(slot: string) {
  try {
    useGame.getState().notify(tz("load.loading"));
    const ov = await api.loadGame(slot);
    // 存档可能在别的世界：先按它换上静态数据再放入概览
    await useGame.getState().enterLoaded(ov);
    useGame.getState().notify(t("loaded", { slot }));
  } catch (e) {
    // S02nF7：读档没成（文件不在、读不进来）：说清楚，并让各处回到原来那一局（航行视图重取，见 store/gameSwitch.ts）
    gameSwitchFailed();
    // FE2：后端的原文只写进控制台；上屏的是人话——存档不存在一句，别的原因一句
    console.warn(`读档 ${slot} 失败：`, errorText(e));
    useGame.getState().fail(tz(loadMissing(e) ? "load.missing" : "load.failed", { slot }));
  }
}
