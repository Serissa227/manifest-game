// 潜水点（B12，docs/UI-CONTRACT.md “B12 潜水入口”）：探险窗口与航行视图共用的小工具。
// 后端的 DiscoveriesView.dives 列出玩家各舰队对每处潜水点能不能潜（与 Dive 命令的校验一致，不能时带当前语言的原因）；
// 界面按选中的舰队筛选。清单不给名字与坐标：名字只在传闻里出现过时才写（与“海上传闻”一致），否则按传闻的海区或“未探明”。
import { t } from "../../i18n";
import { discoveryById } from "../../ipc/byId";
import type { Command, DiscoveriesView, DiveOptionView, StaticView } from "../../ipc/types";

/** 这支舰队的潜水入口：已经发现过的不列（再潜只会被告知已经找到）；能潜的在前，其余按发现物编号。 */
export function divesOf(data: DiscoveriesView | null | undefined, fleet: number | null | undefined): DiveOptionView[] {
  if (!data || fleet === null || fleet === undefined) return [];
  const found = new Set(data.found.map((f) => f.id));
  return (data.dives ?? [])
    .filter((d) => d.fleet === fleet && !found.has(d.discovery))
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.discovery - b.discovery);
}

/**
 * 潜水点的称呼。还没发现，所以不从目录里泄露名字：听过传闻的，目录里有名字就写名字（传闻已经说过），
 * 没有（隐藏世界的目录只有发现过的）就写传闻的海区；连传闻也没有时写“未探明的潜水点”。
 */
export function diveName(statics: StaticView | null, data: DiscoveriesView | null | undefined, id: number): string {
  const rumor = data?.rumors?.find((r) => r.id === id);
  if (!rumor) return t("explore.diveUnknown");
  const def = discoveryById(statics, id);
  if (def) return def.name;
  return rumor.region_name ? t("explore.diveRumor", { region: rumor.region_name }) : t("explore.diveUnknown");
}

/** 潜水的命令。 */
export function diveCommand(fleet: number, discovery: number): Command {
  return { Dive: { owner: "player", fleet, discovery } };
}
