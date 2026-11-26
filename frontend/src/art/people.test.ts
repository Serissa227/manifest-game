// 人物美术：头像与行人的确定性、尺寸、多样性，主角外貌、航海士性别、掌柜姓名的规则；
// 以及 64×64 美型头像的文化服饰、精灵血统、只用共享调色板，姓名的文化格式（西方“名·姓”、东方“姓名”）。
import { describe, expect, it } from "vitest";
import { FACILITIES } from "../store/game";
import { ARCH_STYLES, type ArchStyle } from "./buildings";
import { GIVEN_F, GIVEN_M, SURNAMES, givenPool, nameTableSize, npcName, npcNameParts, surnamePool } from "./names";
import { P, ink } from "./palette";
import {
  BANG_STYLES,
  BEARD_STYLES,
  BROW_STYLES,
  EYE_STYLES,
  FACE_SHAPES,
  FEMALE_HAIR,
  HAIR_BANGS,
  HAT_KINDS,
  MALE_HAIR,
  MOUTH_STYLES,
  NOSE_STYLES,
  NPC_ROLES,
  ORNAMENTS,
  OUTFIT_KINDS,
  bangsFor,
  lookalike,
  type BangStyle,
  type HairStyle,
  type HatKind,
  type OutfitKind,
} from "./people/spec";
import { HEAD, chinY, headRows, jawBottom, mouthY, scarPoints } from "./people/head";
import { browStamp, eyeStamp, mouthStamp } from "./people/face";
import { BODY_DY, ROLE_BG } from "./people/compose";
import { CLOTH, CLOTH_DEEP, EYE_PUPIL, FACE_ROUGE, FACE_SKIN, HAIR, LIP_TONES, METAL, SCLERA, SKIN_TONES, eyeIris, skinRamp, stubbleTone } from "./people/tones";
import {
  CAPTAIN_LOOK_IDS,
  CAPTAIN_LOOK_SPAN,
  CAPTAIN_PORTRAITS,
  WALK_FRAMES,
  captainSpec,
  drawIdle,
  drawPortrait,
  drawWalker,
  keeperSpec,
  mateSpec,
  portraitSpec,
  type PortraitSpec,
} from "./portraits";
import { luma, rgba, type Px } from "./px";

