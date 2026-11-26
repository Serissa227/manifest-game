// 地标与奇观（EXPANSION.md §10.3 landmarks.toml）的像素图标，以及它们在海图上的画法。
// 四类各有风格：自然奇观（大地色、棕色描边）、魔法奇观（紫青辉光、紫色描边与闪光）、
// 古代遗迹（风化的石与青铜、石色描边）、人文地标（鲜明的屋顶与旗帜、深色描边）。
// kind 按关键词归到已知的图样（例如 "crater_lagoon"、"starfall_crater" 都是陨石坑），认不出的按类别画通用图样。
// 线状的古迹（古道、长城、引水渠）沿占地的长边画成一条线；大面积的奇观（陨石坑、水晶林、浮空岛群……）按占地铺开。
import { P, ink } from "../palette";
import { Px } from "../px";
import { memo } from "../render";
import { hash2 } from "./noise";
import type { LandmarkCategory } from "./types";

/** 图标画布边长（描边前）。 */
const S = 13;

interface IconDef {
  category: LandmarkCategory;
  /** kind 中出现这些关键词之一就归到本图样（按表的顺序先到先得） */
  words: readonly string[];
  draw: (p: Px) => void;
}

const sea = P.sea;
const st = P.stone;

/** 已知的地标图样（键为规范的 kind）。顺序即匹配优先级：更具体的词在前。 */
const ICONS: Readonly<Record<string, IconDef>> = {
  // ───── 自然奇观 ─────
  crater: {
    category: "natural",
    words: ["crater"],
    draw: (p) => {
      p.ellipse(6, 7, 6, 5, st[2]);
      p.ellipse(6, 7, 4, 3, sea[3]);
      p.ellipse(7, 8, 3, 2, sea[2]);
      p.set(4, 5, P.foam).set(5, 5, sea[4]);
      for (const [x, y] of [
        [2, 4],
        [3, 3],
        [4, 2],
        [1, 6],
      ])
        p.set(x, y, st[4]);
      for (const [x, y] of [
        [10, 9],
        [9, 10],
        [11, 8],
      ])
        p.set(x, y, st[3]);
    },
  },
  basalt: {
    category: "natural",
    words: ["basalt", "column", "pillar", "organ"],
    draw: (p) => {
      const hs = [7, 10, 8, 11, 9, 6];
      hs.forEach((h, k) => {
        const x = 1 + k * 2;
        p.rect(x, 12 - h, 2, h, st[1]);
        p.vline(x + 1, 12 - h, 11, st[0]);
        p.hline(x, x + 1, 12 - h, st[3]);
      });
      p.hline(0, 12, 11, sea[3]).hline(0, 12, 12, sea[2]);
      p.set(2, 11, P.foam).set(7, 11, P.foam).set(11, 11, P.foam);
    },
  },
  maelstrom: {
    category: "natural",
    words: ["maelstrom", "whirlpool", "vortex", "eddy"],
    draw: (p) => {
      p.ellipse(6, 6, 6, 5, sea[2]);
      p.ellipse(6, 6, 4, 3, sea[1]);
      p.ellipse(6, 6, 1, 1, sea[0]);
      for (let t = 0; t < 12; t += 0.25) {
        const r = 0.8 + t * 0.48;
        p.set(Math.round(6 + Math.cos(t) * r), Math.round(6 + Math.sin(t) * r * 0.85), t > 8 ? P.foam : sea[4]);
      }
    },
  },
  bone_reef: {
    category: "natural",
    words: ["bone", "skeleton", "rib", "carcass"],
    draw: (p) => {
      p.rect(0, 9, 13, 4, sea[3]);
      p.hline(0, 12, 9, sea[4]);
      const bone = P.plaster[3];
      const shade = P.plaster[1];
      for (let k = 0; k < 4; k++) {
        const x = 4 + k * 2;
        p.vline(x, 4 + k, 9, bone).set(x + 1, 4 + k, bone).set(x + 1, 5 + k, shade);
      }
      p.hline(3, 11, 9, shade);
      // 头骨
      p.rect(0, 6, 3, 3, bone).set(1, 7, ink.deep).set(0, 9, shade).set(2, 9, shade);
      p.set(3, 11, P.foam).set(9, 11, P.foam);
    },
  },
  waterfall: {
    category: "natural",
    words: ["falls", "waterfall", "cascade", "table"],
    draw: (p) => {
      p.rect(1, 3, 11, 7, P.wood[2]);
      p.rect(1, 3, 3, 7, P.wood[3]);
      p.rect(9, 3, 3, 7, P.wood[1]);
      p.hline(1, 11, 2, P.leaf[3]).hline(2, 10, 1, P.leaf[4]);
      p.rect(5, 2, 3, 9, P.foam);
      p.vline(7, 3, 10, sea[4]);
      p.ellipse(6, 11, 5, 1, sea[3]);
      p.set(4, 11, P.foam).set(8, 11, P.foam).set(6, 12, P.foam);
    },
  },
  atoll: {
    category: "natural",
    words: ["atoll", "glow", "lagoon", "reef"],
    draw: (p) => {
      p.ellipse(6, 6, 6, 5, sea[2]);
      p.ellipse(6, 6, 5, 4, P.teal[2]);
      p.ellipse(6, 6, 3, 2, sea[4]);
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        p.set(Math.round(6 + Math.cos(a) * 5), Math.round(6 + Math.sin(a) * 4), k % 3 === 0 ? P.white : P.teal[4]);
      }
      p.set(9, 3, P.sand[4]).set(10, 4, P.sand[4]).set(3, 9, P.sand[4]);
    },
  },
  volcano: {
    category: "natural",
    words: ["volcan", "caldera", "lava", "fire_mountain"],
    draw: (p) => {
      p.poly(
        [
          [4.5, 4],
          [8.5, 4],
          [13, 13],
          [0, 13],
        ],
        st[1],
      );
      p.poly(
        [
          [4.5, 4],
          [6.5, 4],
          [5, 13],
          [0, 13],
        ],
        st[2],
      );
      p.hline(5, 8, 4, P.red[2]).set(6, 5, P.lamp[1]).vline(7, 5, 8, P.red[2]).set(8, 9, P.red[1]);
      p.ellipse(7, 2, 2, 1, st[3]).set(9, 1, st[4]).set(5, 1, st[3]).set(10, 0, st[4]);
    },
  },
  arch: {
    category: "natural",
    words: ["arch", "gate_rock", "natural_bridge"],
    draw: (p) => {
      p.rect(1, 3, 11, 8, st[3]);
      p.rect(4, 6, 5, 5, sea[3]);
      p.hline(4, 8, 5, st[2]).set(4, 6, st[2]).set(8, 6, st[2]);
      p.vline(11, 3, 10, st[2]).vline(1, 3, 10, st[4]);
      p.hline(1, 11, 2, P.leaf[3]);
      p.hline(0, 12, 11, sea[3]).hline(0, 12, 12, sea[2]);
      p.set(5, 11, P.foam);
    },
  },
  glass_dunes: {
    category: "natural",
    words: ["glass", "dune"],
    draw: (p) => {
      // 被天火烧成玻璃的沙丘：两道沙脊，迎光面结着一层青白的玻璃壳，闪着光
      p.poly(
        [
          [0, 13],
          [4.5, 5],
          [10, 13],
        ],
        P.sand[3],
      );
      p.poly(
        [
          [4.5, 5],
          [10, 13],
          [7, 13],
        ],
        P.sand[2],
      );
      p.poly(
        [
          [5, 13],
          [9.5, 7],
          [13, 13],
        ],
        P.sand[4],
      );
      p.poly(
        [
          [9.5, 7],
          [13, 13],
          [11, 13],
        ],
        P.sand[2],
      );
      p.line(1, 11, 4, 6, P.teal[3]).line(6, 11, 9, 8, P.teal[3]);
      p.set(4, 6, P.white).set(2, 9, P.teal[4]).set(9, 8, P.white).set(7, 10, P.teal[4]);
      p.set(11, 2, P.white).set(10, 3, P.teal[4]).set(12, 3, P.teal[4]).set(11, 4, P.teal[4]);
    },
  },
  oasis: {
    category: "natural",
    words: ["oasis", "wadi", "spring", "palm"],
    draw: (p) => {
      // 沙地里的一汪泉水，两棵椰枣树
      p.ellipse(6, 11, 6, 2, P.sand[3]);
      p.ellipse(6, 11, 4, 1, sea[3]);
      p.hline(4, 7, 11, sea[4]).set(3, 12, P.leaf[3]).set(9, 12, P.leaf[3]);
      p.line(3, 11, 4, 5, P.wood[2]).line(9, 11, 8, 3, P.wood[2]);
      p.set(4, 8, P.wood[3]).set(8, 7, P.wood[3]);
      const frond = (x: number, y: number) => {
        p.hline(x - 3, x + 3, y, P.leaf[3]).set(x - 3, y + 1, P.leaf[2]).set(x + 3, y + 1, P.leaf[2]);
        p.hline(x - 1, x + 1, y - 1, P.leaf[4]).set(x - 2, y - 1, P.leaf[3]).set(x + 2, y - 1, P.leaf[3]);
        p.set(x, y + 1, P.wood[1]);
      };
      frond(4, 5);
      frond(8, 3);
      p.set(8, 4, P.red[1]).set(4, 6, P.red[1]);
    },
  },
  // ───── 魔法奇观 ─────
  world_tree: {
    category: "arcane",
    words: ["world_tree", "tree", "yggdra", "elder"],
    draw: (p) => {
      p.rect(5, 6, 3, 6, P.wood[2]);
      p.vline(7, 6, 11, P.wood[1]);
      p.hline(2, 10, 12, P.wood[1]).set(3, 11, P.wood[2]).set(9, 11, P.wood[2]);
      p.ellipse(6, 4, 6, 4, P.jade[2]);
      p.ellipse(5, 3, 4, 2, P.jade[3]);
      p.ellipse(4, 2, 2, 1, P.leaf[4]);
      for (const [x, y] of [
        [2, 5],
        [9, 2],
        [10, 5],
        [6, 1],
      ])
        p.set(x, y, P.gold[4]);
    },
  },
  floating_isles: {
    category: "arcane",
    words: ["float", "sky", "levitat", "hover", "cloud"],
    draw: (p) => {
      const isle = (x: number, y: number, w: number) => {
        p.hline(x, x + w - 1, y, P.leaf[3]);
        p.hline(x, x + w - 1, y + 1, P.wood[2]);
        p.hline(x + 1, x + w - 2, y + 2, P.wood[1]);
        p.set(x + Math.floor(w / 2), y + 3, st[1]);
      };
      isle(0, 2, 6);
      isle(6, 6, 7);
      isle(2, 10, 4);
      p.set(1, 1, P.leaf[4]).set(8, 5, P.leaf[4]).vline(10, 9, 11, sea[4]);
      p.set(5, 0, P.teal[4]).set(12, 3, P.teal[4]).set(0, 8, P.teal[4]);
    },
  },
  crystal: {
    category: "arcane",
    words: ["crystal", "spire", "shard", "prism"],
    draw: (p) => {
      const spire = (x: number, h: number, c: string, lite: string) => {
        p.poly(
          [
            [x + 1.5, 12 - h],
            [x + 3, 14 - h],
            [x + 3, 13],
            [x, 13],
            [x, 14 - h],
          ],
          c,
        );
        p.vline(x, 14 - h, 12, lite);
      };
      spire(0, 7, P.cloth.purple[1], P.cloth.purple[2]);
      spire(8, 8, P.cloth.purple[1], P.cloth.purple[2]);
      spire(4, 12, P.teal[2], P.teal[4]);
      p.set(5, 2, P.white).set(1, 3, P.teal[4]).set(11, 2, P.teal[4]).set(12, 7, P.white);
    },
  },
  rune_circle: {
    category: "arcane",
    words: ["rune", "ley", "circle", "menhir", "henge", "altar"],
    draw: (p) => {
      p.ellipse(6, 8, 6, 3, P.cloth.purple[0]);
      p.ellipse(6, 8, 4, 2, P.cloth.purple[1]);
      p.set(6, 8, P.teal[4]).set(5, 8, P.teal[3]).set(7, 8, P.teal[3]).set(6, 7, P.teal[4]);
      for (const [x, y] of [
        [1, 7],
        [11, 7],
        [3, 5],
        [9, 5],
        [6, 4],
        [2, 10],
        [10, 10],
      ]) {
        p.vline(x, y - 3, y, st[3]).set(x + 1, y - 2, st[2]).set(x + 1, y - 1, st[2]);
      }
      p.set(6, 1, P.teal[4]).set(6, 0, P.white);
    },
  },
  storm_eye: {
    category: "arcane",
    words: ["storm", "tempest", "hurricane", "cyclone"],
    draw: (p) => {
      // 永不散去的风暴环：旋转的乌云墙围着一小片平静发亮的海面，云墙里有闪电
      p.ellipse(6, 6, 6, 5, P.slate[1]);
      p.ellipse(6, 6, 4, 3, P.slate[2]);
      for (let t = 0; t < 10; t += 0.3) {
        const r = 2 + t * 0.42;
        p.set(Math.round(6 + Math.cos(t + 1) * r), Math.round(6 + Math.sin(t + 1) * r * 0.85), P.slate[3]);
      }
      p.ellipse(6, 6, 2, 1, sea[4]);
      p.set(6, 6, P.white).set(5, 6, P.teal[4]);
      p.set(11, 2, P.lamp[2]).set(10, 3, P.lamp[1]).set(11, 4, P.lamp[1]).set(10, 5, P.lamp[2]);
      p.set(1, 9, P.lamp[1]).set(2, 10, P.lamp[2]);
    },
  },
  // ───── 古代遗迹 ─────
  colossus: {
    category: "ancient",
    words: ["colossus", "giant", "statue", "titan", "idol"],
    draw: (p) => {
      // 阿尔坎巨像：戴盔的石巨人双手拄着一柄长剑立在方座上，风化的石身、金色的盔缨
      p.rect(2, 11, 9, 2, st[2]).hline(2, 10, 11, st[3]);
      p.rect(4, 5, 5, 4, st[3]).vline(8, 5, 8, st[2]).vline(4, 5, 8, st[4]);
      p.rect(4, 9, 2, 2, st[3]).rect(7, 9, 2, 2, st[2]);
      p.rect(5, 2, 3, 3, st[3]).set(7, 3, st[2]).set(5, 3, st[4]).hline(5, 7, 4, st[2]);
      p.hline(4, 8, 2, st[4]).set(6, 1, P.gold[3]).set(6, 0, P.gold[4]);
      p.vline(6, 6, 12, P.iron[3]).hline(5, 7, 6, P.gold[2]);
      p.set(3, 6, st[3]).set(9, 6, st[2]).set(3, 7, st[2]).set(9, 7, st[1]);
      p.set(8, 10, P.leaf[3]).set(3, 12, P.leaf[2]);
    },
  },
  chain: {
    category: "ancient",
    words: ["chain", "fetter", "shackle"],
    draw: (p) => {
      p.rect(0, 10, 13, 3, sea[3]);
      p.hline(0, 12, 10, sea[4]);
      const link = (x: number, y: number, v: boolean) => (v ? p.ring(x, y, 1, 2, P.iron[2]) : p.ring(x, y, 2, 1, P.iron[3]));
      link(2, 3, false);
      link(4, 5, true);
      link(6, 7, false);
      link(8, 9, true);
      p.set(1, 2, P.iron[3]).set(9, 11, P.foam).set(11, 11, P.foam);
      p.rect(10, 1, 3, 3, st[2]).hline(10, 12, 1, st[3]);
    },
  },
  great_wall: {
    category: "ancient",
    words: ["wall", "rampart", "bulwark"],
    draw: (p) => {
      for (let x = 0; x < 13; x++) {
        const y = 8 - Math.floor(x / 3);
        p.vline(x, y, y + 3, st[2]).set(x, y + 3, st[1]);
        p.set(x, y, st[3]);
        if (x % 2 === 0) p.set(x, y - 1, st[3]);
      }
      p.rect(4, 3, 4, 6, st[3]).vline(7, 3, 8, st[2]).hline(4, 7, 2, st[4]).set(4, 1, st[4]).set(7, 1, st[4]);
      p.set(5, 5, ink.deep);
    },
  },
  ancient_road: {
    category: "ancient",
    words: ["road", "way", "causeway", "path"],
    draw: (p) => {
      p.poly(
        [
          [5, 1],
          [8, 1],
          [13, 13],
          [0, 13],
        ],
        st[2],
      );
      for (let y = 2; y < 13; y += 2) p.hline(Math.round(5 - y * 0.4), Math.round(8 + y * 0.4), y, st[3]);
      p.vline(1, 3, 8, st[3]).vline(2, 3, 8, st[2]).set(1, 2, st[4]).set(2, 2, st[3]);
      p.set(1, 5, P.gold[3]);
    },
  },
  aqueduct: {
    category: "ancient",
    words: ["aqueduct", "viaduct", "canal"],
    draw: (p) => {
      p.hline(0, 12, 2, sea[4]);
      p.rect(0, 3, 13, 2, st[3]);
      p.hline(0, 12, 5, st[2]);
      for (let k = 0; k < 4; k++) {
        const x = k * 4;
        p.rect(x, 5, 1, 8, st[3]).set(x, 12, st[2]);
        if (k < 3) p.set(x + 1, 6, st[2]).set(x + 3, 6, st[2]);
      }
    },
  },
  sunken_city: {
    category: "ancient",
    words: ["sunken", "drowned", "submerged", "atlant"],
    draw: (p) => {
      p.ellipse(4, 7, 3, 3, st[3]);
      p.ellipse(3, 6, 1, 1, st[4]);
      p.rect(8, 2, 2, 8, st[3]).set(8, 1, st[4]).vline(9, 2, 9, st[2]);
      p.rect(11, 5, 2, 5, st[2]).set(11, 4, st[3]);
      p.rect(0, 9, 13, 4, sea[3]);
      p.hline(0, 12, 9, sea[4]);
      p.set(2, 10, P.foam).set(7, 10, P.foam).set(11, 11, P.foam);
    },
  },
  ruins: {
    category: "ancient",
    words: ["ruin", "temple", "remains", "fallen"],
    draw: (p) => {
      p.hline(0, 12, 12, st[1]).hline(1, 11, 11, st[2]);
      p.rect(1, 4, 2, 7, st[3]).vline(2, 4, 10, st[2]);
      p.rect(5, 2, 2, 9, st[3]).vline(6, 2, 10, st[2]);
      p.rect(9, 6, 2, 5, st[3]).vline(10, 6, 10, st[2]);
      p.hline(0, 7, 2, st[4]).hline(0, 7, 3, st[3]);
      p.set(11, 10, st[3]).set(12, 11, st[2]).set(8, 10, st[2]);
      p.set(3, 9, P.leaf[3]).set(7, 10, P.leaf[3]);
    },
  },
  obelisk: {
    category: "ancient",
    words: ["obelisk", "milestone", "stele", "monolith", "pillar_stone", "monument", "memorial"],
    draw: (p) => {
      p.rect(4, 11, 5, 2, st[2]).hline(4, 8, 11, st[3]);
      p.poly(
        [
          [6.5, 0],
          [8, 2],
          [8, 11],
          [5, 11],
          [5, 2],
        ],
        st[3],
      );
      p.vline(7, 2, 10, st[2]).set(6, 1, P.gold[4]).set(6, 0, P.gold[3]);
      p.set(6, 4, st[1]).set(6, 6, st[1]).set(6, 8, st[1]);
      p.set(4, 12, P.leaf[2]).set(8, 12, P.leaf[3]).set(5, 10, P.leaf[2]);
    },
  },
  lighthouse_ruin: {
    category: "ancient",
    words: ["lighthouse_ruin", "ruined_lighthouse", "pharos_ruin", "old_lighthouse"],
    draw: (p) => {
      // 阿尔坎灯塔的残基：收分的石塔只剩半截，断口参差，塔下是礁岩与崩落的石块
      p.rect(0, 11, 13, 2, sea[3]).hline(0, 12, 11, sea[4]);
      p.rect(2, 9, 9, 3, st[2]).hline(2, 10, 9, st[3]);
      p.poly(
        [
          [4, 3],
          [8, 3],
          [9, 10],
          [3, 10],
        ],
        st[3],
      );
      p.vline(8, 4, 9, st[2]).vline(4, 4, 9, st[4]);
      p.set(4, 2, st[3]).set(7, 2, st[3]).set(7, 1, st[4]).set(8, 2, st[2]);
      p.hline(4, 8, 6, st[2]).set(6, 8, ink.deep).set(6, 9, ink.deep);
      p.set(10, 8, st[3]).set(11, 9, st[2]).set(1, 10, st[3]).set(12, 10, st[2]);
      p.set(4, 7, P.leaf[3]).set(8, 9, P.leaf[3]).set(2, 12, P.foam).set(10, 12, P.foam);
      // 塔顶残留的一片铜镜框（铜绿）
      p.set(5, 2, P.teal[2]).set(5, 1, P.teal[3]);
    },
  },
  bell_tower: {
    category: "ancient",
    words: ["bell_tower", "belfry", "bell"],
    draw: (p) => {
      // 沉钟塔：被海水淹到腰部的钟楼，钟室里一口铜钟，塔尖歪斜
      p.rect(4, 3, 5, 7, st[3]).vline(8, 3, 9, st[2]).vline(4, 3, 9, st[4]);
      p.poly(
        [
          [6.5, 0],
          [9, 3],
          [4, 3],
        ],
        P.teal[1],
      );
      p.set(6, 0, P.gold[3]).set(5, 2, P.teal[2]).set(6, 1, P.teal[2]);
      p.rect(5, 4, 3, 3, ink.deep);
      p.hline(5, 7, 6, P.gold[2]).set(6, 5, P.gold[3]).set(6, 4, P.gold[2]);
      p.rect(0, 9, 13, 4, sea[3]);
      p.hline(0, 12, 9, sea[4]);
      p.set(3, 10, P.foam).set(9, 10, P.foam).set(1, 11, P.foam).set(11, 12, P.foam);
      p.set(5, 8, P.leaf[2]).set(8, 7, P.leaf[3]);
    },
  },
  // ───── 人文地标 ─────
  castle: {
    category: "civic",
    words: ["castle", "fortress", "citadel", "palace", "keep"],
    draw: (p) => {
      p.rect(2, 6, 9, 6, st[3]);
      p.rect(2, 6, 9, 1, st[4]);
      for (let x = 2; x <= 10; x += 2) p.set(x, 5, st[3]);
      p.rect(0, 4, 3, 8, st[3]).rect(10, 4, 3, 8, st[2]);
      p.poly(
        [
          [1.5, 1],
          [3, 4],
          [0, 4],
        ],
        P.red[2],
      );
      p.poly(
        [
          [11.5, 1],
          [13, 4],
          [10, 4],
        ],
        P.red[1],
      );
      p.rect(5, 2, 3, 4, st[3]).set(6, 1, st[3]).vline(6, 0, 1, P.wood[1]).set(7, 0, P.gold[3]);
      p.rect(5, 9, 3, 3, ink.deep).set(6, 8, ink.deep);
      p.set(1, 7, ink.deep).set(11, 7, ink.deep);
    },
  },
  lighthouse: {
    category: "civic",
    words: ["lighthouse", "beacon", "pharos"],
    draw: (p) => {
      p.rect(0, 11, 13, 2, st[2]).hline(0, 12, 11, st[3]);
      p.poly(
        [
          [5, 3],
          [8, 3],
          [9, 11],
          [4, 11],
        ],
        P.white,
      );
      p.hline(4, 8, 6, P.red[2]).hline(4, 9, 9, P.red[2]);
      p.vline(8, 3, 10, P.plaster[1]);
      p.rect(5, 1, 3, 2, P.lamp[1]).set(6, 0, P.red[1]);
      p.set(3, 1, P.lamp[2]).set(2, 1, P.lamp[2]).set(9, 1, P.lamp[2]).set(10, 1, P.lamp[2]);
    },
  },
  watchtower: {
    category: "civic",
    words: ["tower", "watch", "lookout", "outpost"],
    draw: (p) => {
      p.rect(4, 4, 5, 9, st[3]).vline(8, 4, 12, st[2]).vline(4, 4, 12, st[4]);
      p.rect(3, 2, 7, 2, st[3]);
      for (let x = 3; x <= 9; x += 2) p.set(x, 1, st[3]);
      p.set(6, 6, ink.deep).set(6, 9, ink.deep).rect(6, 11, 1, 2, ink.deep);
      p.vline(6, -1, 0, P.wood[1]);
    },
  },
  monastery: {
    category: "civic",
    words: ["monastery", "abbey", "priory", "hermitage", "shrine"],
    draw: (p) => {
      p.rect(0, 7, 9, 5, P.plaster[3]).vline(8, 7, 11, P.plaster[1]);
      p.poly(
        [
          [-0.5, 7],
          [4.5, 4],
          [9.5, 7],
        ],
        P.brick[2],
      );
      p.rect(9, 2, 3, 10, P.plaster[2]).vline(11, 2, 11, P.plaster[1]);
      p.poly(
        [
          [10.5, 0],
          [12.5, 2],
          [8.5, 2],
        ],
        P.brick[1],
      );
      p.set(10, 4, P.gold[3]).set(2, 9, ink.deep).set(5, 9, ink.deep).rect(3, 10, 1, 2, ink.deep);
    },
  },
  cathedral: {
    category: "civic",
    words: ["cathedral", "church", "basilica", "chapel"],
    draw: (p) => {
      p.rect(2, 6, 9, 7, P.plaster[2]);
      p.rect(0, 3, 3, 10, P.plaster[3]).rect(10, 3, 3, 10, P.plaster[1]);
      p.poly(
        [
          [1.5, 0],
          [3, 3],
          [0, 3],
        ],
        P.slate[2],
      );
      p.poly(
        [
          [11.5, 0],
          [13, 3],
          [10, 3],
        ],
        P.slate[1],
      );
      p.poly(
        [
          [2, 6],
          [6.5, 3],
          [11, 6],
        ],
        P.slate[2],
      );
      p.ring(6, 8, 1, 1, P.cloth.blue[1]).set(6, 8, P.gold[3]);
      p.rect(5, 10, 3, 3, ink.deep);
    },
  },
  pagoda: {
    category: "civic",
    words: ["pagoda", "stupa"],
    draw: (p) => {
      const tier = (y: number, w: number) => {
        p.hline(6 - w, 6 + w, y, P.jade[2]).set(6 - w - 1, y - 1, P.jade[2]).set(6 + w + 1, y - 1, P.jade[2]);
        p.rect(6 - w + 1, y + 1, 2 * w - 1, 2, P.red[2]);
        p.vline(6 + w - 1, y + 1, y + 2, P.red[1]);
      };
      tier(9, 5);
      tier(6, 4);
      tier(3, 3);
      p.vline(6, 0, 2, P.gold[3]).set(6, 0, P.gold[4]);
      p.hline(1, 11, 12, st[2]);
    },
  },
  observatory: {
    category: "civic",
    words: ["observatory", "astrolab", "star_tower", "telescope"],
    draw: (p) => {
      p.rect(1, 7, 11, 6, P.plaster[3]).vline(11, 7, 12, P.plaster[1]);
      p.ellipse(6, 7, 5, 4, P.slate[3]);
      p.rect(1, 7, 11, 1, P.plaster[2]);
      p.rect(1, 8, 11, 5, P.plaster[3]);
      p.vline(11, 8, 12, P.plaster[1]);
      p.ellipse(4, 5, 1, 1, P.slate[4]);
      p.line(6, 5, 10, 1, P.iron[2]).set(10, 1, P.gold[3]);
      p.set(2, 0, P.white).set(12, 3, P.white);
      p.rect(5, 10, 2, 3, ink.deep);
    },
  },
  university: {
    category: "civic",
    words: ["university", "academy", "library", "college", "archive"],
    draw: (p) => {
      p.poly(
        [
          [0, 4],
          [6.5, 0],
          [13, 4],
        ],
        P.brick[2],
      );
      p.rect(0, 4, 13, 1, P.plaster[3]);
      for (let x = 1; x <= 11; x += 2) p.vline(x, 5, 10, P.plaster[3]);
      for (let x = 2; x <= 10; x += 2) p.vline(x, 5, 10, P.plaster[0]);
      p.rect(0, 11, 13, 2, P.plaster[2]).hline(0, 12, 11, P.plaster[3]);
      p.set(6, 2, P.gold[3]);
    },
  },
};

