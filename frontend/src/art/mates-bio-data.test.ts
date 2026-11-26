// 真实数据里的每位航海士：中文小传与英文小传得到同一张程序头像（切换语言不换脸，EXPANSION.md §12）。
// 程序头像是 AI 肖像缺图时的回退（英雄扩充的新航海士在肖像画好之前就用它），所以两种语言下都得是同一张脸。
// 地名按运行时的规则认：港口与城市的英文名 → 所属势力的文化（同 portraits.ts 的 englishPlaces），出身港口的文化作缺省。
import { describe, expect, it } from "vitest";
import factionsToml from "../../../data/factions.toml?raw";
import factionsEnToml from "../../../data/locales/en/factions.toml?raw";
import matesEnToml from "../../../data/locales/en/mates.toml?raw";
import citiesEnToml from "../../../data/locales/en/world/cities.toml?raw";
import overseasEnToml from "../../../data/locales/en/world/overseas.toml?raw";
import portsEnToml from "../../../data/locales/en/world/ports.toml?raw";
import matesToml from "../../../data/mates.toml?raw";
import citiesToml from "../../../data/world/cities.toml?raw";
import overseasToml from "../../../data/world/overseas.toml?raw";
import portsToml from "../../../data/world/ports.toml?raw";
import { englishPlaces, mateSpec, styleAtLoc, type StyleSource } from "./portraits";

/** TOML 里 [[<表>]] 条目的若干字符串字段（按出现顺序；缺的字段为空串）。只认独占一行的表头（注释里提到的不算）。 */
function entries(text: string, table: string, fields: readonly string[]): Record<string, string>[] {
  return text
    .split(new RegExp(`^\\[\\[${table}\\]\\]\\s*$`, "m"))
    .slice(1)
    .map((block) => Object.fromEntries(fields.map((f) => [f, new RegExp(`^${f}\\s*=\\s*"([^"]*)"`, "m").exec(block)?.[1] ?? ""])));
}

/** 英文覆盖里 [<表>.<key>] 的某个字符串字段：key → 值。 */
function overrides(text: string, table: string, field: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = new RegExp(`^\\[${table}\\.([a-z0-9_]+)\\]$`, "gm");
  const heads = [...text.matchAll(re)];
  heads.forEach((m, i) => {
    const body = text.slice(m.index + m[0].length, heads[i + 1]?.index ?? text.length);
    const v = new RegExp(`^${field}\\s*=\\s*"([^"]*)"`, "m").exec(body)?.[1];
    if (v !== undefined) out.set(m[1], v);
  });
  return out;
}

const factions = entries(factionsToml, "factions", ["key", "style"]);
const factionEn = overrides(factionsEnToml, "factions", "name");
/** 地点（港口、海外港口、内陆城市，按静态数据的顺序）：key、所属势力与英文名。 */
function locations(text: string, table: string, enText: string): { key: string; faction: string; en: string | undefined }[] {
  const en = overrides(enText, table === "cities" ? "cities" : "ports", "name");
  return entries(text, table, ["key", "faction"]).map((p) => ({ key: p.key, faction: p.faction, en: en.get(p.key) }));
}
const places = [...locations(portsToml, "ports", portsEnToml), ...locations(overseasToml, "ports", overseasEnToml), ...locations(citiesToml, "cities", citiesEnToml)];
const statics: StyleSource = {
  locations: places.map((p, id) => ({ id, faction: factions.findIndex((f) => f.key === p.faction), name_en: p.en ?? null })),
  factions: factions.map((f) => ({ key: f.key, style: f.style || null, name_en: factionEn.get(f.key) ?? null })),
};
const mates = entries(matesToml, "mates", ["key", "name", "bio", "home"]);
const matesEnName = overrides(matesEnToml, "mates", "name");
const matesEnBio = overrides(matesEnToml, "mates", "bio");

