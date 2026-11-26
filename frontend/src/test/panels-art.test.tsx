// 面板的游戏化外观：主角与舰长头像、船只画面、航海士人物卡、海盗头目与海盗船、商队与情报的小图，
// 以及图表在羊皮纸底上的配色（模拟的 Tauri IPC；jsdom 没有画布，像素图只检查结构与替代文字）。
import { render, screen, waitFor, within } from "@testing-library/react";
import { init } from "echarts";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANIMAL_KINDS,
  INDUSTRY_KINDS,
  drawAnimal,
  drawGuard,
  drawIndustryIcon,
  drawSeaTile,
  drawSeal,
  drawTrendArrow,
  drawWindRose,
} from "../art/extras";
import { luma, rgba } from "../art/px";
import BattleDialog from "../components/BattleDialog";
import ForecastChart from "../components/analysis/ForecastChart";
import { LineChart } from "../components/Chart";
import CaravanPanel from "../components/panels/CaravanPanel";
import FleetPanel from "../components/panels/FleetPanel";
import IndustryPanel from "../components/panels/IndustryPanel";
import IntelPanel from "../components/panels/IntelPanel";
import MatesPanel from "../components/panels/MatesPanel";
import TacticalPanel from "../components/panels/TacticalPanel";
import { decimal } from "../i18n";
import { useGame } from "../store/game";
import { installIpc, overview, startedGame } from "./fixtures";

describe("舰队面板", () => {
  beforeEach(() => {
    installIpc();
    startedGame();
  });

  it("旗舰队顶部显示主角亲率与头像，船只有画面、耐久与状态条，担任舰长的航海士有头像", async () => {
    useGame.setState({
      overview: {
        ...overview,
        captain: { name: "沈青帆", portrait: 3 },
        fleets: [{ ...overview.fleets[0], cargo: [{ good: 1, qty: 5, avg_cost: 90 }] }],
      },
    });
    render(<FleetPanel />);
    const captain = screen.getByTestId("fleet-captain");
    expect(within(captain).getByText("船长 沈青帆 亲率")).toBeInTheDocument();
    expect(within(captain).getByRole("img", { name: "船长 沈青帆 的头像" })).toBeInTheDocument();
    expect(within(captain).getByText("旗舰队")).toBeInTheDocument();

    const scene = screen.getByTestId("fleet-ships-0");
    expect(within(scene).getByRole("img", { name: "舰队 #0 的船只：单桅帆船" })).toBeInTheDocument();
    const ships = screen.getByRole("list", { name: "船只" });
    expect(within(ships).getByText("单桅帆船")).toBeInTheDocument();
    expect(within(ships).getByText("耐久 60/60")).toBeInTheDocument();

    expect(screen.getByText("货舱 20/80")).toBeInTheDocument();
    expect(screen.getByText("粮 10（约 10 天）")).toBeInTheDocument();
    expect(screen.getByText("水 10（约 10 天）")).toBeInTheDocument();
    expect(screen.getByText("士气 80")).toBeInTheDocument();
    expect(screen.getByText("船员 12（8–20）")).toBeInTheDocument();
    expect(screen.getByText("丝绸 × 5")).toBeInTheDocument();

    // 开局航海士林海燕任舰队 #0 舰长
    expect(await screen.findByText("舰长 林海燕")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "航海士 林海燕 的头像" })).toBeInTheDocument();
    // 装饰图标不暴露给辅助技术：具名图片只有主角、舰长头像与船队画面
    expect(screen.getAllByRole("img").map((el) => el.getAttribute("aria-label"))).toEqual([
      "船长 沈青帆 的头像",
      "航海士 林海燕 的头像",
      "舰队 #0 的船只：单桅帆船",
    ]);
  });

  it("没有主角时用默认称呼", () => {
    render(<FleetPanel />);
    expect(screen.getByText("船主亲率")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "船长 船主 的头像" })).toBeInTheDocument();
    expect(screen.getByText("货舱空空如也")).toBeInTheDocument();
  });

  it("非旗舰队不显示主角亲率", () => {
    const second = { ...overview.fleets[0], id: 5 };
    useGame.setState({
      overview: { ...overview, captain: { name: "沈青帆", portrait: 1 }, fleets: [overview.fleets[0], second] },
      selectedFleet: 5,
    });
    render(<FleetPanel />);
    expect(screen.queryByTestId("fleet-captain")).toBeNull();
    expect(screen.getByTestId("fleet-ships-5")).toBeInTheDocument();
  });
});

