// 顶栏的时刻、当地天气与风（EXPANSION.md §9.3）：时刻文字与时段名、天况名、风名（去向 → 来向）、
// 悬停或聚焦显示未来两天预报；旧后端（没有 minute / local_weather）时优雅降级。概览为模拟数据。
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import TopBar from "../components/TopBar";
import {
  clockIcon,
  forecastDate,
  forecastLabel,
  isSkyKind,
  localWeather,
  normDir,
  periodName,
  skyIcon,
  skyName,
  windFrom,
  windText,
} from "../components/hudWeather";
import type { LocalWeatherView, Overview } from "../ipc/types";
import { useGame } from "../store/game";
import { installIpc, overview, startedGame } from "./fixtures";

/** 主角所在海区的天气：今天起雾、西风 4 级；明天暴风雨、后天多云。 */
const local: LocalWeatherView = {
  region: 0,
  region_name: "内海",
  sky: "fog",
  wind_dir: 2,
  wind_strength: 4,
  forecast: [
    { day: 13, sky: "storm", wind_dir: 5, wind_strength: 6 },
    { day: 14, sky: "cloudy", wind_dir: 0, wind_strength: 0 },
  ],
};

function show(patch: Partial<Overview>) {
  useGame.setState({ overview: { ...overview, ...patch } });
  return render(<TopBar />);
}

