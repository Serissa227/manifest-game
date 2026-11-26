import { useEffect, useMemo, useRef, useState } from "react";
import { P, ink } from "../art/palette";
import { decimal } from "../i18n";
import { useIsV2 } from "../ui/uiMode";
import { V2_CHART, fadeArea } from "./chartTheme";

/**
 * 与羊皮纸窗口协调的图表配色：深棕文字、浅棕网格、纸色提示框；
 * 折线用调色板里彼此区分明显的几种墨色（青、朱、金、靛、绿）。
 */
const THEME = {
  text: P.wood[0],
  muted: P.wood[1],
  axis: P.parchmentDeep,
  grid: `${P.parchmentDark}80`,
  tooltipBg: P.white,
  tooltipBorder: P.parchmentDeep,
  series: [P.teal[1], P.red[2], P.gold[1], P.cloth.navy[2], P.leaf[2]],
  font: '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif',
};

export interface ChartSeries {
  name: string;
  data: number[];
}

interface ChartLike {
  setOption: (o: unknown, opts?: unknown) => void;
  dispose: () => void;
  resize: () => void;
}

/** 旧界面（v1）的图表设置：羊皮纸配色。 */
function optionV1(xs: string[], ys: ChartSeries[]) {
  return {
    animation: false,
    backgroundColor: "transparent",
    color: THEME.series,
    textStyle: { color: THEME.text, fontFamily: THEME.font },
    grid: { left: 64, right: 16, top: 32, bottom: 26 },
    tooltip: {
      trigger: "axis",
      // 数值最多两位小数；提示框留在图表里面，靠近窗口边缘时不被边框截掉
      valueFormatter: decimal,
      confine: true,
      backgroundColor: THEME.tooltipBg,
      borderColor: THEME.tooltipBorder,
      borderWidth: 2,
      padding: [6, 10],
      textStyle: { color: ink.brown, fontSize: 12 },
      axisPointer: { type: "line", lineStyle: { color: THEME.axis, type: "dashed" } },
      extraCssText: `box-shadow: 2px 2px 0 ${ink.brown}55; border-radius: 0;`,
    },
    legend: {
      data: ys.map((s) => s.name),
      top: 0,
      icon: "rect",
      itemWidth: 14,
      itemHeight: 6,
      itemGap: 16,
      textStyle: { color: THEME.text, fontSize: 12, fontWeight: "bold" },
      inactiveColor: THEME.axis,
    },
    xAxis: {
      type: "category",
      data: xs,
      axisLine: { lineStyle: { color: THEME.axis, width: 2 } },
      axisTick: { lineStyle: { color: THEME.axis } },
      axisLabel: { color: THEME.muted },
    },
    yAxis: {
      type: "value",
      scale: true,
      axisLine: { show: false },
      axisLabel: { color: THEME.muted },
      splitLine: { lineStyle: { color: THEME.grid, type: "dashed" } },
    },
    series: ys.map((s) => ({
      name: s.name,
      type: "line",
      data: s.data,
      showSymbol: s.data.length <= 2,
      lineStyle: { width: 2 },
      emphasis: { focus: "series" },
    })),
  };
}

/** 新界面（v2）的图表设置：纸面配色、细线坐标、圆角提示框；只有一条线时下面垫一层很淡的同色面积。 */
function optionV2(xs: string[], ys: ChartSeries[]) {
  const T = V2_CHART;
  return {
    animation: false,
    backgroundColor: "transparent",
    color: T.series,
    textStyle: { color: T.text, fontFamily: T.font },
    // 刻度字算进图里（七位数的金额也不会被左边截掉）
    grid: { left: 4, right: 16, top: 36, bottom: 4, containLabel: true },
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
    legend: {
      data: ys.map((s) => s.name),
      top: 0,
      left: 0,
      icon: "roundRect",
      itemWidth: 16,
      itemHeight: 4,
      itemGap: 18,
      textStyle: { color: T.muted, fontSize: 13 },
      inactiveColor: T.axis,
    },
    xAxis: {
      type: "category",
      data: xs,
      axisLine: { lineStyle: { color: T.axis, width: 1 } },
      axisTick: { show: false },
      axisLabel: { color: T.muted, fontSize: 12, margin: 10 },
    },
    yAxis: {
      type: "value",
      scale: true,
      splitNumber: 4,
      axisLine: { show: false },
      axisLabel: { color: T.muted, fontSize: 12 },
      splitLine: { lineStyle: { color: T.grid, type: "solid" } },
    },
    series: ys.map((s, i) => ({
      name: s.name,
      type: "line",
      data: s.data,
      showSymbol: s.data.length <= 2,
      symbolSize: 6,
      lineStyle: { width: 2 },
      emphasis: { focus: "series" },
      ...(ys.length === 1 ? { areaStyle: fadeArea(T.series[i % T.series.length]) } : {}),
    })),
  };
}

/**
 * ECharts 折线图：按需加载 echarts，组件存续期间只创建一次图表实例，数据变化时只调用 setOption
 * （高倍速下每秒多次更新也不重建）。在没有画布的环境中静默跳过。新界面（v2）换一套纸面配色。
 */
export function LineChart({
  labels,
  series,
  height,
  testId,
}: {
  labels: string[];
  series: ChartSeries[];
  height?: number;
  testId?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<ChartLike | null>(null);
  const [ready, setReady] = useState(false);
  const v2 = useIsV2();
  const spec = useMemo(() => JSON.stringify({ labels, series }), [labels, series]);

  useEffect(() => {
    let disposed = false;
    const onResize = () => chart.current?.resize();
    // 容器尺寸变化（例如侧栏宽度变化）时也要重算，不只是窗口尺寸变化
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
    if (!ready || !chart.current) return;
    const { labels: xs, series: ys } = JSON.parse(spec) as { labels: string[]; series: ChartSeries[] };
    chart.current.setOption(v2 ? optionV2(xs, ys) : optionV1(xs, ys), { notMerge: true });
  }, [spec, ready, v2]);

  return <div ref={el} className="chart" style={{ height: height ?? 180 }} data-testid={testId} />;
}
