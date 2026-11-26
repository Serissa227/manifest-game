// S02nF7：剧情弹窗的两件通病——几件事排着队时，答完一件先给它的结果、点了继续再出下一件；
// 读档 / 新开局 / 换世界以后，存档里带来的上一次结果（story.last）只记下、不当新的弹。
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import StoryDialog from "../components/story/StoryDialog";
import { bumpRequestSeq } from "../ipc/sequence";
import type { Overview, StoryEventView, StoryResultView, StoryView } from "../ipc/types";
import { useGame } from "../store/game";
import { captainStatics, installIpc, overview } from "./fixtures";

const ev = (key: string, title: string, queue: number): StoryEventView => ({
  day: 200,
  fleet: 0,
  kind: "request",
  key,
  story: title,
  title,
  text: "码头上有人等你。",
  speaker: { kind: "none", name: "" },
  choices: [{ key: "ok", text: "答应。", cost: 0 }],
  queue,
});

const res = (key: string, title: string, day = 200): StoryResultView => ({
  day,
  kind: "request",
  key,
  title,
  choice: "答应。",
  reply: `${title}的回应`,
  success: null,
  outcomes: [{ kind: "memory", value: 0, memory: "m_lisbon", title: "寄往里斯本的信" }],
  speaker: { kind: "none", name: "" },
  ended: false,
});

function withStory(story: Partial<StoryView>): Overview {
  return { ...overview, captain: { name: "澪", portrait: 3 }, story: { line: null, pending: null, last: null, journal: [], ...story } };
}

describe("排着队的几件事", () => {
  it("答完第一件、第二件已经等着：先显示第一件的回应与结果，点了继续才出第二件", async () => {
    installIpc();
    useGame.setState({ statics: captainStatics, overview: withStory({ pending: ev("a:c1", "信", 1) }) });
    render(<StoryDialog />);
    expect(screen.getByText("码头上有人等你。")).toBeInTheDocument();
    // 回应以后后端的概览：第一件的结果 + 排在后面的第二件
    act(() => useGame.setState({ overview: withStory({ pending: ev("b:c1", "骑士团", 0), last: res("a:c1", "信") }) }));
    const box = screen.getByTestId("story-result");
    expect(box).toHaveTextContent("信的回应");
    expect(box).toHaveTextContent("留下回忆：寄往里斯本的信");
    await userEvent.setup().click(screen.getByRole("button", { name: "继续" }));
    expect(screen.queryByTestId("story-result")).toBeNull();
    expect(screen.getAllByText("骑士团").length).toBeGreaterThan(0);
  });
});

describe("换局带进来的结果", () => {
  it("读档后头一份概览里的 story.last 不弹；之后变了才弹", () => {
    installIpc();
    useGame.setState({ statics: captainStatics, overview: withStory({}) });
    render(<StoryDialog />);
    act(() => {
      bumpRequestSeq("load");
      useGame.setState({ overview: withStory({ last: res("old:c1", "彭马克的灯", 150) }) });
    });
    expect(screen.queryByTestId("story-result")).toBeNull();
    act(() => useGame.setState({ overview: withStory({ last: res("new:c1", "漂来的木桶", 151) }) }));
    expect(screen.getByTestId("story-result")).toHaveTextContent("漂来的木桶的回应");
  });
});