/** 各类别的通用图样（认不出的 kind 用它）。 */
const DEFAULTS: Readonly<Record<LandmarkCategory, (p: Px) => void>> = {
  natural: (p) => {
    // 一座孤峰，峰顶一颗金星
    p.poly(
      [
        [6.5, 3],
        [12, 12],
        [1, 12],
      ],
      st[2],
    );
    p.poly(
      [
        [6.5, 3],
        [6.5, 12],
        [1, 12],
      ],
      st[3],
    );
    p.set(6, 4, P.snow[3]).set(5, 5, P.snow[3]).set(7, 5, P.snow[2]);
    p.hline(1, 12, 12, P.leaf[2]);
    p.set(6, 0, P.gold[4]).set(5, 1, P.gold[3]).set(7, 1, P.gold[3]).set(6, 1, P.gold[4]).set(6, 2, P.gold[3]);
  },
  arcane: (p) => {
    // 悬浮的符文之眼
    p.ellipse(6, 6, 6, 3, P.cloth.purple[1]);
    p.ellipse(6, 6, 4, 2, P.teal[3]);
    p.ellipse(6, 6, 1, 1, ink.deep);
    p.set(5, 5, P.white);
    p.set(6, 0, P.teal[4]).set(6, 12, P.teal[4]).set(0, 2, P.cloth.purple[2]).set(12, 10, P.cloth.purple[2]);
  },
  ancient: (p) => {
    // 残破的石门
    p.rect(1, 3, 3, 10, st[3]).rect(9, 5, 3, 8, st[3]);
    p.vline(3, 3, 12, st[2]).vline(11, 5, 12, st[2]);
    p.hline(0, 8, 2, st[4]).hline(0, 8, 1, st[3]);
    p.set(10, 4, st[3]).set(12, 12, st[2]).set(6, 12, st[2]).set(7, 11, st[3]);
  },
  civic: (p) => {
    // 市政厅与旗
    p.rect(1, 6, 11, 7, P.plaster[3]).vline(11, 6, 12, P.plaster[1]);
    p.poly(
      [
        [0.5, 6],
        [6.5, 2],
        [12.5, 6],
      ],
      P.brick[2],
    );
    p.vline(6, 0, 3, P.wood[1]).hline(7, 9, 0, P.red[2]).hline(7, 8, 1, P.red[1]);
    p.set(3, 8, ink.deep).set(9, 8, ink.deep).rect(5, 10, 3, 3, ink.deep);
  },
};