describe("航海士人物卡", () => {
  beforeEach(() => {
    installIpc();
    startedGame();
  });

  it("已雇与可雇分组，卡片上有头像、等级、四项能力、职务徽记与薪水", async () => {
    render(<MatesPanel />);
    const card = await screen.findByTestId("mate-0");
    expect(within(card).getByRole("img", { name: "航海士 林海燕 的头像" })).toBeInTheDocument();
    expect(within(card).getByText("Lv2")).toBeInTheDocument();
    for (const label of ["航海", "交易", "战斗", "管理"]) expect(within(card).getByText(label)).toBeInTheDocument();
    expect(within(card).getByText("66")).toBeInTheDocument();
    expect(within(card).getByText("月薪 500 金币 · 忠诚 65")).toBeInTheDocument();
    expect(within(card).getByText("前任钱庄账房。")).toBeInTheDocument();

    const recruits = screen.getByRole("heading", { name: "各港酒馆的航海士" }).parentElement as HTMLElement;
    expect(within(recruits).getByText("周明远")).toBeInTheDocument();
    expect(within(recruits).getByRole("img", { name: "航海士 周明远 的头像" })).toBeInTheDocument();
    expect(within(recruits).getByText("雇金 1,500 金币")).toBeInTheDocument();
  });
});

describe("海战", () => {
  beforeEach(() => {
    installIpc();
    startedGame();
  });

  it("遭遇海盗对话框显示海盗头目头像与海盗船，按钮名不变", () => {
    useGame.setState({
      overview: { ...overview, pending_battles: [{ id: 4, fleet: 0, pirate_ships: 2, pirate_guns: 16, pirate_crew: 40 }] },
    });
    render(<BattleDialog />);
    const dialog = screen.getByRole("dialog", { name: "遭遇海盗！" });
    expect(within(dialog).getByRole("img", { name: /^海盗头目 / })).toBeInTheDocument();
    expect(within(dialog).getByRole("img", { name: "海盗船" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "自动结算" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "战术海战" })).toBeInTheDocument();
  });

  it("同一场遭遇的头目永远是同一个人", () => {
    const pending = [{ id: 9, fleet: 0, pirate_ships: 1, pirate_guns: 4, pirate_crew: 10 }];
    useGame.setState({ overview: { ...overview, pending_battles: pending } });
    const first = render(<BattleDialog />);
    const name = screen.getByRole("img", { name: /^海盗头目 / }).getAttribute("aria-label");
    first.unmount();
    render(<BattleDialog />);
    expect(screen.getByRole("img", { name: /^海盗头目 / }).getAttribute("aria-label")).toBe(name);
  });

  it("战术海战：单位与可达格仍可点击，转向按钮的箭头不改变按钮名", async () => {
    useGame.setState({ overview: { ...overview, tactical_battles: [4] } });
    render(<TacticalPanel />);
    expect(await screen.findByTestId("unit-0")).toBeInTheDocument();
    expect(screen.getByTestId("unit-1")).toBeInTheDocument();
    expect(screen.queryByTestId("unit-2")).toBeNull();
    expect(screen.getByTestId("hex--1-0")).toBeInTheDocument();
    expect(screen.getByTestId("hex--1--1")).toBeInTheDocument();
    for (const d of ["东", "东北", "西北", "西", "西南", "东南"]) {
      expect(screen.getByRole("button", { name: d })).toBeInTheDocument();
    }
  });
});

