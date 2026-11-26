// 第九批养成的比赛与小游戏（UI-CONTRACT I6 追加）：参数的读取、配对的翻牌、节奏的判定、辩论的克制；
// 各小游戏只记录玩家的选择并提交 PlayContest；"按实力结算"只关掉对话框、不提交；养成主画面顶上列出可以比的比赛。
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import ContestDialog from "../components/contests/ContestDialog";
import {
  debateEdge,
  matchDone,
  matchFlip,
  matchPairs,
  matchParams,
  matchStart,
  nearestBeat,
  poemParams,
  rhythmGrade,
} from "../components/contests/contestKit";
import type { ContestView } from "../ipc/types";
import { useGame } from "../store/game";
import { installIpc, overview, statics } from "./fixtures";

const base = (
  kind: ContestView["kind"],
  params: Record<string, unknown>,
): ContestView => ({
  key: `c_${kind}`,
  name: "七夕的歌合",
  kind,
  seed: 7,
  params,
  rivals: [{ key: "yuki", name: "冷泉 雪", portrait: null }],
  auto_pct: 42,
});

describe("小游戏的纯逻辑", () => {
  it("配对：翻两张同面就配上，次数用完结束；输入按翻开的顺序记录", () => {
    const p = matchParams(
      base("match", {
        cols: 2,
        rows: 2,
        faces: ["松", "梅", "梅", "松"],
        flips: 3,
      }),
    );
    let s = matchStart(p);
    s = matchFlip(p, s, 0);
    s = matchFlip(p, s, 1);
    expect(matchPairs(s)).toBe(0);
    s = matchFlip(p, s, 0); // 已经翻开的不动
    s = matchFlip(p, s, 2);
    s = matchFlip(p, s, 1);
    expect(matchPairs(s)).toBe(1);
    s = matchFlip(p, s, 0);
    s = matchFlip(p, s, 3);
    expect(s.moves).toEqual([
      [0, 1],
      [2, 1],
      [0, 3],
    ]);
    expect(matchDone(p, s)).toBe(true);
  });

  it("节奏：最近的拍点与判定；辩论的克制；参数缺字段时给安全值", () => {
    expect(nearestBeat([500, 1000, 1500], 1040)).toEqual({ beat: 1, diff: 40 });
    expect(rhythmGrade(40, 150)).toBe("perfect");
    expect(rhythmGrade(120, 150)).toBe("good");
    expect(rhythmGrade(200, 150)).toBe("miss");
    expect(debateEdge([["example", "authority"]], "example", "authority")).toBe(
      1,
    );
    expect(debateEdge([["example", "authority"]], "authority", "example")).toBe(
      -1,
    );
    expect(debateEdge([], "a", "b")).toBe(0);
    expect(poemParams(base("poem", {}))).toEqual({
      theme: "",
      lines: [],
      hints: [],
    });
  });
});

