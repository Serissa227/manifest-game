// 港口窗口的修整（西幻扩展第三批）：掌柜问候在计数为 0 时换成专门的说法（每种设施都覆盖），
// 酒馆里的高等级航海士按名声门槛禁用招募（与航海士窗口同一套字符串）。模拟的 Tauri IPC，不调用任何真实服务。
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import PortPanel from "../components/panels/PortPanel";
import {
  GREETING_COUNT,
  GREETING_COUNTS,
  greeting,
  greetingCounts,
  greetingKey,
  pickGreeting,
  type GreetingContext,
} from "../components/port/greeting";
import { tk } from "../i18n";
import { zhCN } from "../i18n/zh-CN";
import type { PortView } from "../ipc/types";
import { FACILITIES, useGame, type Facility } from "../store/game";
import { discoveriesView, installIpc, mate, overview, port, startedGame } from "./fixtures";

const TABLE = zhCN as Record<string, string>;

const ctx = (over: Partial<GreetingContext> = {}): GreetingContext => ({
  locKey: "novamar",
  port: "诺瓦马尔",
  faction: "埃斯佩兰王国",
  day: 0,
  season: 0,
  captain: "卡斯帕·布雷肖",
  view: port,
  ...over,
});

/** 所有计数都为 0 的港口：没有特产、没有走俏货、没有航海士、没有船厂、没有委托、没有期货交易所，仓库空、利率繁荣度声望都为 0。 */
const zeroPort: PortView = {
  ...port,
  market: port.market.map((r) => ({ ...r, specialty: false, popular: false })),
  mates_here: [],
  shipyard: [],
  contracts: [],
  exchange: null,
  warehouse: { rented: 0, owned: 0, capacity: 0, used: 0, stock: [] },
  invest: { ...port.invest, development: 0 },
  office: { ...port.office, reputation: 0 },
  bank: { ...port.bank, rate_bp: 0, deposit_rate_bp: 0 },
};

/** 连市场都空着的港口（上市货物数也为 0）。 */
const emptyMarket: PortView = { ...zeroPort, market: [] };

/** 文字里有没有单独的数字 0（“0 样”“0 位”“0%”“共 0”……）。 */
const ZERO = /(^|[^\d.,])0([^\d.,]|$)/;

/** 某地某设施挑中第 i 句常规问候的一天（按“地点 + 设施 + 日期”的哈希；用计数都不为 0 的 port 找）。 */
function dayFor(fac: Facility, index: number, locKey = "novamar"): number {
  for (let d = 0; d < 2000; d++) {
    if (greetingKey(fac, ctx({ day: d, locKey, view: port })) === `portGreet.${fac}.${index}`) return d;
  }
  throw new Error(`找不到 ${fac}.${index}`);
}

