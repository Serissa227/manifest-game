// 迷雾增量（UI-CONTRACT I3 的 fog_delta）：位图的编码（行优先、每格一位、字节内低位在前、base64），
// 全量与增量的应用，跨接缝的行区间，换对局时整张替换；任意一串增量之后与最后的全量逐格相同。
import { describe, expect, it } from "vitest";
import type { FogDelta } from "../ipc/types";
import { applyFogDelta, decodeBase64, encodeBase64, FogBits, type FogState } from "./fogBits";

/** 确定性的伪随机。 */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe("位图编码", () => {
  it("base64 往返；URL 安全的写法与空白也认", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255, 7]);
    for (let n = 0; n <= bytes.length; n++) {
      const sub = bytes.subarray(0, n);
      expect(Array.from(decodeBase64(encodeBase64(sub)))).toEqual(Array.from(sub));
    }
    expect(Array.from(decodeBase64("+/8=\n"))).toEqual([251, 255]);
    expect(Array.from(decodeBase64("-_8"))).toEqual([251, 255]);
    // 与浏览器的 btoa 一致
    expect(encodeBase64(new Uint8Array([104, 105, 33]))).toBe(btoa("hi!"));
  });

  it("行优先、每格一位、字节内低位在前", () => {
    // 3×4：第 0 行第 1 格（下标 1）、第 2 行第 2 格（下标 8）揭开
    const bits = FogBits.fromBase64(encodeBase64(new Uint8Array([0b0000_0010, 0b0000_0001])), 3, 4);
    expect(bits.get(1, 0)).toBe(true);
    expect(bits.get(2, 2)).toBe(true);
    expect(bits.get(0, 0)).toBe(false);
    expect(bits.count()).toBe(2);
    expect(bits.toRows()).toEqual(["010", "000", "001", "000"]);
    // 越界算未揭开
    expect(bits.get(-1, 0)).toBe(false);
    expect(bits.get(3, 0)).toBe(false);
  });

  it("全量比位图短时，缺的部分算未揭开", () => {
    const bits = FogBits.fromBase64(encodeBase64(new Uint8Array([0xff])), 4, 4);
    expect(bits.toRows()).toEqual(["1111", "1111", "0000", "0000"]);
  });
});

describe("增量", () => {
  it("行区间（含两端）揭开，返回新揭开的格的包围盒；已揭开的不算变化", () => {
    const bits = new FogBits(10, 5);
    expect(bits.applyRuns([[2, 3, 5]])).toEqual({ x0: 3, y0: 2, x1: 5, y1: 2 });
    expect(bits.toRows()[2]).toBe("0001110000");
    expect(bits.applyRuns([[2, 4, 5]])).toBeNull();
    expect(bits.applyRuns([[0, 0, 0], [4, 9, 9]])).toEqual({ x0: 0, y0: 0, x1: 9, y1: 4 });
    // 越界的行、列被裁掉
    expect(bits.applyRuns([[7, 0, 3], [1, -4, 1], [3, 8, 30]])).toEqual({ x0: 0, y0: 1, x1: 9, y1: 3 });
    expect(bits.toRows()[1]).toBe("1100000000");
    expect(bits.toRows()[3]).toBe("0000000011");
  });

  it("起始列大于结束列：跨过东西接缝（起始列到行尾、行首到结束列）", () => {
    const bits = new FogBits(10, 2);
    bits.applyRuns([[1, 8, 1]]);
    expect(bits.toRows()).toEqual(["0000000000", "1100000011"]);
  });

  it("任意一串增量应用之后，与最后一次的全量逐格相同", () => {
    const W = 97;
    const H = 41;
    for (let seed = 1; seed <= 12; seed++) {
      const rnd = lcg(seed);
      // 后端的真相：一张逐步揭开的位图
      const truth = new FogBits(W, H);
      let state: FogState | null = null;
      let rev = 0;
      for (let step = 0; step < 30; step++) {
        const runs: [number, number, number][] = [];
        const n = 1 + Math.floor(rnd() * 6);
        for (let i = 0; i < n; i++) {
          const y = Math.floor(rnd() * H);
          const a = Math.floor(rnd() * W);
          const b = rnd() < 0.15 ? Math.floor(rnd() * W) : Math.min(W - 1, a + Math.floor(rnd() * 12));
          runs.push([y, a, b]);
        }
        truth.applyRuns(runs);
        rev++;
        // 第一次给全量；偶尔后端判断 since 太旧也给全量（附带的 runs 应用后不变）
        const full = step === 0 || rnd() < 0.1 ? truth.toBase64() : null;
        const d: FogDelta = { epoch: "e1", rev, full, runs: full ? [] : runs };
        state = applyFogDelta(state, d, W, H).state;
        expect(state.rev).toBe(rev);
      }
      expect(state!.bits.equals(truth)).toBe(true);
      expect(state!.bits.equals(FogBits.fromBase64(truth.toBase64(), W, H))).toBe(true);
      expect(state!.bits.toRows()).toEqual(truth.toRows());
    }
  });

  it("换了一局（epoch 不同）或尺寸不同时整张替换；同一局的增量原地揭开并报告范围", () => {
    const a = new FogBits(8, 4);
    a.applyRuns([[0, 0, 7]]);
    let r = applyFogDelta(null, { epoch: "A", rev: 3, full: a.toBase64(), runs: [] }, 8, 4);
    expect(r.changed).toBe("all");
    expect(r.state.bits.count()).toBe(8);
    const keep = r.state.bits;
    r = applyFogDelta(r.state, { epoch: "A", rev: 4, full: null, runs: [[1, 2, 3]] }, 8, 4);
    expect(r.state.bits).toBe(keep);
    expect(r.changed).toEqual({ x0: 2, y0: 1, x1: 3, y1: 1 });
    // 没有新揭开：changed 为 null
    r = applyFogDelta(r.state, { epoch: "A", rev: 5, full: null, runs: [[1, 2, 3]] }, 8, 4);
    expect(r.changed).toBeNull();
    // 读档：新的 epoch 带全量
    const b = new FogBits(8, 4);
    b.applyRuns([[3, 0, 0]]);
    r = applyFogDelta(r.state, { epoch: "B", rev: 1, full: b.toBase64(), runs: [] }, 8, 4);
    expect(r.changed).toBe("all");
    expect(r.state.epoch).toBe("B");
    expect(r.state.bits.toRows()).toEqual(["00000000", "00000000", "00000000", "10000000"]);
    // 换了地图（尺寸不同）：整张替换
    r = applyFogDelta(r.state, { epoch: "B", rev: 2, full: null, runs: [[0, 0, 1]] }, 6, 2);
    expect(r.changed).toBe("all");
    expect(r.state.bits.toRows()).toEqual(["110000", "000000"]);
  });
});
