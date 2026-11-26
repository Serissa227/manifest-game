// 细图层（第九批 M01“细海图”）：三个二进制文件的解码与取值，仓库里真实的寰宇细图层读得出来，
// 以及整张海图（远档）的海岸改由细海岸层降采样——经典世界（没有细图层）照旧。
import { readFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { chartMemoKey, padWrapInput, type ChartInput } from "./map";
import {
  FINE_LAKE,
  FINE_LAND,
  FINE_MIXED,
  FINE_SEA,
  decodeFineCoast,
  decodeFineElevation,
  decodeFineRivers,
  fineClassAt,
  fineCoastFromRaster,
  fineElevationAt,
  fineWindow,
  type FineLayers,
  type Inflate,
} from "./map/fine";
import { coastPixels, geoLayers } from "./map/geo";
import { decodeFineResource, inflateZlib } from "../map/fineLayers";

const inflate: Inflate = async (data) => new Uint8Array(inflateSync(data));
// 路径放在变量里：写成模板字面量时 Vite 会把 new URL(…, import.meta.url) 改写成网页里的资源地址
const FINE_DIR = "../../../data/maps/earth/fine/";
const file = (name: string) => {
  const rel = FINE_DIR + name;
  return new Uint8Array(readFileSync(new URL(rel, import.meta.url)));
};

function header(magic: string, fields: [number, 2 | 4][]): Uint8Array {
  const out: number[] = [...magic].map((c) => c.charCodeAt(0));
  for (const [v, n] of fields) for (let i = 0; i < n; i++) out.push((v >>> (8 * i)) & 0xff);
  return Uint8Array.from(out);
}
const join2 = (a: Uint8Array, b: Uint8Array) => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
};

/** 照后端的格式拼一份 coast.bin。 */
function coastFile(width: number, height: number, sub: number, kinds: number[], blocks: Uint8Array): Uint8Array {
  const payload = join2(Uint8Array.from(kinds), blocks);
  const packed = new Uint8Array(deflateSync(payload));
  const mixed = kinds.filter((k) => k === FINE_MIXED).length;
  return join2(header("MFCOAST1", [[width, 4], [height, 4], [sub, 2], [1, 2], [mixed, 4], [payload.length, 4], [packed.length, 4]]), packed);
}

