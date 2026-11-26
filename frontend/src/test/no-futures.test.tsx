// 没有期货交易所的世界（寰宇）：命令栏不出“期货”，港口窗口不出“期货交易所”一页，原先停在这一页时落回交易所；
// 有交易所的世界（经典）照旧。
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PortPanel from "../components/panels/PortPanel";
import { commandTabs, hasFutures } from "../components/shell/shellState";
import { useGame } from "../store/game";
import { installIpc, overview, startedGame, statics } from "./fixtures";

describe("没有期货的世界", () => {
  it("命令栏：有交易所时有“期货”，没有时不出；旧数据没有这个字段时照旧", () => {
    expect(statics.exchanges.length).toBeGreaterThan(0);
    expect(commandTabs(overview, false, statics)).toContain("futures");
    expect(commandTabs(overview, false, { ...statics, exchanges: [] })).not.toContain("futures");
    expect(hasFutures(null)).toBe(true);
  });

  it("港口窗口：不出“期货交易所”一页；停在这一页时显示交易所", async () => {
    installIpc();
    startedGame();
    useGame.setState({ statics: { ...statics, exchanges: [] }, facility: "exchange" });
    render(<PortPanel />);
    const panel = await screen.findByTestId("port-panel");
    expect(within(panel).queryByRole("tab", { name: /期货交易所/ })).toBeNull();
    expect(within(panel).getByRole("tab", { name: /交易所/, selected: true })).toBeInTheDocument();
  });
});
