// 养成平时的轮换里加进出海以后的曲子：
// 这一阶段所在城市的港口曲、它外面那片海的航海曲与远洋的《晨星洋》怎么认（voyageTracksOf，与出海以后同一套选曲规矩），
// 怎么进摘要与曲目池，以及没有所在城市时一切照旧。
import { beforeEach, describe, expect, it } from "vitest";
import type { StaticView } from "../ipc/types";
import { TRACK_IDS, type TrackId } from "./tracks";
import {
  digestOf,
  everydayPool,
  publishUpbringing,
  UB_EVERYDAY,
  UB_OCEAN_TRACK,
  UB_TITLE_TRACK,
  useUbMusic,
  voyageTracksOf,
  type UbMusicDigest,
  type UbMusicSource,
} from "./upbringing";
import { rng } from "./score";
import { nextRotation, startRotation } from "./upbringing";

/** 一份只带配乐要看的东西的静态数据：两个势力（日本、明）、两片海、一座港、一座内陆城与一处殖民点。 */
const statics = {
  factions: [
    { key: "tosa", style: "japanese" },
    { key: "ming", style: "ming" },
  ],
  regions: [
    { id: 0, music: "japan" },
    { id: 1, music: "china" },
  ],
  locations: [
    { id: 0, key: "shimoda_tosa", kind: "port", faction: 0, region: 0, x: 900, y: 150 },
    { id: 1, key: "kyoto", kind: "city", faction: 0, region: null, x: 905, y: 145 },
    { id: 2, key: "zhangzhou", kind: "port", faction: 1, region: 1, x: 860, y: 170 },
    { id: 3, key: "wild_bay", kind: "site", faction: 0, region: 0, x: 910, y: 155 },
  ],
} as unknown as StaticView;

const source = (o: Partial<UbMusicSource> = {}): UbMusicSource => ({ stage: "home", phase: "plan", calendar: [], today: [1553, 1, 1], ...o });
const digest = (o: Partial<UbMusicDigest> = {}): UbMusicDigest => ({ stage: "home", phase: "plan", festival: false, contestDay: false, contestOpen: false, ...o });

describe("出海以后会听到的曲子（voyageTracksOf）", () => {
  it("家乡港：港口曲、外面那片海的航海曲、远洋的《晨星洋》，都在曲目表里", () => {
    expect(voyageTracksOf(statics, "shimoda_tosa")).toEqual(["port_japan", "sea_japan", "ocean"]);
    expect(voyageTracksOf(statics, "zhangzhou")).toEqual(["port_ming", "sea_ming", "ocean"]);
    for (const id of voyageTracksOf(statics, "shimoda_tosa")) expect(TRACK_IDS).toContain(id);
    expect(UB_OCEAN_TRACK).toBe("ocean");
  });

  it("内陆城市没有海区：只有港口曲与远洋的一首", () => {
    expect(voyageTracksOf(statics, "kyoto")).toEqual(["port_japan", "ocean"]);
  });

  it("认不出的地点、殖民点、没有静态数据或没有所在城市：没有", () => {
    expect(voyageTracksOf(statics, "nowhere")).toEqual([]);
    expect(voyageTracksOf(statics, "wild_bay")).toEqual([]);
    expect(voyageTracksOf(null, "shimoda_tosa")).toEqual([]);
    expect(voyageTracksOf(statics, null)).toEqual([]);
    expect(voyageTracksOf(statics, undefined)).toEqual([]);
  });
});

describe("摘要与曲目池", () => {
  beforeEach(() => {
    useUbMusic.setState({ digest: null });
  });

  it("没有出海的曲子时摘要里没有这一项（与原来一模一样）；有时原样带上", () => {
    expect(digestOf(source())).not.toHaveProperty("voyage");
    expect(digestOf(source(), false, [])).not.toHaveProperty("voyage");
    expect(digestOf(source(), false, ["port_japan", "sea_japan"]).voyage).toEqual(["port_japan", "sea_japan"]);
  });

  it("曲目池：出海的曲子排在通用的平时曲之后、主页面的曲子之前，不重复", () => {
    const pool = everydayPool(digest({ protagonist: "mio", voyage: ["port_japan", "sea_japan", "ocean"] }));
    expect(pool).toEqual(["ub_home", "ub_home_japan", ...UB_EVERYDAY, "port_japan", "sea_japan", "ocean", UB_TITLE_TRACK]);
    // 自创主角的家乡曲先借同一文化的港口曲：出海的港口曲与它是同一首，只算一次
    const korea = everydayPool(digest({ protagonist: "template_pilot", culture: "korean", voyage: ["port_korea", "sea_east_china", "ocean"] }));
    expect(korea.filter((id) => id === "port_korea")).toHaveLength(1);
    expect(new Set(korea).size).toBe(korea.length);
    // 没有这一项时照旧
    expect(everydayPool(digest({ protagonist: "mio" }))).toEqual(["ub_home", "ub_home_japan", ...UB_EVERYDAY, UB_TITLE_TRACK]);
  });

  it("加进来以后平时的曲子多了三首，轮一圈每首都轮得到、同一首不连着放", () => {
    const before = everydayPool(digest({ protagonist: "mio" }));
    const pool = everydayPool(digest({ protagonist: "mio", voyage: voyageTracksOf(statics, "shimoda_tosa") }));
    expect(pool.length).toBe(before.length + 3);
    const rand = rng(11);
    let rot = startRotation(pool, rand);
    const played: TrackId[] = [rot.current];
    for (let i = 0; i < pool.length * 3; i++) {
      rot = nextRotation(rot, rand);
      expect(rot.current).not.toBe(played[played.length - 1]);
      played.push(rot.current);
    }
    for (const id of pool) expect(played).toContain(id);
  });

  it("养成主画面发布摘要时带上所在城市出海以后的曲子；内容没变不重复通知；换了城市（进学院）跟着换", () => {
    let notified = 0;
    const off = useUbMusic.subscribe(() => notified++);
    publishUpbringing(source({ town: { key: "shimoda_tosa" } }), false, statics);
    expect(useUbMusic.getState().digest?.voyage).toEqual(["port_japan", "sea_japan", "ocean"]);
    expect(notified).toBe(1);
    publishUpbringing(source({ town: { key: "shimoda_tosa" } }), false, statics);
    expect(notified).toBe(1);
    publishUpbringing(source({ stage: "academy", town: { key: "kyoto" } }), false, statics);
    expect(useUbMusic.getState().digest?.voyage).toEqual(["port_japan", "ocean"]);
    expect(notified).toBe(2);
    // 没给静态数据或所在城市：没有这一项
    publishUpbringing(source({ stage: "academy", town: { key: "kyoto" } }));
    expect(useUbMusic.getState().digest).not.toHaveProperty("voyage");
    publishUpbringing(source({ stage: "academy" }), false, statics);
    expect(useUbMusic.getState().digest).not.toHaveProperty("voyage");
    off();
  });
});