const OUTLINE: Readonly<Record<LandmarkCategory, string>> = {
  natural: ink.brown,
  arcane: P.cloth.purple[0],
  ancient: st[0],
  civic: ink.deep,
};

/** 规范的地标图样名（导出给测试与图例）。 */
export const LANDMARK_KINDS: readonly string[] = Object.keys(ICONS);
export const LANDMARK_CATEGORIES: readonly LandmarkCategory[] = ["natural", "arcane", "ancient", "civic"];

/**
 * kind → 规范的图样名；认不出时为 null（按类别画通用图样）。
 * 同类别的图样优先；同类别里取匹配到的关键词最长的（例如 "star_tower" 是天文台而不是瞭望塔），一样长时按表的顺序。
 */
export function landmarkIconKey(kind: string, category: LandmarkCategory): string | null {
  const k = kind.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(ICONS, k)) return k;
  let best: string | null = null;
  let bestScore = 0;
  for (const [name, def] of Object.entries(ICONS)) {
    let len = 0;
    for (const w of def.words) if (w.length > len && k.includes(w)) len = w.length;
    if (len === 0) continue;
    const score = (def.category === category ? 1000 : 0) + len;
    if (score > bestScore) {
      bestScore = score;
      best = name;
    }
  }
  return best;
}

/** 地标的像素图标（15×15，含描边）：按 kind 取图样，认不出时画类别的通用图样。 */
export function drawLandmarkIcon(kind: string, category: LandmarkCategory): Px {
  const asked: LandmarkCategory = LANDMARK_CATEGORIES.includes(category) ? category : "natural";
  const key = landmarkIconKey(kind, asked);
  // 认出的图样按它自己的类别画描边与辉光（同一种图样在各处风格一致）
  const cat: LandmarkCategory = key ? ICONS[key].category : asked;
  return memo(`lmk:${key ?? `default-${cat}`}:${cat}`, () => {
    const p = new Px(S, S);
    if (key) ICONS[key].draw(p);
    else DEFAULTS[cat](p);
    let out = p.outlined(OUTLINE[cat]);
    if (cat === "arcane") {
      // 魔法奇观：外圈一层淡淡的辉光与几点闪光
      const glow = new Px(out.w + 2, out.h + 2);
      glow.blit(out.outlined(P.teal[3] + "66", true), 0, 0);
      glow.set(0, 3, P.teal[4]).set(glow.w - 1, glow.h - 5, P.teal[4]).set(3, glow.h - 1, P.cloth.purple[2]);
      out = glow;
    }
    return out;
  });
}

