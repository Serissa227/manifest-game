// 港口街景预览：七种建筑风格与六种文化城镇风格 × 春/冬 × 宽 480 与 640，外加内陆城市（npx vite-node scripts/art-preview.ts port.preview）。
// 殖民地：小、中、大三个发展阶段（开拓者风格与所有者风格），殖民点：八种地形的荒野海湾（春与冬）。
// 昼夜与天气：同一港口的四个时段、各种天况（白天与夜里）、风朝西、闪电那一帧，殖民地与殖民点的夜景、雾景与雪景。
// 港口数据在这里手写几组；旗色取后端按势力顺序分配的颜色。风格由势力 key 映射（townStyleOf），或由 style 直接指定
// （第九批的六种文化城镇风格：日本、明、奥斯曼、斯瓦希里、马来、玛雅各一个港口）。
import { townStyleOf } from "../art/buildings";
import { sheet, type Preview } from "../art/px";
import { lightningAt, TIMES_OF_DAY, WEATHERS } from "../art/scenery";
import { COLONY_KEYS } from "../art/buildings";
import { composePortScene, facilitiesAt, TERRAINS, type PortSceneParams, type SceneColony } from "./port";

const PORTS: Omit<PortSceneParams, "season" | "width">[] = [
  { key: "chenggang", name: "澄港", kind: "port", faction: "cuilan", flag: "#c0392b", facilities: facilitiesAt("port", true, true), flagship: { type: 1, sail: "square" }, others: 2 },
  { key: "bingquan", name: "冰泉", kind: "port", faction: "shuangling", flag: "#8e44ad", facilities: facilitiesAt("port", true, false), flagship: { type: 0, sail: "lateen" }, others: 1 },
  { key: "jinsuigang", name: "金穗港", kind: "port", faction: "jinsui", flag: "#2e86c1", facilities: facilitiesAt("port", true, true), flagship: { type: 2, sail: "square" }, others: 3 },
  { key: "chishagang", name: "赤砂港", kind: "port", faction: "chisha", flag: "#d4ac0d", facilities: facilitiesAt("port", true, true), flagship: { type: 3, sail: "lateen" }, others: 2 },
  { key: "bichaogang", name: "碧潮港", kind: "port", faction: "bichao", flag: "#27ae60", facilities: facilitiesAt("port", false, false), flagship: null, others: 2 },
  { key: "yaohuagang", name: "瑶华港", kind: "port", faction: "yaohua", flag: "#e67e22", facilities: facilitiesAt("port", true, true), flagship: { type: 1, sail: "lateen" }, others: 2 },
  { key: "kaituo", name: "开拓者殖民地", kind: "port", faction: "cuilan", style: "frontier", flag: "#c0392b", facilities: facilitiesAt("port", false, false), flagship: null, others: 1 },
  ...(["japanese", "ming", "ottoman", "swahili", "malay", "maya"] as const).map((style) => ({
    key: `terra-${style}`,
    name: style,
    kind: "port" as const,
    faction: "terra",
    style,
    flag: "#c0392b",
    facilities: facilitiesAt("port", true, true),
    flagship: { type: 1, sail: "square" as const },
    others: 2,
  })),
];

const CITIES: Omit<PortSceneParams, "season" | "width">[] = [
  { key: "lancheng", name: "岚城", kind: "city", faction: "cuilan", flag: "#c0392b", facilities: facilitiesAt("city", false, false) },
  { key: "tuocheng", name: "驼城", kind: "city", faction: "chisha", flag: "#d4ac0d", facilities: facilitiesAt("city", false, false) },
  { key: "xueyuan", name: "雪原城", kind: "city", faction: "shuangling", flag: "#8e44ad", facilities: facilitiesAt("city", false, false) },
];

