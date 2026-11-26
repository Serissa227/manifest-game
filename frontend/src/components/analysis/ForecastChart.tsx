// 行情预测图（ECharts）：实际价格（实线）、回看拟合（虚线）、预测（点线）、八成与九成五的区间（阴影），
// 复盘时另画预测期的实际价格与修订版。配色沿用 Chart.tsx 的羊皮纸主题（新界面换成 chartTheme.ts 的纸面配色 V2_CHART）；
// 没有画布的环境里静默跳过。
import { useEffect, useMemo, useRef, useState } from "react";
import { P, ink } from "../../art/palette";
import { dayParts, decimal, t } from "../../i18n";
import { useIsV2 } from "../../ui/uiMode";
import { V2_CHART } from "../chartTheme";

export interface ChartBand {
  lo: (number | null)[];
  hi: (number | null)[];
}

export interface ForecastChartProps {
  /** 横轴：绝对天数 */
  days: number[];
  /** 实际价格（拟合窗口里的，与 days 对齐） */
  actual: (number | null)[];
  fitted?: (number | null)[];
  forecast?: (number | null)[];
  band80?: ChartBand;
  band95?: ChartBand;
  /** 预测期里的实际价格（复盘用） */
  after?: (number | null)[];
  revisions?: { name: string; data: (number | null)[] }[];
  /** 起点（最后一个已知收盘日）：画一条竖线 */
  origin?: number | null;
  height?: number;
  testId?: string;
}

interface ChartLike {
  setOption: (o: unknown, opts?: unknown) => void;
  dispose: () => void;
  resize: () => void;
}

const COLORS = {
  actual: P.teal[1],
  fitted: P.cloth.navy[2],
  forecast: P.gold[1],
  band: P.gold[3],
  after: P.red[2],
  revision: P.leaf[2],
};

/** 新界面的线色：实际价格海蓝实线、回看拟合说明色虚线、预测深黄铜点线、区间黄铜阴影、预测期的实际价格印章红、修订版绿。 */
const COLORS_V2: Record<keyof typeof COLORS, string> = {
  actual: "#1f5a8a",
  fitted: "#6f5d48",
  forecast: "#7a5210",
  band: "#c8922e",
  after: "#a3302a",
  revision: "#2b6a3b",
};

const label = (day: number) => {
  const d = dayParts(day);
  return `${d.month}/${d.date}`;
};

/** 区间阴影：下沿（不画）+ 宽度（阴影），叠放在同一组里。 */
function bandSeries(name: string, band: ChartBand, opacity: number, colors: Record<keyof typeof COLORS, string> = COLORS) {
  const width = band.hi.map((h, i) => (h === null || band.lo[i] === null ? null : h - (band.lo[i] as number)));
  const stack = `band-${name}`;
  return [
    { name: "", type: "line", data: band.lo, stack, symbol: "none", lineStyle: { opacity: 0 }, tooltip: { show: false }, silent: true },
    {
      name,
      type: "line",
      data: width,
      stack,
      symbol: "none",
      lineStyle: { opacity: 0 },
      itemStyle: { color: colors.band, opacity: Math.min(1, opacity * 2.5) },
      areaStyle: { color: colors.band, opacity },
      tooltip: { show: false },
      silent: true,
    },
  ];
}