describe("细图层的解码", () => {
  it("细海岸：整格同类的不存块，混合格每细格 2 位；逐细格读回", async () => {
    // 2 × 1 粗格、每格 4 × 4 细格：左格整格是海，右格混合（按 (x + y) % 3 排海、陆、湖）
    const sub = 4;
    const raster = new Uint8Array(8 * 4);
    for (let y = 0; y < 4; y++) for (let x = 4; x < 8; x++) raster[y * 8 + x] = [FINE_SEA, FINE_LAND, FINE_LAKE][(x + y) % 3];
    const built = fineCoastFromRaster(2, 1, sub, raster);
    expect([...built.kinds]).toEqual([FINE_SEA, FINE_MIXED]);
    expect(built.blocks.length).toBe(4);
    const decoded = await decodeFineCoast(coastFile(2, 1, sub, [...built.kinds], built.blocks), inflate);
    expect([...decoded.kinds]).toEqual([...built.kinds]);
    expect([...decoded.blockOf]).toEqual([-1, 0]);
    const f = { ...decoded, hash: "t", elevW: 1, elevH: 1, elevPer: 1, elevation: new Int16Array(1), rivers: [] } satisfies FineLayers;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) expect(fineClassAt(f, x, y)).toBe(raster[y * 8 + x]);
    // 横向按宽度取模，纵向越界按最近的一行
    expect(fineClassAt(f, -1, 0)).toBe(raster[7]);
    expect(fineClassAt(f, 8 + 5, -3)).toBe(raster[5]);
    expect(fineClassAt(f, 5, 99)).toBe(raster[3 * 8 + 5]);
    // 成片地取与逐格取一致（含跨接缝的窗口）
    const win = fineWindow(f, -3, -1, 14, 6);
    for (let oy = 0; oy < 6; oy++) for (let ox = 0; ox < 14; ox++) expect(win[oy * 14 + ox]).toBe(fineClassAt(f, ox - 3, oy - 1));
  });

  it("细高程与细河流：差分、之字形与变长整数读回原值", async () => {
    const meters = [0, -1, 300, -8000, 8848, -32768, 32767, 5, -5, 0];
    const w = 5;
    const lo: number[] = [];
    const hi: number[] = [];
    meters.forEach((m, i) => {
      const prev = i % w === 0 ? 0 : meters[i - 1];
      const d = ((m - prev) << 16) >> 16;
      const z = ((d << 1) ^ (d >> 15)) & 0xffff;
      lo.push(z & 0xff);
      hi.push(z >> 8);
    });
    const payload = Uint8Array.from([...lo, ...hi]);
    const packed = new Uint8Array(deflateSync(payload));
    const elev = await decodeFineElevation(join2(header("MFELEV01", [[w, 4], [2, 4], [4, 2], [1, 2], [payload.length, 4], [packed.length, 4]]), packed), inflate);
    expect([elev.elevW, elev.elevH, elev.elevPer]).toEqual([5, 2, 4]);
    expect([...elev.elevation]).toEqual(meters);

    const zig = (v: number) => ((v << 1) ^ (v >> 31)) >>> 0;
    const varint = (v: number) => {
      const out: number[] = [];
      while (v >= 0x80) {
        out.push((v & 0x7f) | 0x80);
        v >>>= 7;
      }
      out.push(v);
      return out;
    };
    const pts = [
      [10, 10],
      [11, 12],
      [-3, 40],
      [100000, -7],
    ];
    const body: number[] = [3, ...varint(pts.length)];
    let px = 0;
    let py = 0;
    for (const [x, y] of pts) {
      body.push(...varint(zig(x - px)), ...varint(zig(y - py)));
      px = x;
      py = y;
    }
    body.push(9, 0);
    const rp = Uint8Array.from(body);
    const rpacked = new Uint8Array(deflateSync(rp));
    const rivers = await decodeFineRivers(join2(header("MFRIVER1", [[3, 4], [2, 4], [24, 2], [1, 2], [2, 4], [rp.length, 4], [rpacked.length, 4]]), rpacked), inflate);
    expect(rivers.map((r) => r.rank)).toEqual([3, 9]);
    expect([...rivers[0].pts]).toEqual(pts.flat());
    expect(rivers[1].pts.length).toBe(0);
  });

  it("魔数、版本或长度不对的文件报错，不给出半截的数据", async () => {
    const good = coastFile(1, 1, 4, [FINE_LAND], new Uint8Array(0));
    await expect(decodeFineCoast(good, inflate)).resolves.toMatchObject({ width: 1, height: 1 });
    const bad = good.slice();
    bad[0] = 0x58;
    await expect(decodeFineCoast(bad, inflate)).rejects.toThrow();
    await expect(decodeFineCoast(good.slice(0, good.length - 1), inflate)).rejects.toThrow();
    const version = good.slice();
    version[18] = 2;
    await expect(decodeFineCoast(version, inflate)).rejects.toThrow();
    await expect(decodeFineElevation(good, inflate)).rejects.toThrow();
    await expect(decodeFineRivers(good, inflate)).rejects.toThrow();
  });
});

