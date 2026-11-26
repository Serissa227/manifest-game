// T03 商馆代办的小工具（AgencyDesk.tsx 与测试共用）。

/** 按当前行情估一张买单要预留多少：限价 × 件数 × (1 + 税率) + 代办费（与内核同一个算法，向上取整）。 */
export function reserveFor(limit: number, qty: number, taxBp: number, feePct: number): number {
  const gross = Math.max(0, limit) * Math.max(0, qty);
  const fee = gross > 0 && feePct > 0 ? Math.floor((gross * feePct + 99) / 100) : 0;
  return gross + Math.floor((gross * taxBp) / 10_000) + 1 + fee;
}
