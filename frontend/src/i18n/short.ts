// 短写的大数（网页自适应：手机顶栏里放不下“1,234,567”）：十万以下照常加千分位；
// 再大按当前语言的紧凑写法（浏览器自带的 Intl 紧凑记数：中文“12.3万”“123万”“1.23亿”，英文“123K”“1.23M”），三位有效数字。
// 全额另写在读屏文字与悬停提示里。
import { num } from "./index";
import { currentLocale } from "./locale";

const formats = new Map<string, Intl.NumberFormat>();

function compact(tag: string): Intl.NumberFormat {
  let f = formats.get(tag);
  if (!f) {
    f = new Intl.NumberFormat(tag, { notation: "compact", maximumSignificantDigits: 3 });
    formats.set(tag, f);
  }
  return f;
}

/** 短写的大数：|v| < 100,000 时原样（带千分位），否则按当前语言紧凑记数。 */
export function shortNum(v: number): string {
  const n = Math.round(v);
  if (Math.abs(n) < 100_000) return num(n);
  return compact(currentLocale() === "en" ? "en-US" : "zh-CN").format(n);
}
