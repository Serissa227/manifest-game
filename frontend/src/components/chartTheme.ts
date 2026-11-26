// 新界面（v2）的图表配色（components/Chart.tsx 的折线图与 analysis/ForecastChart.tsx 的预测图共用）。
// 单独放一个文件：组件文件只导出组件（React 的快速刷新要求）。
/**
 * 新界面（v2，docs/UI-REDESIGN.md 第 3 节）的图表配色：画在纸面（--v2-paper-2）上——墨色文字、次要墨色的刻度、
 * 黄铜细线的坐标轴与很淡的网格；提示框是带圆角与柔和阴影的白纸条；折线取语义色（海蓝、印章红、深黄铜、绿、次要墨色），
 * 在纸面上的对比都在 4.5 : 1 以上。每个值都是 base.css 的一个令牌（画布里读不到 CSS 变量，所以写成色值，注释里是令牌名）。
 */
export const V2_CHART = {
  text: "#241c15", // --v2-ink
  muted: "#594938", // --v2-ink-2（刻度字 12 px，用次要墨色而不是说明色）
  axis: "#b39b72", // --v2-line-strong
  grid: "#e7dcc6", // --v2-paper-sunk（比 --v2-line 淡：网格只是参照）
  tooltipBg: "#fffdf8", // --v2-paper-2
  tooltipBorder: "#d9cbb0", // --v2-line
  // --v2-sea、--v2-seal、--v2-brass-ink、--v2-up、--v2-ink-2
  series: ["#1f5a8a", "#a3302a", "#7a5210", "#2b6a3b", "#594938"],
  font: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
  tooltipCss: "box-shadow: 0 6px 18px rgba(36, 28, 21, 0.18); border-radius: 5px;",
};

/** 半透明的同色渐变（折线下面的一层很淡的面积，只在只有一条线时画）。 */
export function fadeArea(color: string) {
  return {
    color: {
      type: "linear",
      x: 0,
      y: 0,
      x2: 0,
      y2: 1,
      colorStops: [
        { offset: 0, color: `${color}2e` },
        { offset: 1, color: `${color}00` },
      ],
    },
  };
}