describe("比赛对话框", () => {
  beforeEach(() => {
    useGame.setState({
      statics,
      overview,
      version: 1,
      error: null,
      message: null,
    });
  });

  it("作诗：每句挑一个词，吟出时提交选的下标", async () => {
    const user = userEvent.setup();
    const c = base("poem", {
      theme: "七夕",
      lines: [
        { prompt: "银河＿", options: ["流", "远"] },
        { prompt: "＿叶上", options: ["梶", "竹"] },
      ],
      hints: ["季语：梶叶"],
    });
    const calls = installIpc({ contest: () => c });
    let closed = false;
    render(<ContestDialog contest="c_poem" onClose={() => (closed = true)} />);
    await screen.findByText("题：七夕");
    expect(screen.getByRole("button", { name: "吟出" })).toBeDisabled();
    await user.click(
      within(screen.getByRole("radiogroup", { name: "第 1 句" })).getByRole(
        "radio",
        { name: "远" },
      ),
    );
    await user.click(
      within(screen.getByRole("radiogroup", { name: "第 2 句" })).getByRole(
        "radio",
        { name: "梶" },
      ),
    );
    expect(screen.getByText("银河远 / 梶叶上")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "吟出" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", {
        command: {
          PlayContest: { owner: "player", contest: "c_poem", moves: [1, 0] },
        },
      }),
    );
    await waitFor(() => expect(closed).toBe(true));
  });

  it("辩论：每回合出一张牌，克制的那张标绿；出完交卷", async () => {
    const user = userEvent.setup();
    const c = base("debate", {
      topic: "天下之大，能否绕而行之",
      rounds: [
        { opponent: { text: "古人未尝言之", kind: "authority" } },
        { opponent: { text: "海有尽头", kind: "logic" } },
      ],
      hand: [
        { key: "magellan", text: "已有人绕行一周", kind: "example" },
        { key: "eclipse", text: "月食时地影是圆的", kind: "logic" },
      ],
      beats: [["example", "authority"]],
    });
    const calls = installIpc({ contest: () => c });
    render(<ContestDialog contest="c_debate" onClose={() => {}} />);
    await user.click(
      await screen.findByRole("button", { name: /已有人绕行一周/ }),
    );
    expect(document.querySelector(".ct-edge1")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: /月食时地影是圆的/ }));
    await user.click(screen.getByRole("button", { name: "交卷" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", {
        command: {
          PlayContest: {
            owner: "player",
            contest: "c_debate",
            moves: ["magellan", "eclipse"],
          },
        },
      }),
    );
  });

  it("竞渡与辨识：逐程选走法；每个样品认一个答案", async () => {
    const user = userEvent.setup();
    const race = base("race", {
      legs: [
        {
          text: "出发",
          options: [
            { key: "shore", text: "贴岸", risk: 0 },
            { key: "wind", text: "抢风", risk: 2000 },
          ],
        },
      ],
    });
    const calls = installIpc({
      contest: (a) =>
        a.key === "c_race"
          ? race
          : base("identify", {
              samples: [{ key: "s1", clues: ["香气清冽", "回甘"] }],
              answers: [
                { key: "uji", name: "宇治" },
                { key: "toga", name: "栂尾" },
              ],
            }),
    });
    const { unmount } = render(
      <ContestDialog contest="c_race" onClose={() => {}} />,
    );
    expect(await screen.findByText("失败 20%")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /抢风/ }));
    await user.click(screen.getByRole("button", { name: "交卷" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", {
        command: {
          PlayContest: { owner: "player", contest: "c_race", moves: ["wind"] },
        },
      }),
    );
    unmount();
    render(<ContestDialog contest="c_identify" onClose={() => {}} />);
    await user.selectOptions(await screen.findByLabelText("样品 1"), "toga");
    await user.click(screen.getByRole("button", { name: "交卷" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", {
        command: {
          PlayContest: {
            owner: "player",
            contest: "c_identify",
            moves: ["toga"],
          },
        },
      }),
    );
  });

  it("按实力结算：只关掉，不提交", async () => {
    const user = userEvent.setup();
    const calls = installIpc({
      contest: () =>
        base("match", { cols: 2, rows: 1, faces: ["松", "松"], flips: 1 }),
    });
    let closed = false;
    render(<ContestDialog contest="c_match" onClose={() => (closed = true)} />);
    expect(await screen.findByText("按实力约 42% 能赢")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "按实力结算" }));
    expect(closed).toBe(true);
    expect(calls.mock.calls.some((c) => c[0] === "submit")).toBe(false);
  });
});

describe("U04：比赛报名", () => {
  it("要报名的比赛：按实力结算先替玩家报名，再关掉", async () => {
    const user = userEvent.setup();
    const calls = installIpc({
      contest: () => ({
        ...base("match", { cols: 2, rows: 1, faces: ["松", "松"], flips: 1 }),
        registered: false,
        can_register: true,
      }),
    });
    let closed = false;
    render(<ContestDialog contest="c_match" onClose={() => (closed = true)} />);
    expect(await screen.findByText("按实力约 42% 能赢")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "按实力结算" }));
    await waitFor(() => expect(closed).toBe(true));
    expect(calls).toHaveBeenCalledWith("submit", {
      command: {
        PlayContest: {
          owner: "player",
          contest: "c_match",
          moves: { register: true },
        },
      },
    });
  });

  it("已经报过名：按实力结算只关掉，不再提交", async () => {
    const user = userEvent.setup();
    const calls = installIpc({
      contest: () => ({
        ...base("match", { cols: 2, rows: 1, faces: ["松", "松"], flips: 1 }),
        registered: true,
        can_register: false,
      }),
    });
    let closed = false;
    render(<ContestDialog contest="c_match" onClose={() => (closed = true)} />);
    expect(await screen.findByText("按实力约 42% 能赢")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "按实力结算" }));
    expect(closed).toBe(true);
    expect(calls.mock.calls.some((c) => c[0] === "submit")).toBe(false);
  });
});
