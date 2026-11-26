// T02 商馆的回报、风险与目标的界面：
// - 港口投资页一屏看全：上月分红与折合年收益、预计年收益率、被上限压住时的提示；遭劫的规则、照现在会折损多少、上次遭劫；
//   船厂的两个发展度台阶；本港投资者前五名；几档常用金额一点就投（“升到下一级”就是“补到下一级”那一档）；
// - 船厂页列出还没开造的船型与差多少发展度，一键去投资。
// 没有这些字段的旧后端与规则关闭的世界照旧（trade-house.test.tsx 不变）。
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ShipyardTab from "../components/panels/ShipyardTab";
import { HouseLadder } from "../components/port/House";
import { setLocale } from "../i18n/locale";
import type { HouseView, PortView } from "../ipc/types";
import { useGame } from "../store/game";
import { installIpc, port, startedGame } from "./fixtures";

const base: HouseView = {
  level: 1,
  max_level: 4,
  reputation: 5,
  goodwill: 15,
  rank_goodwill: [0, 10, 30, 60],
  top_rank: 1,
  levels: [
    { level: 0, cost: 0, goodwill: 0, tax_bp: 10_000, storage: 0, top_rank: 0 },
    { level: 1, cost: 5_000, goodwill: 10, tax_bp: 10_000, storage: 100, top_rank: 1 },
    { level: 2, cost: 15_000, goodwill: 25, tax_bp: 8_500, storage: 200, top_rank: 2 },
    { level: 3, cost: 45_000, goodwill: 45, tax_bp: 7_000, storage: 300, top_rank: 2 },
    { level: 4, cost: 135_000, goodwill: 70, tax_bp: 5_000, storage: 300, top_rank: 3 },
  ],
  next_cost: 10_000,
  ally_share_bp: 4_000,
  ally_house: 4,
  depth_bp: 12_880,
  depth_next_bp: 13_120,
  decay_months: 6,
};

const house: HouseView = {
  ...base,
  dividend: {
    yield_bp: 773,
    next_due: 32,
    last: 25,
    last_day: 60,
    last_yield_bp: 600,
    pool_due: 410,
    pool_paid: 320,
    cap: "purse",
    annual_pct: 6,
    hinterland_pct: 10,
  },
  risk: { loss_pct: 50, house_pct: 25, house_level: 3, exposure: 2_500, last_day: 20, last_loss: 2_500, last_total: 21_000 },
  yard_steps: [
    { development: 65, ships: [0], reached: false },
    { development: 80, ships: [], reached: false },
  ],
  investors: [
    { name: "海燕商会", me: false, amount: 48_000, level: 3 },
    { name: "玩家", me: true, amount: 5_000, level: 1 },
  ],
};

const invest = { ...port.invest, development: 62, mine: 5_000, share_bp: 9_000 };

