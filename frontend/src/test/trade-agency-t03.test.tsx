// T03 商馆代办的界面：仓库页的“代办”一栏（挂单、撤单、没成交的原因、成交记录）一次点击就提交；
// 没有商馆时写明要投资、一键去投资页；投资页写明下一级多几个挂单位 / 产业位；旧后端（没有 agency 字段）照旧。
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AgencyDesk from "../components/panels/AgencyDesk";
import { reserveFor } from "../components/panels/agencyKit";
import WarehouseTab from "../components/panels/WarehouseTab";
import { setLocale } from "../i18n/locale";
import type { AgencyView } from "../ipc/types";
import { useGame } from "../store/game";
import { installIpc, port, startedGame } from "./fixtures";

const agency: AgencyView = {
  slots: 2,
  used: 1,
  fee_pct: 2,
  per_level: 2,
  orders: [{ id: 7, good: 1, side: "buy", limit: 80, qty: 15, filled: 5, reserved: 1_300, placed: 40, waiting: "agency.price" }],
  fills: [{ day: 41, good: 1, side: "buy", qty: 5, total: 420, fee: 8 }],
  goods: [
    { good: 0, price: 12, tax_bp: 500, stock: 0 },
    { good: 1, price: 90, tax_bp: 500, stock: 30 },
  ],
};

describe("仓库页的代办一栏（T03）", () => {
  beforeEach(() => {
    setLocale("zh-CN");
    installIpc();
    startedGame();
  });

  it("挂单一次点击：买单按限价 × 件数 × (1 + 税率) + 代办费预留", async () => {
    const submit = vi.fn(() => Promise.resolve());
    useGame.setState({ submit } as never);
    render(<AgencyDesk loc={0} agency={agency} />);
    expect(screen.getByTestId("agency-slots")).toHaveTextContent("挂单 1 / 2 张");
    // 第一种货：谷物，现价 12；10 件 → 120 + 6 税 + 1 + 代办费 3
    expect(reserveFor(12, 10, 500, 2)).toBe(130);
    expect(screen.getByTestId("agency-cost")).toHaveTextContent("预留 130 金币");
    await userEvent.setup().click(screen.getByRole("button", { name: "挂单" }));
    expect(submit).toHaveBeenCalledWith({ PlaceOrder: { owner: "player", loc: 0, good: 0, side: "Buy", limit: 12, qty: 10 } });
  });

  it("挂着的单写出成交进度、预留金、没成交的原因；撤单一次点击", async () => {
    const submit = vi.fn(() => Promise.resolve());
    useGame.setState({ submit } as never);
    render(<AgencyDesk loc={0} agency={agency} />);
    const row = screen.getByTestId("agency-order-7");
    expect(row).toHaveTextContent("已成交 5 / 20 件");
    expect(row).toHaveTextContent("价格还没到");
    await userEvent.setup().click(within(row).getByRole("button", { name: "撤单" }));
    expect(submit).toHaveBeenCalledWith({ CancelOrder: { owner: "player", order: 7 } });
    expect(screen.getByTestId("agency-fills")).toHaveTextContent("买进");
  });

  it("卖单看仓库里的货：不够时挂不上", async () => {
    render(<AgencyDesk loc={0} agency={agency} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "卖单" }));
    expect(screen.getByTestId("agency-cost")).toHaveTextContent("仓库里只有 0 件");
    expect(screen.getByRole("button", { name: "挂单" })).toBeDisabled();
  });

  it("没有商馆时写明要投资，一键去投资页", async () => {
    render(<AgencyDesk loc={0} agency={{ ...agency, slots: 0, used: 0, orders: [] }} />);
    expect(screen.getByTestId("agency-no-house")).toHaveTextContent("1 级商馆 2 张");
    await userEvent.setup().click(screen.getByRole("button", { name: "去投资" }));
    expect(useGame.getState().facility).toBe("invest");
  });

  it("旧后端（没有 agency 字段）照旧没有这一栏；有时挂在装卸台下面", () => {
    const { unmount } = render(<WarehouseTab port={port} />);
    expect(screen.queryByTestId("agency")).toBeNull();
    unmount();
    render(<WarehouseTab port={{ ...port, warehouse: { ...port.warehouse, agency } }} />);
    expect(screen.getByTestId("agency")).toBeInTheDocument();
  });
});
