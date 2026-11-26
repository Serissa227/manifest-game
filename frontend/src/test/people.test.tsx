// 第九批的人物页、关系图与任务日志（docs/UI-CONTRACT.md I5）：排序、关系图的布局、任务排序；
// 选人看详情、同在一处时交谈 / 送礼 / 招募、不在一处时按钮不出现；关系图只画后端给的关系；任务日志的期限与完成。
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import PeoplePanel from "../components/people/PeoplePanel";
import QuestsPanel from "../components/people/QuestsPanel";
import { circleLayout, sortPersons, sortTracks } from "../components/people/peopleKit";
import type { PersonCard, PersonDetail, RelationshipsView, TrackView } from "../ipc/types";
import { useGame } from "../store/game";
import { installIpc, overview, statics } from "./fixtures";

const person = (o: Partial<PersonCard> & Pick<PersonCard, "key" | "name">): PersonCard => ({
  portrait: null,
  age: 30,
  kind: "story",
  role: "",
  where: null,
  affinity: 20,
  heart: null,
  heart_stage: null,
  bond: null,
  relation: [],
  call_name: "船长",
  can_recruit: false,
  requests: 0,
  ...o,
});

const aishling = person({ key: "aishling", name: "艾希林·奥弗莱厄蒂", role: "奥弗莱厄蒂家的女儿", where: "戈尔韦 · 码头", affinity: 55, heart: 40, heart_stage: 2, bond: "B", relation: ["朋友"], can_recruit: true, requests: 1 });
const pieter = person({ key: "pieter", name: "彼得·范·德·费尔德", role: "年轻的制图师", affinity: 70 });
const detail = (here: boolean): PersonDetail => ({
  ...aishling,
  here,
  bio_pages: [{ title: "海上的女儿", text: "她的船叫……" }],
  likes_known: ["海图"],
  dislikes_known: [],
  birthday: [3, 17],
  days_to_birthday: 40,
  memories: ["你帮她把彼得找了回来。"],
  topics: [
    { key: "rumor", name: "打听传闻", enabled: true },
    { key: "request", name: "问请托", enabled: false, blocked_reason: "今天已经问过了" },
  ],
  gifts: [{ item: "chart_ireland", name: "爱尔兰的海图", qty: 1, reaction: "love" }],
  basis: "original",
  sources: ["奥弗莱厄蒂家（康诺特的海上氏族）"],
});

describe("人物与任务的纯逻辑", () => {
  it("按情谊排序（同情谊看心动），按名字排序，最近遇到照后端的顺序", () => {
    expect(sortPersons([aishling, pieter], "affinity").map((p) => p.key)).toEqual(["pieter", "aishling"]);
    expect(sortPersons([pieter, aishling], "recent").map((p) => p.key)).toEqual(["pieter", "aishling"]);
  });

  it("关系图：主角在圆心，人物等距排在圆周上，布局确定", () => {
    const rel: RelationshipsView = {
      nodes: [
        { key: "mio", name: "一条澪", portrait: null, kind: "protagonist" },
        { key: "b", name: "B", portrait: null, kind: "person" },
        { key: "a", name: "A", portrait: null, kind: "person" },
      ],
      edges: [],
    };
    const l = circleLayout(rel);
    expect(l.get("mio")).toEqual({ x: 0.5, y: 0.5 });
    expect(l.get("a")?.x).toBeCloseTo(0.5);
    expect(l.get("a")?.y).toBeCloseTo(0.12);
    expect(circleLayout(rel)).toEqual(l);
  });

  it("任务：进行中在前，有期限的按剩余天数", () => {
    const tr = (key: string, status: TrackView["status"], days: number | null): TrackView => ({
      key,
      name: key,
      kind: "request",
      status,
      chapter: "c1",
      chapter_title: "",
      objectives: [{ text: "", done: false, days_left: days }],
    });
    expect(sortTracks([tr("done", "done", null), tr("late", "active", 30), tr("soon", "active", 3), tr("wait", "waiting", null)]).map((x) => x.key)).toEqual(["soon", "late", "wait", "done"]);
  });
});