/** 殖民地的三个发展阶段。 */
const STAGES: [string, SceneColony][] = [
  ["small", { population: 40, buildings: [{ key: "housing", level: 1 }, { key: "farm", level: 1 }, { key: "storehouse", level: 1 }, { key: "lumber", level: 1 }] }],
  [
    "medium",
    {
      population: 220,
      buildings: [
        { key: "housing", level: 2 },
        { key: "farm", level: 2 },
        { key: "lumber", level: 2 },
        { key: "storehouse", level: 2 },
        { key: "dock", level: 1 },
        { key: "chapel", level: 1 },
        { key: "fort", level: 1 },
        { key: "tavern", level: 1 },
        { key: "fishery", level: 1 },
      ],
    },
  ],
  ["large", { population: 900, buildings: COLONY_KEYS.map((key, i) => ({ key, level: i % 4 === 3 ? 2 : 3 })) }],
];

export default function preview(): Preview[] {
  const out: Preview[] = [];
  const frame = 13;
  for (const p of PORTS) {
    for (const season of [0, 3]) {
      for (const width of [480, 640]) {
        const { px } = composePortScene({ ...p, season, width }, frame);
        out.push({ name: `${townStyleOf(p.faction, p.style)}-${season === 0 ? "spring" : "winter"}-${width}`, px: px.clone(), scale: 2 });
      }
    }
  }
  for (const c of CITIES) {
    for (const season of [1, 3]) {
      const { px } = composePortScene({ ...c, season, width: 640 }, frame);
      out.push({ name: `city-${townStyleOf(c.faction, c.style)}-${season === 1 ? "summer" : "winter"}-640`, px: px.clone(), scale: 2 });
    }
  }
  // 殖民地：三个发展阶段（开拓者风格的森林殖民地、埃斯佩兰风格的丛林殖民地）
  for (const [stage, colony] of STAGES) {
    for (const [tag, style, terrain, flag] of [
      ["frontier", "frontier", "forest", "#c0392b"],
      ["esperan", "mediterranean", "jungle", "#c0392b"],
    ] as const) {
      const p: PortSceneParams = {
        key: `colony-${tag}`,
        name: "新殖民地",
        kind: "colony",
        faction: "cuilan",
        style,
        flag,
        terrain,
        colony,
        facilities: stage === "small" ? [] : facilitiesAt("colony", false, false),
        season: 1,
        width: 640,
        flagship: { type: 1, sail: "square" },
        others: 1,
      };
      out.push({ name: `colony-${stage}-${tag}-640`, px: composePortScene(p, frame).px.clone(), scale: 2 });
    }
  }
  {
    const colony = STAGES[1][1];
    const base: PortSceneParams = { key: "colony-tundra", kind: "colony", faction: "shuangling", style: "nordic", flag: "#8e44ad", terrain: "tundra", colony, facilities: [], season: 3, width: 480, flagship: null, others: 0 };
    out.push({ name: "colony-medium-tundra-winter-480", px: composePortScene(base, frame).px.clone(), scale: 2 });
    out.push({ name: "colony-large-desert-400", px: composePortScene({ ...base, key: "colony-desert", style: "desert", terrain: "desert", season: 2, width: 400, colony: STAGES[2][1] }, frame).px.clone(), scale: 2 });
    out.push({ name: "colony-hover-chapel", px: composePortScene({ ...base, season: 1, hoverBuilding: "chapel" }, frame).px.clone(), scale: 2 });
  }
  // 殖民点：八种地形的荒野海湾（春、冬），主角的船下锚在湾里
  for (const terrain of TERRAINS) {
    for (const season of [0, 3]) {
      const p: PortSceneParams = {
        key: `site-${terrain}`,
        kind: "site",
        faction: "",
        terrain,
        ruins: terrain === "jungle" || terrain === "desert" || terrain === "hills",
        facilities: [],
        season,
        width: 640,
        flagship: { type: 0, sail: "lateen" },
        others: 1,
      };
      out.push({ name: `site-${terrain}-${season === 0 ? "spring" : "winter"}-640`, px: composePortScene(p, frame).px.clone(), scale: 2 });
    }
  }
  // 悬停高亮与动画帧（看云、海、行人是否连贯）
  const base = { ...PORTS[0], season: 1, width: 640 };
  out.push({ name: "hover-market", px: composePortScene({ ...base, hover: "market" }, 0).px.clone(), scale: 2 });
  out.push({ name: "hover-exchange", px: composePortScene({ ...base, hover: "exchange" }, 0).px.clone(), scale: 2 });
  for (const f of [0, 20]) out.push({ name: `anim-${f}`, px: composePortScene(base, f).px.clone(), scale: 2 });
  // 宽屏
  out.push({ name: "wide-960", px: composePortScene({ ...PORTS[2], season: 2, width: 960 }, frame).px.clone(), scale: 1 });

  // 昼夜：四个时段（晴）
  const day = { ...PORTS[0], season: 1, width: 640 };
  out.push({ name: "phase-4", px: sheet(TIMES_OF_DAY.map((time) => composePortScene({ ...day, time, weather: "clear" }, frame).px.clone()), { cols: 2, gap: 2, bg: "#000000" }), scale: 1 });
  for (const time of TIMES_OF_DAY) out.push({ name: `phase-${time}`, px: composePortScene({ ...day, time, weather: "clear" }, frame).px.clone(), scale: 2 });
  // 天况：白天与夜里各六种
  for (const time of ["day", "night"] as const) {
    out.push({
      name: `weather-${time}`,
      px: sheet(WEATHERS.map((weather) => composePortScene({ ...day, time, weather, windX: 0.8, windStrength: 6 }, frame).px.clone()), { cols: 2, gap: 2, bg: "#000000" }),
      scale: 1,
    });
  }
  out.push({ name: "rain-day", px: composePortScene({ ...day, time: "day", weather: "rain", windX: -0.7, windStrength: 5 }, frame).px.clone(), scale: 2 });
  out.push({ name: "fog-dawn", px: composePortScene({ ...day, time: "dawn", weather: "fog", windX: 0.3 }, frame).px.clone(), scale: 2 });
  out.push({ name: "night-rain", px: composePortScene({ ...day, time: "night", weather: "rain", windX: 0.5 }, frame).px.clone(), scale: 2 });
  // 风朝西：云、旗、炊烟朝左
  out.push({ name: "wind-west", px: composePortScene({ ...day, time: "day", weather: "cloudy", windX: -1, windStrength: 8 }, 30).px.clone(), scale: 2 });
  // 暴风雨：闪电那一帧
  let flash = 0;
  while (lightningAt(flash) < 0.15) flash++;
  out.push({ name: "storm-flash", px: composePortScene({ ...day, time: "dusk", weather: "storm", windX: 1, windStrength: 9 }, flash).px.clone(), scale: 2 });
  // 寒冷港口的冬夜雪景、内陆城市的夜
  out.push({ name: "snow-night-nordic", px: composePortScene({ ...PORTS[1], season: 3, width: 640, time: "night", weather: "snow", windX: -0.5 }, frame).px.clone(), scale: 2 });
  out.push({ name: "city-night", px: composePortScene({ ...CITIES[0], season: 1, width: 640, time: "night", weather: "clear" }, frame).px.clone(), scale: 2 });
  // 殖民地的夜、殖民点的雾晨
  {
    const colony: PortSceneParams = { key: "colony-frontier", kind: "colony", faction: "cuilan", style: "frontier", flag: "#c0392b", terrain: "forest", colony: STAGES[1][1], facilities: facilitiesAt("colony", false, false), season: 1, width: 640, flagship: { type: 1, sail: "square" }, others: 1 };
    out.push({ name: "colony-night", px: composePortScene({ ...colony, time: "night", weather: "clear" }, frame).px.clone(), scale: 2 });
    out.push({ name: "colony-dusk-rain", px: composePortScene({ ...colony, time: "dusk", weather: "rain" }, frame).px.clone(), scale: 2 });
    const site: PortSceneParams = { key: "site-island", kind: "site", faction: "", terrain: "island", facilities: [], season: 1, width: 640, flagship: { type: 0, sail: "lateen" }, others: 1 };
    out.push({ name: "site-dawn-fog", px: composePortScene({ ...site, time: "dawn", weather: "fog" }, frame).px.clone(), scale: 2 });
    out.push({ name: "site-night", px: composePortScene({ ...site, time: "night", weather: "clear" }, frame).px.clone(), scale: 2 });
  }
  return out;
}