describe("仓库里的寰宇细图层", () => {
  /** 经纬度 → 细格坐标（西缘 −180°、北缘 72°、每粗格 20 角分、每格 24 细格）。 */
  const at = (lon: number, lat: number): [number, number] => [Math.floor((lon + 180) * 72), Math.floor((72 - lat) * 72)];

  it("三个文件都解得开，读出来的是真实的地理（与后端的测试同一批地点）", async () => {
    const coast = await decodeFineCoast(file("coast.bin"), inflate);
    const elevation = await decodeFineElevation(file("elevation.bin"), inflate);
    const rivers = await decodeFineRivers(file("rivers.bin"), inflate);
    const f: FineLayers = { hash: "earth", ...coast, ...elevation, rivers };
    expect([f.width, f.height, f.sub]).toEqual([1080, 396, 24]);
    expect([f.elevW, f.elevH, f.elevPer]).toEqual([4320, 1584, 4]);
    const cls = (lon: number, lat: number) => fineClassAt(f, ...at(lon, lat));
    expect(cls(-30, 0)).toBe(FINE_SEA);
    expect(cls(90, 45)).toBe(FINE_LAND);
    expect(cls(-87, 47.5)).toBe(FINE_LAKE);
    expect(cls(130.6, 32.2)).toBe(FINE_LAND);
    expect(cls(135.0, 34.5)).toBe(FINE_SEA);
    expect(cls(12.6, 41.9)).toBe(FINE_LAND);
    const meters = (lon: number, lat: number) => fineElevationAt(f, Math.floor((lon + 180) * 12), Math.floor((72 - lat) * 12));
    expect(meters(86.9, 28.0)).toBeGreaterThan(5000);
    expect(meters(142.5, 11.3)).toBeLessThan(-6000);
    expect(meters(3.0, 56.0)).toBeGreaterThan(-200);
    expect(meters(3.0, 56.0)).toBeLessThan(0);
    expect(rivers.length).toBeGreaterThan(1000);
    expect(rivers.some((r) => r.rank <= 1)).toBe(true);
    expect(rivers.every((r) => r.pts.length >= 4)).toBe(true);
  }, 30000);

  it("浏览器的解压（DecompressionStream）与 zlib 逐字节相同；后端给的资源整份解码", async () => {
    const bytes = file("rivers.bin");
    const a = await inflateZlib(bytes.subarray(32));
    const b = new Uint8Array(inflateSync(bytes.subarray(32)));
    expect(a.length).toBe(b.length);
    expect(a.every((v, i) => v === b[i])).toBe(true);
    const b64 = (name: string) => {
      const bytes = file(name);
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    };
    const layers = await decodeFineResource({ key: "earth", hash: "h", cells: 24, coast: b64("coast.bin"), elevation: b64("elevation.bin"), rivers: b64("rivers.bin") });
    expect(layers).toMatchObject({ hash: "h", sub: 24, width: 1080, height: 396, elevW: 4320 });
    // 没有细图层的地图：空的一份
    expect(await decodeFineResource({ key: "classic", hash: "", cells: 0, coast: null, elevation: null, rivers: null })).toBeNull();
  }, 30000);
});

