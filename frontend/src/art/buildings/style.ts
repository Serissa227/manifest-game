// 风格套件接口：每种建筑风格提供同一套“构件”（墙、台基、屋顶、门、窗、招牌……），
// 设施与民居的构图只调用这些构件，于是同一设施在各种风格下造型一致、材质各异。
import type { Facility } from "../../store/game";
import type { TownStyle } from "../buildings";
import { overlay } from "../palette";
import { type Canvas, type Ramp, tintOpaque } from "./kit";
import type { LampKind } from "./parts";

/**
 * 随机种子里的风格标签：五种已有风格沿用改名前的旧标签（按势力 key 命名时的写法），
 * 使改名前后同一风格的画面逐像素不变；新风格（含第九批的六种文化风格）直接用自己的名字。
 */
const SEED_TAG: Readonly<Record<TownStyle, string>> = {
  mediterranean: "mediterranean",
  nordic: "shuangling",
  lowland: "jinsui",
  desert: "chisha",
  islands: "bichao",
  eastern: "cuilan",
  frontier: "frontier",
  japanese: "japanese",
  ming: "ming",
  ottoman: "ottoman",
  swahili: "swahili",
  malay: "malay",
  maya: "maya",
};

/** 随机种子里使用的风格标签（见 SEED_TAG）。 */
export function seedTag(style: TownStyle): string {
  return SEED_TAG[style];
}

/** 墙体种类：main 主墙、ground 底层、upper 上层、stone 厚重石构（银行等）、plain 素墙。 */
export type WallKind = "main" | "ground" | "upper" | "stone" | "plain";
/** 屋顶种类：main 主屋顶、grand 正式大屋顶（带脊饰/圆顶）、tower 塔顶、porch 门廊小顶、shed 棚顶、gable 民居的另一种屋顶（山墙朝街等）。 */
export type RoofKind = "main" | "grand" | "tower" | "porch" | "shed" | "gable";
/** 窗：std 标准、tall 高窗、small 小窗、round 圆窗、wide 宽窗。 */
export type WinKind = "std" | "tall" | "small" | "round" | "wide";
/** 门：std 单扇、double 双开、grand 大门、open 敞开门洞、iron 铁门、barn 仓库大门。 */
export type DoorKind = "std" | "double" | "grand" | "open" | "iron" | "barn";

export interface Kit {
  readonly style: TownStyle;
  /** 设施门口与酒馆门上挂灯的样式（缺省按风格名查表，见 facilities.ts） */
  readonly lamp?: LampKind;
  /** 酒馆用的屋顶（缺省：低地、沙漠、北地、开拓者用 gable，其余用 main） */
  readonly tavernRoof?: RoofKind;
  /** 民居的台基用满高 plinthH（高脚屋；缺省只有群岛如此） */
  readonly stilted?: boolean;
  /** 势力旗色（暗、中、亮） */
  readonly flag: Ramp;
  /** 木作色阶（门框、柱、梁） */
  readonly trim: Ramp;
  /** 台基高度 */
  readonly plinthH: number;
  /** 遮阳棚两种条纹色 */
  readonly awning: readonly [Ramp, Ramp];
  /** 墙体 */
  wall(c: Canvas, x: number, y: number, w: number, h: number, kind?: WallKind): void;
  /** 台基：占据 [gy-h, gy) 行 */
  plinth(c: Canvas, x: number, w: number, h: number): void;
  /** 屋顶：墙体 x..x+w-1，墙顶 y；返回屋顶（含脊饰）最高点的 y */
  roof(c: Canvas, x: number, w: number, y: number, kind?: RoofKind): number;
  /** 楼层之间的腰线/横梁（占 2 行，顶在 y） */
  band(c: Canvas, x: number, w: number, y: number): void;
  /** 立柱：左边 x，从 y0 到 y1（含）；返回柱宽 */
  post(c: Canvas, x: number, y0: number, y1: number, kind?: "post" | "column"): number;
  /** 窗的尺寸 */
  winSize(kind?: WinKind): readonly [number, number];
  /** 窗：左上角 (x, y) */
  window(c: Canvas, x: number, y: number, kind?: WinKind): void;
  /** 门的尺寸 */
  doorSize(kind?: DoorKind): readonly [number, number];
  /** 门：中心 cx，门底在 bottom 行之上（门占 [bottom-h, bottom)） */
  door(c: Canvas, cx: number, bottom: number, kind?: DoorKind): void;
  /** 招牌：中心 cx，顶在 y；返回招牌高度 */
  sign(c: Canvas, cx: number, y: number, fac: Facility): number;
  /** 风格点缀（灯笼、渔网、花串……）：墙体 x..x+w-1，墙顶 y，墙底 bottom */
  decor(c: Canvas, x: number, w: number, y: number, bottom: number): void;
  /** 可选：开间门洞（拱廊、货摊的门面），左上角 (x, y)，宽 w 高 h；没有时用方形的暗门洞 */
  bay?(c: Canvas, x: number, y: number, w: number, h: number): void;
}

/** 檐下阴影：顶在 y，rows 行实影 + 1 行抖动。 */
export function eaveShadow(c: Canvas, x: number, w: number, y: number, rows = 2): void {
  tintOpaque(c.p, x, y, w, rows, overlay.shadow);
  tintOpaque(c.p, x, y + rows, w, 1, overlay.shadow, 2);
}

/** 按配色变体从候选里挑一个。 */
export function pickTone<T>(c: Canvas, options: readonly T[]): T {
  return options[((c.tone % options.length) + options.length) % options.length];
}

/** 在 [x, x+w) 中均匀排 n 扇窗，顶在 y；skip 返回 true 的位置不画（留给招牌、门）。 */
export function windowRow(c: Canvas, k: Kit, x: number, w: number, y: number, n: number, kind: WinKind = "std", skip?: (i: number) => boolean): number[] {
  const [ww] = k.winSize(kind);
  const xs: number[] = [];
  for (let i = 0; i < n; i++) {
    const cx = x + Math.round(((i + 0.5) * w) / n);
    const wx = cx - Math.floor(ww / 2);
    xs.push(cx);
    if (skip?.(i)) continue;
    k.window(c, wx, y, kind);
  }
  return xs;
}
