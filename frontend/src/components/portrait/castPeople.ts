// 新增人物位上的人：酒馆情报贩子、殖民地总管、各国君主、商会会长。
// 每个人给出素材 id、程序生成的中英成对名字、头衔与缺图时的回退头像；同一个输入永远是同一个人。
import { styleOf, type ArchStyle } from "../../art/buildings";
import type { NamePairText } from "../../art/names";
import { castName, companyAssetId, fallbackSpec, informantAssetId, rulerAssetId, stewardAssetId } from "../../art/portraitCast";
import type { NpcRole } from "../../art/portraits";
import type { Px } from "../../art/px";
import { nameOf, t, tk } from "../../i18n";
import type { LocView, StaticView } from "../../ipc/types";
import { portraitPx } from "../panels/panelArt";

export interface CastPerson {
  asset: string | null;
  name: NamePairText;
  title: string;
  fallback: () => Px;
}

function person(asset: string | null, seed: string, role: NpcRole, title: string, region?: ArchStyle, style?: string | null): CastPerson {
  return {
    asset,
    name: castName(asset, seed, region, style),
    title,
    fallback: () => portraitPx(fallbackSpec(asset, seed, role, region)),
  };
}

/** 有专门称号的君主（势力 key）；数据里新加的势力称“君主”。 */
const RULER_TITLES = new Set(["cuilan", "jinsui", "chisha", "bichao", "shuangling", "yaohua"]);

/** 势力的君主：头衔为“势力名 · 称号”（埃斯佩兰王国 · 国王）。 */
export function rulerOf(statics: StaticView, faction: number): CastPerson {
  const f = statics.factions[faction];
  const key = f?.key ?? "";
  const style = f ? styleOf(f.key, f.style) : undefined;
  const rank = tk(`cast.ruler.${RULER_TITLES.has(key) ? key : "other"}`);
  return person(rulerAssetId(key), `ruler-${key}`, "office", f ? `${nameOf(f)} · ${rank}` : rank, style);
}

/** NPC 商会的会长：头衔为“商会名 · 会长”。 */
export function companyHeadOf(statics: StaticView, company: number): CastPerson {
  const c = statics.companies[company];
  const asset = companyAssetId(company);
  const head = t("cast.companyHead");
  return person(asset, `company-head-${c?.name_en || c?.name || company}`, "guild", c ? `${nameOf(c)} · ${head}` : head);
}

/** 港口酒馆的情报贩子（按港口的文化，a / b 按港口 key）。 */
export function informantOf(statics: StaticView, loc: LocView): CastPerson {
  const f = statics.factions[loc.faction];
  const region = styleOf(f?.key, f?.style);
  return person(informantAssetId(region, loc.key), `informant-${loc.key}`, "tavern", t("cast.informant"), region, f?.style);
}

/** 殖民地总管（按殖民地编号）。 */
export function stewardOf(colony: number): CastPerson {
  return person(stewardAssetId(colony), `steward-${colony}`, "office", t("cast.steward"));
}
