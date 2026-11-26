// 航海士头像在两种语言下是同一张脸（EXPANSION.md §12）：英文界面里后端给出英文小传，
// 小传里的外貌线索（眼罩、红发、金发盘发、鬓边的花……）要用英文再认出来，得到与中文小传相同的头像参数。
// 下面的小传取自 data/mates.toml 与英文覆盖 data/locales/en/mates.toml（样例固定在这里，数据改写时这里不受影响）。
import { describe, expect, it } from "vitest";
import type { ArchStyle } from "./buildings";
import { mateSpec } from "./portraits";

/** 英文小传里的地名 → 文化（运行时由静态数据里的英文地名生成，见 portraits.ts 的 englishPlaces）。 */
const PLACES: readonly (readonly [RegExp, ArchStyle])[] = [
  [/\bIsbrunn\b/, "nordic"],
  [/\bNordvakt\b/, "nordic"],
  [/\bQadira\b/, "desert"],
  [/\bAkakora\b/, "islands"],
  [/\bHala Bay\b/, "desert"],
];

/** [英文正名, 中文名, 中文小传, 英文小传] */
const MATES: readonly (readonly [string, string, string, string])[] = [
  [
    "Hilde Valkensdottir",
    "希尔德·瓦尔肯斯多蒂尔",
    "伊斯布伦大商家出走的千金，浅金色的头发总是盘得一丝不乱。她精通北方诸港的行情，也摸透了各家掌柜的脾气。",
    "The runaway heiress of a great Isbrunn merchant house, her pale gold hair always pinned up without a strand out of place. She knows the markets of every northern port, and the temper of every factor in them.",
  ],
  [
    "Hallvar Grafen",
    "哈尔瓦尔·格拉芬",
    "诺德瓦克特的老舵手，胡子花白，左眼蒙着黑布，据说年轻时在霜语海的风暴里丢了它。",
    "An old helmsman of Nordvakt with a grizzled beard and a black patch over his left eye, lost, they say, to a storm on the Frostwhisper Sea when he was young.",
  ],
  [
    "Nasrin al-Hadi",
    "娜斯琳·阿尔哈迪",
    "卡迪拉的前护卫统领，她红发如火，擅使一对弯刀，也擅长把一群醉醺醺的水手练成像样的战士。",
    "Former captain of the guard at Qadira, with hair as red as flame. She fights with a pair of scimitars, and is just as good at turning a crowd of drunken sailors into proper fighters.",
  ],
  [
    "Tiare Vakaloa",
    "蒂阿蕾·瓦卡洛阿",
    "阿卡科拉的独木舟领航员，她鬓边总插着一朵红花，只凭浪涌与海鸟就能找到看不见的岛屿。",
    "An outrigger navigator from Akakora who always wears a red flower above her ear. By the swell and the seabirds alone she can find islands no one can see.",
  ],
  [
    "Karim al-Najmi",
    "卡里姆·阿尔纳吉米",
    "哈拉湾天文台的学徒出身，深色皮肤，胡须修剪整齐，随身带着祖传的黄铜星盘，能在无月之夜算出船位。",
    "Trained as an apprentice at the Hala Bay observatory, dark-skinned with a neatly trimmed beard. He carries his family's brass astrolabe and can work out a ship's position on a moonless night.",
  ],
  [
    "Ethelin Losaen",
    "艾瑟琳·洛萨恩",
    "研究阿尔坎遗迹的学者，据说祖母是林中的精裔。她有一对微尖的耳朵和一双看过太多古书的灰眼睛。",
    "A scholar of Arkan ruins whose grandmother, they say, was one of the Elder Folk of the forests. She has slightly pointed ears and gray eyes that have read too many old books.",
  ],
];

describe("英文小传的外貌线索与中文小传一致（切换语言不换脸）", () => {
  it("同一位航海士：中文小传与英文小传得到完全相同的头像参数", () => {
    for (const [nameEn, nameZh, bioZh, bioEn] of MATES) {
      const zh = mateSpec({ name: nameZh, name_en: nameEn, bio: bioZh }, "mediterranean", PLACES);
      const en = mateSpec({ name: nameEn, name_en: nameEn, bio: bioEn }, "mediterranean", PLACES);
      expect(en, nameEn).toEqual(zh);
    }
  });

  it("编辑指出的四处线索在英文里都认得出来", () => {
    const spec = (bio: string) => mateSpec({ name: "X", name_en: "X", bio });
    expect(spec("a black patch over his left eye").eyepatch).toBe(true);
    expect(spec("a patch over one eye").eyepatch).toBe(true);
    expect(spec("with hair as red as flame").hairColor).toBe("auburn");
    expect(spec("flame-red hair").hairColor).toBe("auburn");
    const hilde = spec("her pale gold hair always pinned up");
    expect(hilde.hairColor).toBe("blond");
    expect(["bun", "updo"]).toContain(hilde.hair);
    expect(spec("she wears a red flower above her ear").hat).toBe("flower");
    expect(spec("a flower tucked behind her ear").hat).toBe("flower");
  });

  it("不误认：只是提到红色、金子或花的句子不改头像", () => {
    const plain = mateSpec({ name: "Y", name_en: "Y", bio: "He trades gold and red cloth, and grows flowers." });
    const base = mateSpec({ name: "Y", name_en: "Y", bio: "He trades cloth." });
    expect(plain.hairColor).toBe(base.hairColor);
    expect(plain.hat).toBe(base.hat);
    expect(plain.eyepatch).toBe(base.eyepatch);
  });
});