/** 海图上的大巨像（迈步的石巨人，高举火炬；faceLeft 时左右翻转）。 */
function colossusSprite(faceLeft: boolean): Px {
  return memo(`lmk-colossus-big:${faceLeft ? 1 : 0}`, () => {
    const p = new Px(13, 21);
    // 两块礁岩的底座与浪花
    p.rect(0, 18, 5, 3, st[2]).hline(0, 4, 18, st[3]).rect(8, 18, 5, 3, st[1]).hline(8, 12, 18, st[2]);
    p.set(1, 20, P.foam).set(10, 20, P.foam).set(5, 20, P.sea[4]).set(7, 20, P.sea[4]);
    // 迈开的两腿
    for (let k = 0; k < 7; k++) {
      p.hline(2 + Math.floor(k / 2), 3 + Math.floor(k / 2), 17 - k, st[3]);
      p.hline(10 - Math.floor(k / 2), 11 - Math.floor(k / 2), 17 - k, st[2]);
    }
    // 腰带（铜绿）、躯干
    p.rect(4, 6, 5, 5, st[3]).vline(8, 6, 10, st[2]).vline(4, 6, 10, st[4]).hline(4, 8, 10, P.teal[2]);
    // 头与头盔（铜绿的盔、金色的盔缨）
    p.rect(5, 3, 3, 3, st[3]).set(7, 4, st[2]).set(6, 4, ink.deep);
    p.hline(4, 8, 2, P.teal[2]).hline(5, 7, 1, P.teal[3]).set(6, 0, P.gold[3]).set(7, 0, P.gold[2]);
    // 高举火炬的右臂与火焰
    p.set(9, 6, st[3]).set(10, 5, st[3]).set(10, 4, st[2]).set(11, 3, st[3]).vline(11, 1, 2, P.wood[1]);
    p.set(11, 0, P.lamp[2]).set(12, 0, P.lamp[1]).set(10, 0, P.red[2]);
    // 垂下的左臂与铜盾
    p.vline(3, 6, 9, st[3]).rect(1, 8, 2, 3, P.teal[1]).set(1, 8, P.teal[2]);
    // 风化：裂缝与苔藓
    p.set(5, 8, st[1]).set(6, 9, st[1]).set(3, 14, P.leaf[2]).set(9, 15, P.leaf[2]).set(2, 17, P.leaf[3]);
    let out = p.outlined(OUTLINE.ancient);
    if (faceLeft) {
      const f = new Px(out.w, out.h);
      for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) f.data[y * out.w + (out.w - 1 - x)] = out.data[y * out.w + x];
      out = f;
    }
    return out;
  });
}

