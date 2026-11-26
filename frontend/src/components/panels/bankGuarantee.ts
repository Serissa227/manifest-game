// R10-FE4：钱庄里“家里作保”那一块画哪几样（纯逻辑；Bank 组件照它画）。数据是银行视图的 guarantee（U06B3，views.rs BankGuaranteeView）。
// 真值表（逐行有测试，见 test/bank-guarantee-fe4.test.ts）：
// | 有这一段 | available | reason          | 柜台金额 ≤ amount | → 画什么 |
// | 否       | —         | —               | —                 | 什么都不画 |
// | 是       | true      | （任意）         | 否（或金额 ≤ 0）  | 标题、说明、“填上 {amount}” |
// | 是       | true      | （任意）         | 是                | 标题、说明、“填上 {amount}”、借款按钮下的“这一笔走家里的保” |
// | 是       | false     | precondition    | —                 | 标题、“已经用过了” |
// | 是       | false     | wrong_location  | —                 | 标题、“只在{port}的钱庄认”（没有港名用不带港名的那句） |
// | 是       | false     | not_owner / 别的 / 没有 | —         | 什么都不画 |
import type { BankView } from "../../ipc/types";

export type GuaranteeKind = "none" | "offer" | "used" | "home";

export interface GuaranteeShow {
  kind: GuaranteeKind;
  /** offer：柜台这一笔走不走家里的保（借款按钮下那行小字） */
  applies: boolean;
}

export function guaranteeShow(g: BankView["guarantee"], amount: number): GuaranteeShow {
  if (!g) return { kind: "none", applies: false };
  if (g.available) return { kind: "offer", applies: amount > 0 && amount <= g.amount };
  if (g.reason === "precondition") return { kind: "used", applies: false };
  if (g.reason === "wrong_location") return { kind: "home", applies: false };
  return { kind: "none", applies: false };
}

/** 走保的年息（万分之一）：平常的年息 × rate_pct ÷ 100（与内核 bank.rs 同一个式子，整数除法向下取整）。 */
export const guaranteeRateBp = (rateBp: number, ratePct: number): number => Math.floor((rateBp * ratePct) / 100);