export default function ForecastChart(props: ForecastChartProps) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<ChartLike | null>(null);
  const [ready, setReady] = useState(false);
  const v2 = useIsV2();
  const option = useMemo(() => {
    if (v2) return optionV2(props);
    const xs = props.days.map(label);
    const series: unknown[] = [];
    if (props.band95) series.push(...bandSeries(t("fc.ch.band95"), props.band95, 0.22));
    if (props.band80) series.push(...bandSeries(t("fc.ch.band80"), props.band80, 0.38));
    const line = (name: string, data: (number | null)[], color: string, type: "solid" | "dashed" | "dotted", width = 2) => ({
      name,
      type: "line",
      data,
      symbol: "none",
      connectNulls: false,
      lineStyle: { color, width, type },
      itemStyle: { color },
    });
    const actual = line(t("fc.ch.actual"), props.actual, COLORS.actual, "solid");
    if (props.origin !== undefined && props.origin !== null) {
      const i = props.days.indexOf(props.origin);
      if (i >= 0) Object.assign(actual, { markLine: { symbol: "none", silent: true, lineStyle: { color: P.parchmentDeep, type: "dashed" }, label: { show: false }, data: [{ xAxis: xs[i] }] } });
    }
    series.push(actual);
    if (props.fitted) series.push(line(t("fc.ch.fitted"), props.fitted, COLORS.fitted, "dashed", 1));
    if (props.forecast) series.push(line(t("fc.ch.forecast"), props.forecast, COLORS.forecast, "dotted", 3));
    if (props.after) series.push(line(t("fc.ch.after"), props.after, COLORS.after, "solid"));
    for (const r of props.revisions ?? []) series.push(line(r.name, r.data, COLORS.revision, "dashed"));
    const names = (series as { name: string }[]).map((s) => s.name).filter((n) => n);
    return {
      animation: false,
      backgroundColor: "transparent",
      textStyle: { color: P.wood[0], fontFamily: '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif' },
      grid: { left: 56, right: 16, top: 36, bottom: 26 },
      tooltip: {
        trigger: "axis",
        // 拟合与预测是小数：最多两位；提示框留在图表里面，靠近窗口边缘时不被边框截掉
        valueFormatter: decimal,
        confine: true,
        backgroundColor: P.white,
        borderColor: P.parchmentDeep,
        borderWidth: 2,
        textStyle: { color: ink.brown, fontSize: 12 },
        extraCssText: `box-shadow: 2px 2px 0 ${ink.brown}55; border-radius: 0;`,
      },
      legend: { data: names, top: 0, icon: "rect", itemWidth: 14, itemHeight: 6, textStyle: { color: P.wood[0], fontSize: 12 } },
      xAxis: { type: "category", data: xs, axisLine: { lineStyle: { color: P.parchmentDeep, width: 2 } }, axisLabel: { color: P.wood[1] } },
      yAxis: { type: "value", scale: true, axisLabel: { color: P.wood[1] }, splitLine: { lineStyle: { color: `${P.parchmentDark}80`, type: "dashed" } } },
      series,
    };
  }, [props, v2]);

  useEffect(() => {
    let disposed = false;
    const onResize = () => chart.current?.resize();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onResize);
    import("echarts")
      .then((echarts) => {
        if (disposed || !el.current) return;
        try {
          chart.current = echarts.init(el.current) as ChartLike;
          window.addEventListener("resize", onResize);
          observer?.observe(el.current);
          setReady(true);
        } catch {
          chart.current = null;
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
      window.removeEventListener("resize", onResize);
      observer?.disconnect();
      chart.current?.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    if (ready && chart.current) chart.current.setOption(option, { notMerge: true });
  }, [option, ready]);

  return <div ref={el} className="chart fc-chart" style={{ height: props.height ?? 220 }} data-testid={props.testId ?? "forecast-chart"} />;
}

/**
 * 新界面（v2）的预测图：线与区间同 v1，换成纸面配色（chartTheme.ts 的 V2_CHART）——细线坐标、很淡的网格、
 * 起点是一条说明色的细虚线、圆角提示框；区间的阴影淡一些，让预测线浮在上面。
 */
function optionV2(props: ForecastChartProps) {
  const T = V2_CHART;
  const C = COLORS_V2;
  const xs = props.days.map(label);
  const series: unknown[] = [];
  if (props.band95) series.push(...bandSeries(t("fc.ch.band95"), props.band95, 0.14, C));
  if (props.band80) series.push(...bandSeries(t("fc.ch.band80"), props.band80, 0.26, C));
  const line = (name: string, data: (number | null)[], color: string, type: "solid" | "dashed" | "dotted", width = 2) => ({
    name,
    type: "line",
    data,
    symbol: "none",
    connectNulls: false,
    lineStyle: { color, width, type },
    itemStyle: { color },
  });
  const actual = line(t("fc.ch.actual"), props.actual, C.actual, "solid");
  if (props.origin !== undefined && props.origin !== null) {
    const i = props.days.indexOf(props.origin);
    if (i >= 0) Object.assign(actual, { markLine: { symbol: "none", silent: true, lineStyle: { color: T.muted, type: "dashed", width: 1 }, label: { show: false }, data: [{ xAxis: xs[i] }] } });
  }
  series.push(actual);
  if (props.fitted) series.push(line(t("fc.ch.fitted"), props.fitted, C.fitted, "dashed", 1));
  if (props.forecast) series.push(line(t("fc.ch.forecast"), props.forecast, C.forecast, "dotted", 3));
  if (props.after) series.push(line(t("fc.ch.after"), props.after, C.after, "solid"));
  for (const r of props.revisions ?? []) series.push(line(r.name, r.data, C.revision, "dashed"));
  const names = (series as { name: string }[]).map((s) => s.name).filter((n) => n);
  const baseOption = {
    animation: false,
    backgroundColor: "transparent",
    textStyle: { color: T.text, fontFamily: T.font },
    grid: { left: 4, right: 16, top: 40, bottom: 4, containLabel: true },
    tooltip: {
      trigger: "axis",
      valueFormatter: decimal,
      confine: true,
      backgroundColor: T.tooltipBg,
      borderColor: T.tooltipBorder,
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: T.text, fontSize: 13 },
      axisPointer: { type: "line", lineStyle: { color: T.axis, type: "solid" } },
      extraCssText: T.tooltipCss,
    },
    legend: { data: names, top: 0, left: 0, icon: "roundRect", itemWidth: 16, itemHeight: 4, itemGap: 14, textStyle: { color: T.muted, fontSize: 12 } },
    xAxis: { type: "category", data: xs, axisLine: { lineStyle: { color: T.axis, width: 1 } }, axisTick: { show: false }, axisLabel: { color: T.muted, fontSize: 12, margin: 10 } },
    yAxis: { type: "value", scale: true, axisLabel: { color: T.muted, fontSize: 12 }, splitLine: { lineStyle: { color: T.grid, type: "solid" } } },
    series,
  };
  // 窄的图（≤ 520 px）项间收紧；图例真会折行时才给它让出地方——按估算的图例宽度定断点，
  // 不只看图宽（交易所抽屉里四项的图例在手机上排得下一行，原来也留了两行的 64 px，画线的地方矮了约四分之一）
  const items = names.map(legendItemWidth);
  return {
    baseOption,
    media: [
      { query: { maxWidth: 520 }, option: { legend: { itemGap: 10 } } },
      { query: { maxWidth: legendFits(items, 1) - 1 }, option: { grid: { top: 64 } } },
      // 再窄就折成三行（复盘图带预测期的实际价格与修订版，英文更长）
      { query: { maxWidth: legendFits(items, 2) - 1 }, option: { grid: { top: 88 } } },
    ],
  };
}