/** 画在海图上时需要的上下文。 */
export interface LandmarkCtx {
  out: Px;
  /** 像素是否为陆地 */
  isLand: (x: number, y: number) => boolean;
  cell: number;
}

/**
 * 在海图上画一个地标：线状的古迹沿占地的长边画线，大面积的奇观按占地铺开，其余把图标画在占地中心。
 * x、y、w、h 为格坐标与占地。
 */
export function paintLandmark(ctx: LandmarkCtx, kind: string, category: LandmarkCategory, x: number, y: number, w: number, h: number): void {
  const { out, isLand, cell: C } = ctx;
  const key = landmarkIconKey(kind, category);
  const px0 = x * C;
  const py0 = y * C;
  const pw = Math.max(1, w) * C;
  const ph = Math.max(1, h) * C;
  const cx = Math.round(px0 + pw / 2);
  const cy = Math.round(py0 + ph / 2);
  const seed = x * 7919 + y * 104729;
  const long = Math.max(w, h) >= 3;
  if (long && (key === "great_wall" || key === "ancient_road" || key === "aqueduct")) {
    // 沿长边的线：长城是带垛口与烽台的石墙，古道是铺石的路面与里程碑，引水渠是一串拱
    const horiz = w >= h;
    const n = horiz ? pw : ph;
    // 只画在陆地像素上（海岸附近的几像素也不越到海里）
    const put = (x: number, y: number, c: string) => {
      if (isLand(x, y)) out.set(x, y, c);
    };
    for (let s = 0; s < n; s++) {
      const wob = Math.round(Math.sin((s + seed) / 9) * 1.5 + Math.sin((s + seed) / 3.7) * 0.6);
      const lx = horiz ? px0 + s : cx + wob;
      const ly = horiz ? cy + wob : py0 + s;
      if (!isLand(lx, ly)) continue;
      if (key === "great_wall") {
        put(lx, ly, st[2]);
        put(lx, ly - 1, st[3]);
        if (s % 2 === 0) put(lx, ly - 2, st[3]);
        put(horiz ? lx : lx + 1, horiz ? ly + 1 : ly, "#1a142355");
        if (s % 14 === 7) {
          for (let ty = ly - 4; ty < ly; ty++) for (let tx = lx - 1; tx <= lx + 1; tx++) put(tx, ty, tx === lx + 1 ? st[2] : st[3]);
          put(lx, ly - 5, st[4]);
        }
      } else if (key === "ancient_road") {
        put(lx, ly, s % 3 === 2 ? st[2] : st[3]);
        if (s % 16 === 8) {
          put(horiz ? lx : lx - 2, horiz ? ly - 2 : ly, st[4]);
          put(horiz ? lx : lx - 2, horiz ? ly - 1 : ly + 1, st[2]);
        }
      } else {
        put(lx, ly - 3, st[3]);
        put(lx, ly - 2, st[2]);
        if (s % 4 === 0) {
          for (let ty = ly - 1; ty <= ly + 1; ty++) put(lx, ty, st[3]);
          put(lx + 1, ly + 1, "#1a142355");
        } else if (s % 4 === 2) put(lx, ly - 1, st[2]);
      }
    }
    return;
  }
  if (key === "crater" && (w >= 2 || h >= 2)) {
    // 正圆的陨石坑潟湖：环形的岩壁（左上受光）、坑里的潟湖
    const r = Math.max(4, Math.min(pw, ph) / 2);
    out.ellipse(cx, cy, r, r, st[2]);
    out.ellipse(cx, cy, r - 2, r - 2, P.sea[3]);
    out.ellipse(cx + 1, cy + 1, r - 4, r - 4, P.sea[2]);
    for (let a = 0; a < 64; a++) {
      const t = (a / 64) * Math.PI * 2;
      const ex = Math.round(cx + Math.cos(t) * r);
      const ey = Math.round(cy + Math.sin(t) * r);
      out.set(ex, ey, Math.cos(t) + Math.sin(t) < 0 ? st[4] : st[1]);
      const ix = Math.round(cx + Math.cos(t) * (r - 2));
      const iy = Math.round(cy + Math.sin(t) * (r - 2));
      out.set(ix, iy, Math.cos(t) + Math.sin(t) > 0 ? st[3] : st[1]);
    }
    out.set(cx - 2, cy - 2, P.foam).set(cx - 1, cy - 2, P.sea[4]);
    return;
  }
  if (key === "colossus" && kind.includes("colossus")) {
    // 阿尔坎巨像：海图上画成大图样（约 3×5 格），迈步举火的石巨人，面朝海峡（两岸左右对称）
    const faceLeft = !isLand(cx - 10, cy) || (isLand(cx + 10, cy) && !isLand(cx - 6, cy));
    const big = colossusSprite(faceLeft);
    out.blit(big, cx - Math.floor(big.w / 2), cy - big.h + 5);
    return;
  }
  if (key === "colossus" && w * h >= 2) {
    // 石像群：占地内散布几尊长着苔藓的小石像
    for (let k = 0; k < 4; k++) {
      const sx = px0 + 1 + Math.floor(hash2(k, 7, seed) * Math.max(1, pw - 2));
      const sy = py0 + 3 + Math.floor(hash2(k, 8, seed) * Math.max(1, ph - 3));
      if (!isLand(sx, sy)) continue;
      out.vline(sx, sy - 3, sy, st[3]).vline(sx + 1, sy - 3, sy, st[2]).set(sx, sy - 4, st[3]).set(sx + 1, sy - 1, P.leaf[2]).set(sx, sy - 2, ink.deep);
    }
  }
  // 铺开的奇观：在占地内再散布几个小的
  if ((w >= 2 || h >= 2) && (key === "crystal" || key === "basalt" || key === "floating_isles" || key === "bone_reef" || key === "rune_circle")) {
    const count = Math.min(10, w * h * 2);
    for (let k = 0; k < count; k++) {
      const sx = px0 + Math.floor(hash2(k, 1, seed) * pw);
      const sy = py0 + Math.floor(hash2(k, 2, seed) * ph);
      if (Math.abs(sx - cx) < 5 && Math.abs(sy - cy) < 5) continue;
      if (key === "crystal") {
        const hgt = 3 + Math.floor(hash2(k, 3, seed) * 3);
        const c = k % 2 === 0 ? P.teal[3] : P.cloth.purple[2];
        out.vline(sx, sy - hgt, sy, c).vline(sx + 1, sy - hgt + 1, sy, k % 2 === 0 ? P.teal[1] : P.cloth.purple[0]).set(sx, sy - hgt, P.white);
      } else if (key === "basalt") {
        const hgt = 2 + Math.floor(hash2(k, 3, seed) * 3);
        out.vline(sx, sy - hgt, sy, st[1]).vline(sx + 1, sy - hgt, sy, st[0]).set(sx, sy - hgt, st[3]);
      } else if (key === "floating_isles") {
        out.hline(sx - 2, sx + 2, sy - 6, P.leaf[3]).hline(sx - 2, sx + 2, sy - 5, P.wood[2]).hline(sx - 1, sx + 1, sy - 4, P.wood[1]).set(sx, sy - 3, st[1]);
        out.hline(sx - 1, sx + 1, sy + 1, "#1a142333");
      } else if (key === "bone_reef") {
        out.vline(sx, sy - 3, sy, P.plaster[3]).set(sx + 1, sy - 3, P.plaster[3]).set(sx, sy + 1, P.foam);
      } else {
        out.vline(sx, sy - 3, sy, st[3]).vline(sx + 1, sy - 2, sy, st[2]);
      }
    }
  }
  const icon = drawLandmarkIcon(kind, category);
  out.blit(icon, cx - Math.floor(icon.w / 2), cy - Math.floor(icon.h / 2) - 2);
}
