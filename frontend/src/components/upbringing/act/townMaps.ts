// 行动制主画面的城镇地图（第十轮 A03）：从高处斜着看下去的整片城镇，public/scenes/townmap_<城市>.webp（1536×768，2:1，会动），
// 由 tools/scenes/draw_new.py 出图与导出（提示词在 art-src/scenes.json 的 town_maps）。
//
// 图钉坐标是“这张图上的位置”（图宽、图高的百分比，0–100，图标中心），按画面逐个量过，跟着图走——换图就要重量。
// 数据里地点的 x、y（家庭 / 学院 places 的 0–100，契约 5 的 places[].x / y）只在这座城没有地图、或这张表里没有那个地点时才用
// （仍按 townKit.spotPos 往里收一圈摆在借来的场景图上）。所以：在有地图的城市，改数据的 x、y 不会挪图钉；新加的地点要来这里补坐标。
//
// 主画面按 cover 铺满（见 styles/upbringing-act.css 的 .ua-map-view--town）：窗口比 2:1 宽或窄时，图的上下或左右会裁掉一点
// （每边至多约 7%），所以图钉都放在 x 8–92、y 14–86 的安全区里。
//
// 季节（第十轮 A04）：现有的图算夏（常景）；另有 <file>--spring / --autumn / --winter 三季，是照原图换季重画的（draw_new.py season），
// 构图、建筑逐处不动，图钉坐标共用一套。按游戏里的月份挑（ubKit.seasonOfMonth：春 3–5、夏 6–8、秋 9–11、冬 12–2），
// 与地点场景走同一个季节函数；seasons 里没写的季退回常景。
import { publicImage } from "../../../art/imageUrl";
import { seasonOfMonth } from "../ubKit";

export interface TownMap {
  /** public/scenes/ 下的文件名主干（大图；会动的权重图是 <file>-rig.webp，清单 art/sceneLive.ts） */
  file: string;
  /** 图的宽高比 */
  ratio: number;
  /** 另画了的季节（文件 <file>--<季>.webp，同样会动）；没写的季用 file（夏 = 常景） */
  seasons: readonly ("spring" | "autumn" | "winter")[];
  /** 地点键 → [x, y]（图上的百分比，图标中心） */
  spots: Readonly<Record<string, readonly [number, number]>>;
}

/** 城市（视图的 town.key）→ 城镇地图。 */
export const TOWN_MAPS: Readonly<Record<string, TownMap>> = {
  // 土佐下田：四万十川从左下流向右下的河口（沙洲、渡船），镇子在河北岸，背后是山
  shimoda_tosa: {
    file: "townmap_shimoda_tosa",
    ratio: 2,
    seasons: ["spring", "autumn", "winter"],
    spots: {
      mio_home_shrine: [9.5, 24], // 左上山坡：朱红鸟居与石阶
      mio_home_home: [23.5, 30], // 土墙围着的宅邸（桧皮葺、门屋）
      mio_home_garden: [36.5, 32], // 宅邸右边的池庭（小桥、石灯笼）
      mio_home_classroom: [49, 22], // 山坡上的小寺（本堂与钟楼）
      mio_home_library: [69.5, 25], // 竹林边的草庵
      mio_home_market: [13, 57], // 河边的摊棚
      mio_home_trading_house: [45.5, 49], // 白壁土仓（商家的院子）
      mio_home_roof: [67.5, 42], // 镇上最高的两层仓房（大屋顶）
      mio_home_dock: [43, 72], // 河岸的栈桥与米包
      mio_home_workshop: [76, 60], // 河口边的造船棚
    },
  },
  // 京都宫中一带：左边宝镜寺，左上宫中的讲读间，上方公家的土仓，右上回廊围着的小庭，右边室町通，右下鸭川渡口
  kyoto: {
    file: "townmap_kyoto",
    ratio: 2,
    seasons: ["spring", "autumn", "winter"],
    spots: {
      kyoto_court_place_shrine: [10, 42], // 土墙围着的尼寺佛堂
      kyoto_court_place_classroom: [27.5, 30], // 白砂庭前的讲读间
      kyoto_court_place_library: [45, 22], // 白壁土仓（三条西家的书库）
      kyoto_court_place_garden: [66, 37], // 回廊围着的小庭（红叶）
      kyoto_court_place_market: [86, 42], // 室町通的町家
      kyoto_court_place_dock: [87, 76], // 鸭川的渡船与踏石
      kyoto_court_place_roof: [54.5, 56], // 伸到池上的月见台
      kyoto_court_place_dorm: [21, 66], // 长屋顶下的局（女房们住的一排房）
    },
  },
  // 能岛：整座小岛，四周是急流与漩涡；左边岩上的龙神祠，右下小早的泊位，正下方岬头的望楼
  noshima: {
    file: "townmap_noshima",
    ratio: 2,
    seasons: ["spring", "autumn", "winter"],
    spots: {
      noshima_boat_school_place_shrine: [10, 46], // 岩上的小祠与鸟居
      noshima_boat_school_place_classroom: [25, 27], // 船台边的草棚
      noshima_boat_school_place_library: [54.5, 17], // 最高一层台地上的板屋（收潮表）
      noshima_boat_school_place_garden: [73, 29], // 晒网的竹架
      noshima_boat_school_place_market: [86, 43], // 拉上岩棚的鱼贩小船
      noshima_boat_school_place_dock: [76, 66], // 栈桥边的小早与安宅船
      noshima_boat_school_place_roof: [47, 70], // 岬头的望楼
      noshima_boat_school_place_dorm: [24, 63], // 长长的船屋
    },
  },
};

/**
 * 行动制该用哪座城的地图（U06F2）：先看本阶段的地点键落在哪张图量过的图钉里（家乡 `mio_home_*` → 下田，
 * 京都 `kyoto_court_place_*` → kyoto，能岛 `noshima_boat_school_place_*` → noshima），对不上再用视图的城市键。
 * 这样即使后端给的城市键（cast 的所在地）与图的键不一致、或换阶段那一刻城市还没跟上，地图也和图钉一致。
 */
export function actTownKey(town: string | null | undefined, placeKeys: readonly string[]): string | null {
  let best: string | null = null;
  let hits = 0;
  for (const [key, m] of Object.entries(TOWN_MAPS)) {
    const n = placeKeys.filter((p) => Object.prototype.hasOwnProperty.call(m.spots, p)).length;
    if (n > hits) {
      best = key;
      hits = n;
    }
  }
  return best ?? town ?? null;
}

/** 这座城的地图（没有为 null）。 */
export function townMapOf(town: string | null | undefined): TownMap | null {
  return town && Object.prototype.hasOwnProperty.call(TOWN_MAPS, town) ? TOWN_MAPS[town] : null;
}

/** 这个月该用的那张图的文件名主干（有这一季就用这一季，否则常景）。 */
export function townMapFile(m: TownMap, month: number | undefined): string {
  if (month === undefined || !Number.isFinite(month)) return m.file;
  const s = seasonOfMonth(month);
  return s !== "summer" && m.seasons.includes(s) ? `${m.file}--${s}` : m.file;
}

/** 地图大图的地址（相对 public/ 的路径与文件名主干，同 townKit.TownArt 的 src / file）；给了月份时按季节挑。 */
export function townMapArt(m: TownMap, month?: number): { src: string; file: string; url: string } {
  const file = townMapFile(m, month);
  const src = `scenes/${file}.webp`;
  return { src, file, url: publicImage(src) };
}