describe("商队、产业与情报", () => {
  beforeEach(() => {
    startedGame();
  });

  it("商队：驮畜说明与我的商队卡片", async () => {
    installIpc();
    useGame.setState({
      overview: {
        ...overview,
        caravans: [
          {
            id: 3,
            animal: 0,
            count: 7,
            guards: 2,
            at: 0,
            leg: null,
            dest: null,
            capacity: 140,
            cargo: [{ good: 0, qty: 30, avg_cost: 10 }],
            daily_cost: 29,
          },
        ],
      },
    });
    render(<CaravanPanel />);
    expect(screen.getByText("每头载 20 · 每日开销 3 金币")).toBeInTheDocument();
    expect(screen.getByText("驮载 30/140")).toBeInTheDocument();
    expect(screen.getByText("×7")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "解散" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("两地之间没有道路")).toBeInTheDocument());
  });

  it("产业：配方链带商品，停工有印记", async () => {
    installIpc({
      industries: () => ({
        industries: [
          {
            id: 0,
            loc: 0,
            kind: 0,
            recipe: 0,
            level: 2,
            manager: false,
            stalled: true,
            book_value: 5000,
            input_stock: [[0, 4]],
            daily_revenue: 90,
            daily_inputs: 24,
            daily_costs: 25,
            daily_profit: 41,
          },
        ],
        sites: [0],
      }),
    });
    render(<IndustryPanel />);
    expect(await screen.findByText("缺料停工")).toBeInTheDocument();
    expect(screen.getByText("谷物×4")).toBeInTheDocument();
    expect(screen.getAllByText("丝绸×1").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "雇佣管理人" })).toBeInTheDocument();
  });

  it("情报：新闻做成带来源与可信度的告示", async () => {
    installIpc({
      intel: () => ({
        news: [{ id: 1, day: 10, source: "tavern", credibility: 40, text: "听说柳湾的丝绸要涨价。" }],
        events: [{ name: "丝路节", description: "每年一度的集市。", start: 5, end: 20, place: ["澄港"] }],
        log: [],
        chronicles: [{ year: 0, text: "这一年风平浪静。" }],
      }),
    });
    render(<IntelPanel />);
    expect(await screen.findByText("【酒馆传言·可信度 40】听说柳湾的丝绸要涨价。")).toBeInTheDocument();
    expect(screen.getByText("丝路节（澄港）第 5–20 天")).toBeInTheDocument();
    expect(screen.getByText("1502年")).toBeInTheDocument();
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });
});

describe("图表配色", () => {
  it("图例、坐标轴与提示框在羊皮纸底上清晰可读（深色文字、浅色提示框）", async () => {
    vi.mocked(init).mockClear();
    render(<LineChart labels={["1", "2"]} series={[{ name: "总资产", data: [1, 2] }]} />);
    await waitFor(() => expect(init).toHaveBeenCalledTimes(1));
    const chart = vi.mocked(init).mock.results[0].value as { setOption: ReturnType<typeof vi.fn> };
    await waitFor(() => expect(chart.setOption).toHaveBeenCalledTimes(1));
    const opt = chart.setOption.mock.calls[0][0] as {
      legend: { textStyle: { color: string } };
      xAxis: { axisLabel: { color: string } };
      yAxis: { axisLabel: { color: string } };
      tooltip: { backgroundColor: string; textStyle: { color: string } };
      color: string[];
    };
    const dark = (c: string) => luma(rgba(c)) < 110;
    expect(dark(opt.legend.textStyle.color)).toBe(true);
    expect(dark(opt.xAxis.axisLabel.color)).toBe(true);
    expect(dark(opt.yAxis.axisLabel.color)).toBe(true);
    expect(dark(opt.tooltip.textStyle.color)).toBe(true);
    expect(luma(rgba(opt.tooltip.backgroundColor))).toBeGreaterThan(200);
    // 折线颜色在羊皮纸（明度约 200）上要有足够反差
    for (const c of opt.color) expect(luma(rgba(c))).toBeLessThan(150);
  });

  it("提示框的数值最多两位小数、空值写作“-”，提示框留在图表里面（不被窗口边框截掉）", async () => {
    expect(decimal(12.954841603910417)).toBe("12.95");
    expect(decimal(12)).toBe("12");
    expect(decimal(12.5)).toBe("12.5");
    expect(decimal(12_345.678)).toBe("12,345.68");
    expect(decimal(null)).toBe("-");
    expect(decimal(undefined)).toBe("-");
    expect(decimal(Number.NaN)).toBe("-");
    type Tip = { tooltip: { confine: boolean; valueFormatter: (v: unknown, i: number) => string } };
    const optionOf = async (ui: ReactElement) => {
      vi.mocked(init).mockClear();
      const { unmount } = render(ui);
      await waitFor(() => expect(init).toHaveBeenCalledTimes(1));
      const chart = vi.mocked(init).mock.results[0].value as { setOption: ReturnType<typeof vi.fn> };
      await waitFor(() => expect(chart.setOption).toHaveBeenCalledTimes(1));
      unmount();
      return chart.setOption.mock.calls[0][0] as Tip;
    };
    // 行情预测图：回看拟合是小数（图表库还会传入数据序号，不影响写法）
    const fc = await optionOf(<ForecastChart days={[100, 101]} actual={[12, 13]} fitted={[12.954841603910417, 12.5]} />);
    expect(fc.tooltip.confine).toBe(true);
    expect(fc.tooltip.valueFormatter(12.954841603910417, 0)).toBe("12.95");
    // 普通折线图同样（整数照旧：千分位、没有小数）
    const line = await optionOf(<LineChart labels={["1", "2"]} series={[{ name: "总资产", data: [12_345, 2] }]} />);
    expect(line.tooltip.confine).toBe(true);
    expect(line.tooltip.valueFormatter(12_345, 1)).toBe("12,345");
  });
});