/** 像素内容的指纹（用来比较两张图是否相同）。 */
function fingerprint(px: Px): string {
  let h = 0x811c9dc5;
  for (const v of px.data) {
    h ^= v;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${px.w}x${px.h}:${h.toString(16)}:${px.data.length}`;
}

function samePixels(a: Px, b: Px): boolean {
  return a.w === b.w && a.h === b.h && a.data.every((v, i) => v === b.data[i]);
}

/** 姓名里的“名”是否为 g：西方“名·姓”的名在第一个间隔号之前，东方“姓名”以名结尾。 */
function hasGiven(name: string, g: string): boolean {
  return name.includes("·") ? name.startsWith(`${g}·`) : name.endsWith(g);
}

describe("头像", () => {
  it("同一个种子永远得到同一张脸（参数与像素都相同）", () => {
    for (const role of NPC_ROLES) {
      const a = portraitSpec(`seed-${role}`, role);
      const b = portraitSpec(`seed-${role}`, role);
      expect(a).toEqual(b);
      // 另起一份参数对象，绕过缓存键的同一性，逐像素比较
      expect(samePixels(drawPortrait(a), drawPortrait({ ...b }))).toBe(true);
    }
  });

  it("尺寸为 64×64，背景铺满（没有透明像素）", () => {
    for (const role of NPC_ROLES) {
      const px = drawPortrait(portraitSpec(`size-${role}`, role));
      expect([px.w, px.h]).toEqual([64, 64]);
      expect(px.data.every((v) => (v & 0xff) === 0xff)).toBe(true);
    }
  });

  it("不同种子足够不同：100 个种子里至少 90 张互不相同", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const role = NPC_ROLES[i % NPC_ROLES.length];
      seen.add(fingerprint(drawPortrait(portraitSpec(`variety-${i}`, role))));
    }
    expect(seen.size).toBeGreaterThanOrEqual(90);
  });

  it("同一身份内部也足够多样：30 张交易所掌柜至少 28 张不同", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) seen.add(fingerprint(drawPortrait(portraitSpec(`market-${i}`, "market"))));
    expect(seen.size).toBeGreaterThanOrEqual(28);
  });

  it("身份决定背景色：同一张脸换身份，背景左上角的颜色随之改变", () => {
    const corners = new Set<number>();
    for (const role of NPC_ROLES) corners.add(drawPortrait({ ...portraitSpec("same-face", "townsfolk"), role }).get(0, 0));
    expect(corners.size).toBeGreaterThanOrEqual(10);
  });

  it("可以强制性别、地区与年龄", () => {
    for (const region of ARCH_STYLES) {
      const s = portraitSpec("opts", "townsfolk", { female: true, region, age: 2 });
      expect(s.female).toBe(true);
      expect(s.region).toBe(region);
      expect(s.age).toBe(2);
    }
    expect(portraitSpec("opts", "townsfolk", { female: false }).female).toBe(false);
  });

  it("地区风味会改变帽饰与服装：各地区 40 个市民的装束分布不同", () => {
    const signature = (region: (typeof ARCH_STYLES)[number]) => {
      const counts = new Map<string, number>();
      for (let i = 0; i < 40; i++) {
        const s = portraitSpec(`region-${i}`, "townsfolk", { region });
        for (const k of [`hat:${s.hat}`, `outfit:${s.outfit}`]) counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      return counts;
    };
    expect((signature("nordic").get("hat:fur") ?? 0) + (signature("nordic").get("outfit:fur") ?? 0)).toBeGreaterThan(10);
    expect((signature("desert").get("hat:turban") ?? 0) + (signature("desert").get("hat:hood") ?? 0)).toBeGreaterThan(5);
    expect(signature("desert").get("outfit:wide") ?? 0).toBeGreaterThan(5);
    expect(signature("islands").get("outfit:island") ?? 0).toBeGreaterThan(5);
    expect(signature("eastern").get("hat:fur") ?? 0).toBe(0);
  });

  it("所有部件组合都能画出来（发型、帽子、服饰、五官、饰物）", () => {
    const hats: HatKind[] = [
      "none",
      "tricorn",
      "cap",
      "bandana",
      "kerchief",
      "official",
      "straw",
      "fur",
      "turban",
      "flower",
      "beanie",
      "visor",
      "scholar",
      "headband",
      "hood",
      "wreath",
    ];
    const outfits: OutfitKind[] = [
      "captain",
      "coat",
      "jacket",
      "vest",
      "apron",
      "smith",
      "robe",
      "wide",
      "tunic",
      "striped",
      "fur",
      "island",
      "dress",
      "official",
      "banker",
    ];
    const base: PortraitSpec = { ...portraitSpec("combo", "townsfolk", { female: false }), hat: "none", beard: "none", hair: "crop", eyepatch: false, glasses: false };
    /** 一组参数全部能画出来，并且画出来两两不同（每个部件都真的画出了不同的东西）。 */
    const distinct = (specs: PortraitSpec[]) => {
      const prints = new Set<string>();
      for (const s of specs) {
        const px = drawPortrait(s);
        expect([px.w, px.h]).toEqual([64, 64]);
        prints.add(fingerprint(px));
      }
      expect(prints.size).toBe(specs.length);
    };
    distinct([...MALE_HAIR, ...FEMALE_HAIR].map((hair) => ({ ...base, hair })));
    distinct(hats.map((hat) => ({ ...base, hat })));
    // 官帽随地区变化（未指定地区时按地中海）
    distinct(ARCH_STYLES.map((region) => ({ ...base, hat: "official", region })));
    for (const female of [false, true]) distinct(outfits.map((outfit) => ({ ...base, outfit, female })));
    distinct(FACE_SHAPES.map((face) => ({ ...base, face })));
    distinct(EYE_STYLES.map((eyes) => ({ ...base, eyes })));
    distinct(BEARD_STYLES.map((beard) => ({ ...base, beard })));
    distinct([0, 1, 2, 3, 4].map((skin) => ({ ...base, skin })));
    distinct(([0, 1, 2] as const).map((age) => ({ ...base, age })));
    distinct([
      base,
      { ...base, glasses: true },
      { ...base, earring: true },
      { ...base, pipe: true },
      { ...base, scar: true },
      { ...base, eyepatch: true },
      { ...base, cape: true },
      { ...base, sword: true },
      { ...base, necklace: "shell" },
      { ...base, necklace: "gold" },
      { ...base, necklace: "beads" },
      { ...base, necklace: "pendant" },
    ]);
    // 所有帽子 × 发型 × 地区都不出错
    for (const hat of hats) for (const hair of [...MALE_HAIR, ...FEMALE_HAIR]) expect(drawPortrait({ ...base, hat, hair }).w).toBe(64);
  });

  it("部件数量满足设计要求", () => {
    expect(FACE_SHAPES.length).toBeGreaterThanOrEqual(3);
    expect(EYE_STYLES.length).toBeGreaterThanOrEqual(5);
    expect(BEARD_STYLES.filter((b) => b !== "none").length).toBeGreaterThanOrEqual(5);
    expect(MALE_HAIR.length).toBeGreaterThanOrEqual(8);
    expect(FEMALE_HAIR.length).toBeGreaterThanOrEqual(8);
    for (const style of ["bald", "tied", "braid", "topknot", "ponytail", "curly"]) {
      expect([...MALE_HAIR, ...FEMALE_HAIR]).toContain(style);
    }
  });
});

describe("主角外貌", () => {
  it("共 24 种（编号 0–11 与 13–24，12 号空缺），编号为偶数的是男、奇数的是女，越界按 25 取模", () => {
    expect(CAPTAIN_PORTRAITS).toBe(24);
    expect(CAPTAIN_LOOK_SPAN).toBe(25);
    expect(CAPTAIN_LOOK_IDS).toEqual([...Array.from({ length: 12 }, (_, i) => i), ...Array.from({ length: 12 }, (_, i) => 13 + i)]);
    for (const i of CAPTAIN_LOOK_IDS) {
      const s = captainSpec(i);
      expect(s.role).toBe("captain");
      expect(s.female).toBe(i % 2 === 1);
      expect(captainSpec(i + CAPTAIN_LOOK_SPAN)).toEqual(s);
      expect(captainSpec(i - CAPTAIN_LOOK_SPAN)).toEqual(s);
    }
    expect(captainSpec(-1)).toEqual(captainSpec(24));
    expect(captainSpec(25)).toEqual(captainSpec(0));
    expect(captainSpec(26)).toEqual(captainSpec(1));
    expect(captainSpec(-14)).toEqual(captainSpec(11));
    // 第一批 12 种的参数与编号不变（旧存档里的主角还是原来那张脸）
    for (let i = 0; i < 12; i++) expect(captainSpec(i).seed).toBe(portraitSpec(`captain-${i}`, "captain", { female: i % 2 === 1 }).seed);
  });

  it("24 个外貌两两不同，且都像船长（船长服饰）", () => {
    const prints = new Set<string>();
    for (const i of CAPTAIN_LOOK_IDS) {
      const s = captainSpec(i);
      expect(s.outfit).toBe("captain");
      prints.add(fingerprint(drawPortrait(s)));
    }
    expect(prints.size).toBe(CAPTAIN_PORTRAITS);
  });
});

describe("航海士", () => {
  it("小传里用“她”称呼的画成女性，其余画成男性", () => {
    expect(mateSpec({ name: "驼铃", bio: "认得每一处水井，骆驼都肯听她的。" }).female).toBe(true);
    expect(mateSpec({ name: "白素云", bio: "冰泉商会出走的千金，她精通行情。" }).female).toBe(true);
    expect(mateSpec({ name: "石铁", bio: "一只手能提起两桶淡水。" }).female).toBe(false);
    expect(mateSpec({ name: "无名" }).female).toBe(false);
  });

  it("以姓名为种子，结果确定；小传里的外貌线索会体现在头像上", () => {
    const a = mateSpec({ name: "周明远", bio: "戴一副磨花的圆框眼镜。" });
    expect(mateSpec({ name: "周明远", bio: "戴一副磨花的圆框眼镜。" })).toEqual(a);
    expect(a.glasses).toBe(true);
    expect(a.role).toBe("mate");
    const b = mateSpec({ name: "韩北风", bio: "北望港的老舵手，左眼蒙着黑布。" });
    expect(b.eyepatch).toBe(true);
    expect(b.age).toBe(2);
    expect(b.region).toBe("nordic");
    const red = mateSpec({ name: "赤焰", bio: "赤砂港的前护卫统领，红发如火。" });
    expect(red.hairColor).toBe("auburn");
    // 写明了发色，就不戴把头发整个盖住的帽子
    expect(["turban", "hood", "bandana", "kerchief", "fur", "beanie", "scholar", "official"]).not.toContain(red.hat);
    expect(red.hair).not.toBe("bald");
    expect(mateSpec({ name: "雾角", bio: "总是裹着一件灰斗篷。" }).hat).toBe("hood");
  });
});

describe("设施掌柜与姓名", () => {
  it("姓名表规模足够：姓 ≥60、男名 ≥80、女名 ≥80", () => {
    const n = nameTableSize();
    expect(n.surnames).toBeGreaterThanOrEqual(60);
    expect(n.male).toBeGreaterThanOrEqual(80);
    expect(n.female).toBeGreaterThanOrEqual(80);
    expect(new Set(SURNAMES).size).toBe(SURNAMES.length);
    expect(new Set(GIVEN_M).size).toBe(GIVEN_M.length);
    expect(new Set(GIVEN_F).size).toBe(GIVEN_F.length);
  });

  it("同一种子的姓名固定且不为空；地区名池只增不减", () => {
    for (let i = 0; i < 50; i++) {
      for (const region of [undefined, ...ARCH_STYLES]) {
        const a = npcName(`n-${i}`, i % 2 === 1, region);
        expect(a).toBe(npcName(`n-${i}`, i % 2 === 1, region));
        expect(a.length).toBeGreaterThanOrEqual(2);
        expect(a.trim()).toBe(a);
      }
    }
    for (const region of ARCH_STYLES) expect(givenPool(true, region).length).toBeGreaterThan(GIVEN_F.length);
    const names = new Set(Array.from({ length: 200 }, (_, i) => npcName(`spread-${i}`)));
    expect(names.size).toBeGreaterThan(150);
  });

  it("名字按性别取自对应的名池", () => {
    for (let i = 0; i < 40; i++) {
      for (const region of [undefined, ...ARCH_STYLES]) {
        const f = npcName(`g-${i}`, true, region);
        const m = npcName(`g-${i}`, false, region);
        expect(givenPool(true, region).some((g) => hasGiven(f, g))).toBe(true);
        expect(givenPool(false, region).some((g) => hasGiven(m, g))).toBe(true);
      }
    }
  });

  it("掌柜以“港口-设施”为种子：结果确定，姓名性别与头像一致", () => {
    for (const region of ARCH_STYLES) {
      for (const fac of FACILITIES) {
        const k = keeperSpec(`port-${region}`, fac, region);
        expect(keeperSpec(`port-${region}`, fac, region)).toEqual(k);
        expect(k.spec.role).toBe(fac);
        expect(k.spec.region).toBe(region);
        expect(k.name).toBe(npcName(`port-${region}-${fac}`, k.spec.female, region));
        expect(givenPool(k.spec.female, region).some((g) => hasGiven(k.name, g))).toBe(true);
      }
    }
    // 两性都会出现
    const sexes = new Set(FACILITIES.map((f) => keeperSpec("chenggang", f).spec.female));
    expect(sexes.size).toBe(2);
  });
});

describe("行人", () => {
  it("4 帧行走循环：尺寸固定，帧与帧不同，帧号取模", () => {
    expect(WALK_FRAMES).toBe(4);
    for (const role of NPC_ROLES) {
      const s = portraitSpec(`walker-${role}`, role);
      const frames = Array.from({ length: WALK_FRAMES }, (_, f) => drawWalker(s, f));
      const idle = drawIdle(s);
      for (const f of [...frames, idle]) {
        expect([f.w, f.h]).toEqual([idle.w, idle.h]);
        const b = f.bounds();
        expect(b).not.toBeNull();
        // 人物本身约 10×18：不含帽子与携带物时高度 16–20 像素
        expect(b!.h).toBeGreaterThanOrEqual(16);
        expect(b!.w).toBeLessThanOrEqual(12);
      }
      expect(new Set(frames.map(fingerprint)).size).toBeGreaterThanOrEqual(3);
      expect(samePixels(drawWalker(s, WALK_FRAMES), frames[0])).toBe(true);
      expect(samePixels(drawWalker(s, -1), frames[WALK_FRAMES - 1])).toBe(true);
    }
  });

  it("脚踩在同一行（按底边对齐不会上下跳）", () => {
    const s = portraitSpec("feet", "sailor");
    const bottoms = [drawIdle(s), ...Array.from({ length: WALK_FRAMES }, (_, f) => drawWalker(s, f))].map((p) => {
      const b = p.bounds()!;
      return b.y + b.h;
    });
    expect(new Set(bottoms).size).toBe(1);
  });

  it("颜色跟头像参数一致：换主色，行人的衣服跟着变", () => {
    const s = portraitSpec("color", "townsfolk", { female: false });
    const a = drawIdle({ ...s, main: "crimson", outfit: "tunic" });
    const b = drawIdle({ ...s, main: "navy", outfit: "tunic" });
    expect(samePixels(a, b)).toBe(false);
  });

  it("不同身份轮廓不同", () => {
    const silhouette = (role: (typeof NPC_ROLES)[number]) => {
      const p = drawIdle(portraitSpec(`sil-${role}`, role, { female: false }));
      return Array.from(p.data, (v) => ((v & 0xff) === 0 ? "0" : "1")).join("");
    };
    const shapes = new Set(["sailor", "townsfolk", "market", "office", "warehouse", "captain"].map((r) => silhouette(r as never)));
    expect(shapes.size).toBeGreaterThanOrEqual(5);
  });
});

/** 共享调色板里的全部颜色。 */
function paletteColors(): Set<number> {
  const out = new Set<number>();
  const walk = (v: unknown) => {
    if (typeof v === "string") out.add(rgba(v));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(P);
  walk(ink);
  return out;
}

const CULTURE_OPTS: readonly (ArchStyle | undefined)[] = [undefined, ...ARCH_STYLES];

describe("64×64 美型头像：文化、身份与调色板", () => {
  it("各文化 × 各身份 × 两性都画成 64×64，而且只用共享调色板里的颜色", () => {
    const pal = paletteColors();
    for (const region of CULTURE_OPTS) {
      for (const role of NPC_ROLES) {
        for (const female of [false, true]) {
          const px = drawPortrait(portraitSpec(`pal-${region ?? "mixed"}-${role}`, role, { region, female }));
          expect([px.w, px.h]).toEqual([64, 64]);
          const stray = [...new Set(px.data)].filter((v) => !pal.has(v));
          expect(stray).toEqual([]);
        }
      }
    }
  });

  it("新增的帽子、服饰、发型、项链都画得出来，并且两两不同", () => {
    const base: PortraitSpec = {
      ...portraitSpec("combo64", "townsfolk", { female: true }),
      hat: "none",
      hair: "bun",
      beard: "none",
      eyepatch: false,
      glasses: false,
      elf: false,
    };
    const distinct = (specs: PortraitSpec[]) => {
      const prints = new Set(specs.map((s) => fingerprint(drawPortrait(s))));
      expect(prints.size).toBe(specs.length);
    };
    distinct(HAT_KINDS.map((hat) => ({ ...base, hat })));
    for (const female of [false, true]) distinct(OUTFIT_KINDS.map((outfit) => ({ ...base, outfit, female })));
    distinct(FEMALE_HAIR.map((hair) => ({ ...base, hair })));
    distinct((["none", "shell", "gold", "beads", "pendant", "lei"] as const).map((necklace) => ({ ...base, necklace })));
  });

  it("每种文化都有自己的标志性服饰", () => {
    const count = (region: ArchStyle, pick: (s: PortraitSpec) => boolean) => {
      let n = 0;
      for (let i = 0; i < 60; i++) {
        for (const role of ["townsfolk", "tavern", "market", "mate"] as const) if (pick(portraitSpec(`sig-${i}-${role}`, role, { region }))) n++;
      }
      return n;
    };
    expect(count("mediterranean", (s) => s.hat === "plumed" || s.hat === "mantilla")).toBeGreaterThan(20);
    expect(count("mediterranean", (s) => s.outfit === "doublet" || s.outfit === "bodice")).toBeGreaterThan(40);
    expect(count("nordic", (s) => s.outfit === "fur" || s.outfit === "leather")).toBeGreaterThan(60);
    expect(count("nordic", (s) => s.female && ["braids", "sidebraid", "crownbraid"].includes(s.hair))).toBeGreaterThan(15);
    expect(count("lowland", (s) => s.hat === "capotain" || s.hat === "lacecap")).toBeGreaterThan(30);
    expect(count("lowland", (s) => s.outfit === "wool")).toBeGreaterThan(40);
    expect(count("desert", (s) => s.hat === "turban" || s.hat === "hood" || s.hat === "veil")).toBeGreaterThan(60);
    expect(count("desert", (s) => s.hat === "veil")).toBeGreaterThan(5);
    expect(count("islands", (s) => s.necklace === "lei" || s.necklace === "shell")).toBeGreaterThan(60);
    expect(count("eastern", (s) => s.hat === "crown" || s.hat === "hairpin")).toBeGreaterThan(40);
    expect(count("eastern", (s) => s.outfit === "robe")).toBeGreaterThan(40);
    expect(count("frontier", (s) => s.hat === "slouch")).toBeGreaterThan(30);
    expect(count("frontier", (s) => s.outfit === "buckskin" || s.outfit === "leather")).toBeGreaterThan(50);
    // 别的文化不会出现这些标志
    expect(count("eastern", (s) => s.hat === "plumed" || s.hat === "capotain" || s.outfit === "wool")).toBe(0);
    expect(count("nordic", (s) => s.hat === "turban" || s.hat === "veil" || s.outfit === "robe")).toBe(0);
  });

  it("官员换成本文化的官服与官帽：七种文化的官员两两不同", () => {
    const prints = new Set(
      ARCH_STYLES.map((region) =>
        fingerprint(drawPortrait({ ...portraitSpec("office-same", "office", { region, female: false }), region, skin: 1, hair: "crop", beard: "none" })),
      ),
    );
    expect(prints.size).toBe(ARCH_STYLES.length);
    expect(portraitSpec("office-m", "office", { region: "mediterranean", female: false }).outfit).toBe("doublet");
    expect(portraitSpec("office-m", "office", { region: "mediterranean", female: true }).outfit).toBe("bodice");
    expect(portraitSpec("office-l", "office", { region: "lowland" }).outfit).toBe("wool");
    expect(portraitSpec("office-e", "office", { region: "eastern" }).outfit).toBe("robe");
  });

  it("肤色与发色多元，并随文化变化：北地、低地偏浅，沙漠、群岛偏深", () => {
    const mean = (region: ArchStyle) => {
      let sum = 0;
      for (let i = 0; i < 80; i++) sum += portraitSpec(`skin-${i}`, "townsfolk", { region }).skin;
      return sum / 80;
    };
    expect(mean("nordic")).toBeLessThan(mean("desert") - 1);
    expect(mean("lowland")).toBeLessThan(mean("islands") - 1);
    const skins = new Set<number>();
    const hairs = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const s = portraitSpec(`mix-${i}`, NPC_ROLES[i % NPC_ROLES.length], { region: ARCH_STYLES[i % ARCH_STYLES.length] });
      skins.add(s.skin);
      hairs.add(s.hairColor);
    }
    expect(skins.size).toBe(5);
    expect(hairs.size).toBeGreaterThanOrEqual(7);
  });

  it("约 8% 的人物带精灵血统，尖耳真的画了出来", () => {
    let elves = 0;
    const n = 1200;
    for (let i = 0; i < n; i++) if (portraitSpec(`elf-${i}`, NPC_ROLES[i % NPC_ROLES.length], { region: CULTURE_OPTS[i % CULTURE_OPTS.length] }).elf) elves++;
    expect(elves / n).toBeGreaterThan(0.04);
    expect(elves / n).toBeLessThan(0.13);
    const s: PortraitSpec = { ...portraitSpec("ear", "townsfolk", { female: true }), hat: "none", hair: "straight", elf: false };
    expect(samePixels(drawPortrait(s), drawPortrait({ ...s, elf: true }))).toBe(false);
    // 兜帽盖住耳朵时不画尖耳
    expect(samePixels(drawPortrait({ ...s, hat: "hood" }), drawPortrait({ ...s, hat: "hood", elf: true }))).toBe(true);
  });

  it("眼睛有神：没戴眼罩与眼镜的脸，两只眼睛里都有白色高光", () => {
    const white = rgba(P.white);
    for (let i = 0; i < 60; i++) {
      const s = portraitSpec(`eye-${i}`, NPC_ROLES[i % NPC_ROLES.length], { region: CULTURE_OPTS[i % CULTURE_OPTS.length] });
      if (s.eyepatch || s.glasses) continue;
      const px = drawPortrait(s);
      const has = (x0: number, x1: number) => {
        for (let y = 26; y <= 33; y++) for (let x = x0; x <= x1; x++) if (px.get(x, y) === white) return true;
        return false;
      };
      expect(has(24, 31)).toBe(true);
      expect(has(38, 43)).toBe(true);
    }
  });
});

describe("主角外貌（64×64 重新设计）", () => {
  it("24 个外貌涵盖多种文化、肤色与发色，其中一位带精灵血统", () => {
    const looks = CAPTAIN_LOOK_IDS.map((i) => captainSpec(i));
    expect(looks).toHaveLength(CAPTAIN_PORTRAITS);
    expect(new Set(looks.map((s) => s.region)).size).toBeGreaterThanOrEqual(6);
    expect(new Set(looks.map((s) => s.skin)).size).toBe(5);
    expect(new Set(looks.map((s) => s.hairColor)).size).toBeGreaterThanOrEqual(6);
    expect(new Set(looks.map((s) => s.hat)).size).toBeGreaterThanOrEqual(7);
    expect(looks.filter((s) => s.elf).length).toBe(1);
    // 主角都佩剑、不戴眼镜
    for (const s of looks) {
      expect(s.sword).toBe(true);
      expect(s.glasses).toBe(false);
    }
  });

  it("英雄扩充的 12 种（13–24）：按人物概念取文化、帽饰、发型与肤色，各有个人配色；六男六女、五档肤色都有", () => {
    const more = CAPTAIN_LOOK_IDS.filter((i) => i >= 13).map((i) => [i, captainSpec(i)] as const);
    expect(more.map(([i]) => i)).toEqual([13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
    expect(more.filter(([, s]) => s.female).map(([i]) => i)).toEqual([13, 15, 17, 19, 21, 23]);
    expect(new Set(more.map(([, s]) => s.skin)).size).toBe(5);
    expect(new Set(more.map(([, s]) => s.region)).size).toBeGreaterThanOrEqual(6);
    // 东方角色自然地出现：追风船长、书生、老领航
    expect(more.filter(([, s]) => s.region === "eastern").map(([i]) => i)).toEqual([13, 18, 23]);
    const look = (i: number) => captainSpec(i);
    expect([look(13).hair, look(13).cape, look(13).mouth]).toEqual(["ponytail", true, "grin"]);
    expect([look(14).hat, look(14).beard, look(14).region]).toEqual(["slouch", "stubble", "frontier"]);
    expect([look(15).hat, look(15).eyeColor, look(15).region]).toEqual(["lacecap", 3, "lowland"]);
    expect([look(16).hair, look(16).necklace, look(16).region]).toEqual(["topknot", "shell", "islands"]);
    expect([look(17).hat, look(17).earring, look(17).region]).toEqual(["hood", true, "desert"]);
    expect([look(18).hat, look(18).beard, look(18).skin]).toEqual(["hairpin", "none", 0]);
    expect([look(19).hat, look(19).hair, look(19).mouth]).toEqual(["straw", "wavy", "grin"]);
    expect([look(20).cape, look(20).eyeColor, look(20).mouth, look(20).region]).toEqual([true, 4, "line", "nordic"]);
    expect([look(21).hair, look(21).grizzle, look(21).ornament, look(21).age]).toEqual(["bun", 1, "pearls", 1]);
    expect([look(22).hat, look(22).skin, look(22).necklace]).toEqual(["turban", 4, "beads"]);
    expect([look(23).hair, look(23).grizzle, look(23).mouth]).toEqual(["updo", 2, "smile"]);
    expect([look(24).hat, look(24).beard, look(24).earring]).toEqual(["plumed", "mustache", true]);
    // 个人配色：主色 + 点缀色的搭配两两不同
    expect(new Set(more.map(([, s]) => `${s.main}/${s.accent}`)).size).toBe(12);
  });

  it("越界取模后画出的是同一张图", () => {
    for (const i of [0, 5, 11, 13, 24]) {
      expect(samePixels(drawPortrait(captainSpec(i)), drawPortrait(captainSpec(i + CAPTAIN_LOOK_SPAN * 3)))).toBe(true);
      expect(samePixels(drawPortrait(captainSpec(i)), drawPortrait(captainSpec(i - CAPTAIN_LOOK_SPAN)))).toBe(true);
    }
  });
});

describe("航海士：所在港口的文化", () => {
  it("小传没写出身时按传入的港口文化打扮；写了出身时以小传为准", () => {
    const plain = { name: "无出身", bio: "沉默寡言，擅长掌舵。" };
    expect(mateSpec(plain).region).toBeNull();
    for (const region of ARCH_STYLES) expect(mateSpec(plain, region).region).toBe(region);
    expect(mateSpec({ name: "沙漠来客", bio: "生在沙漠边的绿洲。" }, "nordic").region).toBe("desert");
    expect(mateSpec({ name: "峡湾之子", bio: "诺德海姆峡湾长大的舵手。" }, "islands").region).toBe("nordic");
    expect(mateSpec({ name: "瑶华书生", bio: "瑶华来的书生。" }).region).toBe("eastern");
    // 不传文化时与旧接口一致
    expect(mateSpec(plain)).toEqual(mateSpec(plain, undefined));
  });

  it("文化参数不影响“她”的判断与小传线索", () => {
    for (const region of ARCH_STYLES) {
      expect(mateSpec({ name: "某人", bio: "她曾是灯塔守望人。" }, region).female).toBe(true);
      expect(mateSpec({ name: "某人", bio: "一只手能提起两桶淡水。" }, region).female).toBe(false);
      const s = mateSpec({ name: "老账房", bio: "年迈的账房，戴着眼镜，脸上一道刀疤。" }, region);
      expect(s.glasses).toBe(true);
      expect(s.age).toBe(2);
      expect(s.scar).toBe(true);
    }
    expect(mateSpec({ name: "林中客", bio: "有精灵血统，一对尖耳藏在发间。" }).elf).toBe(true);
  });

  it("小传里的更多外貌线索：发色、辫子与盘发、胡须、头巾、鬓边的花、眼睛颜色、精裔", () => {
    const a = mateSpec({ name: "甲", bio: "浅金色的头发总是盘得一丝不乱，她是商家的千金。" });
    expect([a.hairColor, a.hair, a.age, a.female]).toEqual(["blond", "bun", 0, true]);
    const b = mateSpec({ name: "乙", bio: "金发编成粗辫，手臂上刺满了纹样。" });
    expect([b.hairColor, b.hair]).toEqual(["blond", "braid"]);
    const c = mateSpec({ name: "丙", bio: "深色皮肤，胡须修剪整齐，缠着金边头巾。" });
    expect(c.skin).toBeGreaterThanOrEqual(3);
    expect([c.beard, c.hat]).toEqual(["goatee", "turban"]);
    expect(mateSpec({ name: "丁", bio: "胡子花白的老水手。" }).beard).toBe("full");
    expect(mateSpec({ name: "戊", bio: "她鬓边总插着一朵红花。" }).hat).toBe("flower");
    const e = mateSpec({ name: "己", bio: "据说祖母是林中的精裔。她有一对微尖的耳朵和一双灰眼睛。" });
    expect([e.elf, e.eyeColor]).toEqual([true, 4]);
    // 有小传的航海士只在小传提到精灵血统时才画尖耳
    for (let i = 0; i < 60; i++) {
      const s = mateSpec({ name: `人${i}`, bio: "码头上长大的水手。" });
      expect(s.elf).toBe(false);
      // 也不会留下精灵专属的银发与紫眼
      expect(s.hairColor).not.toBe("silver");
      expect(s.eyeColor).not.toBe(6);
    }
    // 强制的精灵血统不打乱其余部件
    const free = portraitSpec("force-elf", "townsfolk");
    const forced = portraitSpec("force-elf", "townsfolk", { elf: !free.elf });
    expect(forced.elf).toBe(!free.elf);
    expect([forced.face, forced.eyes, forced.outfit]).toEqual([free.face, free.eyes, free.outfit]);
    // “老师傅”“老板”不是说本人老
    expect(mateSpec({ name: "庚", bio: "她精打细算，船坞里的老师傅都怕她三分。" }, "nordic").age).not.toBe(2);
    expect(mateSpec({ name: "辛", bio: "诺德瓦克特的老舵手。" }).age).toBe(2);
    // 小传提到几处地方时，取最先提到的出身
    expect(mateSpec({ name: "壬", bio: "瑶华丝商的女儿，她十岁随宝船队来到梅尔蒙德。" }).region).toBe("eastern");
    expect(mateSpec({ name: "癸", bio: "卡迪拉的前护卫统领，她红发如火。" }, "islands").region).toBe("desert");
  });
});

describe("姓名的文化格式", () => {
  it("西方各文化用“名·姓”（含间隔号），东方用“姓名”（不含间隔号）", () => {
    for (let i = 0; i < 120; i++) {
      for (const region of CULTURE_OPTS) {
        for (const female of [false, true]) {
          const p = npcNameParts(`fmt-${i}`, female, region);
          expect(p.text).toBe(npcName(`fmt-${i}`, female, region));
          if (p.eastern) {
            expect(region).toBe("eastern");
            expect(p.text).not.toContain("·");
            expect(p.text).toBe(p.surname + p.given);
          } else {
            expect(p.text).toBe(`${p.given}·${p.surname}`);
          }
        }
      }
    }
    // 不指定文化时一律是西方格式
    for (let i = 0; i < 100; i++) expect(npcName(`west-${i}`, i % 2 === 1)).toContain("·");
    // 东方港口的名字大多是东方格式（少数是外来的商人）
    const east = Array.from({ length: 200 }, (_, i) => npcNameParts(`east-${i}`, i % 2 === 1, "eastern"));
    expect(east.filter((p) => p.eastern).length).toBeGreaterThan(140);
  });

  it("指定文化时大多数名字来自该文化的名池，开拓者殖民地一半是移民", () => {
    for (const region of ARCH_STYLES) {
      let own = 0;
      for (let i = 0; i < 300; i++) {
        const female = i % 2 === 1;
        const p = npcNameParts(`own-${i}`, female, region);
        if (!(female ? GIVEN_F : GIVEN_M).includes(p.given)) own++;
      }
      if (region === "frontier") {
        expect(own / 300).toBeGreaterThan(0.35);
        expect(own / 300).toBeLessThan(0.65);
      } else {
        expect(own / 300).toBeGreaterThan(0.7);
        expect(own / 300).toBeLessThan(0.9);
      }
    }
  });

  it("姓名最长 12 个字（主角姓名的上限），名与姓不为空、没有空白", () => {
    for (const region of CULTURE_OPTS) {
      for (const female of [false, true]) {
        const g = Math.max(...givenPool(female, region).map((n) => [...n].length));
        const s = Math.max(...surnamePool(region).map((n) => [...n].length));
        expect(g + 1 + s).toBeLessThanOrEqual(12);
      }
    }
    for (const n of [...GIVEN_M, ...GIVEN_F, ...SURNAMES]) {
      expect(n.trim()).toBe(n);
      expect(n.length).toBeGreaterThan(0);
    }
  });

  it("男名与女名互不重复（同一个名字不会两性通用）", () => {
    for (const region of CULTURE_OPTS) {
      const f = new Set(givenPool(true, region));
      expect(givenPool(false, region).filter((m) => f.has(m))).toEqual([]);
    }
  });
});

describe("行人（新服饰）", () => {
  it("各文化的新帽子与新服饰：尺寸固定、脚踩同一行", () => {
    const base = portraitSpec("walk64", "townsfolk", { female: true });
    const specs: PortraitSpec[] = [];
    for (const hat of HAT_KINDS) specs.push({ ...base, hat });
    for (const outfit of OUTFIT_KINDS) for (const female of [false, true]) specs.push({ ...base, outfit, female });
    for (const region of ARCH_STYLES) specs.push({ ...base, hat: "official", region });
    specs.push({ ...base, elf: true, hat: "none" });
    const bottoms = new Set<number>();
    for (const s of specs) {
      for (let f = 0; f < WALK_FRAMES; f++) {
        const px = drawWalker(s, f);
        expect([px.w, px.h]).toEqual([12, 24]);
        const b = px.bounds()!;
        bottoms.add(b.y + b.h);
      }
    }
    expect(bottoms.size).toBe(1);
    // 七种文化的官帽在行人身上也不一样
    const hats = new Set(ARCH_STYLES.map((region) => fingerprint(drawIdle({ ...base, female: false, outfit: "official", hat: "official", region }))));
    expect(hats.size).toBe(ARCH_STYLES.length);
  });
});

/** 五官目录用的标准人物：青年、小麦肤色、光头（五官不被刘海挡住）、无饰物。 */
function plainFace(female: boolean, over: Partial<PortraitSpec> = {}): PortraitSpec {
  return {
    ...portraitSpec("features", "townsfolk", { female, age: 0, elf: false }),
    skin: 1,
    face: "oval",
    eyes: "almond",
    eyeColor: 1,
    brows: female ? "thin" : "thick",
    nose: "small",
    mouth: "line",
    beard: "none",
    hair: "bald",
    bangs: "none",
    hairColor: "brown",
    grizzle: 0,
    hat: "none",
    glasses: false,
    earring: false,
    eyepatch: false,
    scar: false,
    pipe: false,
    necklace: "none",
    cape: false,
    sword: false,
    ...over,
  };
}

/** 数一块区域里属于某组颜色的像素。 */
function countIn(px: Px, colors: readonly string[], x0: number, y0: number, x1: number, y1: number): number {
  const set = new Set(colors.map((c) => rgba(c)));
  let n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (set.has(px.get(x, y))) n++;
  return n;
}

/** 一块区域里的像素指纹（只比较五官所在的区域）。 */
function regionPrint(px: Px, x0: number, y0: number, x1: number, y1: number): string {
  const out: number[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push(px.get(x, y));
  return out.join(",");
}

describe("五官与发型的多样性（第三批打磨）", () => {
  it("部件数量：脸型 ≥5、眼型 ≥6、眉形 ≥5、鼻子 ≥4、嘴 ≥5、刘海 7 种", () => {
    expect(FACE_SHAPES).toEqual(expect.arrayContaining(["oval", "heart", "round", "square", "long"]));
    expect(EYE_STYLES).toEqual(expect.arrayContaining(["almond", "round", "narrow", "droopy", "sharp", "mono"]));
    expect(BROW_STYLES.length).toBeGreaterThanOrEqual(5);
    expect(BROW_STYLES).toContain("sword");
    expect(NOSE_STYLES.length).toBeGreaterThanOrEqual(4);
    expect(MOUTH_STYLES.length).toBeGreaterThanOrEqual(5);
    expect([...BANG_STYLES].sort()).toEqual(["blunt", "center", "curly", "none", "side", "swept", "wispy"]);
    expect(BEARD_STYLES).toContain("trim");
  });

  it("200 个随机女性头像里，脸型 × 眼型 × 嘴型 × 刘海 的组合至少 60 种，每一维都用到了全部或几乎全部选项", () => {
    const combos = new Set<string>();
    const faces = new Set<string>();
    const eyes = new Set<string>();
    const mouths = new Set<string>();
    const bangs = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const s = portraitSpec(`women-${i}`, NPC_ROLES[i % NPC_ROLES.length], { female: true, region: CULTURE_OPTS[i % CULTURE_OPTS.length] });
      const b = bangsFor(s.hair, s.bangs);
      combos.add(`${s.face}|${s.eyes}|${s.mouth}|${b}`);
      faces.add(s.face);
      eyes.add(s.eyes);
      mouths.add(s.mouth);
      bangs.add(b);
    }
    expect(combos.size).toBeGreaterThanOrEqual(60);
    expect(faces.size).toBe(FACE_SHAPES.length);
    expect(eyes.size).toBeGreaterThanOrEqual(6);
    expect(mouths.size).toBeGreaterThanOrEqual(5);
    expect(bangs.size).toBeGreaterThanOrEqual(6);
  });

  it("200 个随机男性头像里，脸型 × 眼型 × 眉形 × 胡须 的组合至少 60 种，剑眉与修整短须都会出现", () => {
    const combos = new Set<string>();
    const brows = new Set<string>();
    const beards = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const s = portraitSpec(`men-${i}`, NPC_ROLES[i % NPC_ROLES.length], { female: false, region: CULTURE_OPTS[i % CULTURE_OPTS.length] });
      combos.add(`${s.face}|${s.eyes}|${s.brows}|${s.beard}`);
      brows.add(s.brows);
      beards.add(s.beard);
    }
    expect(combos.size).toBeGreaterThanOrEqual(60);
    expect(brows).toContain("sword");
    expect(beards).toContain("trim");
    expect(brows.size).toBeGreaterThanOrEqual(5);
  });

  it("同性别的脸不再是同一个模板：100 个随机女性头像的五官区域至少 95 种互不相同", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      // 统一肤色、发色、瞳色，去掉帽子与眼镜：只靠五官与刘海的形状区分，比较眉、眼、鼻、嘴与下巴所在的区域
      const s: PortraitSpec = {
        ...portraitSpec(`template-${i}`, "townsfolk", { female: true }),
        skin: 1,
        hairColor: "dark",
        eyeColor: 0,
        grizzle: 0,
        hat: "none",
        glasses: false,
        eyepatch: false,
      };
      seen.add(regionPrint(drawPortrait(s), 20, 22, 46, 46));
    }
    expect(seen.size).toBeGreaterThanOrEqual(95);
  });

  it("每种眼型、眉形、鼻子、嘴、脸型都画出了不同的像素（男女分别比较）", () => {
    for (const female of [false, true]) {
      const distinct = (specs: PortraitSpec[]) => expect(new Set(specs.map((s) => fingerprint(drawPortrait(s)))).size).toBe(specs.length);
      distinct(EYE_STYLES.map((eyes) => plainFace(female, { eyes })));
      distinct(BROW_STYLES.map((brows) => plainFace(female, { brows })));
      distinct(NOSE_STYLES.map((nose) => plainFace(female, { nose })));
      distinct(MOUTH_STYLES.map((mouth) => plainFace(female, { mouth })));
      distinct(FACE_SHAPES.map((face) => plainFace(female, { face })));
    }
  });

  it("女性的嘴有两阶唇色，不再是一个红点；男性的唇色更淡", () => {
    for (const skin of [0, 1, 2, 3, 4]) {
      const lip = LIP_TONES[skin];
      for (const mouth of MOUTH_STYLES) {
        const f = drawPortrait(plainFace(true, { mouth, skin }));
        const m = drawPortrait(plainFace(false, { mouth, skin }));
        // 嘴所在的区域：x 30..40、y 36..44（鹅蛋脸的嘴在 y≈39）
        const tones = [lip[1], lip[2], lip[3]].filter((c) => countIn(f, [c], 30, 36, 40, 44) > 0);
        expect(tones.length).toBeGreaterThanOrEqual(mouth === "frown" ? 1 : 2);
        expect(countIn(f, [...lip], 30, 36, 40, 44)).toBeGreaterThanOrEqual(4);
        expect(countIn(m, [lip[0], lip[1], lip[2]], 30, 36, 40, 44)).toBeLessThan(countIn(f, [lip[0], lip[1], lip[2]], 30, 36, 40, 44));
      }
    }
  });

  it("女性的睫毛更明显：同一种眼型，女性的睫毛像素比男性多", () => {
    const lash = P.hair.black[0];
    for (const eyes of EYE_STYLES) {
      const f = countIn(drawPortrait(plainFace(true, { eyes })), [lash], 21, 23, 45, 33);
      const m = countIn(drawPortrait(plainFace(false, { eyes })), [lash], 21, 23, 45, 33);
      expect(f).toBeGreaterThan(m);
    }
  });

  it("刘海：七种都画得出来且两两不同；每种发型允许的刘海都合法，不允许时退回该发型的缺省刘海", () => {
    const pick = (b: BangStyle): HairStyle => (HAIR_BANGS.straight.includes(b) ? "straight" : "curls");
    const prints = new Set(BANG_STYLES.map((b) => fingerprint(drawPortrait(plainFace(true, { hair: pick(b), bangs: b })))));
    expect(prints.size).toBe(BANG_STYLES.length);
    // 同一个发型（发髻）上换六种刘海，六张图互不相同
    const bun = HAIR_BANGS.bun;
    expect(new Set(bun.map((b) => fingerprint(drawPortrait(plainFace(true, { hair: "bun", bangs: b }))))).size).toBe(bun.length);
    const used = new Set<BangStyle>();
    for (const hair of [...MALE_HAIR, ...FEMALE_HAIR]) {
      const ok = HAIR_BANGS[hair];
      expect(ok.length).toBeGreaterThan(0);
      for (const b of ok) {
        expect(BANG_STYLES).toContain(b);
        used.add(b);
      }
      for (const b of BANG_STYLES) expect(bangsFor(hair, b)).toBe(ok.includes(b) ? b : ok[0]);
      // 不允许的刘海画出来与缺省刘海一模一样
      const bad = BANG_STYLES.find((b) => !ok.includes(b));
      if (bad) expect(samePixels(drawPortrait(plainFace(true, { hair, bangs: bad })), drawPortrait(plainFace(true, { hair, bangs: ok[0] })))).toBe(true);
    }
    expect(used.size).toBe(BANG_STYLES.length);
    // 随机生成的刘海总是该发型允许的
    for (let i = 0; i < 300; i++) {
      const s = portraitSpec(`bangs-${i}`, NPC_ROLES[i % NPC_ROLES.length], { region: CULTURE_OPTS[i % CULTURE_OPTS.length] });
      expect(HAIR_BANGS[s.hair]).toContain(s.bangs);
    }
  });

  it("年龄差异：老年的脸上皱纹（皮肤暗面）比青年多，中年介于两者之间；白发比例随年龄增加", () => {
    for (const female of [false, true]) {
      const ramp = skinRamp(1);
      const lines = (age: 0 | 1 | 2) => countIn(drawPortrait(plainFace(female, { age })), [ramp[1]], 18, 24, 46, 46);
      expect(lines(1)).toBeGreaterThan(lines(0));
      expect(lines(2)).toBeGreaterThan(lines(1));
    }
    // 白发：同一个发型，鬓角花白与花白夹杂的灰色像素依次增多，没有白发时一个灰像素都没有
    const gray = [...HAIR.gray];
    const grays = ([0, 1, 2] as const).map((grizzle) => countIn(drawPortrait(plainFace(false, { hair: "long", bangs: "center", grizzle })), gray, 0, 0, 63, 63));
    expect(grays[0]).toBe(0);
    expect(grays[1]).toBeGreaterThan(0);
    expect(grays[2]).toBeGreaterThan(grays[1]);
    // 随机人群：青年没有白发；老年要么满头灰白，要么花白
    let oldGray = 0;
    let old = 0;
    for (let i = 0; i < 400; i++) {
      const s = portraitSpec(`grizzle-${i}`, NPC_ROLES[i % NPC_ROLES.length], { region: CULTURE_OPTS[i % CULTURE_OPTS.length] });
      if (s.age === 0) expect(s.grizzle).toBe(0);
      if (s.age === 2) {
        old++;
        if (s.grizzle > 0 || s.hairColor === "gray" || s.hairColor === "white" || s.hairColor === "silver") oldGray++;
      }
    }
    expect(old).toBeGreaterThan(20);
    expect(oldGray).toBe(old);
  });

  it("新部件确定且只用共享调色板：所有眼、眉、鼻、嘴、刘海、胡须、年龄与白发的组合", () => {
    const pal = paletteColors();
    const specs: PortraitSpec[] = [];
    for (const female of [false, true]) {
      for (const skin of [0, 1, 2, 3, 4]) {
        for (const eyes of EYE_STYLES) specs.push(plainFace(female, { skin, eyes, age: skin % 2 === 0 ? 2 : 0 }));
        for (const brows of BROW_STYLES) specs.push(plainFace(female, { skin, brows, hairColor: skin % 2 ? "blond" : "gray" }));
        for (const nose of NOSE_STYLES) specs.push(plainFace(female, { skin, nose }));
        for (const mouth of MOUTH_STYLES) specs.push(plainFace(female, { skin, mouth, age: skin % 2 === 1 ? 0 : 1 }));
      }
      for (const bangs of BANG_STYLES) for (const grizzle of [0, 1, 2] as const) specs.push(plainFace(female, { hair: female ? "straight" : "long", bangs, grizzle, age: grizzle ? 2 : 0 }));
    }
    for (const beard of BEARD_STYLES) for (const grizzle of [0, 1, 2] as const) specs.push(plainFace(false, { beard, grizzle, age: 1, hairColor: "auburn" }));
    for (const s of specs) {
      const a = drawPortrait(s);
      expect([a.w, a.h]).toEqual([64, 64]);
      expect(samePixels(a, drawPortrait({ ...s }))).toBe(true);
      const stray = [...new Set(a.data)].filter((v) => !pal.has(v));
      expect(stray).toEqual([]);
    }
  });

  it("小传里的发型线索：卷发、齐刘海、中分、鬓角花白", () => {
    const a = mateSpec({ name: "卷", bio: "一头卷发的厨子，她总在哼歌。" });
    expect([a.hair, bangsFor(a.hair, a.bangs)]).toEqual(["curls", "curly"]);
    expect(mateSpec({ name: "卷二", bio: "卷发的水手。" }).hair).toBe("curly");
    const b = mateSpec({ name: "齐", bio: "她留着齐刘海，是个算账的好手。" });
    expect(bangsFor(b.hair, b.bangs)).toBe("blunt");
    const c = mateSpec({ name: "分", bio: "中分长发的书记员。" });
    expect(bangsFor(c.hair, c.bangs)).toBe("center");
    const d = mateSpec({ name: "鬓", bio: "两鬓斑白的老账房。" });
    expect(d.age).toBe(2);
    expect(d.hairColor === "gray" || d.hairColor === "white" || d.grizzle === 1).toBe(true);
    const e = mateSpec({ name: "鬓二", bio: "鬓角花白，仍是最好的舵手。" });
    expect(e.age).toBeGreaterThanOrEqual(1);
    expect(e.grizzle === 1 || e.hairColor === "gray" || e.hairColor === "white").toBe(true);
    // “其中分出”之类的字样不算发型
    const plain = mateSpec({ name: "货", bio: "从货物其中分出一半。" });
    expect(plain).toEqual(portraitSpec("mate-货", "mate", { female: false, elf: false }));
  });

  it("24 个主角的五官组合两两不同：任意两位至少有 4 项五官或刘海不同，整组用到 5 种脸型、6 种以上眼型与刘海；每一批 12 位的发型互不相同", () => {
    const looks = CAPTAIN_LOOK_IDS.map((i) => captainSpec(i));
    expect(looks).toHaveLength(CAPTAIN_PORTRAITS);
    const parts = (s: PortraitSpec) => [s.face, s.eyes, s.brows, s.nose, s.mouth, bangsFor(s.hair, s.bangs), s.hair];
    for (let i = 0; i < looks.length; i++) {
      for (let j = i + 1; j < looks.length; j++) {
        const a = parts(looks[i]);
        const b = parts(looks[j]);
        expect(a.filter((v, k) => v !== b[k]).length).toBeGreaterThanOrEqual(4);
      }
    }
    expect(new Set(looks.map((s) => s.face)).size).toBe(FACE_SHAPES.length);
    expect(new Set(looks.map((s) => s.eyes)).size).toBeGreaterThanOrEqual(6);
    expect(new Set(looks.map((s) => bangsFor(s.hair, s.bangs))).size).toBeGreaterThanOrEqual(6);
    // 发型：第一批（0–11）的 12 位互不相同，英雄扩充（13–24）的 12 位互不相同；发型一共只有 22 种，24 位合起来用到 20 种
    const first = looks.slice(0, 12);
    const more = looks.slice(12);
    expect(new Set(first.map((s) => s.hair)).size).toBe(first.length);
    expect(new Set(more.map((s) => s.hair)).size).toBe(more.length);
    expect(new Set(looks.map((s) => s.hair)).size).toBeGreaterThanOrEqual(20);
    // 主角的刘海都是该发型允许的（写定的外貌不会被悄悄改画）
    for (const s of looks) expect(HAIR_BANGS[s.hair]).toContain(s.bangs);
  });
});

describe("动画赛璐璐头像（扩展第四批）", () => {
  /** 一块区域里 3×3 的棋盘格抖动（两种颜色逐像素交替）的个数。 */
  const checkers = (px: Px, x0: number, y0: number, x1: number, y1: number) => {
    let n = 0;
    for (let y = y0; y + 2 <= y1; y++) {
      for (let x = x0; x + 2 <= x1; x++) {
        const a = px.get(x, y);
        const b = px.get(x + 1, y);
        if (a === b) continue;
        let hit = true;
        for (let j = 0; j < 3 && hit; j++) for (let i = 0; i < 3 && hit; i++) if (px.get(x + i, y + j) !== ((i + j) % 2 === 0 ? a : b)) hit = false;
        if (hit) n++;
      }
    }
    return n;
  };

  it("脸、头发与帽子上没有棋盘格抖动：各文化 × 各身份 × 两性的头部区域一处都没有", () => {
    for (const region of CULTURE_OPTS) {
      for (const role of NPC_ROLES) {
        for (const female of [false, true]) {
          const px = drawPortrait(portraitSpec(`cel-${region ?? "mixed"}-${role}`, role, { region, female }));
          // 头部区域：衣领以上（y ≤ 46）
          expect(checkers(px, 6, 0, 58, 46)).toBe(0);
        }
      }
    }
    // 胡茬、面纱、毛皮帽、草帽、头巾、遮光帽檐这些以前靠抖动表现的部件也一样
    for (const over of [{ beard: "stubble" }, { hat: "veil" }, { hat: "fur" }, { hat: "straw" }, { hat: "bandana" }, { hat: "turban" }, { hat: "visor" }] as const) {
      const px = drawPortrait(plainFace(false, { hair: "crop", bangs: "wispy", ...over }));
      expect(checkers(px, 6, 0, 58, 46)).toBe(0);
    }
  });

  it("同色系描边：脸的轮廓线用皮肤自己的描边色，外面不再套一圈近黑", () => {
    const deep = rgba(ink.deep);
    for (const skin of [0, 1, 2, 3, 4]) {
      for (const face of FACE_SHAPES) {
        const px = drawPortrait(plainFace(skin % 2 === 1, { skin, face }));
        const row = headRows(face).get(36);
        expect(row).toBeDefined();
        const r = row ? row[1] : 0;
        expect(px.get(r, 36)).toBe(rgba(FACE_SKIN[skin][0]));
        expect(px.get(r + 1, 36)).not.toBe(deep);
      }
    }
    // 头发的外缘同样用发色最深一阶
    const px = drawPortrait(plainFace(true, { hair: "bob", bangs: "blunt", hairColor: "blond" }));
    let top = -1;
    for (let y = 0; y < 30 && top < 0; y++) if (px.get(31, y) === rgba(HAIR.blond[0])) top = y;
    expect(top).toBeGreaterThan(0);
    expect(px.get(31, top - 1)).not.toBe(deep);
  });

  it("眼睛大而有神：虹膜比宽更高（女性至少 5 行、男性至少 4 行），四阶虹膜上暗下亮都画出来", () => {
    const rowsWith = (px: Px, colors: readonly string[]) => {
      const set = new Set(colors.map((c) => rgba(c)));
      let n = 0;
      for (let y = 23; y <= 33; y++) {
        let hit = false;
        for (let x = 23; x <= 31; x++) if (set.has(px.get(x, y))) hit = true;
        if (hit) n++;
      }
      return n;
    };
    for (const eyeColor of [0, 2, 3, 6]) {
      const iris = eyeIris(eyeColor);
      for (const eyes of ["round", "almond", "droopy", "mono"] as const) {
        const f = drawPortrait(plainFace(true, { eyes, eyeColor }));
        const m = drawPortrait(plainFace(false, { eyes, eyeColor }));
        expect(rowsWith(f, iris)).toBeGreaterThanOrEqual(5);
        expect(rowsWith(m, iris)).toBeGreaterThanOrEqual(4);
        // 女性四阶都用到；最深的一阶在上、最亮的一阶在下
        for (const c of iris) expect(countIn(f, [c], 23, 24, 31, 33)).toBeGreaterThan(0);
        let lowest = -1;
        let highest = 99;
        for (let y = 24; y <= 33; y++) {
          for (let x = 23; x <= 31; x++) {
            if (f.get(x, y) === rgba(iris[3])) lowest = Math.max(lowest, y);
            if (f.get(x, y) === rgba(iris[0])) highest = Math.min(highest, y);
          }
        }
        expect(lowest).toBeGreaterThan(highest);
      }
    }
  });

  it("八种瞳色（四阶虹膜）画出来两两不同", () => {
    for (const female of [false, true]) {
      const prints = new Set([0, 1, 2, 3, 4, 5, 6, 7].map((eyeColor) => fingerprint(drawPortrait(plainFace(female, { eyeColor })))));
      expect(prints.size).toBe(8);
    }
  });

  it("颈纤细：女性的颈比男性细，女性不超过 7 像素、男性不超过 9 像素", () => {
    const width = (female: boolean) => {
      const px = drawPortrait(plainFace(female, { face: "oval" }));
      // 只数颈本身的皮肤（不含两侧的描边线）
      const skin = new Set(FACE_SKIN[1].slice(1).map((c) => rgba(c)));
      let n = 0;
      for (let x = 0; x < 64; x++) if (skin.has(px.get(x, 46))) n++;
      return n;
    };
    expect(width(true)).toBeLessThan(width(false));
    expect(width(true)).toBeLessThanOrEqual(7);
    expect(width(false)).toBeLessThanOrEqual(9);
  });

  it("鬓角花白只白贴着脸的发际线：同一发型下灰色像素远少于花白夹杂", () => {
    const gray = [...HAIR.gray];
    for (const hair of ["crop", "side", "long", "bob"] as const) {
      const g = (grizzle: 0 | 1 | 2) => countIn(drawPortrait(plainFace(hair === "bob", { hair, bangs: HAIR_BANGS[hair][0], grizzle, age: 1 })), gray, 0, 0, 63, 63);
      expect(g(0)).toBe(0);
      expect(g(1)).toBeGreaterThan(0);
      expect(g(1) * 4).toBeLessThan(g(2));
    }
  });
});

describe("头像美型第五批：评审意见落实与嫁接（动画赛璐璐方向）", () => {
  /** 一张头像里某组颜色的像素个数（整张图）。 */
  const countAll = (px: Px, colors: readonly string[]) => countIn(px, colors, 0, 0, 63, 63);
  /** 不戴帽、无饰物的标准人物（五官目录用），明确不别发饰。 */
  const face = (female: boolean, over: Partial<PortraitSpec> = {}) => plainFace(female, { ornament: "none", ...over });

  it("深肤色恢复原深度：古铜、棕褐、深褐的深影、暗面、基色与行人的 SKIN_TONES 相同，提亮的一阶只作高光", () => {
    for (const skin of [2, 3, 4]) {
      const [, deep, shade, base, hi] = FACE_SKIN[skin];
      expect([deep, shade, base]).toEqual(SKIN_TONES[skin].slice(0, 3));
      expect(hi).toBe(SKIN_TONES[skin][3]);
    }
    expect(FACE_SKIN[2][3]).toBe("#c7875e");
    expect(FACE_SKIN[3][3]).toBe("#9a5e3e");
    expect(FACE_SKIN[4][3]).toBe("#6e3e28");
    // 偏粉的暗面只给白皙、小麦两档
    for (const skin of [0, 1]) expect(FACE_SKIN[skin][2]).not.toBe(SKIN_TONES[skin][1]);
    // 五档基色由浅到深、相邻两档都拉得开
    const lum = FACE_SKIN.map((r) => luma(rgba(r[3])));
    for (let i = 1; i < lum.length; i++) expect(lum[i - 1] - lum[i]).toBeGreaterThan(10);
    // 24 位主角：脸上大面积的基色就是本档的基色，深肤色的主角不浅于行人
    for (const i of CAPTAIN_LOOK_IDS) {
      const s = captainSpec(i);
      const px = drawPortrait(s);
      expect(countIn(px, [FACE_SKIN[s.skin][3]], 17, 24, 46, 47)).toBeGreaterThan(40);
      if (s.skin >= 2) expect(FACE_SKIN[s.skin][3]).toBe(SKIN_TONES[s.skin][2]);
    }
  });

  it("成年男性不带腮红：留胡须或中年以上一格都没有，年轻、不留胡子的最多近侧 2 格", () => {
    for (const skin of [0, 1, 2, 3, 4]) {
      const rouge = [...FACE_ROUGE[skin]];
      for (const age of [0, 1, 2] as const) {
        for (const beard of ["none", "stubble", "trim", "goatee"] as const) {
          const n = countAll(drawPortrait(face(false, { skin, age, beard })), rouge);
          if (age > 0 || beard !== "none") expect(n).toBe(0);
          else expect(n).toBeLessThanOrEqual(2);
        }
      }
      // 女性照旧两颊都有腮红
      expect(countAll(drawPortrait(face(true, { skin })), rouge)).toBeGreaterThanOrEqual(6);
    }
  });

  it("五种脸型拉开差别：轮廓两两至少 6 行不同、面积差至少 10 像素，下巴高低相差至少 4 行，脸长大于脸宽；方脸两侧竖直落下再收到 4 像素的平下巴、瓜子最窄、圆脸最短（y41）、长脸靠窄而下巴在 y46；男性下颌支竖直 3 行、在下颌角转折成一条直线收到平下巴，远侧颧骨收 1 像素", () => {
    for (const male of [false, true]) {
      const rows = FACE_SHAPES.map((f) => headRows(f, male));
      const area = (m: Map<number, readonly [number, number]>) => {
        let n = 0;
        for (const [, [a, b]] of m) n += b - a + 1;
        return n;
      };
      for (let i = 0; i < rows.length; i++) {
        for (let j = i + 1; j < rows.length; j++) {
          let diff = 0;
          for (let y = 24; y <= 48; y++) if (JSON.stringify(rows[i].get(y)) !== JSON.stringify(rows[j].get(y))) diff++;
          expect(diff).toBeGreaterThanOrEqual(6);
          expect(Math.abs(area(rows[i]) - area(rows[j]))).toBeGreaterThanOrEqual(10);
        }
      }
      const chins = FACE_SHAPES.map((f) => chinY(f, male));
      expect(Math.max(...chins) - Math.min(...chins)).toBeGreaterThanOrEqual(4);
      for (const f of FACE_SHAPES) {
        let l = 99;
        let r = -1;
        for (const [, [a, b]] of headRows(f, male)) {
          l = Math.min(l, a);
          r = Math.max(r, b);
        }
        expect(chinY(f, male) - HEAD.top + 1).toBeGreaterThan(r - l + 1);
        // 嘴底（下唇）到下巴描边至少隔 2 行，窄下巴也不挤
        for (let x = HEAD.midX - 1; x <= HEAD.midX + 1; x++) expect(jawBottom(f, x, male) - (mouthY(f) + 1) - 1).toBeGreaterThanOrEqual(2);
      }
      const width = (f: (typeof FACE_SHAPES)[number], y: number) => {
        const s = headRows(f, male).get(y);
        return s ? s[1] - s[0] + 1 : 0;
      };
      // 瓜子在颧骨以下最窄，圆脸下巴最短（y41），长脸下巴在 y46，方脸下巴底是平的 4 像素、两侧在 y35–37 竖直
      for (const f of FACE_SHAPES) if (f !== "heart") expect(width("heart", 36)).toBeLessThan(width(f, 36));
      for (const f of FACE_SHAPES) if (f !== "round") expect(chinY("round", male)).toBeLessThan(chinY(f, male));
      expect(chinY("round", male)).toBe(41);
      expect(chinY("long", male)).toBe(46);
      expect(width("square", chinY("square", male))).toBe(4);
      expect(width("square", 40)).toBeGreaterThan(width("oval", 40));
      const sq = headRows("square", male);
      for (const y of [36, 37]) expect(sq.get(y)).toEqual(sq.get(35));
    }
    for (const f of FACE_SHAPES) {
      const r = headRows(f, true);
      for (let y = 28; y <= 33; y++) expect(r.get(y)![1]).toBeLessThanOrEqual(44);
      // 下颌支：耳垂下（y35–37）近侧竖直 3 行；下颌角以下每一行都往里收（一条直线，没有竖直的台阶），下巴平 4 格（圆脸更宽）
      const l35 = r.get(35)![0];
      expect(r.get(36)![0]).toBe(l35);
      expect(r.get(37)![0]).toBe(l35);
      const cy = chinY(f, true);
      for (let y = 38; y <= cy; y++) expect(r.get(y)![0]).toBeGreaterThan(r.get(y - 1)![0]);
      const [a, b] = r.get(cy)!;
      if (f === "round") expect(b - a + 1).toBeGreaterThanOrEqual(4);
      else expect(b - a + 1).toBe(4);
    }
  });
  it("男式短发彼此可分：短寸、侧分、蓬乱三种轮廓两两至少 25 像素不同，而且不共用同一个左侧尖发梢", () => {
    const sil = (hair: "crop" | "side" | "messy") => {
      const px = drawPortrait(face(false, { hair, bangs: HAIR_BANGS[hair][0] }));
      const bg = new Set(ROLE_BG.townsfolk.map((c) => rgba(c)));
      return Array.from({ length: 64 * 30 }, (_, i) => (bg.has(px.get(i % 64, Math.floor(i / 64))) ? 0 : 1));
    };
    const [a, b, c] = (["crop", "side", "messy"] as const).map(sil);
    const d = (u: number[], v: number[], x1 = 64) => u.filter((w, i) => i % 64 < x1 && w !== v[i]).length;
    expect(d(a, b)).toBeGreaterThanOrEqual(25);
    expect(d(a, c)).toBeGreaterThanOrEqual(25);
    expect(d(b, c)).toBeGreaterThanOrEqual(25);
    // 近侧（左边 x<20）的轮廓也各不相同
    expect(d(a, b, 20)).toBeGreaterThan(0);
    expect(d(a, c, 20)).toBeGreaterThan(0);
    expect(d(b, c, 20)).toBeGreaterThan(0);
  });

  it("瞳孔永远是虹膜里最暗的两格（八种瞳色、两性、三档浅肤色），琥珀眼也读得出瞳孔", () => {
    for (const female of [false, true]) {
      for (const skin of [0, 1, 2]) {
        for (let eyeColor = 0; eyeColor < 8; eyeColor++) {
          const px = drawPortrait(face(female, { skin, eyeColor, hairColor: "blond" }));
          const pupil = EYE_PUPIL[eyeColor];
          expect(countIn(px, [pupil], 22, 24, 32, 32)).toBe(2);
          expect(countIn(px, [pupil], 36, 24, 45, 32)).toBe(2);
          for (const c of eyeIris(eyeColor)) expect(luma(rgba(pupil))).toBeLessThan(luma(rgba(c)));
        }
      }
    }
  });

  it("深肤色的眼睛：虹膜最深一阶比皮肤暗面更暗，上睫毛用近黑（金发也一样）", () => {
    for (const skin of [3, 4]) {
      const shade = luma(rgba(FACE_SKIN[skin][2]));
      for (let eyeColor = 0; eyeColor < 8; eyeColor++) {
        for (const female of [false, true]) {
          const px = drawPortrait(face(female, { skin, eyeColor, hairColor: "blond" }));
          // 虹膜最上一行最左的一格（印章里第一个 “1”）
          const rows = eyeStamp("almond", female).near;
          const r0 = rows.findIndex((r) => r.includes("1"));
          const c0 = rows[r0].indexOf("1");
          expect(luma(px.get(22 + c0, 24 + r0))).toBeLessThan(shade);
          expect(countIn(px, [P.hair.black[0]], 21, 23, 45, 33)).toBeGreaterThanOrEqual(8);
        }
      }
    }
  });

  it("眼白偏冷、只有高光是纯白；高光按眼型与身份区分：老人 1×1，凤眼、细长眼、海盗 1×2，圆眼与少女 2×2 外加一点闪光", () => {
    const whites = (s: PortraitSpec) => countIn(drawPortrait(s), [P.white], 22, 24, 32, 32);
    expect(countIn(drawPortrait(face(true)), [SCLERA[1]], 22, 24, 32, 32)).toBeGreaterThan(0);
    for (const female of [false, true]) {
      for (const eyes of EYE_STYLES) {
        expect(whites(face(female, { eyes, age: 2 }))).toBe(1);
        if (eyes === "sharp" || eyes === "narrow") expect(whites(face(female, { eyes }))).toBe(2);
        expect(whites(face(female, { eyes, role: "pirate" }))).toBe(2);
      }
      expect(whites(face(female, { eyes: "round" }))).toBe(5);
    }
    // 少女（青年女性）的杏眼、下垂眼也是 2×2 加闪光；中年女性回到 1×2
    expect(whites(face(true, { eyes: "almond" }))).toBe(5);
    expect(whites(face(true, { eyes: "droopy" }))).toBe(5);
    expect(whites(face(true, { eyes: "almond", age: 1 }))).toBe(2);
    expect(whites(face(false, { eyes: "almond" }))).toBe(2);
  });

  it("半垂眼不显困：虹膜露出至少 4 行，高光落在虹膜的上半部", () => {
    for (const female of [false, true]) {
      for (const eyeColor of [0, 2, 5]) {
        const px = drawPortrait(face(female, { eyes: "sleepy", eyeColor }));
        const iris = new Set([...eyeIris(eyeColor), EYE_PUPIL[eyeColor], P.white].map((c) => rgba(c)));
        const rows: number[] = [];
        for (let y = 23; y <= 33; y++) {
          let hit = false;
          for (let x = 23; x <= 31; x++) if (iris.has(px.get(x, y)) && px.get(x, y) !== rgba(P.white)) hit = true;
          if (hit) rows.push(y);
        }
        expect(rows.length).toBeGreaterThanOrEqual(4);
        let glint = 99;
        for (let y = 23; y <= 33; y++) for (let x = 23; x <= 31; x++) if (px.get(x, y) === rgba(P.white)) glint = Math.min(glint, y);
        expect(glint).toBeLessThan(rows[0] + rows.length / 2);
      }
    }
  });

  it("男性的虹膜比女性少一行；男性凤眼的上睫毛线只有 1 像素、外眼角不上挑", () => {
    const irisRows = (s: PortraitSpec) => {
      const px = drawPortrait(s);
      const iris = new Set([...eyeIris(s.eyeColor), EYE_PUPIL[s.eyeColor], P.white].map((c) => rgba(c)));
      let n = 0;
      for (let y = 23; y <= 33; y++) {
        let hit = false;
        for (let x = 23; x <= 31; x++) if (iris.has(px.get(x, y))) hit = true;
        if (hit) n++;
      }
      return n;
    };
    for (const eyes of EYE_STYLES) expect(irisRows(face(false, { eyes, eyeColor: 2 }))).toBe(irisRows(face(true, { eyes, eyeColor: 2 })) - 1);
    const sharp = eyeStamp("sharp", false);
    for (const rows of [sharp.near, sharp.far]) {
      // 上睫毛线：每一列最多 1 格 K；外眼角没有高过睫毛线的一笔
      const lashRows = rows.map((r, i) => (r.includes("K") ? i : -1)).filter((i) => i >= 0);
      const top = Math.min(...lashRows);
      for (let c = 0; c < rows[0].length; c++) expect(rows.filter((r) => r[c] === "K").length).toBeLessThanOrEqual(1);
      expect(rows[top].replace(/[^K]/g, "").length).toBeGreaterThanOrEqual(5);
    }
  });

  it("嘴：女性 3 像素短唇线，嘴型的差别在嘴角——抿嘴两角各下压一格、歪嘴一角上扬并延长、中性用唇缝色，这两种不加粉色高光；开怀笑不露齿；青年男性的微笑是 4 像素平嘴线只抬一角，中老年两角上扬", () => {
    const my = mouthY("oval");
    for (const skin of [0, 1, 2, 3, 4]) {
      const lip = LIP_TONES[skin];
      for (const mouth of MOUTH_STYLES) {
        const f = drawPortrait(face(true, { mouth, skin }));
        const plainMouth = mouth === "line" || mouth === "frown";
        expect(countIn(f, [lip[3]], 31, 35, 39, 44)).toBe(plainMouth ? 0 : 1);
        if (mouth === "line") {
          // 中性：唇缝色在中间、两侧上唇色
          expect(f.get(HEAD.midX, my)).toBe(rgba(lip[0]));
          expect(countIn(f, [lip[1]], 31, my, 39, my)).toBe(2);
        } else {
          expect(countIn(f, [lip[1]], 31, 35, 39, 44)).toBeGreaterThanOrEqual(3);
          expect(countIn(f, [lip[1]], 31, 35, 39, 44)).toBeLessThanOrEqual(5);
        }
        // 抿嘴：唇线下一行两个嘴角各一格；歪嘴：唇线上一行只在远侧有两格（上扬并延长），近侧平
        if (mouth === "frown") {
          expect(countIn(f, [lip[1]], 31, my + 1, 39, my + 1)).toBe(2);
          expect(countIn(f, [lip[1]], 31, my - 1, 39, my - 1)).toBe(0);
        }
        if (mouth === "smirk") {
          expect(countIn(f, [lip[1]], HEAD.midX + 1, my - 1, 40, my - 1)).toBe(2);
          expect(countIn(f, [lip[1]], 30, my - 1, HEAD.midX, my - 1)).toBe(0);
        }
      }
      for (const female of [false, true]) expect(countIn(drawPortrait(face(female, { mouth: "grin", skin })), [P.white], 30, 34, 40, 44)).toBe(0);
    }
    // 男性的微笑：青年只抬一角（唇线上一行一格描边色）、唇线 4 像素、没有粉色的下唇；中老年两角都上扬
    const ramp = FACE_SKIN[1];
    const smile = (age: 0 | 1 | 2) => drawPortrait(face(false, { mouth: "smile", age }));
    const corners = (age: 0 | 1 | 2) => countIn(smile(age), [ramp[0]], 30, my - 1, 41, my - 1);
    expect(corners(0)).toBe(1);
    expect(corners(1)).toBe(2);
    expect(corners(2)).toBe(2);
    for (const age of [0, 1, 2] as const) {
      expect(countIn(smile(age), [ramp[0]], 30, my, 41, my)).toBe(4);
      expect(countIn(smile(age), [...LIP_TONES[1]], 30, my - 1, 41, my + 2)).toBe(0);
    }
  });
  it("年龄：老人高光 1×1、睫毛线下移、原线成眼皮褶；老妇的笑纹与法令纹用深影连成一笔、虹膜比少女少两行、腮红只留近侧一格、嘴角上扬不加下唇高光、近侧下颌多一格松弛的转折；老翁有抬头纹；中年只多一道眼尾细纹", () => {
    for (const female of [false, true]) {
      const ramp = FACE_SKIN[1];
      const deep = (age: 0 | 1 | 2) => countIn(drawPortrait(face(female, { age })), [ramp[1]], 16, 22, 46, 46);
      expect(deep(1) - deep(0)).toBe(2);
      expect(deep(2)).toBeGreaterThan(deep(1));
    }
    const ramp = FACE_SKIN[1];
    const oldF = drawPortrait(face(true, { age: 2 }));
    const my = mouthY("oval");
    const ex = HEAD.nearEyeX;
    const ey = HEAD.eyeY;
    // 法令纹：鼻翼外下方连到嘴角外的 3 像素（深影，斜着、竖着相接成一笔）；外眼角 2 像素的斜向笑纹
    for (const [x, y] of [
      [HEAD.midX - 4, my - 3],
      [HEAD.midX - 5, my - 2],
      [HEAD.midX - 5, my - 1],
      [ex - 3, ey + 2],
      [ex - 4, ey + 3],
    ] as const)
      expect(oldF.get(x, y)).toBe(rgba(ramp[1]));
    // 白皙肤色上也看得见：纹路用深影，与基色的明度差不小于基色的 20%
    const fair = FACE_SKIN[0];
    expect(luma(rgba(fair[3])) - luma(rgba(fair[1]))).toBeGreaterThan(luma(rgba(fair[3])) * 0.2);
    // 老翁（光头）额头的抬头纹
    const oldM = drawPortrait(face(false, { age: 2 }));
    expect(countIn(oldM, [ramp[1]], 24, 17, 33, 17)).toBeGreaterThanOrEqual(8);
    // 老妇的腮红只留近侧一格；嘴没有粉色的下唇高光
    expect(countAll(oldF, [...FACE_ROUGE[1]])).toBeLessThanOrEqual(1);
    for (const mouth of MOUTH_STYLES) expect(countIn(drawPortrait(face(true, { age: 2, mouth })), [LIP_TONES[1][3]], 30, 34, 40, 44)).toBe(0);
    // 虹膜：老妇比少女少两行（睫毛线下移一行、最底一行变回皮肤），没有小闪光
    const irisRows = (s: PortraitSpec) => {
      const px = drawPortrait(s);
      const iris = new Set([...eyeIris(s.eyeColor), EYE_PUPIL[s.eyeColor], P.white].map((c) => rgba(c)));
      let n = 0;
      for (let y = 23; y <= 33; y++) {
        let hit = false;
        for (let x = 23; x <= 31; x++) if (iris.has(px.get(x, y))) hit = true;
        if (hit) n++;
      }
      return n;
    };
    for (const eyes of EYE_STYLES) expect(irisRows(face(true, { eyes, age: 2, eyeColor: 2 }))).toBe(irisRows(face(true, { eyes, eyeColor: 2 })) - 2);
    // 近侧下颌在嘴角高度多一格松弛的转折（老妇的脸在那一行比少女宽一格）
    const skinAt = (px: Px, y: number) => {
      const set = new Set(FACE_SKIN[1].map((c) => rgba(c)));
      let x = 0;
      while (x < 40 && !set.has(px.get(x, y))) x++;
      return x;
    };
    const young = drawPortrait(face(true, {}));
    expect(skinAt(oldF, my + 1)).toBe(skinAt(young, my + 1) - 1);
  });
  it("鬓角花白：一条约 3 像素宽的灰色鬓角带，戴帽时从帽檐下露出来；花白夹杂时发髻保持原发色", () => {
    const gray = [...HAIR.gray];
    for (const hat of ["none", "tricorn", "cap", "turban"] as const) {
      const px = drawPortrait(face(false, { hair: "side", bangs: "side", hairColor: "black", grizzle: 1, age: 1, hat }));
      // 近侧鬓角：某一行至少连着 2 格灰、整条至少 10 格
      expect(countIn(px, gray, 14, 15, 26, 35)).toBeGreaterThanOrEqual(10);
      let run = 0;
      for (let y = 15; y <= 35; y++) {
        let r = 0;
        for (let x = 14; x <= 26; x++) {
          r = gray.some((c) => rgba(c) === px.get(x, y)) ? r + 1 : 0;
          run = Math.max(run, r);
        }
      }
      expect(run).toBeGreaterThanOrEqual(2);
    }
    // 花白夹杂：发髻的一团保持原发色
    const bun = drawPortrait(face(true, { hair: "bun", bangs: "side", hairColor: "brown", grizzle: 2, age: 2 }));
    expect(countIn(bun, gray, 13, 6, 19, 12)).toBe(0);
    // 灰发的描边保留原来的发色（外缘不是一圈灰）
    const px = drawPortrait(face(false, { hair: "crop", bangs: "wispy", hairColor: "dark", grizzle: 2, age: 2 }));
    expect(countAll(px, [HAIR.dark[0]])).toBeGreaterThan(20);
  });

  it("眉毛每一笔都连着：七种眉形在男女、近远侧都没有断开的单像素；女性的眉毛比男性浅一阶", () => {
    for (const style of BROW_STYLES) {
      const stamp = browStamp(style);
      for (const male of [false, true]) {
        for (const rows of [stamp.near, stamp.far]) {
          const on = (x: number, y: number) => {
            const c = rows[y]?.[x];
            return c === "B" || c === "T" || (male && c === "b");
          };
          const pts: [number, number][] = [];
          rows.forEach((r, y) => [...r].forEach((_, x) => on(x, y) && pts.push([x, y])));
          expect(pts.length).toBeGreaterThan(0);
          // 每个像素都有上下左右相邻的眉毛像素
          for (const [x, y] of pts) expect(on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1)).toBe(true);
          // 整道眉是一个连通块（斜着相接也算）
          const seen = new Set<string>([pts[0].join()]);
          const stack = [pts[0]];
          while (stack.length) {
            const [x, y] = stack.pop()!;
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                const k = `${x + dx},${y + dy}`;
                if (!seen.has(k) && on(x + dx, y + dy)) {
                  seen.add(k);
                  stack.push([x + dx, y + dy]);
                }
              }
            }
          }
          expect(seen.size).toBe(pts.length);
        }
      }
    }
    // 棕发：女性眉身用发色基色（浅一阶），男性用暗阶
    for (const brows of BROW_STYLES) {
      expect(countIn(drawPortrait(face(true, { brows })), [HAIR.brown[2]], 20, 19, 46, 24)).toBeGreaterThan(0);
      expect(countIn(drawPortrait(face(true, { brows })), [HAIR.brown[1]], 20, 19, 46, 24)).toBe(0);
      expect(countIn(drawPortrait(face(false, { brows })), [HAIR.brown[1]], 20, 19, 46, 24)).toBeGreaterThanOrEqual(8);
    }
  });

  it("卷发逐卷上色：外轮廓一个个半圆凸起（顶沿与两侧合计至少 6 个），发卷里有受光与暗缝，和直发一眼分开", () => {
    const bg = new Set(ROLE_BG.townsfolk.map((c) => rgba(c)));
    /** 去掉连续相同值后数凸起（sign=-1 数极小值，1 数极大值）。 */
    const peaks = (v: number[], sign: number) => {
      const s = v.filter((x, i) => i === 0 || x !== v[i - 1]);
      let n = 0;
      for (let i = 1; i + 1 < s.length; i++) if (sign * (s[i] - s[i - 1]) > 0 && sign * (s[i] - s[i + 1]) > 0) n++;
      return n;
    };
    const bumps = (female: boolean, hair: HairStyle, bangs: BangStyle) => {
      const px = drawPortrait(face(female, { hair, bangs, hairColor: "brown" }));
      const top: number[] = [];
      const left: number[] = [];
      const right: number[] = [];
      for (let x = 12; x <= 50; x++) {
        let y = 0;
        while (y < 30 && bg.has(px.get(x, y))) y++;
        top.push(y);
      }
      for (let y = 4; y <= 30; y++) {
        let x = 0;
        while (x < 31 && bg.has(px.get(x, y))) x++;
        left.push(x);
        let r = 63;
        while (r > 32 && bg.has(px.get(r, y))) r--;
        right.push(r);
      }
      return { n: peaks(top, -1) + peaks(left, -1) + peaks(right, 1), px };
    };
    const curls = bumps(true, "curls", "curly");
    const curly = bumps(false, "curly", "curly");
    expect(curls.n).toBeGreaterThanOrEqual(6);
    expect(curly.n).toBeGreaterThanOrEqual(6);
    expect(curls.n).toBeGreaterThanOrEqual(bumps(true, "wavy", "center").n + 4);
    expect(curly.n).toBeGreaterThanOrEqual(bumps(false, "crop", "wispy").n + 4);
    for (const { px } of [curls, curly]) expect(HAIR.brown.filter((c) => countIn(px, [c], 14, 2, 48, 20) > 0).length).toBeGreaterThanOrEqual(4);
  });

  it("毛领成簇平涂、黑蕾丝是稀疏的网格：两处都没有棋盘格", () => {
    const bg = new Set(ROLE_BG.townsfolk.map((c) => rgba(c)));
    const alt2 = (px: Px, x0: number, y0: number, x1: number, y1: number) => {
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const a = px.get(x, y);
          const b = px.get(x + 1, y);
          if (bg.has(a) || bg.has(b)) continue;
          if (a !== b && px.get(x + 1, y + 1) === a && px.get(x, y + 1) === b && px.get(x + 2, y) === a && px.get(x + 2, y + 1) === b) n++;
        }
      }
      return n;
    };
    for (const accent of ["white", "gold", "navy"] as const) {
      const px = drawPortrait(face(false, { outfit: "fur", accent, main: "slate" }));
      expect(alt2(px, 0, 44, 62, 60)).toBe(0);
    }
    for (const hatColor of ["black", "white"] as const) {
      const px = drawPortrait(face(true, { hat: "mantilla", hatColor, hair: "bun", bangs: "side" }));
      expect(alt2(px, 2, 0, 58, 60)).toBe(0);
    }
  });

  it("面纱是一块垂布：上沿一道金边平直地压在鼻梁下，两侧竖直落下，下缘垂到下巴以下 3–6 行、盖住衣领，与脸型无关；两道竖向软褶，嘴的位置不点暗色；与皮肤明度太接近时换成暗一阶；白头纱用奶白", () => {
    const teal = drawPortrait(face(true, { hat: "veil", hatColor: "teal", hair: "bun" }));
    const cloth = [...CLOTH.teal, CLOTH_DEEP.teal];
    expect(countIn(teal, cloth, 26, 37, 44, 47)).toBeGreaterThan(80);
    // 上沿：y35 一整行金边
    expect(countIn(teal, [...METAL.gold], 23, 35, 47, 35)).toBeGreaterThanOrEqual(20);
    // 嘴的位置就是纱的基色，不透出暗色的嘴
    expect(teal.get(HEAD.midX, mouthY("oval"))).toBe(rgba(CLOTH.teal[1]));
    // 下缘在下巴以下 3–6 行（中线上最低的纱）
    let low = -1;
    for (let y = 36; y < 64; y++) if (cloth.some((c) => rgba(c) === teal.get(HEAD.midX, y))) low = y;
    expect(low - chinY("oval", false)).toBeGreaterThanOrEqual(3);
    expect(low - chinY("oval", false)).toBeLessThanOrEqual(6);
    // 两侧竖直：近侧 x23 与远侧 x47 从金边往下一直是纱
    for (let y = 36; y <= 46; y++) {
      expect(cloth.some((c) => rgba(c) === teal.get(23, y))).toBe(true);
      expect(cloth.some((c) => rgba(c) === teal.get(47, y))).toBe(true);
    }
    // 两道竖向软褶：x29 与 x39 各有一列暗阶
    for (const x of [29, 39]) expect(countIn(teal, [CLOTH.teal[0]], x, 37, x, 47)).toBeGreaterThanOrEqual(8);
    // 与脸型无关：圆脸、长脸蒙上同一块纱，纱的区域一模一样
    const veilArea = (f: (typeof FACE_SHAPES)[number]) => regionPrint(drawPortrait(face(true, { hat: "veil", hatColor: "teal", hair: "bun", face: f })), 23, 36, 47, 50);
    expect(veilArea("round")).toBe(veilArea("long"));
    // 纱面没有白色（不是口罩、不是白胡子）
    expect(countIn(teal, [P.white], 24, 36, 46, 50)).toBe(0);
    for (const hatColor of ["white", "cream"] as const) {
      const white = drawPortrait(face(true, { hat: "veil", hatColor, hair: "bun" }));
      expect(countIn(white, [CLOTH.cream[1]], 26, 37, 44, 47)).toBeGreaterThan(60);
      expect(countIn(white, [P.white], 24, 36, 46, 50)).toBe(0);
    }
    // 纱与皮肤拉得开：纱的基色（嘴的位置）与皮肤基色的明度差不小于 15%
    for (const skin of [0, 1, 2, 3, 4]) {
      for (const hatColor of ["teal", "jade", "brown", "red", "purple", "ochre", "sand", "crimson"] as const) {
        const px = drawPortrait(face(true, { hat: "veil", hatColor, hair: "bun", skin }));
        const base = luma(rgba(FACE_SKIN[skin][3]));
        expect(Math.abs(luma(px.get(HEAD.midX, mouthY("oval"))) - base)).toBeGreaterThanOrEqual(base * 0.15);
      }
    }
  });
  it("胸像构图：衣服与胸口整层下移 BODY_DY=1，下巴下方露出一段颈、开领处露出锁骨受光线，身体轮廓以外不露皮肤", () => {
    expect(BODY_DY).toBe(1);
    for (const female of [false, true]) {
      for (const skin of [0, 2, 4]) {
        const s = face(female, { skin });
        const px = drawPortrait(s);
        const ramp = new Set(FACE_SKIN[skin].map((c) => rgba(c)));
        const cy = chinY(s.face, !female);
        let neck = 0;
        for (let y = cy + 1; y <= cy + 4; y++) if (ramp.has(px.get(33, y))) neck++;
        expect(neck).toBe(4);
        // 肩头（身体轮廓外、颈根展开以外）不露出胸口的皮肤
        expect(countIn(px, FACE_SKIN[skin], 2, 50, 20, 52)).toBe(0);
      }
    }
    // 开领的衣服（胸衣、方领裙、群岛披布）露出近侧锁骨的一道受光线
    for (const [female, outfit] of [
      [true, "bodice"],
      [true, "dress"],
      [false, "island"],
    ] as const) {
      expect(countIn(drawPortrait(face(female, { outfit })), [FACE_SKIN[1][4]], 18, 48, 34, 54)).toBeGreaterThanOrEqual(3);
    }
  });

  it("发饰：八种（含束发布条）画出来两两不同；金属、宝石、珍珠、布花都有白色闪光，束发布条是布、没有闪光；戴帽子或光头时不画；蝴蝶结压在头发里、颜色取自服装，珍珠串是一条连续的珠线", () => {
    const base = face(true, { hair: "straight", bangs: "side", accent: "teal" });
    const prints = new Set(ORNAMENTS.map((ornament) => fingerprint(drawPortrait({ ...base, ornament }))));
    expect(prints.size).toBe(ORNAMENTS.length);
    const white = rgba(P.white);
    const added = (a: Px, b: Px) => {
      const out: [number, number, number][] = [];
      for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) out.push([i % 64, Math.floor(i / 64), a.data[i]]);
      return out;
    };
    for (const ornament of ORNAMENTS) {
      if (ornament === "none") continue;
      const a = drawPortrait({ ...base, ornament });
      const b = drawPortrait({ ...base, ornament: "none" });
      const glint = added(a, b).filter(([, , v]) => v === white).length;
      if (ornament === "tie") expect(glint).toBe(0);
      else expect(glint).toBeGreaterThan(0);
      for (const hat of ["tricorn", "kerchief", "veil", "hood", "hairpin"] as const) {
        expect(samePixels(drawPortrait({ ...base, ornament, hat }), drawPortrait({ ...base, ornament: "none", hat }))).toBe(true);
      }
      expect(samePixels(drawPortrait({ ...base, ornament, hair: "bald" }), drawPortrait({ ...base, ornament: "none", hair: "bald" }))).toBe(true);
    }
    // 蝴蝶结与束发布条：锚点随发型走，画出来的每一格都落在头发上（不浮在背景上、不压到脸上）
    for (const hair of ["straight", "bun", "ponytail", "twinbuns", "updo", "bob", "pixie"] as const) {
      for (const ornament of ["ribbon", "tie"] as const) {
        const s = face(true, { hair, bangs: HAIR_BANGS[hair][0], accent: "teal", hairColor: "brown" });
        const b = drawPortrait({ ...s, ornament: "none" });
        const px = added(drawPortrait({ ...s, ornament }), b);
        expect(px.length).toBeGreaterThan(3);
        const hairSet = new Set(HAIR.brown.map((c) => rgba(c)));
        for (const [x, y] of px) expect(hairSet.has(b.get(x, y))).toBe(true);
      }
    }
    // 蝴蝶结的布色取自服装（点缀色与发色拉得开时用点缀色，否则看主色），不是固定的酒红
    const teal = drawPortrait({ ...base, ornament: "ribbon", accent: "teal" });
    const gold = drawPortrait({ ...base, ornament: "ribbon", accent: "gold", main: "navy" });
    const green = drawPortrait({ ...base, ornament: "ribbon", accent: "cream", main: "jade" });
    expect(countIn(teal, [...CLOTH.teal], 10, 8, 30, 26)).toBeGreaterThanOrEqual(8);
    expect(countIn(gold, [...CLOTH.gold], 10, 8, 30, 26)).toBeGreaterThanOrEqual(8);
    expect(countIn(green, [...CLOTH.jade], 10, 8, 30, 26)).toBeGreaterThanOrEqual(8);
    for (const px of [teal, gold, green]) expect(countIn(px, [...CLOTH.crimson], 10, 8, 30, 26)).toBe(0);
    // 珍珠串：白与浅银的珠子连成一条（八邻接连通）至少 12 颗，下方一列发色暗阶的投影
    const pearls = added(drawPortrait({ ...base, ornament: "pearls" }), drawPortrait({ ...base, ornament: "none" }));
    const beads = pearls.filter(([, , v]) => v === white || v === rgba(P.snow[2]));
    const key = (x: number, y: number) => `${x},${y}`;
    const set = new Set(beads.map(([x, y]) => key(x, y)));
    const seen = new Set<string>([key(beads[0][0], beads[0][1])]);
    const stack = [[beads[0][0], beads[0][1]]];
    while (stack.length) {
      const [x, y] = stack.pop()!;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const k = key(x + dx, y + dy);
          if (set.has(k) && !seen.has(k)) {
            seen.add(k);
            stack.push([x + dx, y + dy]);
          }
        }
    }
    expect(seen.size).toBeGreaterThanOrEqual(12);
    // 每颗珠子下面一格是发色暗阶的投影（或下一颗珠子）
    const pearlPx = drawPortrait({ ...base, ornament: "pearls" });
    const under = beads.filter(([x, y]) => pearlPx.get(x, y + 1) === rgba(HAIR.brown[1]) || set.has(key(x, y + 1))).length;
    expect(under).toBeGreaterThanOrEqual(beads.length - 2);
    // 主角：3 号别宝石发夹、5 号戴细金头冠
    expect(captainSpec(3).ornament).toBe("clip");
    expect(captainSpec(5).ornament).toBe("circlet");
  });
  it("发饰用独立的随机序列、按文化与身份挑选：已有部件的抽取不变；海盗、船厂、码头只在发髻上系束发布条（或不戴），蝴蝶结只给市民、酒馆、交易所；群岛偏小花、北地偏头冠、内海偏珍珠", () => {
    // 加入发饰之前的抽取结果（与第四批的 makeSpec 算出的值相同）：性别、帽子、服饰、发型、刘海、主色、点缀色、帽色都不变
    const before: readonly (readonly [string, boolean, string, string, string, string, string, string, string])[] = [
      ["alpha", true, "none", "tunic", "ponytail", "wispy", "green", "brown", "ochre"],
      ["beta", true, "mantilla", "bodice", "braids", "blunt", "crimson", "brown", "cream"],
      ["gamma", false, "none", "doublet", "side", "swept", "cream", "white", "crimson"],
      ["delta", true, "mantilla", "dress", "bob", "swept", "blue", "white", "cream"],
      ["epsilon", true, "mantilla", "bodice", "wavy", "curly", "ochre", "white", "cream"],
      ["zeta", true, "mantilla", "dress", "pixie", "swept", "blue", "brown", "crimson"],
      ["eta", true, "none", "bodice", "wavy", "swept", "green", "white", "cream"],
      ["theta", true, "kerchief", "bodice", "wavy", "curly", "crimson", "cream", "brown"],
    ];
    for (const [seed, ...want] of before) {
      const s = portraitSpec(seed, "townsfolk", { region: "mediterranean" });
      expect([s.female, s.hat, s.outfit, s.hair, s.bangs, s.main, s.accent, s.hatColor]).toEqual(want);
    }
    let young = 0;
    const byRegion = new Map<string, Map<string, number>>();
    for (let i = 0; i < 700; i++) {
      const region = ARCH_STYLES[i % ARCH_STYLES.length];
      const role = NPC_ROLES[i % NPC_ROLES.length];
      const f = portraitSpec(`orn-${i}`, role, { female: true, age: 0, region });
      if (f.ornament !== "none") {
        young++;
        expect(f.hat).toBe("none");
        expect(f.hair).not.toBe("bald");
        if (role === "pirate" || role === "shipyard" || role === "sailor" || role === "warehouse") {
          expect(f.ornament).toBe("tie");
          expect(["bun", "updo", "twinbuns"]).toContain(f.hair);
        } else expect(f.ornament).not.toBe("tie");
        if (f.ornament === "ribbon") expect(["townsfolk", "tavern", "exchange"]).toContain(role);
        const m = byRegion.get(region) ?? new Map<string, number>();
        m.set(f.ornament, (m.get(f.ornament) ?? 0) + 1);
        byRegion.set(region, m);
      }
      const m = portraitSpec(`orn-${i}`, role, { female: false, elf: false, region });
      expect(m.ornament).toBe("none");
      const e = portraitSpec(`orn-${i}`, "townsfolk", { female: false, elf: true, region });
      expect(["none", "circlet"]).toContain(e.ornament);
    }
    // 不戴帽子的青年女性里约一半别着发饰
    const bare = Array.from({ length: 700 }, (_, i) => portraitSpec(`orn-${i}`, NPC_ROLES[i % NPC_ROLES.length], { female: true, age: 0, region: ARCH_STYLES[i % ARCH_STYLES.length] })).filter((s) => s.hat === "none" && s.hair !== "bald").length;
    expect(young / bare).toBeGreaterThan(0.3);
    expect(young / bare).toBeLessThan(0.7);
    // 文化偏好：用不受身份限制的掌柜多抽一些
    const plain = ["townsfolk", "tavern", "market", "guild", "bank", "invest", "mate"] as const;
    for (let i = 0; i < 4200; i++) {
      const region = ARCH_STYLES[i % ARCH_STYLES.length];
      const f = portraitSpec(`taste-${i}`, plain[i % plain.length], { female: true, age: 0, region });
      if (f.ornament === "none") continue;
      const m = byRegion.get(region) ?? new Map<string, number>();
      m.set(f.ornament, (m.get(f.ornament) ?? 0) + 1);
      byRegion.set(region, m);
    }
    const share = (region: string, o: string) => {
      const m = byRegion.get(region);
      if (!m) return 0;
      const total = [...m.values()].reduce((a, b) => a + b, 0);
      return (m.get(o) ?? 0) / total;
    };
    expect(share("islands", "blossom")).toBeGreaterThan(share("lowland", "blossom"));
    expect(share("nordic", "circlet")).toBeGreaterThan(share("islands", "circlet"));
    expect(share("mediterranean", "pearls")).toBeGreaterThan(share("nordic", "pearls"));
  });

  it("头巾碎花修好了：浅色头巾上画出点缀色的小花，深色头巾上不画（没有白色铆钉点）", () => {
    const w = drawPortrait(face(true, { hat: "kerchief", hatColor: "white", accent: "crimson", hair: "bun" }));
    expect(countIn(w, [P.gold[3]], 14, 2, 46, 24)).toBeGreaterThanOrEqual(3);
    expect(countIn(w, [CLOTH.crimson[1]], 14, 2, 46, 24)).toBeGreaterThanOrEqual(6);
    // 深色、黄色的头巾不画花：换点缀色，头巾的像素一模一样；也没有白点
    const hatArea = (hatColor: "navy" | "crimson" | "gold" | "ochre" | "white", accent: "white" | "crimson" | "teal") =>
      regionPrint(drawPortrait(face(true, { hat: "kerchief", hatColor, accent, hair: "bun" })), 14, 2, 46, 15);
    for (const hatColor of ["navy", "crimson", "gold", "ochre"] as const) {
      expect(hatArea(hatColor, "teal")).toBe(hatArea(hatColor, "crimson"));
      expect(countIn(drawPortrait(face(true, { hat: "kerchief", hatColor, accent: "white", hair: "bun" })), [P.white], 14, 2, 46, 15)).toBe(0);
    }
    expect(hatArea("white", "teal")).not.toBe(hatArea("white", "crimson"));
  });

  it("合成最后收拾棋盘格：随机人群的人物内部没有 3×2 或 2×3 的两色交替", () => {
    for (let i = 0; i < 120; i++) {
      const s = portraitSpec(`dedither-${i}`, NPC_ROLES[i % NPC_ROLES.length], { region: CULTURE_OPTS[i % CULTURE_OPTS.length] });
      const px = drawPortrait(s);
      const bg = new Set(ROLE_BG[s.role].map((c) => rgba(c)));
      let n = 0;
      for (let y = 0; y < 62; y++) {
        for (let x = 0; x < 62; x++) {
          const a = px.get(x, y);
          const b = px.get(x + 1, y);
          if (a === b || px.get(x, y + 1) !== b || px.get(x + 1, y + 1) !== a) continue;
          const wide = px.get(x + 2, y) === a && px.get(x + 2, y + 1) === b;
          const tall = px.get(x, y + 2) === a && px.get(x + 1, y + 2) === b;
          if (!wide && !tall) continue;
          if (bg.has(a) || bg.has(b)) continue;
          n++;
        }
      }
      expect(n).toBe(0);
    }
  });

  it("胡须：主体用发色基色（花白的长者是灰白的胡子、红发的主角是红胡子），暗阶只作下沿暗缝；络腮胡与长须只给中年以上的男性；胡茬是沿下颌的一条带加上唇与下巴，色相取皮肤暗面、不比暗面更灰", () => {
    for (let i = 0; i < 600; i++) {
      const s = portraitSpec(`beard-${i}`, NPC_ROLES[i % NPC_ROLES.length], { female: false, region: CULTURE_OPTS[i % CULTURE_OPTS.length] });
      if (s.age === 0) expect(["full", "long"]).not.toContain(s.beard);
    }
    /** 胡子的像素：与不留胡子的同一张脸相比变了的格子。 */
    const beardPx = (s: PortraitSpec) => {
      const a = drawPortrait(s);
      const b = drawPortrait({ ...s, beard: "none" });
      const out: number[] = [];
      for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) out.push(a.data[i]);
      return out;
    };
    const top = (vs: number[]) => {
      const m = new Map<number, number>();
      for (const v of vs) m.set(v, (m.get(v) ?? 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
    };
    for (const beard of ["full", "long"] as const) {
      const vs = beardPx(face(false, { beard, age: 2, hairColor: "dark" }));
      expect(top(vs)).toBe(rgba(HAIR.dark[2]));
      expect(vs.filter((v) => v === rgba(HAIR.dark[2])).length).toBeGreaterThan(beard === "long" ? 80 : 50);
      // 暗阶只是一道暗缝，远少于基色
      expect(vs.filter((v) => v === rgba(HAIR.dark[1])).length * 2).toBeLessThan(vs.filter((v) => v === rgba(HAIR.dark[2])).length);
      // 灰发的长者：胡子的平均明度不低于灰发基色的 85%
      const gray = beardPx(face(false, { beard, age: 2, hairColor: "gray" }));
      const mean = gray.reduce((a, v) => a + luma(v), 0) / gray.length;
      expect(mean).toBeGreaterThanOrEqual(luma(rgba(HAIR.gray[2])) * 0.85);
    }
    // 花白夹杂：胡子换成灰的基色与亮阶，不是灰色的暗阶
    const griz = beardPx(face(false, { beard: "full", age: 2, hairColor: "brown", grizzle: 2 }));
    expect(top(griz)).toBe(rgba(HAIR.gray[2]));
    // 主角 7 号（光头眼罩、赤褐大胡子）：胡子出现最多的颜色是赤褐的基色
    expect(top(beardPx(captainSpec(6)))).toBe(rgba(HAIR.auburn[2]));
    // 胡茬：沿下颌的一条带、上唇与下巴；颧骨以下的脸颊露出基色，耳垂以上没有胡茬，嘴周不留肤色的孤岛
    const st = drawPortrait(face(false, { beard: "stubble", age: 1, hairColor: "dark" }));
    const tone = stubbleTone(1, "dark");
    expect(countAll(st, [tone])).toBeGreaterThan(40);
    expect(countIn(st, [tone], 16, 0, 63, 33)).toBe(0);
    expect(st.get(26, 36)).toBe(rgba(FACE_SKIN[1][3]));
    const my = mouthY("oval");
    const cy = chinY("oval", true);
    expect(countIn(st, [FACE_SKIN[1][3], FACE_SKIN[1][4]], HEAD.midX - 4, my - 1, HEAD.midX + 4, cy - 1)).toBe(0);
    // 胡茬色：色相取皮肤暗面、饱和度不低于暗面；浅肤色的明度介于暗面与基色之间、比基色低 15% 以上，深肤色比暗面再暗
    const hsl = (c: string) => {
      const v = rgba(c);
      const r = ((v >>> 24) & 0xff) / 255;
      const g = ((v >>> 16) & 0xff) / 255;
      const b = ((v >>> 8) & 0xff) / 255;
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const l = (mx + mn) / 2;
      return { s: mx === mn ? 0 : (mx - mn) / (l > 0.5 ? 2 - mx - mn : mx + mn), l };
    };
    for (const skin of [0, 1, 2, 3, 4]) {
      const [, , shade, base] = FACE_SKIN[skin];
      for (const hairColor of ["black", "dark", "brown", "auburn"] as const) {
        const c = stubbleTone(skin, hairColor);
        expect(hsl(c).s).toBeGreaterThanOrEqual(hsl(shade).s - 0.005);
        if (skin <= 2) {
          expect(luma(rgba(c))).toBeGreaterThanOrEqual(luma(rgba(shade)));
          expect(luma(rgba(c))).toBeLessThanOrEqual(luma(rgba(base)) * 0.85);
        } else expect(luma(rgba(c))).toBeLessThan(luma(rgba(shade)));
      }
      // 金发、白发：浅肤色直接用皮肤暗面
      if (skin <= 2) expect(stubbleTone(skin, "blond")).toBe(shade);
    }
  });
  it("头发远侧外缘里侧有一道侧逆光亮边（只在头发上）", () => {
    for (const hairColor of ["brown", "black", "blond"] as const) {
      const px = drawPortrait(face(true, { hair: "straight", bangs: "center", hairColor }));
      expect(countIn(px, [HAIR[hairColor][3]], 41, 16, 50, 34)).toBeGreaterThanOrEqual(4);
    }
  });
});

describe("头像美型第六批：美型与多样性评审的新意见（动画赛璐璐方向）", () => {
  const countAll = (px: Px, colors: readonly string[]) => countIn(px, colors, 0, 0, 63, 63);
  const face = (female: boolean, over: Partial<PortraitSpec> = {}) => plainFace(female, { ornament: "none", ...over });
  /** 与另一张图相比变了的像素 [x, y, 颜色]。 */
  const added = (a: Px, b: Px) => {
    const out: [number, number, number][] = [];
    for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) out.push([i % 64, Math.floor(i / 64), a.data[i]]);
    return out;
  };

  it("虹膜框在眼白里：最亮一阶只在倒数第二行留一两格反光，最底一行收窄成 3 格中间色，外眼角下方两格下睫毛；深一些的肤色上最底一行不比皮肤基色亮太多", () => {
    for (const style of EYE_STYLES) {
      for (const female of [false, true]) {
        const pair = eyeStamp(style, female);
        for (const rows of [pair.near, pair.far]) {
          const irisRows = rows.map((r, i) => (/[1-4]/.test(r) ? i : -1)).filter((i) => i >= 0);
          const last = irisRows[irisRows.length - 1];
          // 最亮一阶：整只眼最多 2 格，只在倒数第二行，不在最底一行
          const lights = rows.flatMap((r, i) => [...r].map((c) => (c === "4" ? i : -1)).filter((i) => i >= 0));
          expect(lights.length).toBeGreaterThanOrEqual(1);
          expect(lights.length).toBeLessThanOrEqual(2);
          for (const i of lights) expect(i).toBe(last - 1);
          // 最底一行 3 格、只用中间色
          expect(rows[last].replace(/[^1-4]/g, "")).toBe("333");
          // 下睫毛：最底一行两格 l
          expect(rows[last].replace(/[^l]/g, "")).toBe("ll");
          // 倒数第二行两侧都有眼白（虹膜框在眼白里，不直接贴着皮肤）
          const row = rows[last - 1];
          const a = row.search(/[1-4]/);
          const b = row.length - 1 - [...row].reverse().join("").search(/[1-4]/);
          expect(row[a - 1]).toBe("W");
          expect(row[b + 1]).toBe("W");
        }
      }
    }
    // 近侧眼：外眼角（左）下方的下睫毛用皮肤描边色
    const px = drawPortrait(face(true, { eyeColor: 2 }));
    expect(countIn(px, [FACE_SKIN[1][0]], 22, 30, 26, 31)).toBeGreaterThanOrEqual(2);
    // 古铜以下的肤色：琥珀眼的最底一行不比皮肤基色亮 10% 以上
    for (const skin of [2, 3, 4]) {
      for (const female of [false, true]) {
        const p2 = drawPortrait(face(female, { skin, eyeColor: 5, eyes: "almond" }));
        const rows = eyeStamp("almond", female).near;
        const irisRows = rows.map((r, i) => (/[1-4]/.test(r) ? i : -1)).filter((i) => i >= 0);
        const last = irisRows[irisRows.length - 1];
        const c0 = rows[last].indexOf("3");
        const cells = [0, 1, 2].map((k) => p2.get(22 + c0 + k, 24 + last));
        const irisSet = new Set(eyeIris(5).map((c) => rgba(c)));
        const limit = luma(rgba(FACE_SKIN[skin][3])) * 1.1;
        // 要么三格都不比基色亮 10% 以上，要么收窄到 2 格
        expect(cells.every((v) => luma(v) <= limit) || cells.filter((v) => irisSet.has(v)).length <= 2).toBe(true);
      }
    }
  });

  it("男性的眼睛：上睫毛线中段 1 像素、只在外眼角两格加粗，虹膜顶行有中间色（读成圆的），两侧都露出眼白，成年人睫毛上方一道暗面色的眼皮褶；半垂眼只给慵懒眼", () => {
    for (const style of EYE_STYLES) {
      const pair = eyeStamp(style, false);
      for (const [rows, near] of [
        [pair.near, true],
        [pair.far, false],
      ] as const) {
        const lashCols = [...new Set(rows.flatMap((r) => [...r].map((c, i) => (c === "K" ? i : -1)).filter((i) => i >= 0)))].sort((a, b) => a - b);
        // 外眼角两列以外，每一列最多 1 格睫毛
        const outer = near ? lashCols.slice(0, 2) : lashCols.slice(-2);
        for (const c of lashCols) if (!outer.includes(c)) expect(rows.filter((r) => r[c] === "K").length).toBeLessThanOrEqual(1);
        // 虹膜顶行：有中间色 3，最深一阶只在两角
        const top = rows.findIndex((r) => /[1-4]/.test(r));
        const topIris = rows[top].replace(/[^1-4]/g, "");
        if (style !== "sleepy") {
          expect(topIris.includes("3")).toBe(true);
          expect(topIris.replace(/^1|1$/g, "").includes("1")).toBe(false);
        }
        // 虹膜下一行两侧都有眼白
        const row = rows[top + 1];
        const a = row.search(/[1-4]/);
        const b = row.length - 1 - [...row].reverse().join("").search(/[1-4]/);
        expect("wW".includes(row[a - 1])).toBe(true);
        expect("wW".includes(row[b + 1])).toBe(true);
        // 眼皮褶（暗面色 C）在睫毛线上一行（单眼皮没有）
        const lashTop = rows.findIndex((r) => r.includes("K"));
        if (style !== "mono") expect(rows[lashTop - 1].includes("C")).toBe(true);
      }
    }
    // 只有慵懒眼的虹膜顶行全是深色（半垂的眼皮），其余眼型都不是
    const topDark = (style: (typeof EYE_STYLES)[number]) => {
      const rows = eyeStamp(style, false).near;
      return rows[rows.findIndex((r) => /[1-4]/.test(r))].replace(/[^1-4]/g, "") === "1111";
    };
    for (const style of EYE_STYLES) expect(topDark(style)).toBe(style === "sleepy");
    // 眼皮褶用皮肤暗面色：成年男性的近侧眼上方有暗面色的一段
    expect(countIn(drawPortrait(face(false, { eyes: "almond" })), [FACE_SKIN[1][2]], 24, 25, 30, 25)).toBeGreaterThanOrEqual(4);
    // 凤眼与圆眼的高光位置拉开：凤眼在瞳孔右侧，圆眼在左侧
    const glintX = (eyes: "round" | "sharp") => {
      const p = drawPortrait(face(false, { eyes, eyeColor: 2 }));
      let gx = -1;
      let px = -1;
      for (let y = 24; y <= 32; y++)
        for (let x = 22; x <= 32; x++) {
          if (p.get(x, y) === rgba(P.white) && gx < 0) gx = x;
          if (p.get(x, y) === rgba(EYE_PUPIL[2])) px = x;
        }
      return gx - px;
    };
    expect(glintX("sharp")).toBeGreaterThan(0);
    expect(glintX("round")).toBeLessThan(0);
  });

  it("女性的眉（压眉以外）：眉头不低于眉尾（同高或高一行）、眉头一段水平两格，台阶只往眉尾方向下降；男性的眉比女性低一行", () => {
    for (const style of BROW_STYLES) {
      if (style === "stern" || style === "bushy") continue;
      const b = browStamp(style, true);
      for (const [rows, near] of [
        [b.near, true],
        [b.far, false],
      ] as const) {
        const on = (x: number, y: number) => rows[y]?.[x] === "B" || rows[y]?.[x] === "T";
        // 每一格都有上下左右相邻的眉毛像素，整道眉八邻接连通（女性专用的画法也没有孤立的单像素）
        const pts: [number, number][] = [];
        rows.forEach((r, y) => [...r].forEach((_, x) => on(x, y) && pts.push([x, y])));
        for (const [x, y] of pts) expect(on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1)).toBe(true);
        const seen = new Set<string>([pts[0].join()]);
        const stack = [pts[0]];
        while (stack.length) {
          const [x, y] = stack.pop()!;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const k = `${x + dx},${y + dy}`;
              if (!seen.has(k) && on(x + dx, y + dy)) {
                seen.add(k);
                stack.push([x + dx, y + dy]);
              }
            }
        }
        expect(seen.size).toBe(pts.length);
        const cols: number[] = [];
        for (let x = 0; x < 11; x++) if (rows.some((_, y) => on(x, y))) cols.push(x);
        const inner = near ? cols[cols.length - 1] : cols[0];
        const tail = near ? cols[0] : cols[cols.length - 1];
        const topRow = (x: number) => rows.findIndex((_, y) => on(x, y));
        const lowRow = (x: number) => rows.length - 1 - [...rows].reverse().findIndex((_, y) => on(x, rows.length - 1 - y));
        // 眉头（最靠鼻梁的一列）的上沿不低于眉尾的下沿，最多高一行
        expect(topRow(inner)).toBeLessThanOrEqual(lowRow(tail));
        expect(lowRow(tail) - topRow(inner)).toBeLessThanOrEqual(1);
        // 眉头一段水平：最靠鼻梁的两列同一行
        const next = near ? inner - 1 : inner + 1;
        expect(topRow(next)).toBe(topRow(inner));
        // 从眉头往眉尾走，上沿先平或升到眉峰，过了眉峰只降不升
        const seq = (near ? [...cols].reverse() : cols).map(topRow);
        const peak = seq.indexOf(Math.min(...seq));
        for (let i = 1; i <= peak; i++) expect(seq[i]).toBeLessThanOrEqual(seq[i - 1]);
        for (let i = peak + 1; i < seq.length; i++) expect(seq[i]).toBeGreaterThanOrEqual(seq[i - 1]);
      }
    }
    // 男性的眉压低一行：同一种眉形，男性眉毛最上一行比女性低
    const topY = (female: boolean) => {
      const px = drawPortrait(face(female, { brows: "straight" }));
      for (let y = 16; y <= 26; y++) if (countIn(px, [...HAIR.brown], 21, y, 46, y) > 0) return y;
      return -1;
    };
    expect(topY(false)).toBe(topY(true) + 1);
    // 灰发、花白夹杂的男性：眉身用灰的基色、下沿暗阶，不是炭黑的铁灰
    for (const over of [{ hairColor: "gray" as const }, { hairColor: "brown" as const, grizzle: 2 as const, age: 2 as const }]) {
      const px = drawPortrait(face(false, { brows: "thick", ...over }));
      expect(countIn(px, [HAIR.gray[2]], 20, 19, 46, 25)).toBeGreaterThanOrEqual(6);
      expect(countIn(px, [HAIR.gray[0]], 20, 19, 46, 25)).toBe(0);
    }
  });

  it("嘴型两两不同：中老年男性的六种嘴、老年女性的六种嘴；主角的开怀笑是闭口微笑", () => {
    for (const [female, age] of [
      [false, 1],
      [false, 2],
      [true, 2],
    ] as const) {
      expect(new Set(MOUTH_STYLES.map((mouth) => fingerprint(drawPortrait(face(female, { mouth, age }))))).size).toBe(MOUTH_STYLES.length);
      expect(new Set(MOUTH_STYLES.map((mouth) => mouthStamp(face(female, { mouth, age })).join("/"))).size).toBe(MOUTH_STYLES.length);
    }
    // 主角（船长）女性的开怀笑 = 闭口微笑（下唇一格高光），不露出整条下唇
    const cap = { ...captainSpec(9), mouth: "grin" as const };
    expect(mouthStamp(cap)).toEqual(mouthStamp({ ...cap, mouth: "smile" }));
    // 带笑的中老年男性：外眼角多一格深影的笑纹（和蔼），平嘴的没有
    const deep = (mouth: "smile" | "line") => countAll(drawPortrait(face(false, { age: 1, mouth })), [FACE_SKIN[1][1]]);
    expect(deep("smile")).toBeGreaterThan(deep("line"));
  });

  it("八字胡：上沿平直、胡子下面留一行皮肤再是唇线；笑时胡尖上翘，只有抿嘴或严肃（压眉）的平嘴才下垂", () => {
    const my = mouthY("oval");
    const hair = HAIR.dark;
    const tips = (mouth: (typeof MOUTH_STYLES)[number], brows: "thick" | "stern" = "thick") => {
      const px = drawPortrait(face(false, { beard: "mustache", hairColor: "dark", mouth, brows, age: 1 }));
      // 胡尖（最外两列）所在的行
      const ys: number[] = [];
      for (let y = my - 5; y <= my + 1; y++) if (px.get(HEAD.midX - 5, y) === rgba(hair[0])) ys.push(y);
      return { y: ys[0], px };
    };
    const body = my - 2;
    expect(tips("smile").y).toBe(body - 1);
    expect(tips("grin").y).toBe(body - 1);
    expect(tips("line").y).toBe(body);
    expect(tips("smirk").y).toBe(body);
    expect(tips("frown").y).toBe(body + 1);
    expect(tips("line", "stern").y).toBe(body + 1);
    // 上沿平直：胡子最上一行横跨 8 格；胡子下面一行（唇线上一行）的中段是皮肤
    const px = tips("line").px;
    expect(countIn(px, [...hair], HEAD.midX - 4, my - 3, HEAD.midX + 3, my - 3)).toBe(8);
    expect(countIn(px, [...hair], HEAD.midX - 2, my - 1, HEAD.midX + 2, my - 1)).toBe(0);
  });

  it("络腮鬓与修整短须分得开：络腮鬓是贴着近侧下颌 3–4 像素宽的一条、内侧一列发色亮阶的受光边、到嘴角收成钩，下巴刮净；修整短须盖住下巴", () => {
    const cy = chinY("oval", true);
    const chops = drawPortrait(face(false, { beard: "chops", hairColor: "black", age: 1, skin: 3 }));
    const trim = drawPortrait(face(false, { beard: "trim", hairColor: "black", age: 1, skin: 3 }));
    const black = [...HAIR.black];
    // 宽度：y36 这一行从脸缘往里至少 3 格胡子
    expect(countIn(chops, black, 16, 36, 24, 36)).toBeGreaterThanOrEqual(3);
    // 内侧的受光边
    expect(countIn(chops, [HAIR.black[3]], 16, 28, 32, cy)).toBeGreaterThanOrEqual(6);
    // 下巴刮净 / 修整短须盖住下巴
    expect(countIn(chops, black, HEAD.midX - 2, cy - 3, HEAD.midX + 2, cy - 1)).toBe(0);
    expect(countIn(trim, black, HEAD.midX - 2, cy - 3, HEAD.midX + 2, cy - 1)).toBeGreaterThanOrEqual(8);
    // 钩：嘴角外侧（x MID-5）在唇线上下都有胡子
    const my = mouthY("oval");
    expect(countIn(chops, black, HEAD.midX - 5, my - 1, HEAD.midX - 5, my + 1)).toBe(3);
  });

  it("刀疤是一条连续、对齐的愈合斜线：眼睛处断开、两端在同一条直线上，浅色不带深色伴随线；有疤一侧不画腮红", () => {
    const pts = scarPoints();
    const above = pts.filter(([, y]) => y < HEAD.eyeY - 3);
    const below = pts.filter(([, y]) => y > HEAD.eyeY + 5);
    expect(above.length).toBeGreaterThanOrEqual(4);
    expect(below.length).toBeGreaterThanOrEqual(4);
    // 同一条直线：斜率一致（每 19 行左移 6 列），相邻两点最多隔一列
    for (const [x, y] of pts) expect(x).toBe(29 - Math.floor(((y - 18) * 6) / 19));
    for (let i = 1; i < pts.length; i++) if (pts[i][1] === pts[i - 1][1] + 1) expect(Math.abs(pts[i][0] - pts[i - 1][0])).toBeLessThanOrEqual(1);
    for (const skin of [0, 1, 2, 3, 4]) {
      for (const female of [false, true]) {
        const s = face(female, { skin, scar: true });
        const px = drawPortrait(s);
        const plain = drawPortrait({ ...s, scar: false });
        const scar = added(px, plain);
        // 不是鲜红的新伤：没有 red[3]，也没有比皮肤深影更暗的伴随线
        expect(scar.filter(([, , v]) => v === rgba(P.red[3])).length).toBe(0);
        for (const [, , v] of scar) if (!(FACE_ROUGE[skin] as readonly string[]).some((c) => rgba(c) === v)) expect(luma(v)).toBeGreaterThanOrEqual(luma(rgba(FACE_SKIN[skin][2])));
        // 近侧脸颊没有腮红
        expect(countIn(px, [...FACE_ROUGE[skin]], 18, 30, 30, 38)).toBe(0);
      }
    }
  });

  it("腮红：深肤色是与基色同明度的单行（近侧 4、远侧 2），不成块、不比基色暗；主角女性只留近侧 2 格", () => {
    for (const skin of [2, 3, 4]) {
      const px = drawPortrait(face(true, { skin }));
      const rouge = FACE_ROUGE[skin][0];
      const cells: [number, number][] = [];
      for (let y = 28; y <= 40; y++) for (let x = 16; x <= 46; x++) if (px.get(x, y) === rgba(rouge)) cells.push([x, y]);
      expect(cells.length).toBe(6);
      // 单行：没有上下相邻的两格
      for (const [x, y] of cells) expect(cells.some(([a, b]) => a === x && b === y + 1)).toBe(false);
      expect(Math.abs(luma(rgba(rouge)) - luma(rgba(FACE_SKIN[skin][3])))).toBeLessThanOrEqual(luma(rgba(FACE_SKIN[skin][3])) * 0.08);
    }
    for (const i of CAPTAIN_LOOK_IDS.filter((k) => k % 2 === 1)) {
      const s = captainSpec(i);
      expect(countAll(drawPortrait(s), [...FACE_ROUGE[s.skin]])).toBeLessThanOrEqual(2);
    }
    // 主角的眼睛不带少女的小闪光：近侧眼最多 2 格白色高光
    for (const i of CAPTAIN_LOOK_IDS) {
      const s = captainSpec(i);
      if (s.eyepatch) continue;
      expect(countIn(drawPortrait(s), [P.white], 22, 24, 32, 32)).toBeLessThanOrEqual(2);
    }
  });

  it("白皙肤色：赛璐璐暗面与基色的明度差 ≥12%，老人的纹路用深影", () => {
    const [, deep, shade, base] = FACE_SKIN[0];
    expect(luma(rgba(base)) - luma(rgba(shade))).toBeGreaterThanOrEqual(luma(rgba(base)) * 0.12);
    const old = drawPortrait(face(true, { skin: 0, age: 2 }));
    expect(countAll(old, [deep])).toBeGreaterThan(countAll(drawPortrait(face(true, { skin: 0 })), [deep]));
  });

  it("卷发是一个个 4×4 的小卷：头发里没有孤立的单格亮点、暗点（四邻里总有同色的格）", () => {
    for (const [female, hair] of [
      [true, "curls"],
      [false, "curly"],
      [true, "straight"],
      [false, "messy"],
    ] as const) {
      const s = face(female, { hair, bangs: HAIR_BANGS[hair][0], hairColor: "brown" });
      const px = drawPortrait(s);
      const hairSet = new Set(HAIR.brown.map((c) => rgba(c)));
      let lonely = 0;
      for (let y = 1; y < 63; y++) {
        for (let x = 1; x < 63; x++) {
          const v = px.get(x, y);
          if (!hairSet.has(v) || v === rgba(HAIR.brown[0])) continue;
          const ns = [px.get(x - 1, y), px.get(x + 1, y), px.get(x, y - 1), px.get(x, y + 1)];
          if (ns.every((n) => hairSet.has(n)) && !ns.includes(v)) lonely++;
        }
      }
      expect(lonely).toBe(0);
    }
  });

  it("光头老翁耳后的头发是顺着颅骨往上收尖的一簇：上端细、下缘有小锯齿，不是一块直角的补丁", () => {
    const s = face(false, { age: 2, hairColor: "gray", brows: "bushy" });
    const px = drawPortrait(s);
    const young = drawPortrait({ ...s, age: 0 });
    const gray = new Set(HAIR.gray.map((c) => rgba(c)));
    const rowsW = new Map<number, number>();
    for (let y = 10; y <= 40; y++) {
      let n = 0;
      for (let x = 6; x <= 20; x++) if (gray.has(px.get(x, y)) && !gray.has(young.get(x, y))) n++;
      if (n) rowsW.set(y, n);
    }
    const ys = [...rowsW.keys()].sort((a, b) => a - b);
    expect(ys.length).toBeGreaterThanOrEqual(10);
    // 上端细（最上一行不超过 3 格，含外轮廓），往下变宽
    expect(rowsW.get(ys[0])!).toBeLessThanOrEqual(3);
    expect(Math.max(...rowsW.values())).toBeGreaterThanOrEqual(rowsW.get(ys[0])! + 2);
    // 下缘的锯齿：最下一行分成至少两段
    const bottom = ys[ys.length - 1];
    let runs = 0;
    let prev = false;
    for (let x = 6; x <= 20; x++) {
      const on = gray.has(px.get(x, bottom));
      if (on && !prev) runs++;
      prev = on;
    }
    expect(runs).toBeGreaterThanOrEqual(2);
  });

  it("同一港口的九位掌柜不撞脸：发型、发色、头饰、肤色、脸型五项里任意两人至少三项不同；东方港的同款发簪最多一人戴", () => {
    const facilities = ["market", "shipyard", "tavern", "guild", "bank", "exchange", "warehouse", "invest", "office"] as const;
    for (let n = 0; n < 120; n++) {
      const region = ARCH_STYLES[n % ARCH_STYLES.length];
      const loc = n < ARCH_STYLES.length ? `port-${region}` : `loc-${n}`;
      const ks = facilities.map((f) => keeperSpec(loc, f, region).spec);
      for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) expect(lookalike(ks[i], ks[j])).toBeLessThan(3);
      expect(ks.filter((s) => s.hat === "hairpin").length).toBeLessThanOrEqual(1);
      // 重抽只动发色、脸型、发型（与刘海、白发、发饰）：性别、身份、服饰不变
      facilities.forEach((f, i) => {
        const raw = portraitSpec(`${loc}-${f}`, f, { region });
        expect([ks[i].female, ks[i].role, ks[i].outfit, ks[i].age]).toEqual([raw.female, raw.role, raw.outfit, raw.age]);
      });
    }
  });
});