describe("顶栏的时刻与天气", () => {
  beforeEach(() => {
    installIpc();
    startedGame();
  });

  it("旧后端（没有 minute 与 local_weather）：日期照旧，时刻取 8:00（上午），不显示天气与风", () => {
    show({});
    expect(screen.getByTestId("date")).toHaveTextContent("1502年1月13日（春）");
    const clock = screen.getByTestId("clock");
    expect(clock).toHaveTextContent("08:00");
    expect(clock).toHaveTextContent("上午");
    expect(screen.queryByTestId("weather")).toBeNull();
    expect(screen.queryByTestId("wind")).toBeNull();
    expect(screen.queryByTestId("forecast")).toBeNull();
  });

  it("时刻文字与时段名随 minute 变化；日期元素的文字格式不变", () => {
    const { unmount } = show({ minute: 400 });
    expect(screen.getByTestId("clock")).toHaveTextContent("06:40");
    expect(screen.getByTestId("clock")).toHaveTextContent("黎明");
    expect(screen.getByTestId("clock")).toHaveAttribute("title", "时刻 06:40，黎明");
    expect(screen.getByTestId("date")).toHaveTextContent("1502年1月13日（春）");
    expect(screen.getByTestId("date")).not.toHaveTextContent("06:40");
    unmount();
    for (const [minute, text, period] of [
      [0, "00:00", "深夜"],
      [299, "04:59", "深夜"],
      [690, "11:30", "正午"],
      [900, "15:00", "下午"],
      [1080, "18:00", "黄昏"],
      [1305, "21:45", "夜晚"],
    ] as const) {
      const r = show({ minute });
      expect(screen.getByTestId("clock")).toHaveTextContent(text);
      expect(screen.getByTestId("clock")).toHaveTextContent(period);
      r.unmount();
    }
  });

  it("显示当地天况与风：wind_dir 是去向，风名取来向（吹向东 = 西风）", () => {
    show({ minute: 480, local_weather: local });
    expect(screen.getByTestId("weather")).toHaveTextContent("雾");
    expect(screen.getByTestId("wind")).toHaveTextContent("西风 4 级");
    // 天气组的可访问名称带上海区、天况与风
    expect(screen.getByRole("group", { name: /内海：雾，西风 4 级/ })).toBeInTheDocument();
  });

  it("悬停或聚焦天气时显示未来两天预报（天况、风向、风力），移开或失焦后收起", () => {
    show({ minute: 480, local_weather: local });
    const group = screen.getByRole("group", { name: /内海：雾/ });
    expect(screen.queryByTestId("forecast")).toBeNull();

    fireEvent.mouseEnter(group);
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveAttribute("data-testid", "forecast");
    expect(group).toHaveAttribute("aria-describedby", tip.id);
    expect(tip).toHaveTextContent("内海 · 未来两天");
    const days = within(tip).getAllByRole("listitem");
    expect(days).toHaveLength(2);
    // 明天：暴风雨（标红）、吹向西南 = 东北风 6 级
    expect(days[0]).toHaveTextContent("明天");
    expect(days[0]).toHaveTextContent("1月14日");
    expect(days[0]).toHaveTextContent("暴风雨");
    expect(days[0]).toHaveTextContent("东北风 6 级");
    expect(days[0]).toHaveClass("is-storm");
    // 后天：多云、无风
    expect(days[1]).toHaveTextContent("后天");
    expect(days[1]).toHaveTextContent("1月15日");
    expect(days[1]).toHaveTextContent("多云");
    expect(days[1]).toHaveTextContent("无风");
    expect(days[1]).not.toHaveClass("is-storm");

    fireEvent.mouseLeave(group);
    expect(screen.queryByRole("tooltip")).toBeNull();

    // 键盘聚焦同样展开，Esc 或失焦收起
    fireEvent.focus(group);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.keyDown(group, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(group);
    fireEvent.blur(group);
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(group).not.toHaveAttribute("aria-describedby");
  });

  it("没有预报时提示暂无预报；天况不认识或 local_weather 为空时不显示天气", () => {
    const r = show({ minute: 480, local_weather: { ...local, region_name: "", forecast: [] } });
    const group = screen.getByRole("group", { name: /当地：雾/ });
    fireEvent.mouseEnter(group);
    expect(screen.getByRole("tooltip")).toHaveTextContent("当地 · 未来两天");
    expect(screen.getByRole("tooltip")).toHaveTextContent("暂无预报");
    r.unmount();

    const r2 = show({ minute: 480, local_weather: { ...local, sky: "hail" as never } });
    expect(screen.queryByTestId("weather")).toBeNull();
    expect(screen.getByTestId("clock")).toHaveTextContent("08:00");
    r2.unmount();

    show({ minute: 480, local_weather: null });
    expect(screen.queryByTestId("weather")).toBeNull();
    expect(screen.queryByTestId("wind")).toBeNull();
  });
});

describe("顶栏时刻与天气的纯函数", () => {
  it("风名：八个去向依次对应的来向风名", () => {
    const names = ["南风", "西南风", "西风", "西北风", "北风", "东北风", "东风", "东南风"];
    for (let dir = 0; dir < 8; dir++) {
      expect(windFrom(dir)).toBe((dir + 4) % 8);
      expect(windText(dir, 3)).toBe(`${names[dir]} 3 级`);
    }
    // 取模与非法值
    expect(windText(10, 5)).toBe("西风 5 级");
    expect(windText(-1, 5)).toBe("东南风 5 级");
    expect(normDir(Number.NaN)).toBe(0);
    // 风力夹在 0–10，0 为无风
    expect(windText(2, 0)).toBe("无风");
    expect(windText(2, -3)).toBe("无风");
    expect(windText(2, 14)).toBe("西风 10 级");
  });

  it("时段名与日月图标：黎明与黄昏为半日，白天为太阳，夜晚为月亮", () => {
    expect(periodName(0)).toBe("深夜");
    expect(periodName(300)).toBe("黎明");
    expect(periodName(420)).toBe("上午");
    expect(periodName(660)).toBe("正午");
    expect(periodName(780)).toBe("下午");
    expect(periodName(1020)).toBe("黄昏");
    expect(periodName(1140)).toBe("夜晚");
    expect(clockIcon(360)).toBe("sun_half");
    expect(clockIcon(480)).toBe("sun");
    expect(clockIcon(1050)).toBe("sun_half");
    expect(clockIcon(1200)).toBe("moon");
    expect(clockIcon(120)).toBe("moon");
  });

  it("天况名与图标、预报的日子", () => {
    expect(["clear", "cloudy", "rain", "fog", "storm", "snow"].map((s) => (isSkyKind(s) ? skyName(s) : ""))).toEqual([
      "晴",
      "多云",
      "雨",
      "雾",
      "暴风雨",
      "雪",
    ]);
    expect(isSkyKind("hail")).toBe(false);
    expect(isSkyKind(3)).toBe(false);
    expect(skyIcon("storm")).toBe("sky_storm");
    expect(forecastLabel(12, 13)).toBe("明天");
    expect(forecastLabel(12, 14)).toBe("后天");
    expect(forecastLabel(12, 16)).toBe("4 天后");
    expect(forecastDate(13)).toBe("1月14日");
    expect(forecastDate(29)).toBe("1月30日");
    expect(forecastDate(30)).toBe("2月1日");
  });

  it("localWeather：只保留晚于今天、天况已知的预报，按日期排序，最多两天", () => {
    const w = localWeather({
      day: 12,
      local_weather: {
        ...local,
        forecast: [
          { day: 15, sky: "rain", wind_dir: 1, wind_strength: 2 },
          { day: 12, sky: "clear", wind_dir: 1, wind_strength: 2 },
          { day: 14, sky: "hail" as never, wind_dir: 1, wind_strength: 2 },
          { day: 13, sky: "snow", wind_dir: 1, wind_strength: 2 },
        ],
      },
    });
    expect(w?.forecast.map((d) => [d.day, d.sky])).toEqual([
      [13, "snow"],
      [15, "rain"],
    ]);
    expect(localWeather({ day: 12 })).toBeNull();
    expect(localWeather(null)).toBeNull();
    expect(localWeather({ day: 12, local_weather: { ...local, wind_dir: Number.NaN } })).toBeNull();
  });
});