describe("面板小图（art/extras）", () => {
  it("驮畜、产业图标、印章、罗盘都能画出且确定", () => {
    for (let i = 0; i < ANIMAL_KINDS; i++) {
      const a = drawAnimal(i);
      expect(a.bounds()).not.toBeNull();
      expect(a.h).toBeLessThanOrEqual(22);
      expect(a.w).toBeGreaterThanOrEqual(20);
      expect(Array.from(drawAnimal(i, 1).data)).not.toEqual(Array.from(a.data));
    }
    // 越界取模
    expect(drawAnimal(ANIMAL_KINDS)).toBe(drawAnimal(0));
    for (let i = 0; i < INDUSTRY_KINDS; i++) {
      const p = drawIndustryIcon(i);
      expect([p.w, p.h]).toEqual([24, 24]);
      expect(p.colorCount()).toBeLessThanOrEqual(24);
    }
    const seals = [90, 60, 30].map(drawSeal);
    expect(new Set(seals.map((s) => Array.from(s.data).join(","))).size).toBe(3);
    // 可信度越低，印泥剥落越多（不透明像素越少）
    const opaque = (v: number) => Array.from(drawSeal(v).data).filter((c) => (c & 0xff) === 0xff).length;
    expect(opaque(95)).toBeGreaterThan(opaque(30));
    const roses = [0, 1, 2, 3, 4, 5].map((d) => Array.from(drawWindRose(d).data).join(","));
    expect(new Set(roses).size).toBe(6);
    expect(drawWindRose(6)).toBe(drawWindRose(0));
    expect(drawGuard().bounds()).not.toBeNull();
    expect(drawTrendArrow("up")).not.toBe(drawTrendArrow("down"));
  });

  it("海面贴图不透明、用色克制（平铺时不漏底色）", () => {
    const tile = drawSeaTile(0);
    expect([tile.w, tile.h]).toEqual([32, 32]);
    // 全部不透明，平铺时不会漏出底色
    expect(Array.from(tile.data).every((c) => (c & 0xff) === 0xff)).toBe(true);
    expect(tile.colorCount()).toBeLessThanOrEqual(6);
  });
});

describe("探险日志与大事记的小图", () => {
  beforeEach(() => {
    startedGame();
  });

  it("探险窗口：种类图章、名声章与按钮图标都对辅助技术隐藏，按钮名称只有文字", async () => {
    const { default: ExplorePanel } = await import("../components/panels/ExplorePanel");
    const { colonialOverview, colonialStatics, discoveriesView } = await import("./fixtures");
    installIpc({ discoveries: () => ({ ...discoveriesView, total: 3 }) });
    useGame.setState({ statics: colonialStatics, overview: colonialOverview });
    render(<ExplorePanel />);
    const card = await screen.findByTestId("discovery-0");
    const panel = screen.getByTestId("explore-panel");
    const canvases = panel.querySelectorAll("canvas");
    // 发现物卡片与“？？？”各一枚图章、六类统计各一枚，另有标题、名声与若干小图标
    expect(canvases.length).toBeGreaterThanOrEqual(8);
    for (const c of canvases) expect(c).toHaveAttribute("aria-hidden", "true");
    expect(within(card).getByRole("button", { name: "向商会报告" })).toHaveAccessibleName("向商会报告");
    expect(screen.getByRole("button", { name: "全部" })).toHaveAccessibleName("全部");
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });

  it("航海士名声门槛的徽记图标对辅助技术隐藏", async () => {
    const { mate } = await import("./fixtures");
    installIpc({ mates: () => ({ hired: [], available: [{ ...mate, level: 5 }] }) });
    useGame.setState({ overview: { ...overview, fame: 0 } });
    render(<MatesPanel />);
    const badge = await screen.findByText("需名声 60");
    for (const c of badge.querySelectorAll("canvas")) expect(c).toHaveAttribute("aria-hidden", "true");
    expect(screen.getAllByRole("img").map((el) => el.getAttribute("aria-label"))).toEqual(["航海士 周明远 的头像"]);
  });
});