describe("整张海图的海岸改由细海岸层降采样", () => {
  /** 3 × 2 粗格：左列是海，中间一列是陆，右列是海。 */
  const rows = ["~#~", "~#~"];
  const input: ChartInput = { width: 3, height: 2, rows };
  const S = 24;
  function fineOf(paint: (raster: Uint8Array, FW: number) => void): FineLayers {
    const raster = new Uint8Array(3 * S * 2 * S);
    for (let y = 0; y < 2 * S; y++) for (let x = S; x < 2 * S; x++) raster[y * 3 * S + x] = FINE_LAND;
    paint(raster, 3 * S);
    return { hash: "t", ...fineCoastFromRaster(3, 2, S, raster), elevW: 12, elevH: 8, elevPer: 4, elevation: new Int16Array(96), rivers: [] };
  }

  it("每个像素盖 6 × 6 细格，陆的不少于 16 个才是陆；真实的海湾伸进陆格、陆伸进海格都照画", () => {
    const fine = fineOf((r, FW) => {
      // 陆格 (1,0) 的右上角是一片海湾（12 × 12 细格 = 2 × 2 像素）
      for (let y = 0; y < 12; y++) for (let x = S + 12; x < 2 * S; x++) r[y * FW + x] = FINE_SEA;
      // 海格 (2,1) 的左上角伸进一块陆（6 × 6 细格 = 1 个像素），不在格心与水道上
      for (let y = S; y < S + 6; y++) for (let x = 2 * S; x < 2 * S + 6; x++) r[y * FW + x] = FINE_LAND;
      // 海格 (0,0) 里一小粒陆（3 × 3 细格）：不够一个像素的一半，远档上不画
      for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) r[y * FW + x] = FINE_LAND;
    });
    const coast = coastPixels(geoLayers(input), { fine });
    const land = (px: number, py: number) => coast.land[py * coast.PW + px];
    expect([coast.PW, coast.PH]).toEqual([12, 8]);
    expect(land(5, 5)).toBe(1);
    expect([land(6, 0), land(7, 0), land(6, 1), land(7, 1)]).toEqual([0, 0, 0, 0]);
    expect(land(4, 0)).toBe(1);
    expect(land(8, 4)).toBe(1);
    expect(land(9, 4)).toBe(0);
    expect(land(0, 0)).toBe(0);
    // 距离场随真实的海岸
    expect(coast.outDist[0]).toBeGreaterThan(3);
    expect(coast.inDist[5 * 12 + 5]).toBeGreaterThanOrEqual(1);
  });

  it("航行网格仍是权威：可航行格的中心与通往可航行邻格的水道必是水；陆格里没有陆像素时中心画成陆", () => {
    const fine = fineOf((r, FW) => {
      // 海格 (0,0) 整格被陆盖住；陆格 (1,1) 整格是水
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) r[y * FW + x] = FINE_LAND;
      for (let y = S; y < 2 * S; y++) for (let x = S; x < 2 * S; x++) r[y * FW + x] = FINE_SEA;
    });
    const coast = coastPixels(geoLayers(input), { fine });
    const land = (px: number, py: number) => coast.land[py * coast.PW + px];
    // (0,0) 的中心 2 × 2 与通往下面那个海格的水道
    expect([land(1, 1), land(2, 1), land(1, 2), land(2, 2), land(1, 3), land(2, 3)]).toEqual([0, 0, 0, 0, 0, 0]);
    // 别处照细海岸层：这一格的角上仍是陆
    expect(land(0, 0)).toBe(1);
    expect(land(3, 0)).toBe(1);
    // 陆格 (1,1) 的中心
    expect([land(5, 5), land(6, 5), land(5, 6), land(6, 6)]).toEqual([1, 1, 1, 1]);
    expect(land(4, 4)).toBe(0);
  });

  it("没有细图层（经典世界）时海岸与原来逐像素相同；海图的键只在有细图层时带上它的哈希", () => {
    const geo = geoLayers(input);
    const a = coastPixels(geo);
    const b = coastPixels(geo, {});
    const c = coastPixels(geo, { fine: null });
    expect([...b.land]).toEqual([...a.land]);
    expect([...c.land]).toEqual([...a.land]);
    const fine = fineOf(() => {});
    expect(chartMemoKey(input, 1)).not.toContain("fine");
    expect(chartMemoKey({ ...input, fine }, 1)).toContain(`:fine${fine.hash}`);
    expect(chartMemoKey({ ...input, fine }, 1)).not.toBe(chartMemoKey({ ...input, fine: { ...fine, hash: "other" } }, 1));
    // 环绕补边：细图层不动，只记下补边后的第 0 列对应它的哪一列；没有细图层的输入不带这个字段
    const wide: ChartInput = { width: 40, height: 2, rows: ["~".repeat(40), "#".repeat(40)], wrapX: true };
    expect("fineOffsetX" in padWrapInput(wide, 16)).toBe(false);
    expect(padWrapInput({ ...wide, fine }, 16).fineOffsetX).toBe(-16);
  });
});
