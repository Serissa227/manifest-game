// 人物预览（npx vite-node scripts/art-preview.ts people）：
// 各文化 × 各身份的头像总览、各文化 × 两性各 24 张的随机人群、24 个主角外貌（整图与放大的脸）、
// 设施掌柜、精灵血统、部件目录（发型 / 刘海 / 帽子 / 服饰 / 五官）、放大的五官目录、年龄对比与发饰，以及行人动画帧条。
import { ARCH_STYLES } from "./buildings";
import {
  CAPTAIN_LOOK_IDS,
  WALK_FRAMES,
  captainSpec,
  drawIdle,
  drawPortrait,
  drawWalker,
  keeperSpec,
  mateSpec,
  portraitSpec,
  type NpcRole,
} from "./portraits";
import {
  BANG_STYLES,
  BEARD_STYLES,
  BROW_STYLES,
  EYE_STYLES,
  FACE_SHAPES,
  FEMALE_HAIR,
  HAT_KINDS,
  MALE_HAIR,
  MOUTH_STYLES,
  NOSE_STYLES,
  NPC_ROLES,
  ORNAMENTS,
  OUTFIT_KINDS,
  type NpcRole as Role,
  type PortraitSpec,
} from "./people/spec";
import { FACILITIES } from "../store/game";
import { Px, sheet, type Preview, type PreviewContext } from "./px";

/** 部件目录用的标准人物：青年、白皙肤色、棕发、无饰物。 */
function base(female: boolean, over: Partial<PortraitSpec> = {}): PortraitSpec {
  return {
    ...portraitSpec("catalog", "townsfolk", { female, age: 0 }),
    skin: 1,
    face: female ? "heart" : "oval",
    eyes: female ? "round" : "almond",
    eyeColor: female ? 3 : 1,
    brows: female ? "thin" : "thick",
    nose: female ? "small" : "straight",
    mouth: female ? "lips" : "line",
    beard: "none",
    hair: female ? "straight" : "side",
    bangs: female ? "blunt" : "side",
    hairColor: "brown",
    grizzle: 0,
    hat: "none",
    hatColor: "crimson",
    outfit: "tunic",
    main: "blue",
    accent: "cream",
    glasses: false,
    earring: false,
    eyepatch: false,
    scar: false,
    pipe: false,
    necklace: "none",
    ornament: "none",
    cape: false,
    sword: false,
    elf: false,
    region: null,
    ...over,
  };
}

const DARK = "#20202a";
const HAT_LIST = HAT_KINDS.filter((h) => h !== "none");

/** 裁出脸部（放大看五官）。 */
function face(s: PortraitSpec): Px {
  return drawPortrait(s).crop(12, 4, 40, 48);
}

/** 只裁五官（眉、眼、鼻、嘴），给放大的五官目录用。 */
function features(s: PortraitSpec): Px {
  return drawPortrait(s).crop(16, 16, 34, 32);
}