describe("人物页与任务日志", () => {
  beforeEach(() => {
    useGame.setState({ statics, overview, version: 1, error: null, message: null, selectedLoc: 0 });
  });

  it("选人看详情；同在一处时交谈、送礼、邀请；不能用的话题写明原因", async () => {
    const user = userEvent.setup();
    const calls = installIpc({ persons: () => ({ persons: [aishling, pieter] }), person: () => detail(true) });
    render(<PeoplePanel />);
    await user.click(await screen.findByTestId("person-aishling"));
    const d = await screen.findByTestId("person-detail");
    expect(d).toHaveTextContent("海上的女儿");
    expect(d).toHaveTextContent("你帮她把彼得找了回来。");
    expect(within(d).getByLabelText("心动")).toBeInTheDocument();
    await user.click(within(d).getByRole("button", { name: "打听传闻" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { Talk: { owner: "player", person: "aishling", topic: "rumor" } } }));
    expect(within(d).getByRole("button", { name: "问请托" })).toBeDisabled();
    await user.selectOptions(within(d).getByLabelText("送礼……"), "chart_ireland");
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { GiveItem: { owner: "player", person: "aishling", item: "chart_ireland", qty: 1 } } }));
    await user.click(within(d).getByRole("button", { name: "邀请加入" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { RecruitPerson: { owner: "player", person: "aishling" } } }));
  });

  it("AI 打开时的自由对话：写一句提交 TalkFree，回复与内核裁决的结果随概览推回；AI 关着时不出现", async () => {
    const user = userEvent.setup();
    const calls = installIpc({ persons: () => ({ persons: [aishling] }), person: () => ({ ...detail(true), chat: { enabled: true, left_today: 5 } }) });
    render(<PeoplePanel />);
    await user.click(await screen.findByTestId("person-aishling"));
    const d = await screen.findByTestId("person-detail");
    const box = within(d).getByRole("textbox", { name: "自由对话" });
    expect(d).toHaveTextContent("今天还能聊 5 句");
    await user.type(box, "你的船叫什么名字？");
    await user.click(within(d).getByRole("button", { name: "说" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { TalkFree: { owner: "player", person: "aishling", text: "你的船叫什么名字？" } } }));
    act(() =>
      useGame.getState().setOverview({
        ...overview,
        chat: {
          person: "aishling",
          seq: 2,
          turns: [
            { seq: 1, who: "you", text: "你的船叫什么名字？", status: "done", effects: [] },
            { seq: 2, who: "them", text: "「灰鹭号」。别笑。", status: "done", effects: [{ kind: "affinity", text: "情谊 +2" }] },
          ],
        },
      }),
    );
    expect(await within(d).findByText("「灰鹭号」。别笑。")).toBeInTheDocument();
    expect(d).toHaveTextContent("情谊 +2");
  });

  it("AI 关着（chat 为 null）或今天聊完了：没有输入框，或者输入框不可用并写明原因", async () => {
    const user = userEvent.setup();
    installIpc({ persons: () => ({ persons: [aishling] }), person: () => ({ ...detail(true), chat: { enabled: false, blocked_reason: "她在忙着装货", left_today: 0 } }) });
    render(<PeoplePanel />);
    await user.click(await screen.findByTestId("person-aishling"));
    const d = await screen.findByTestId("person-detail");
    const box = within(d).getByRole("textbox", { name: "自由对话" });
    expect(box).toBeDisabled();
    expect(box).toHaveAttribute("placeholder", "她在忙着装货");
  });

  it("不在一处时没有交谈与送礼，只写明靠港遇到时才能", async () => {
    const user = userEvent.setup();
    installIpc({ persons: () => ({ persons: [aishling] }), person: () => detail(false) });
    render(<PeoplePanel />);
    await user.click(await screen.findByTestId("person-aishling"));
    const d = await screen.findByTestId("person-detail");
    expect(within(d).queryByRole("button", { name: "打听传闻" })).not.toBeInTheDocument();
    expect(d).toHaveTextContent("不在同一处");
  });

  it("关系图只画后端给的关系；点人物回到详情", async () => {
    const user = userEvent.setup();
    const rel: RelationshipsView = {
      nodes: [
        { key: "mio", name: "一条澪", portrait: null, kind: "protagonist" },
        { key: "aishling", name: "艾希林", portrait: null, kind: "person" },
        { key: "pieter", name: "彼得", portrait: null, kind: "person" },
      ],
      edges: [{ a: "aishling", b: "pieter", kind: "lovers", label: "恋人" }],
    };
    const calls = installIpc({ persons: () => ({ persons: [aishling, pieter] }), relationships: () => rel, person: () => detail(true) });
    render(<PeoplePanel />);
    await screen.findByTestId("person-aishling");
    await user.click(screen.getByRole("tab", { name: "关系图" }));
    const graph = await screen.findByRole("img", { name: "人物之间的关系" });
    expect(graph.querySelectorAll(".pp-edge")).toHaveLength(1);
    expect(graph).toHaveTextContent("恋人");
    await user.click(within(graph).getByRole("button", { name: "艾希林" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("person", { key: "aishling" }));
  });

  it("任务日志：目标、地点与剩余天数，完成的默认收起", async () => {
    const user = userEvent.setup();
    const tracks: TrackView[] = [
      { key: "mio_main", name: "一条澪 · 主线", kind: "main", status: "active", chapter: "c3", chapter_title: "第三章 · 木津川口", objectives: [{ text: "把三百斤硝石送到堺", done: false, place: "堺", days_left: 6 }, { text: "见到鹰丸", done: true }] },
      { key: "old", name: "旧请托", kind: "request", status: "done", chapter: "c9", chapter_title: "完", objectives: [] },
    ];
    installIpc({ story_log: () => ({ tracks }) });
    render(<QuestsPanel />);
    const main = await screen.findByTestId("track-mio_main");
    expect(main).toHaveTextContent("把三百斤硝石送到堺");
    expect(within(main).getByText("还剩 6 天")).toHaveClass("is-urgent");
    expect(screen.queryByTestId("track-old")).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("也显示完成与失败的"));
    expect(screen.getByTestId("track-old")).toBeInTheDocument();
  });
});
