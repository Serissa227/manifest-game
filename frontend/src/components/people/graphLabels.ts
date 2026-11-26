// 关系图（新界面 v2）的字号与线上标签的位置。
// svg 按宽度缩放（viewBox 520 宽；桌面画到 640 宽，手机 390 宽时只有约 360），字号按实际的缩放折算，显示出来不小于 12 px；
// 线上的标签（“恋人”“朋友”）放在线的中点附近，但躲开人物的圆点、名字与别的标签——不然手机上会读成“罗塞拉恋人”。
// 纯计算，不碰 DOM：PeoplePanel 量出缩放后调用；旧界面（v1）不用这里，标签照旧在中点。

export interface Pt {
  x: number;
  y: number;
}

/** 一个矩形（svg 单位）。 */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 关系图的字号（svg 单位）：按缩放 k（显示宽 ÷ viewBox 宽）折算，线上标签显示不小于 12.5 px、名字不小于 14 px；桌面放大时照旧 12 / 13。 */
export function graphFontSizes(k: number | null): { edge: number; node: number } {
  if (!k || !Number.isFinite(k) || k <= 0) return { edge: 12, node: 13 };
  return { edge: Math.max(12, Math.round(12.5 / k)), node: Math.max(13, Math.round(14 / k)) };
}

/** 估算一行字的宽（svg 单位）：汉字、全角标点按 1 个字号，其他按 0.6 个。 */
export function textWidth(s: string, fs: number): number {
  let w = 0;
  for (const ch of s) w += (ch.codePointAt(0) ?? 0) >= 0x2e80 ? fs : fs * 0.6;
  return w;
}

/** 以 x 居中、基线在 y 的一行字占的框（上沿约 0.9 个字号、下沿约 0.25 个），四周再留 pad。 */
export function textBox(s: string, x: number, y: number, fs: number, pad = 2): Box {
  const w = textWidth(s, fs);
  return { x0: x - w / 2 - pad, x1: x + w / 2 + pad, y0: y - fs * 0.9 - pad, y1: y + fs * 0.25 + pad };
}

/** 两个框重叠的面积。 */
export function overlapArea(a: Box, b: Box): number {
  return Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
}

/** 沿线试的位置：从中点往两头，不靠近两端的圆点。 */
const STOPS = [0.5, 0.42, 0.58, 0.34, 0.66, 0.27, 0.73];

/**
 * 线上标签的位置（x 居中、基线 y）：沿线从中点往两头试，挑与障碍（圆点、名字、已经放下的标签）重叠最少的一处；
 * 一处都不重叠时就用它（中点优先）。标签的基线在线上方 4 个单位，与旧界面一样。
 */
export function placeEdgeLabels(edges: { a: Pt; b: Pt; label: string }[], obstacles: Box[], fs: number): Pt[] {
  const placed: Box[] = [];
  return edges.map((e) => {
    let best: { p: Pt; box: Box; cost: number } | null = null;
    for (const s of STOPS) {
      const p = { x: e.a.x + (e.b.x - e.a.x) * s, y: e.a.y + (e.b.y - e.a.y) * s - 4 };
      const box = textBox(e.label, p.x, p.y, fs);
      let cost = 0;
      for (const o of obstacles) cost += overlapArea(box, o);
      for (const o of placed) cost += overlapArea(box, o);
      if (!best || cost < best.cost) best = { p, box, cost };
      if (cost === 0) break;
    }
    // edges 不为空时 best 一定有值（STOPS 不为空）
    const chosen = best as { p: Pt; box: Box; cost: number };
    placed.push(chosen.box);
    return chosen.p;
  });
}