export default function preview(ctx: PreviewContext): Preview[] {
  const out: Preview[] = [];

  // 放大细节：主角与几位典型人物的脸
  const detail = [captainSpec(0), captainSpec(1), captainSpec(4), captainSpec(9), portraitSpec("elder", "guild", { age: 2, female: true, region: "eastern" })].map(face);
  out.push({ name: "zoom-faces", px: sheet(detail, { cols: 5, gap: 2, bg: DARK }), scale: 8 });
  const hairZoom = [
    base(true, { hair: "straight", hairColor: "black" }),
    base(true, { hair: "wavy", hairColor: "auburn", skin: 0, eyeColor: 2 }),
    base(true, { hair: "bob", hairColor: "blond", skin: 0, eyeColor: 2 }),
    base(true, { hair: "ponytail", hairColor: "dark", skin: 2, eyeColor: 0 }),
    base(false, { hair: "side", hairColor: "black", skin: 0, eyeColor: 0 }),
    base(false, { hair: "long", hairColor: "blond", skin: 0, eyeColor: 4 }),
  ].map((s) => drawPortrait(s).crop(4, 0, 56, 64));
  out.push({ name: "zoom-hair", px: sheet(hairZoom, { cols: 6, gap: 2, bg: DARK }), scale: 6 });

  // 主角 24 个外貌（编号 0–11、13–24）：整图与放大的脸
  const caps = CAPTAIN_LOOK_IDS.map((i) => drawPortrait(captainSpec(i)));
  out.push({ name: "captains", px: sheet(caps, { cols: 6, gap: 3, bg: DARK }), scale: 4 });
  const capFaces = CAPTAIN_LOOK_IDS.map((i) => drawPortrait(captainSpec(i)).crop(8, 4, 48, 48));
  out.push({ name: "zoom-captains", px: sheet(capFaces, { cols: 6, gap: 2, bg: DARK }), scale: 5 });
  // 实际尺寸：上两行 1×（64 px，列表与小头像框），下两行 2×（128 px，卡片与对话框），不再放大，看游戏里真实的观感
  const real = [...caps.slice(0, 6), ...Array.from({ length: 6 }, (_, i) => drawPortrait(portraitSpec(`size-${i}`, NPC_ROLES[(i * 5) % NPC_ROLES.length])))];
  const one = sheet(real, { cols: 12, gap: 4, bg: DARK });
  const two = sheet(
    real.map((p) => p.scaled(2)),
    { cols: 6, gap: 4, bg: DARK },
  );
  const sizes = new Px(Math.max(one.w, two.w), one.h + two.h).fill(DARK);
  sizes.blit(one, 0, 0).blit(two, 0, one.h);
  out.push({ name: "sizes-1x-2x", px: sizes, scale: 1 });

  // 各文化 × 两性各 24 张随机人群（上两行女性、下两行男性），看同一文化里的脸是否足够不同
  const crowdRoles: readonly Role[] = ["townsfolk", "tavern", "market", "mate", "sailor", "guild"];
  for (const region of [...ARCH_STYLES, null]) {
    const crowd: Px[] = [];
    for (const female of [true, false]) {
      for (let i = 0; i < 24; i++) {
        const role = crowdRoles[i % crowdRoles.length];
        crowd.push(drawPortrait(portraitSpec(`crowd-${region ?? "mixed"}-${female ? "f" : "m"}-${i}`, role, { region: region ?? undefined, female })));
      }
    }
    out.push({ name: `crowd-${region ?? "mixed"}`, px: sheet(crowd, { cols: 12, gap: 2, bg: DARK }), scale: 3 });
  }

  // 放大的五官目录：脸型、眼型、眉形、鼻子、嘴（男女各一行）、刘海、胡须、年龄与白发
  const bald = { hair: "bald", hat: "none" } as const;
  const featureRows: Px[][] = [
    FACE_SHAPES.flatMap((f) => [face(base(true, { face: f, hair: "bun", bangs: "none" })), face(base(false, { face: f, hair: "crop", bangs: "none" }))]),
    EYE_STYLES.map((e) => features(base(true, { eyes: e, ...bald }))),
    EYE_STYLES.map((e) => features(base(false, { eyes: e, ...bald }))),
    BROW_STYLES.map((b) => features(base(true, { brows: b, ...bald }))),
    BROW_STYLES.map((b) => features(base(false, { brows: b, ...bald }))),
    NOSE_STYLES.flatMap((n) => [features(base(true, { nose: n, ...bald })), features(base(false, { nose: n, ...bald }))]),
    MOUTH_STYLES.map((m) => features(base(true, { mouth: m, ...bald }))),
    MOUTH_STYLES.map((m) => features(base(false, { mouth: m, ...bald }))),
  ];
  featureRows.forEach((row, i) => out.push({ name: `zoom-features-${i}`, px: sheet(row, { cols: row.length, gap: 2, bg: DARK }), scale: 6 }));
  // 刘海：同一张脸配七种刘海（长直发、发髻、男式短发 / 长发）
  const bangRows = [
    BANG_STYLES.map((b) => face(base(true, { bangs: b, hair: b === "curly" ? "curls" : "straight" }))),
    BANG_STYLES.map((b) => face(base(true, { bangs: b, hair: b === "curly" ? "curls" : "bun", hairColor: "black", skin: 3, eyeColor: 0 }))),
    BANG_STYLES.map((b) => face(base(false, { bangs: b, hair: b === "curly" ? "curly" : b === "blunt" || b === "swept" ? "messy" : "long", hairColor: "blond", skin: 0, eyeColor: 2 }))),
  ];
  out.push({ name: "zoom-bangs", px: sheet(bangRows.flat(), { cols: BANG_STYLES.length, gap: 2, bg: DARK }), scale: 5 });
  // 年龄：青年、中年（鬓角花白）、老年（花白夹杂 / 全白），男女各一行
  const ages = [
    face(base(true, { age: 0 })),
    face(base(true, { age: 1, grizzle: 1 })),
    face(base(true, { age: 2, grizzle: 2, hair: "bun", bangs: "side" })),
    face(base(true, { age: 2, hairColor: "white", hair: "updo", bangs: "none", eyes: "droopy", mouth: "smile" })),
    face(base(false, { age: 0, brows: "sword", face: "square" })),
    face(base(false, { age: 1, grizzle: 1, beard: "trim", face: "square" })),
    face(base(false, { age: 2, grizzle: 2, beard: "full", brows: "bushy", hair: "slick" })),
    face(base(false, { age: 2, hairColor: "gray", brows: "bushy", face: "long", ...bald })),
  ];
  out.push({ name: "zoom-ages", px: sheet(ages, { cols: 4, gap: 2, bg: DARK }), scale: 5 });
  out.push({
    name: "zoom-beards",
    px: sheet(
      BEARD_STYLES.map((b) => face(base(false, { beard: b, hairColor: "dark", age: 1 }))),
      { cols: BEARD_STYLES.length, gap: 2, bg: DARK },
    ),
    scale: 5,
  });

  // 发饰：七种（含不戴）各配一张长直发与一张发髻的脸，末尾是别着宝石发夹、细金头冠的两位主角
  const orn = [
    ...ORNAMENTS.map((ornament) => face(base(true, { ornament, hair: "straight", bangs: "side", accent: "teal" }))),
    ...ORNAMENTS.map((ornament) => face(base(true, { ornament, hair: "bun", bangs: "swept", accent: "crimson", hairColor: "black", skin: 3 }))),
    face(captainSpec(3)),
    face(captainSpec(5)),
  ];
  out.push({ name: "zoom-ornaments", px: sheet(orn, { cols: ORNAMENTS.length + 1, gap: 2, bg: DARK }), scale: 5 });

  // 文化 × 身份：每种文化一行，市民 / 水手 / 航海士 / 官员 / 酒馆 / 交易所 各一男一女
  const roleSet: NpcRole[] = ["townsfolk", "sailor", "mate", "office", "tavern", "market"];
  const all: Px[] = [];
  for (const region of [...ARCH_STYLES, null]) {
    const row: Px[] = [];
    for (const role of roleSet) {
      for (const female of [false, true]) {
        row.push(drawPortrait(portraitSpec(`${region ?? "mixed"}-${role}-${female ? "f" : "m"}`, role, { region: region ?? undefined, female })));
      }
    }
    all.push(...row);
    out.push({ name: `culture-${region ?? "mixed"}`, px: sheet(row, { cols: 12, gap: 2, bg: DARK }), scale: 3 });
  }
  out.push({ name: "cultures", px: sheet(all, { cols: 12, gap: 2, bg: DARK }), scale: 2 });
  // 各文化的女性（市民、酒馆、航海士）放大看
  const women: Px[] = [];
  for (const region of ARCH_STYLES) for (let i = 0; i < 2; i++) women.push(face(portraitSpec(`w-${region}-${i}`, i ? "tavern" : "townsfolk", { region, female: true, age: 0 })));
  out.push({ name: "zoom-women", px: sheet(women, { cols: 7, gap: 2, bg: DARK }), scale: 5 });
  const men: Px[] = [];
  for (const region of ARCH_STYLES) for (let i = 0; i < 2; i++) men.push(face(portraitSpec(`m-${region}-${i}`, i ? "mate" : "townsfolk", { region, female: false, age: i ? 1 : 0 })));
  out.push({ name: "zoom-men", px: sheet(men, { cols: 7, gap: 2, bg: DARK }), scale: 5 });

  // 每种身份 12 张（混合人群）
  const rows: Px[] = [];
  for (const role of NPC_ROLES) {
    for (let i = 0; i < 12; i++) rows.push(drawPortrait(portraitSpec(`${role}-${i}`, role)));
  }
  out.push({ name: "roles", px: sheet(rows, { cols: 12, gap: 2, bg: DARK }), scale: 2 });

  // 设施掌柜：每种文化一个港口的九个设施（下方附姓名，另见 names 预览）
  const keepers: Px[] = [];
  for (const region of ARCH_STYLES) for (const f of FACILITIES) keepers.push(drawPortrait(keeperSpec(`port-${region}`, f, region).spec));
  out.push({ name: "keepers", px: sheet(keepers, { cols: 9, gap: 2, bg: DARK }), scale: 2 });

  // 精灵血统：挑出带尖耳的人物
  const elves: Px[] = [];
  for (let i = 0; elves.length < 12 && i < 600; i++) {
    const s = portraitSpec(`elf-${i}`, NPC_ROLES[i % NPC_ROLES.length], { region: ARCH_STYLES[i % ARCH_STYLES.length] });
    if (s.elf) elves.push(drawPortrait(s));
  }
  out.push({ name: "elves", px: sheet(elves, { cols: 6, gap: 2, bg: DARK }), scale: 3 });

  // 老年人
  const elders: Px[] = [];
  for (let i = 0; i < 12; i++) elders.push(drawPortrait(portraitSpec(`old-${i}`, NPC_ROLES[i % NPC_ROLES.length], { age: 2, female: i % 2 === 1, region: ARCH_STYLES[i % ARCH_STYLES.length] })));
  out.push({ name: "elders", px: sheet(elders, { cols: 6, gap: 2, bg: DARK }), scale: 3 });

  // 数据文件里的航海士（小传里的外貌线索会体现在头像上）
  const toml = ctx.readText("data/mates.toml");
  const mates = [...toml.matchAll(/name = "([^"]+)"\s*\r?\nbio = "([^"]*)"/g)].map((m) => drawPortrait(mateSpec({ name: m[1], bio: m[2] })));
  if (mates.length) out.push({ name: "mates", px: sheet(mates, { cols: 8, gap: 2, bg: DARK }), scale: 2 });

  // 部件目录
  out.push({
    name: "cat-hair",
    px: sheet([...MALE_HAIR.map((hair) => drawPortrait(base(false, { hair }))), ...FEMALE_HAIR.map((hair) => drawPortrait(base(true, { hair })))], {
      cols: 11,
      gap: 2,
      bg: DARK,
    }),
    scale: 3,
  });
  out.push({
    name: "cat-hats",
    px: sheet(
      HAT_LIST.flatMap((hat) => [drawPortrait(base(false, { hat, hatColor: "crimson" })), drawPortrait(base(true, { hat, hatColor: "teal", hair: "bun" }))]),
      { cols: 12, gap: 2, bg: DARK },
    ),
    scale: 3,
  });
  out.push({
    name: "cat-outfits",
    px: sheet(
      OUTFIT_KINDS.flatMap((outfit) => [drawPortrait(base(false, { outfit, main: "navy", accent: "red" })), drawPortrait(base(true, { outfit, main: "green", accent: "gold" }))]),
      { cols: 10, gap: 2, bg: DARK },
    ),
    scale: 3,
  });
  const parts: Px[] = [];
  for (const f of FACE_SHAPES) parts.push(face(base(false, { face: f, hair: "bald" })));
  for (const e of EYE_STYLES) parts.push(face(base(false, { eyes: e })));
  for (const e of EYE_STYLES) parts.push(face(base(true, { eyes: e, hair: "bun" })));
  for (const m of MOUTH_STYLES) parts.push(face(base(true, { mouth: m, hair: "bun" })));
  for (const m of MOUTH_STYLES) parts.push(face(base(false, { mouth: m })));
  for (const b of BEARD_STYLES) parts.push(face(base(false, { beard: b, hairColor: "dark", age: 1 })));
  for (const skin of [0, 1, 2, 3, 4]) parts.push(face(base(skin % 2 === 1, { skin, hair: skin % 2 ? "bun" : "crop" })));
  for (const age of [0, 1, 2] as const) parts.push(face(base(false, { age, hairColor: age === 2 ? "white" : "brown" })));
  parts.push(face(base(false, { glasses: true })), face(base(false, { eyepatch: true, scar: true })), face(base(false, { pipe: true, earring: true })));
  parts.push(face(base(true, { elf: true, hairColor: "silver", eyeColor: 6 })), face(base(false, { elf: true, hairColor: "blond", eyeColor: 7 })));
  out.push({ name: "cat-face", px: sheet(parts, { cols: 12, gap: 2, bg: DARK }), scale: 4 });

  // 行人：每种身份一行，站立帧 + 4 帧行走
  const walkers: Px[] = [];
  const kinds: NpcRole[] = ["sailor", "townsfolk", "market", "office", "pirate", "captain", "tavern", "warehouse", "guild", "shipyard"];
  for (const role of kinds) {
    for (const female of [false, true]) {
      const spec = portraitSpec(`walk-${role}-${female}`, role, { female });
      walkers.push(drawIdle(spec));
      for (let f = 0; f < WALK_FRAMES; f++) walkers.push(drawWalker(spec, f));
    }
  }
  out.push({ name: "walkers", px: sheet(walkers, { cols: (WALK_FRAMES + 1) * 2, gap: 3, bg: "#8a8699" }), scale: 5 });
  // 行人：各文化的市民与主角
  const wr: Px[] = [];
  for (const region of ARCH_STYLES) {
    for (const [role, female] of [
      ["townsfolk", false],
      ["townsfolk", true],
      ["sailor", false],
      ["office", false],
      ["market", true],
    ] as const) {
      const spec = portraitSpec(`walkr-${region}-${role}-${female}`, role, { female, region });
      wr.push(drawWalker(spec, 0), drawWalker(spec, 1));
    }
  }
  for (const i of CAPTAIN_LOOK_IDS) wr.push(drawWalker(captainSpec(i), 0));
  out.push({ name: "walkers-regions", px: sheet(wr, { cols: 10, gap: 3, bg: "#8a8699" }), scale: 5 });
  return out;
}