describe("掌柜问候：计数为 0 时换成专门的说法", () => {
  it("每种设施在各项计数都为 0 时，所有日子的问候都不说出“0”，占位符都已填好", () => {
    for (const view of [zeroPort, emptyMarket]) {
      for (const f of FACILITIES) {
        const keys = new Set<string>();
        for (let day = 0; day < 120; day++) {
          const key = greetingKey(f, ctx({ day, view }));
          keys.add(key);
          const text = greeting(f, ctx({ day, view }));
          expect(text, `${f} 第 ${day} 天：${text}`).not.toMatch(ZERO);
          expect(text).not.toMatch(/[{}]/);
          expect(text.startsWith("portGreet")).toBe(false);
        }
        // 挑中的每一句（含零值说法）里都没有值为 0 的计数占位符
        const counts = greetingCounts(f, view);
        for (const key of keys) {
          for (const name of GREETING_COUNTS) {
            if (counts[name] === 0) expect(TABLE[key], `${key} 含 {${name}}`).not.toContain(`{${name}}`);
          }
        }
      }
    }
  });

  it("整个设施空着时用设施的专门一句；句中计数为 0 时用这句的零值说法", () => {
    expect(greetingKey("tavern", ctx({ view: zeroPort }))).toBe("portGreet.tavern.nomate");
    expect(greetingKey("shipyard", ctx({ view: zeroPort }))).toBe("portGreet.shipyard.none");
    expect(greetingKey("guild", ctx({ view: zeroPort }))).toBe("portGreet.guild.none");
    expect(greetingKey("exchange", ctx({ view: zeroPort }))).toBe("portGreet.exchange.none");
    const zc = greetingCounts("market", emptyMarket);
    // 交易所四句带计数的问候各有零值说法；不带计数的第 4 句照常
    for (const i of [0, 1, 2, 3]) expect(pickGreeting(TABLE, "market", i, zc)).toBe(`portGreet.market.${i}.zero`);
    expect(pickGreeting(TABLE, "market", 4, zc)).toBe("portGreet.market.4");
    // 银行（利率）、仓库（仓位）、港口投资（繁荣度）、势力办事处（声望）
    expect(pickGreeting(TABLE, "bank", 0, greetingCounts("bank", zeroPort))).toBe("portGreet.bank.0.zero");
    expect(pickGreeting(TABLE, "bank", 2, greetingCounts("bank", zeroPort))).toBe("portGreet.bank.2.zero");
    expect(pickGreeting(TABLE, "warehouse", 2, greetingCounts("warehouse", zeroPort))).toBe("portGreet.warehouse.2.zero");
    expect(pickGreeting(TABLE, "invest", 0, greetingCounts("invest", zeroPort))).toBe("portGreet.invest.0.zero");
    expect(pickGreeting(TABLE, "office", 0, greetingCounts("office", zeroPort))).toBe("portGreet.office.0.zero");
    // 不带计数的句子不受影响
    expect(pickGreeting(TABLE, "office", 1, greetingCounts("office", zeroPort))).toBe("portGreet.office.1");
    // 每种设施的常规句都还在（零值说法是追加的，不占编号）
    for (const f of FACILITIES) for (let i = 0; i < GREETING_COUNT[f]; i++) expect(tk(`portGreet.${f}.${i}`)).not.toBe(`portGreet.${f}.${i}`);
  });

  it("只有为 0 的那一项才换：有走俏货时照常报数；仓库有仓位但空着、声望为负时各按实际说", () => {
    const hot: PortView = { ...port, market: port.market.map((r) => ({ ...r, popular: true })) };
    const cold: PortView = { ...port, market: port.market.map((r) => ({ ...r, popular: false })) };
    const d1 = dayFor("market", 1);
    expect(greeting("market", ctx({ day: d1, view: hot }))).toContain("眼下有 2 样货正走俏");
    expect(greetingKey("market", ctx({ day: d1, view: cold }))).toBe("portGreet.market.1.zero");
    expect(greeting("market", ctx({ day: d1, view: cold }))).toBe("眼下没有哪样货特别走俏，行情平稳，买卖都好商量。");

    const shelf = (used: number, capacity: number): PortView => ({ ...port, warehouse: { rented: capacity, owned: 0, capacity, used, stock: [] } });
    expect(pickGreeting(TABLE, "warehouse", 2, greetingCounts("warehouse", shelf(0, 200)))).toBe("portGreet.warehouse.2.zero");
    expect(pickGreeting(TABLE, "warehouse", 2, greetingCounts("warehouse", shelf(50, 200)))).toBe("portGreet.warehouse.2");
    const office = (reputation: number): PortView => ({ ...port, office: { ...port.office, reputation } });
    expect(pickGreeting(TABLE, "office", 0, greetingCounts("office", office(-5)))).toBe("portGreet.office.0");
    expect(pickGreeting(TABLE, "office", 0, greetingCounts("office", office(0)))).toBe("portGreet.office.0.zero");
  });

  it("删掉零值说法时，改用本设施下一句没有零计数的常规句；都有零计数时仍用原句", () => {
    const table: Record<string, string> = {
      "portGreet.market.0": "好货有 {specialty} 样",
      "portGreet.market.1": "走俏的有 {popular} 样",
      "portGreet.market.2": "欢迎光临",
      "portGreet.market.3": "一共 {count} 样",
      "portGreet.market.4": "进货出货都在这儿",
      "portGreet.market.3.zero": "牌子空着 {popular}",
    };
    const zero = { specialty: 0, popular: 0, count: 0 };
    expect(pickGreeting(table, "market", 0, zero)).toBe("portGreet.market.2");
    expect(pickGreeting(table, "market", 1, zero)).toBe("portGreet.market.2");
    // 零值说法本身也含为 0 的计数时不用它
    expect(pickGreeting(table, "market", 3, zero)).toBe("portGreet.market.4");
    expect(pickGreeting(table, "market", 0, { specialty: 3, popular: 0, count: 2 })).toBe("portGreet.market.0");
    const allZero: Record<string, string> = {
      "portGreet.bank.0": "{rate}",
      "portGreet.bank.1": "{rate}",
      "portGreet.bank.2": "{loanRate}",
      "portGreet.bank.3": "{rate}",
    };
    expect(pickGreeting(allZero, "bank", 1, { rate: 0, loanRate: 0 })).toBe("portGreet.bank.1");
  });

  it("港口窗口里：没有走俏货的那天，掌柜说的是零值说法（走查截图 02 的情形）", async () => {
    const cold: PortView = { ...port, market: port.market.map((r) => ({ ...r, popular: false })) };
    // 港口窗口的问候以地点 key（澄港 chenggang）为种子
    const day = dayFor("market", 1, "chenggang");
    installIpc({ port: () => cold });
    startedGame();
    useGame.setState({ overview: { ...overview, day } });
    render(<PortPanel />);
    const bubble = await screen.findByTestId("keeper-greeting");
    expect(bubble).toHaveTextContent("眼下没有哪样货特别走俏，行情平稳，买卖都好商量。");
    expect(bubble.textContent).not.toMatch(ZERO);
  });
});

