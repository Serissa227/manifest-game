// 行情窗口的文字：方法名、诊断结论、市场驱动、调整建议与事件标记（按当前语言，见 i18n 的 fc.* 键）。
import { t, tk } from "../i18n";
import type { ForecastMark } from "../ipc/types";
import type { Suggestion } from "./adjust";
import type { Driver } from "./attribution";
import type { Finding } from "./diagnose";
import type { Verdict } from "./monitor";
import { isMethod } from "./spec";

/** 方法的名字（未知的 key 原样显示）。 */
export function methodName(key: string): string {
  return isMethod(key) ? tk(`fc.m.${key}`) : key;
}

/** 方法名 + 公认名称的括注，例如“递减权重均价（简单指数平滑）”。 */
export function methodFull(key: string): string {
  return isMethod(key) ? t("paren", { text: tk(`fc.m.${key}`), note: tk(`fc.mm.${key}`) }) : key;
}

const pct = (v: number, digits = 0) => Math.abs(v).toFixed(digits);
const sign = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "");

export function verdictLabel(v: Verdict): string {
  return tk(`fc.v.${v}`);
}

/** 诊断结论的一句话。 */
export function findingText(f: Finding): string {
  const v = f.value ?? 0;
  switch (f.key) {
    case "bias":
      return t("fc.f.bias", { dir: t(v > 0 ? "fc.f.biasLow" : "fc.f.biasHigh"), pct: pct(v, 1) });
    case "breach":
      return t("fc.f.breach", { day: f.day ?? 0, n: v });
    case "jump":
      return t("fc.f.jump", { day: f.day ?? 0, dir: t(v > 0 ? "fc.f.jumpUp" : "fc.f.jumpDown"), pct: pct(v) });
    case "cusum":
      return t("fc.f.cusum", { day: f.day ?? 0 });
    case "chow":
      return t("fc.f.chow", { day: f.day ?? 0, p: (f.p ?? 0).toFixed(3) });
    case "volatility":
      return t("fc.f.volatility", { x: v.toFixed(1) });
    case "trend_vs_reversion":
      return t("fc.f.trend_vs_reversion", { v: Math.max(1, Math.round(v)) });
    case "hindsight":
      return t("fc.f.hindsight", { method: methodName(f.method ?? ""), pct: pct(v) });
    case "autocorr":
      return t("fc.f.autocorr");
    case "short_sample":
      return t("fc.f.short_sample", { n: v });
    case "clamped":
      return t("fc.f.clamped", { n: v });
    case "narrow_interval":
      return t("fc.f.narrow_interval", { pct: pct(v) });
    case "approx_baseline":
      return t("fc.f.approx_baseline");
    case "stale":
      return t("fc.f.stale", { n: v });
    case "capacity":
      return t("fc.f.capacity", {
        from: Math.round(f.from ?? 100),
        to: Math.round(v),
        dir: t(v >= (f.from ?? 100) ? "fc.f.capacityUp" : "fc.f.capacityDown"),
      });
    case "liquidity": {
      const up = v >= (f.from ?? 100);
      return t("fc.f.liquidity", {
        from: Math.round(f.from ?? 100),
        to: Math.round(v),
        dir: t(up ? "fc.f.liquidityUp" : "fc.f.liquidityDown"),
        move: t(up ? "fc.f.liquidityMoveUp" : "fc.f.liquidityMoveDown"),
      });
    }
  }
}

/** 市场驱动的一行，例如“流行：约 +41%（库存 −350 件）”。 */
export function driverText(d: Driver): string {
  const line = t("fc.d.line", { name: tk(`fc.d.${d.key}`), sign: sign(d.pct), pct: pct(d.pct) });
  if (d.units === undefined || d.units === 0) return line;
  return line + t("fc.d.units", { sign: sign(d.units), units: Math.abs(Math.round(d.units)) });
}

/** 事件标记的一行。 */
export function markText(m: ForecastMark): string {
  if (m.kind === "popular") return t("fc.mk.popular", { day: m.day });
  if (m.kind === "popular_end") return t("fc.mk.popularEnd", { day: m.day });
  const mult = m.mult_bp ? (m.mult_bp / 10_000).toFixed(2) : "";
  const effect = m.effect ?? "";
  const name = effect.includes("supply")
    ? t("fc.mk.supply", { mult })
    : effect.includes("demand")
      ? t("fc.mk.demand", { mult })
      : t("fc.mk.other");
  const until = m.end ? t("fc.mk.until", { end: m.end }) : "";
  return t("fc.mk.event", { day: m.day, name: name + until });
}

/** 调整建议的一句话。 */
export function suggestionText(s: Suggestion): string {
  switch (s.kind) {
    case "refit":
      return t("fc.s.refit");
    case "switch":
      return t("fc.s.switch", { method: methodName(s.spec.method) });
    case "intervention": {
      const iv = s.spec.intervention;
      const size = `${sign(iv?.size ?? 0)}${pct(100 * (iv?.size ?? 0))}%`;
      return t("fc.s.intervention", { day: iv?.day ?? 0, kind: t(iv?.kind === "pulse" ? "fc.iv.pulse" : "fc.iv.step"), size });
    }
    case "seasonal":
      return t("fc.s.seasonal");
    case "exclude":
      return t("fc.s.exclude");
    case "calibrate":
      return t("fc.s.calibrate", { x: s.spec.sigmaScale.toFixed(2) });
    case "params":
      return t("fc.s.refit");
  }
}

/** 航海士卡片上的一行“算学奇才：……”（普通航海士返回 null）。 */
export function geniusLine(methods: readonly string[] | undefined): string | null {
  if (!methods || methods.length === 0) return null;
  return t("fc.mateGenius", { methods: methods.map(methodName).join(t("listSep")) });
}