describe("商馆：一屏看全的投资页（T02）", () => {
  beforeEach(() => {
    setLocale("zh-CN");
  });

  it("写出上月分红、预计年收益率与被上限压住的提示", () => {
    render(<HouseLadder invest={invest} house={house} cash={50_000} min={1_000} onInvest={() => undefined} shipName={() => "单桅帆船"} />);
    expect(screen.getByTestId("house-div-last")).toHaveTextContent("25 金币（折合年 6%）");
    expect(screen.getByTestId("house-div-yield")).toHaveTextContent("7.7%（年利 6% × 市场深度 ×1.29）");
    expect(screen.getByTestId("house-div-cap")).toHaveTextContent("城镇钱袋见底");
    expect(screen.getByTestId("house-div-cap")).toHaveTextContent("应得 410 金币，实分 320 金币");
  });

  it("写出遭劫的规则、照现在会折损多少与上次遭劫", () => {
    render(<HouseLadder invest={invest} house={house} cash={50_000} min={1_000} onInvest={() => undefined} />);
    const risk = screen.getByTestId("house-risk");
    expect(risk).toHaveTextContent("折损 50%；商馆到 3 级的只折 25%");
    expect(screen.getByTestId("house-risk-exposure")).toHaveTextContent("会折损 2,500 金币");
    expect(screen.getByTestId("house-risk-last")).toHaveTextContent("上次遭劫：第 20 天，你折损 2,500 金币，各家合计 21,000 金币");
  });

  it("船厂的台阶写出差几点与开造的船；投资者排名标出你自己", () => {
    render(<HouseLadder invest={invest} house={house} cash={50_000} min={1_000} onInvest={() => undefined} shipName={() => "单桅帆船"} />);
    expect(screen.getByTestId("house-yard-65")).toHaveTextContent("发展度 65 还差 3 点 开造：单桅帆船");
    expect(screen.getByTestId("house-yard-80")).toHaveTextContent("还差 18 点");
    const rows = within(screen.getByTestId("house-investors")).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("海燕商会48,0003 级");
    expect(rows[1]).toHaveClass("is-me");
    expect(rows[1]).toHaveTextContent("你");
  });

  it("几档常用金额一点就投；钱不够的灰掉；“升到下一级”仍是补到下一级那一档", async () => {
    const onInvest = vi.fn();
    const user = userEvent.setup();
    render(<HouseLadder invest={invest} house={house} cash={8_000} min={1_000} onInvest={onInvest} />);
    const quick = screen.getByTestId("house-quick");
    await user.click(within(quick).getByRole("button", { name: "投 5,000" }));
    expect(onInvest).toHaveBeenCalledWith(5_000);
    expect(within(quick).getByRole("button", { name: "投 20,000" })).toBeDisabled();
    // 补到下一级的那一档（10,000）现金不够，灰掉并写明差多少
    expect(screen.getByRole("button", { name: "升到 2 级（10,000 金币）" })).toBeDisabled();
    expect(screen.getByTestId("house-short")).toHaveTextContent("还差 2,000 金币");
  });

  it("没有 T02 字段（旧后端、规则关闭）时只有阶梯，不出右栏", () => {
    render(<HouseLadder invest={invest} house={base} cash={50_000} min={1_000} onInvest={() => undefined} />);
    expect(screen.queryByTestId("house-dividend")).toBeNull();
    expect(screen.queryByTestId("house-risk")).toBeNull();
    expect(screen.queryByTestId("house-investors")).toBeNull();
    expect(screen.getByTestId("house")).not.toHaveClass("house-t02");
  });
});

describe("商馆：下一级多几个挂单位 / 产业位（T03）", () => {
  beforeEach(() => {
    setLocale("zh-CN");
  });

  it("写出现在与下一级的挂单位、产业位与已用几处；没有这个字段时不写", () => {
    const withAgency: HouseView = { ...base, agency: { orders: 2, orders_next: 4, industry: 1, industry_next: 2, industries: 1 } };
    const { unmount } = render(<HouseLadder invest={invest} house={withAgency} cash={50_000} min={1_000} onInvest={() => undefined} />);
    expect(screen.getByTestId("house-agency-orders")).toHaveTextContent("2 张，下一级 4 张");
    expect(screen.getByTestId("house-agency-industry")).toHaveTextContent("1 处（已用 1），下一级 2 处");
    expect(screen.getByTestId("house-agency-next")).toHaveTextContent("升一级：代办挂单位 2 → 4 张，产业位 1 → 2 处");
    unmount();
    render(<HouseLadder invest={invest} house={base} cash={50_000} min={1_000} onInvest={() => undefined} />);
    expect(screen.queryByTestId("house-agency-orders")).toBeNull();
  });
});

describe("船厂：还没开造的船（T02）", () => {
  beforeEach(() => {
    setLocale("zh-CN");
    installIpc();
    startedGame();
  });

  it("列出差多少发展度，一键去投资", async () => {
    const soon: PortView = { ...port, shipyard: [], shipyard_upcoming: [{ ship: 0, development: 65 }], invest };
    useGame.setState({ facility: "shipyard" });
    render(<ShipyardTab port={soon} />);
    const row = screen.getByTestId("sy-soon-0");
    expect(row).toHaveTextContent("单桅帆船");
    expect(row).toHaveTextContent("发展度到 65 开造（现在 62）");
    await userEvent.setup().click(within(row).getByRole("button", { name: "去投资" }));
    expect(useGame.getState().facility).toBe("invest");
  });

  it("没有这一栏的旧后端照旧", () => {
    render(<ShipyardTab port={port} />);
    expect(screen.queryByTestId("sy-soon")).toBeNull();
  });
});
