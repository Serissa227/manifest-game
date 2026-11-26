// 地方乐器的登记格式：一件乐器一个文件（同目录），由 index.ts 汇总进合成版的乐器表（instruments.ts 的 INSTRUMENTS）与鼓点表（DRUMS）。
//
// 新加一件乐器：
// 1. 在本目录写 <名字>.ts，导出一个 RegionalDef：key（曲谱里声部的 inst 写它）、地区、中英文名、instrument（拨弦 / 击奏 / 吹奏 / 弓弦 / 长音的参数，
//    见 ../../instruments.ts 与 ../../dsp.ts），打击乐写 drums（鼓点名 → 合成参数，声部用 inst: "perc"，伴奏型的 hits 里写这些名字）；
// 2. 写一段 demo（8–12 秒的音阶 + 典型装饰），试听台用它渲染音色样本，测试用它检查音域；
// 3. 在 index.ts 的 REGIONAL 里加一行。键与鼓点名不能与已有的重名（测试会查）。
import type { DrumSpec } from "../../dsp";
import type { Instrument } from "../../instruments";

/** 地区（报告与试听台按它分组）。 */
export type Region =
  | "japan"
  | "ming"
  | "ottoman"
  | "india"
  | "nusantara"
  | "andes"
  | "maya"
  | "swahili"
  // 第二阶段：文艺复兴的伊比利亚与意大利
  | "iberia_italy"
  // 第二阶段：北欧（低地国家、英格兰、法兰西、汉萨 / 波罗的海 / 斯堪的纳维亚、罗斯）
  | "north_europe"
  // 第二阶段：阿拉伯（埃及与马穆鲁克、红海、海湾）、波斯、马格里布与安达卢斯
  | "arabia"
  | "persia"
  | "maghreb"
  // 第二阶段：非洲（ethiopia 埃塞俄比亚高原与非洲之角，kongo 刚果与安哥拉，guinea 西非的几内亚海岸：曼丁的格里奥与贝宁湾）
  | "ethiopia"
  | "kongo"
  | "guinea"
  // 第二阶段：中南半岛与菲律宾（暹罗、缅甸、大越、菲律宾南部）
  | "siam"
  | "burma"
  | "vietnam"
  | "philippines"
  // 第二阶段：朝鲜、琉球、女真与满洲
  | "korea"
  | "ryukyu"
  | "jurchen"
  // 第二阶段：美洲（mexica 阿兹特克与纳瓦人、taino 加勒比的泰诺、tupi 巴西的图皮）
  | "mexica"
  | "taino"
  | "tupi"
  // 第二阶段：太平洋（波利尼西亚、密克罗尼西亚、美拉尼西亚）
  | "pacific";

/** 音色样本：一小段曲谱（4/4 拍，单位八分音符），旋律写 abc，打击乐写 drum。 */
export interface RegionalDemo {
  /** 调（theory.parseKey 的写法） */
  key: string;
  /** 每分钟四分音符数 */
  qpm: number;
  /** 小节数（abc 与 drum 都按它铺满） */
  bars: number;
  /** 旋律（ABC，见 ../../abc.ts），可以用 !bend! !fall! !vib! !slide! !trem! 等装饰 */
  abc?: string;
  /** 打击乐的格子（可以几层同时奏，例如塔布拉的左右手）：每个字符一格（grid 个八分音符，缺省 1），字符 → [鼓点名, 力度]，“.” 不奏 */
  drum?: readonly DemoDrum[];
}

/** 音色样本里的一层打击乐。 */
export interface DemoDrum {
  steps: string;
  hits: Readonly<Record<string, readonly [string, number]>>;
  grid?: number;
}

/** 一件地方乐器。 */
export interface RegionalDef {
  /** 乐器表的键（曲谱里声部的 inst）；只有鼓点的打击乐不写 */
  key?: string;
  region: Region;
  name: { zh: string; en: string };
  /** 乐器参数（拨弦、击奏、吹奏、弓弦、长音） */
  instrument?: Instrument;
  /** 鼓点：名字 → 合成参数（声部写 inst: "perc"） */
  drums?: Readonly<Record<string, DrumSpec>>;
  /** 音色样本 */
  demo: RegionalDemo;
}