describe("真实数据：航海士的中英文小传得到同一张程序头像", () => {
  it("数据读得出来：港口、城市与航海士都有英文名", () => {
    expect(places.length).toBeGreaterThanOrEqual(40);
    expect(places.every((p) => p.en)).toBe(true);
    expect(mates.length).toBeGreaterThanOrEqual(40);
    for (const m of mates) {
      expect(matesEnName.get(m.key), m.key).toBeTruthy();
      expect(matesEnBio.get(m.key), m.key).toBeTruthy();
    }
  });

  it("每一位（包括英雄扩充的 18 位新航海士）：中文与英文小传的外貌线索、出身与性别一致", () => {
    const where = englishPlaces(statics);
    for (const m of mates) {
      const nameEn = matesEnName.get(m.key) ?? m.name;
      const region = styleAtLoc(statics, places.findIndex((p) => p.key === m.home));
      const zh = mateSpec({ name: m.name, name_en: nameEn, bio: m.bio, key: m.key }, region, where);
      const en = mateSpec({ name: nameEn, name_en: nameEn, bio: matesEnBio.get(m.key) ?? "", key: m.key }, region, where);
      expect(en, m.key).toEqual(zh);
    }
  });

  it("英雄扩充的新航海士：小传里的外貌画在程序头像上（两种语言相同）", () => {
    const where = englishPlaces(statics);
    const spec = (key: string) => {
      const m = mates.find((x) => x.key === key);
      if (!m) throw new Error(`没有航海士 ${key}`);
      const nameEn = matesEnName.get(key) ?? m.name;
      return mateSpec({ name: nameEn, name_en: nameEn, bio: matesEnBio.get(key) ?? "", key }, undefined, where);
    };
    // 老舵工：晒得黝黑、灰白的头发挽成短髻（瑶华）
    const luo = spec("luo_changfeng");
    expect([luo.female, luo.age, luo.hair, luo.region]).toEqual([false, 2, "topknot", "eastern"]);
    expect(luo.skin).toBeGreaterThanOrEqual(2);
    // 唇上的细须、两撇八字胡
    expect(spec("xie_qingyan").beard).toBe("mustache");
    expect(spec("yusuf_albunni").beard).toBe("mustache");
    // 黑色卷发、晒得黝黑的领港人
    const diego = spec("diego_solano");
    expect([diego.hair, diego.bangs]).toEqual(["curly", "curly"]);
    expect(diego.skin).toBeGreaterThanOrEqual(2);
    // 结霜的短须（随机的胡子样式保留，没有胡子的补上络腮胡）与熊皮斗篷
    const einar = spec("einar_lund");
    expect(["none", "stubble", "mustache"]).not.toContain(einar.beard);
    expect([einar.hat, einar.region]).toEqual(["hood", "nordic"]);
    // 女性：头巾、卷发、粗辫、高髻、晒黑的皮肤
    expect([spec("zahra_alsabbagh").female, spec("zahra_alsabbagh").hat]).toEqual([true, "hood"]);
    expect(spec("ines_pardo").hair).toBe("curls");
    expect(spec("qin_hongying").hair).toBe("braids");
    expect(["bun", "updo"]).toContain(spec("mahina_tauvela").hair);
    expect(spec("shadia_albahri").skin).toBeGreaterThanOrEqual(2);
    // 浅金头发的两位美少年型男子，一位是灰蓝（按蓝）眼睛
    const thijs = spec("thijs_vanoosten");
    expect([thijs.female, thijs.hairColor, thijs.eyeColor]).toEqual([false, "blond", 2]);
    expect(spec("eivind_solberg").hairColor).toBe("blond");
    // 出身文化按小传：瑶华的四位、努拉巴德、莫图侯、奥斯特瓦尔德……
    for (const key of ["shen_zhiwei", "xie_qingyan", "qin_hongying"]) expect(spec(key).region, key).toBe("eastern");
    expect(spec("zahra_alsabbagh").region).toBe("desert");
    expect(spec("manu_ravaka").region).toBe("islands");
    expect(spec("thijs_vanoosten").region).toBe("lowland");
  });
});
