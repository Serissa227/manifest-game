// 迟到的旧概览不把界面拨回去；剧情对话框过时了（后端那边这件事已经处理掉）时，回应被拒之后重新取一次概览，
// 对话框合上、错误看得见；回音迟迟不来时对话框里说一声。
// 后两组测的是通用的机制（store/game.ts 的 submit 失败后 resync、shell/WaitingNote.tsx），载体是剧情对话框。
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { Messages } from "../components/shell/Feedback";
import StoryDialog from "../components/story/StoryDialog";
import type { Overview, StoryView } from "../ipc/types";
import { isStale, useGame } from "../store/game";
import { installIpc, overview, startedGame, statics } from "./fixtures";

const at = (epoch: number, rev: number, day: number): Overview => ({ ...overview, epoch, rev, day });

/** 一件等着回应的剧情事件（只有一个选项，选得了）。 */
const story: StoryView = {
  line: null,
  pending: {
    day: 30,
    fleet: 0,
    kind: "chapter",
    key: "first_bill",
    chapter: 2,
    total: 7,
    story: "盐与潮",
    title: "红蜡封的信",
    text: "信差递来一封盖着红蜡的信。",
    speaker: { kind: "portrait", asset: "keeper-mediterranean-bank-a", name: "佩德雷拉老爷" },
    choices: [{ text: "写信求他再宽限些日子。", cost: 0 }],
  },
  last: null,
  journal: [],
};

describe("概览的编号：迟到的旧概览丢掉", () => {
  beforeEach(() => {
    installIpc();
    startedGame();
    useGame.setState({ stamp: null });
  });

  it("同一个 epoch 里 rev 不比手上新的不放进来；换了 epoch（服务端重启）照常放进来；没有编号的旧后端照常", () => {
    const set = (o: Overview) => act(() => useGame.getState().setOverview(o));
    set(at(7, 5, 10));
    expect(useGame.getState().overview?.day).toBe(10);
    set(at(7, 4, 9));
    set(at(7, 5, 9));
    expect(useGame.getState().overview?.day).toBe(10);
    set(at(7, 6, 11));
    expect(useGame.getState().overview?.day).toBe(11);
    set(at(8, 1, 3));
    expect(useGame.getState().overview?.day).toBe(3);
    // 旧后端没有编号：照常放进来，也不影响之后有编号的比较
    set({ ...overview, day: 20 });
    expect(useGame.getState().overview?.day).toBe(20);
    expect(isStale(useGame.getState().stamp, at(8, 1, 2))).toBe(true);
  });

  it("回到开局画面后，迟到的旧概览不会把人拉回游戏", () => {
    act(() => useGame.getState().setOverview(at(3, 40, 12)));
    act(() => useGame.getState().leave());
    expect(useGame.getState().overview).toBeNull();
    act(() => useGame.getState().setOverview(at(3, 39, 11)));
    expect(useGame.getState().overview).toBeNull();
  });

  it("推送来的概览只在主界面里放进来：开局向导进行中（还没有概览）时不放，免得半途被拉进游戏", () => {
    act(() => useGame.setState({ overview: null }));
    act(() => useGame.getState().applyPushed(at(5, 1, 0)));
    expect(useGame.getState().overview).toBeNull();
    act(() => useGame.getState().setOverview(at(5, 2, 0)));
    act(() => useGame.getState().applyPushed(at(5, 3, 1)));
    expect(useGame.getState().overview?.day).toBe(1);
  });
});

describe("剧情对话框过时了：回应被拒之后重新取概览", () => {
  let calls: ReturnType<typeof installIpc>;
  beforeEach(() => {
    // 后端那边这件事已经处理掉了：回应被拒，重新取回来的概览里没有等着回应的事件
    calls = installIpc({
      submit: () => {
        throw "命令被拒绝：不满足条件：没有等待回应的剧情事件";
      },
      overview: () => ({ ...overview, epoch: 1, rev: 9, story: { ...story, pending: null } }),
    });
    startedGame();
    useGame.setState({
      statics,
      stamp: null,
      error: null,
      overview: { ...overview, epoch: 1, rev: 8, story },
    });
  });

  it("点选项被拒：对话框合上，错误提示显示出来", async () => {
    const user = userEvent.setup();
    render(
      <>
        <StoryDialog />
        <Messages />
      </>,
    );
    expect(screen.getByTestId("story-dialog")).toBeTruthy();
    await user.click(screen.getByTestId("story-choice-0"));
    await waitFor(() => expect(screen.queryByTestId("story-dialog")).toBeNull());
    expect(calls).toHaveBeenCalledWith("overview", {});
    expect(screen.getByRole("alert").textContent).toContain("没有等待回应的剧情事件");
  });
});

describe("回音迟迟不来时对话框里说一声", () => {
  it("点选项之后 0.7 秒还没回音：显示“正在等候回音”，按钮暂时不能再点", async () => {
    installIpc({ submit: () => new Promise(() => {}) });
    startedGame();
    useGame.setState({ statics, stamp: null, error: null, overview: { ...overview, story } });
    const user = userEvent.setup();
    render(<StoryDialog />);
    await user.click(screen.getByTestId("story-choice-0"));
    expect(screen.getByTestId("story-choice-0")).toBeDisabled();
    expect(screen.queryByTestId("waiting-note")).toBeNull();
    expect(await screen.findByTestId("waiting-note", {}, { timeout: 2000 })).toHaveTextContent("正在等候回音");
  });
});