describe("酒馆：高等级航海士的名声门槛", () => {
  const high = { ...mate, id: 5, name: "维达尔·霍尔姆斯特兰", level: 5, hire_cost: 6000 };
  const mid = { ...mate, id: 4, name: "海莉亚·瓦伊莫阿", level: 4, hire_cost: 4000 };
  let calls: ReturnType<typeof installIpc>;

  beforeEach(() => {
    calls = installIpc({ port: () => ({ ...port, mates_here: [high, mid, mate] }) });
    startedGame();
    useGame.setState({ facility: "tavern", overview: { ...overview, fame: 45 } });
  });

  it("名声不足时招募按钮禁用并写明需要多少、现有多少；够了可以招募；不需要名声的照旧", async () => {
    const user = userEvent.setup();
    render(<PortPanel />);
    // 5 级需要名声 60，现有 45（探险记录）
    const card5 = await screen.findByTestId("tavern-mate-5");
    await waitFor(() => expect(within(card5).getByTestId("tavern-fame-5")).toHaveTextContent("需名声 60"));
    expect(within(card5).getByTestId("tavern-fame-5")).toHaveClass("short");
    expect(within(card5).getByText("名声不足：需要 60，现有 45。到港口商会报告探险发现可以提升名声。")).toBeInTheDocument();
    expect(within(card5).getByRole("button", { name: "招募（6000 金币）" })).toBeDisabled();

    // 4 级需要名声 20：够了，可以招募
    const card4 = screen.getByTestId("tavern-mate-4");
    expect(within(card4).getByTestId("tavern-fame-4")).toHaveTextContent("需名声 20");
    expect(within(card4).getByTestId("tavern-fame-4")).not.toHaveClass("short");
    expect(within(card4).queryByText(/名声不足/)).toBeNull();
    await user.click(within(card4).getByRole("button", { name: "招募（4000 金币）" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { HireMate: { owner: "player", mate: 4 } } }));
    expect(calls).not.toHaveBeenCalledWith("submit", { command: { HireMate: { owner: "player", mate: 5 } } });

    // 2 级不需要名声：没有门槛牌，按钮可用
    const card1 = screen.getByTestId("tavern-mate-1");
    expect(within(card1).queryByTestId("tavern-fame-1")).toBeNull();
    expect(within(card1).getByRole("button", { name: "招募（1500 金币）" })).toBeEnabled();
    // 名声牌上的图标对辅助技术隐藏
    for (const c of within(card5).getByTestId("tavern-fame-5").querySelectorAll("canvas")) expect(c).toHaveAttribute("aria-hidden", "true");
  });

  it("名声达到门槛后解禁", async () => {
    installIpc({
      port: () => ({ ...port, mates_here: [high] }),
      discoveries: () => ({ ...discoveriesView, fame: 60 }),
    });
    render(<PortPanel />);
    const card5 = await screen.findByTestId("tavern-mate-5");
    await waitFor(() => expect(within(card5).getByTestId("tavern-fame-5")).not.toHaveClass("short"));
    expect(within(card5).getByRole("button", { name: "招募（6000 金币）" })).toBeEnabled();
  });
});