/**
 * 估算图例一项有多宽（px）：ECharts 的图例每项 = 图标 16 + 5 + 字宽。
 * 字按 12 px 估：汉字（与全角标点）12 px，其余 7.2 px——偏宽一点，宁可多让一点地方，也不让图例压到线上。
 */
function legendItemWidth(name: string): number {
  return 16 + 5 + [...name].reduce((w, ch) => w + ((ch.codePointAt(0) ?? 0) >= 0x2e80 ? 12 : 7.2), 0);
}

/** 宽 width 的图上图例折成几行（ECharts 照顺序往一行里排，排不下就换行；四周各 5 px 内边距）。 */
function legendLines(items: number[], gap: number, width: number): number {
  const room = width - 10;
  let lines = 1;
  let used = 0;
  for (const w of items) {
    if (used > 0 && used + gap + w > room) {
      lines++;
      used = w;
    } else used += used > 0 ? gap + w : w;
  }
  return lines;
}

/** 图例不多于 lines 行时图至少要多宽（px）。项间：≤ 520 px 的图 10 px（见上面的 media），更宽的 14 px。 */
function legendFits(items: number[], lines: number): number {
  const least = (gap: number) => {
    let w = Math.ceil(Math.max(0, ...items)) + 10;
    while (legendLines(items, gap, w) > lines) w++;
    return w;
  };
  const narrow = least(10);
  return narrow <= 520 ? narrow : Math.max(521, least(14));
}
