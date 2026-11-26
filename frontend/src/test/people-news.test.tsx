// 第九批 I5b（docs/UI-CONTRACT.md）：配角之间的线——见闻簿的排序与筛选、打开时把没读过的提交 MarkNewsRead、
// 人物详情的“人际”与“近况”（点对方看对方、回到原来那位）、命令栏的小红点、旁观的一幕（台上的配角并排、说话的那位亮着、
// 没有选项时只有“继续”），以及旧后端（没有这些字段、gossip 统一拒绝）时界面与以前一样。
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import CommandBar from "../components/CommandBar";
import PeoplePanel from "../components/people/PeoplePanel";
import { peopleIndex, sortNews, unreadIds } from "../components/people/peopleKit";
import { tabAlert } from "../components/shell/shellState";
import StoryDialog from "../components/story/StoryDialog";
import { castSpeaker, outcomeText, useStoryUi } from "../components/story/storyKit";
import { setLocale } from "../i18n/locale";
import type { Command, GossipView, NewsItem, Overview, PersonCard, PersonDetail, StoryCastView, StoryChoiceView, StoryView } from "../ipc/types";
import type { Tab } from "../store/game";
import { useGame } from "../store/game";
import { installIpc, overview, statics } from "./fixtures";
import { PHONE, mockViewport, resetViewport } from "./viewport";

const person = (o: Partial<PersonCard> & Pick<PersonCard, "key" | "name">): PersonCard => ({
  portrait: null,
  age: 24,
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

const ines = person({ key: "ines_costa", name: "伊内丝·达·科斯塔", portrait: "t16-ines_costa-24", role: "新基督徒书记的女儿", where: "安特卫普 · 诗社", affinity: 60 });
const sophie = person({ key: "sophie_lemaire", name: "索菲·勒梅尔", portrait: "t16-sophie_lemaire-24", role: "里尔来的难民", affinity: 40 });
const mathijs = person({ key: "mathijs", name: "马蒂斯·佩特斯", portrait: "t16-mathijs-24", role: "修辞会的诗人", affinity: 30 });

const news = (o: Partial<NewsItem> & Pick<NewsItem, "id" | "day">): NewsItem => ({
  text: "",
  persons: [],
  kind: "heard",
  place: null,
  read: true,
  ...o,
});

// 后端给的顺序故意打乱：见闻簿按事情发生的日子排，晚的在前
const n1 = news({ id: "ines_sophie:c1", day: [1564, 3, 2], text: "诗社的两位社员在码头吵了一架，又一起去了印书坊。", persons: ["ines_costa", "sophie_lemaire"], kind: "seen", place: "安特卫普", track_name: "伊内丝与索菲", read: true });
const n2 = news({ id: "ines_sophie:c3", day: [1566, 8, 19], text: "圣像破坏的前夜，伊内丝把家里的船票给了索菲。", persons: ["ines_costa", "sophie_lemaire"], kind: "letter", place: "安特卫普", track_name: "伊内丝与索菲", read: false });
const n3 = news({ id: "mathijs_jan:c2", day: [1565, 1, 10], text: "听说修辞会那出戏，是写给印书坊的扬的。", persons: ["mathijs", "jan"], kind: "heard", place: "布鲁日", read: false });
const n4 = news({ id: "ines_sophie:c2", day: [1564, 3, 2], text: "同一天的另一件事：她们约好下个月再见。", persons: ["sophie_lemaire"], kind: "heard", read: true });
const book: GossipView = { items: [n1, n2, n3, n4], unread: 2 };

const detailOf = (p: PersonCard, extra: Partial<PersonDetail> = {}): PersonDetail => ({
  ...p,
  here: false,
  bio_pages: [],
  likes_known: [],
  dislikes_known: [],
  birthday: null,
  days_to_birthday: null,
  memories: [],
  topics: [],
  gifts: [],
  ...extra,
});

const inesDetail = detailOf(ines, {
  ties: [
    { person: "sophie_lemaire", name: "索菲·勒梅尔", portrait: "t16-sophie_lemaire-24", kind: "crush", label: "在意的人", since: [1563, 9, 1], tags: ["GL"] },
    { person: "mathijs", name: "马蒂斯·佩特斯", portrait: "t16-mathijs-24", kind: "friends", label: "诗社的朋友" },
  ],
  news: [n1, n2],
});
const sophieDetail = detailOf(sophie, { ties: [{ person: "ines_costa", name: "伊内丝·达·科斯塔", portrait: "t16-ines_costa-24", kind: "crush", label: "在意的人", tags: ["GL"] }], news: [n4] });

const withStory = (story: Partial<StoryView> | null): Overview => ({
  ...overview,
  story: story ? { line: null, pending: null, last: null, journal: [], ...story } : undefined,
});

/** 旧后端：gossip 统一拒绝。 */
const rejected = () => {
  throw "这个世界还没有这项功能";
};

function submitted(calls: ReturnType<typeof installIpc>): Command[] {
  return calls.mock.calls.filter(([c]) => c === "submit").map(([, a]) => a.command as Command);
}

beforeEach(() => {
  setLocale("zh-CN");
  useGame.setState({ statics, overview: withStory({ news_unread: 2 }), version: 1, error: null, message: null, selectedLoc: 0 });
});
afterEach(() => {
  useStoryUi.setState({ dismissed: "", panel: false, sideCast: null });
  resetViewport();
});

describe("见闻的纯逻辑", () => {
  it("排序：日子晚的在前，同一天的照后端的顺序；没读过的 id；人物索引由认识的人与人际合成", () => {
    expect(sortNews(book.items).map((x) => x.id)).toEqual(["ines_sophie:c3", "mathijs_jan:c2", "ines_sophie:c1", "ines_sophie:c2"]);
    expect(unreadIds(book.items)).toEqual(["ines_sophie:c3", "mathijs_jan:c2"]);
    const idx = peopleIndex([ines], inesDetail);
    expect(idx.get("ines_costa")?.name).toBe("伊内丝·达·科斯塔");
    expect(idx.get("sophie_lemaire")?.portrait).toBe("t16-sophie_lemaire-24");
    expect(idx.has("jan")).toBe(false);
  });

  it("命令栏的小红点只看 news_unread；旧后端没有这个字段时为 0", () => {
    expect(tabAlert(withStory({ news_unread: 3 }), "people")).toBe(3);
    expect(tabAlert(withStory({ news_unread: 3 }), "port")).toBe(0);
    expect(tabAlert(withStory({}), "people")).toBe(0);
    expect(tabAlert(overview, "people")).toBe(0);
  });

  it("台上说话的那位：按人物 key，其次头像与名字；旁白与主角不加亮", () => {
    const cast: StoryCastView[] = [
      { person: "ines_costa", name: "伊内丝", portrait: "t16-ines_costa-24" },
      { person: "sophie_lemaire", name: "索菲", portrait: "t16-sophie_lemaire-24" },
    ];
    expect(castSpeaker(cast, { kind: "portrait", person: "sophie_lemaire", name: "索菲" })).toBe(1);
    expect(castSpeaker(cast, { kind: "portrait", asset: "t16-ines_costa-24", name: "" })).toBe(0);
    expect(castSpeaker(cast, { kind: "portrait", name: "索菲" })).toBe(1);
    expect(castSpeaker(cast, { kind: "none", name: "" })).toBe(-1);
    expect(castSpeaker(cast, { kind: "captain", name: "" })).toBe(-1);
    expect(outcomeText({ kind: "news", value: 0, text: "她们约好下个月再见。", persons: ["ines_costa"] }, statics)).toBe("记进了见闻簿：她们约好下个月再见。");
  });
});

describe("见闻簿", () => {
  it("“见闻”一页带未读数；最近的在前，三种来源用不同的小图标，涉及的人画成小头像；打开时把没读过的提交一次 MarkNewsRead", async () => {
    const user = userEvent.setup();
    let read = false;
    const calls = installIpc({
      persons: () => ({ persons: [ines, sophie, mathijs] }),
      gossip: () => (read ? { items: book.items.map((x) => ({ ...x, read: true })), unread: 0 } : book),
      submit: (a) => {
        if ("MarkNewsRead" in (a.command as Command)) read = true;
        return { outcome: "Done", overview: withStory({ news_unread: 0 }) };
      },
    });
    render(<PeoplePanel />);
    const tab = await screen.findByRole("tab", { name: "见闻" });
    expect(tab).toHaveTextContent("2");
    expect(tab).toHaveAttribute("title", "2 条没读过");
    await user.click(tab);
    const bookEl = await screen.findByTestId("news-book");
    await within(bookEl).findByTestId("news-ines_sophie:c3");
    const items = within(bookEl).getAllByRole("listitem");
    expect(items.map((li) => li.dataset.testid)).toEqual(["news-ines_sophie:c3", "news-mathijs_jan:c2", "news-ines_sophie:c1", "news-ines_sophie:c2"]);
    // 来源的小图标（亲眼看到 / 听说 / 信里写的）、日子、地点、哪条线
    expect(within(items[0]).getByRole("img", { name: "信里写的" })).toBeInTheDocument();
    expect(within(items[1]).getByRole("img", { name: "听说" })).toBeInTheDocument();
    expect(within(items[2]).getByRole("img", { name: "亲眼看到" })).toBeInTheDocument();
    expect(items[0]).toHaveTextContent("1566 年 8 月 19 日");
    expect(items[0]).toHaveTextContent("安特卫普");
    expect(items[0]).toHaveTextContent("伊内丝与索菲");
    // 涉及的人：认识的可以点，不认识的（扬）只画占位脸
    expect(within(items[0]).getByRole("button", { name: "看看伊内丝·达·科斯塔" })).toBeInTheDocument();
    expect(within(items[1]).getByRole("button", { name: "看看马蒂斯·佩特斯" })).toBeInTheDocument();
    expect(within(items[1]).getAllByRole("button")).toHaveLength(1);
    // 没读过的两条带小点，提交一次 MarkNewsRead（按显示的顺序）
    expect(within(items[0]).getByRole("img", { name: "没读过" })).toBeInTheDocument();
    expect(within(items[2]).queryByRole("img", { name: "没读过" })).toBeNull();
    await waitFor(() => expect(submitted(calls)).toEqual([{ MarkNewsRead: { owner: "player", ids: ["ines_sophie:c3", "mathijs_jan:c2"] } }]));
    // 标为已读、重新取回之后：这一次打开期间小点还在，也不再重复提交；未读数跟着概览变成 0
    await waitFor(() => expect(calls.mock.calls.filter(([c]) => c === "gossip").length).toBeGreaterThanOrEqual(2));
    expect(within(screen.getByTestId("news-ines_sophie:c3")).getByRole("img", { name: "没读过" })).toBeInTheDocument();
    expect(submitted(calls)).toHaveLength(1);
    expect(screen.getByRole("tab", { name: "见闻" })).not.toHaveTextContent(/\d/);
  });

  it("只看当前港口：按所选的港口问 gossip（loc）；那里没有见闻时写明", async () => {
    const user = userEvent.setup();
    const calls = installIpc({
      persons: () => ({ persons: [ines] }),
      gossip: (a) => (a.loc === 0 ? { items: [], unread: 0 } : book),
    });
    render(<PeoplePanel />);
    await user.click(await screen.findByRole("tab", { name: "见闻" }));
    await screen.findByTestId("news-ines_sophie:c3");
    expect(calls).toHaveBeenCalledWith("gossip", { loc: null, limit: null });
    await user.click(screen.getByRole("checkbox", { name: "只看澄港的" }));
    expect(await screen.findByText("这里还没有什么见闻。")).toBeInTheDocument();
    expect(calls).toHaveBeenCalledWith("gossip", { loc: 0, limit: null });
    await user.click(screen.getByRole("checkbox", { name: "只看澄港的" }));
    expect(await screen.findByTestId("news-ines_sophie:c3")).toBeInTheDocument();
  });

  it("点见闻里的头像：回到“见过的人”，看那一位的详情", async () => {
    const user = userEvent.setup();
    const calls = installIpc({
      persons: () => ({ persons: [ines, sophie, mathijs] }),
      gossip: () => book,
      person: (a) => (a.key === "mathijs" ? detailOf(mathijs) : inesDetail),
    });
    render(<PeoplePanel />);
    await user.click(await screen.findByRole("tab", { name: "见闻" }));
    const line = await screen.findByTestId("news-mathijs_jan:c2");
    await user.click(within(line).getByRole("button", { name: "看看马蒂斯·佩特斯" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("person", { key: "mathijs" }));
    expect(screen.getByRole("tab", { name: "见过的人" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("article", { name: "马蒂斯·佩特斯" })).toBeInTheDocument();
    // 从见闻簿跳过来的没有“回到”
    expect(screen.queryByTestId("person-back")).toBeNull();
  });
});

describe("人物详情：人际与近况", () => {
  it("人际写对方的头像、名字、关系名与自何时（GL / BL 只是一个不带字的小色点）；近况最近的在前；点对方看对方，再回到原来那位", async () => {
    const user = userEvent.setup();
    const calls = installIpc({
      persons: () => ({ persons: [ines, sophie, mathijs] }),
      gossip: () => book,
      person: (a) => (a.key === "sophie_lemaire" ? sophieDetail : inesDetail),
    });
    render(<PeoplePanel />);
    await user.click(await screen.findByTestId("person-ines_costa"));
    const d = await screen.findByRole("article", { name: "伊内丝·达·科斯塔" });
    const ties = within(d).getByTestId("person-ties");
    expect(within(ties).getByRole("heading", { name: "人际" })).toBeInTheDocument();
    const toSophie = within(ties).getByTestId("tie-sophie_lemaire");
    expect(toSophie).toHaveTextContent("索菲·勒梅尔");
    expect(toSophie).toHaveTextContent("在意的人");
    expect(toSophie).toHaveTextContent("自 1563 年 9 月 1 日");
    expect(toSophie.querySelector(".pp-tie-dot")).toHaveAttribute("data-tag", "GL");
    expect(ties).not.toHaveTextContent("GL");
    expect(within(ties).getByTestId("tie-mathijs").querySelector(".pp-tie-dot")).toBeNull();
    // 近况：这位的见闻，最近的在前
    const recent = within(d).getByTestId("person-news");
    expect(within(recent).getByRole("heading", { name: "近况" })).toBeInTheDocument();
    expect(within(recent).getAllByRole("listitem").map((li) => li.dataset.testid)).toEqual(["news-ines_sophie:c3", "news-ines_sophie:c1"]);
    // 点对方：看对方的详情，顶上有“回到伊内丝”
    await user.click(toSophie);
    await waitFor(() => expect(calls).toHaveBeenCalledWith("person", { key: "sophie_lemaire" }));
    const s = await screen.findByRole("article", { name: "索菲·勒梅尔" });
    expect(within(s).getByTestId("tie-ines_costa")).toBeInTheDocument();
    await user.click(within(s).getByRole("button", { name: "回到伊内丝·达·科斯塔" }));
    expect(await screen.findByRole("article", { name: "伊内丝·达·科斯塔" })).toBeInTheDocument();
    expect(screen.queryByTestId("person-back")).toBeNull();
    // 详情里看近况不算“打开见闻簿”：不提交已读
    expect(submitted(calls)).toEqual([]);
  });

  it("跳到一位还看不到详情的人：写明，留着回去的路", async () => {
    const user = userEvent.setup();
    installIpc({
      persons: () => ({ persons: [ines] }),
      gossip: () => book,
      person: (a) => {
        if (a.key === "mathijs") throw "没见过这个人";
        return inesDetail;
      },
    });
    render(<PeoplePanel />);
    await user.click(await screen.findByTestId("person-ines_costa"));
    const d = await screen.findByRole("article", { name: "伊内丝·达·科斯塔" });
    await user.click(within(d).getByTestId("tie-mathijs"));
    const missing = await screen.findByTestId("person-missing");
    expect(missing).toHaveTextContent("还看不到这位的详情。");
    await user.click(within(missing).getByRole("button", { name: "回到伊内丝·达·科斯塔" }));
    expect(await screen.findByRole("article", { name: "伊内丝·达·科斯塔" })).toBeInTheDocument();
  });
});

describe("命令栏的小红点", () => {
  const tabs: Tab[] = ["port", "fleet", "mates", "people", "quests", "futures", "analysis", "settings"];

  it("有没读过的见闻时人物键带小红点（提示里写条数）；没有时不带", () => {
    installIpc();
    const { rerender } = render(<CommandBar tabs={tabs} active="port" open onSelect={() => {}} />);
    const people = screen.getByRole("tab", { name: "人物" });
    expect(within(people).getByTestId("cmd-dot")).toBeInTheDocument();
    expect(people).toHaveAttribute("title", "人物 · 2 条新见闻");
    expect(within(screen.getByRole("tab", { name: "港口" })).queryByTestId("cmd-dot")).toBeNull();
    act(() => useGame.setState({ overview: withStory({ news_unread: 0 }) }));
    rerender(<CommandBar tabs={tabs} active="port" open onSelect={() => {}} />);
    expect(screen.queryByTestId("cmd-dot")).toBeNull();
    expect(screen.getByRole("tab", { name: "人物" })).toHaveAttribute("title", "人物");
  });

  it("手机上人物收在“更多”里：“更多”带小红点，抽屉里的人物格也带", async () => {
    const user = userEvent.setup();
    mockViewport(PHONE);
    installIpc();
    render(<CommandBar tabs={tabs} active="port" open onSelect={() => {}} />);
    const more = screen.getByTestId("cmd-more");
    expect(within(more).getByTestId("cmd-dot")).toBeInTheDocument();
    await user.click(more);
    const sheet = screen.getByRole("dialog", { name: "全部功能" });
    const item = within(sheet).getByRole("button", { name: "人物" });
    expect(within(item).getByTestId("cmd-dot")).toBeInTheDocument();
    expect(within(within(sheet).getByRole("button", { name: "任务" })).queryByTestId("cmd-dot")).toBeNull();
  });
});

describe("旁观的一幕", () => {
  const cast: StoryCastView[] = [
    { person: "ines_costa", name: "伊内丝", portrait: "t16-ines_costa-24" },
    { person: "sophie_lemaire", name: "索菲", portrait: "t16-sophie_lemaire-24" },
  ];
  const side = (choices: StoryChoiceView[]) =>
    withStory({
      pending: {
        day: 40,
        fleet: 0,
        kind: "side",
        key: "ines_sophie:c3",
        chapter: 3,
        total: 5,
        title: "船票",
        text: "码头上，伊内丝把一张船票塞进索菲的手里。{captain}站在缆桩后面，没有出声。",
        speaker: { kind: "portrait", person: "ines_costa", asset: "t16-ines_costa-24", name: "伊内丝" },
        choices,
        track_name: "伊内丝与索菲",
        cast,
      },
    });

  it("台上两位的头像并排、说话的那位亮着；标题上方写“旁观”与那条线；没有选项时只有“继续”，提交 StoryAnswer 第 0 项", async () => {
    const user = userEvent.setup();
    const calls = installIpc();
    useGame.setState({ overview: { ...side([]), captain: { name: "澪", portrait: 3 } } });
    render(<StoryDialog />);
    expect(screen.getByTestId("story-dialog")).toHaveAttribute("data-kind", "side");
    const dlg = screen.getByRole("dialog", { name: "船票" });
    const stage = within(dlg).getByRole("group", { name: "台上的人" });
    const figs = within(stage).getAllByRole("figure");
    expect(figs).toHaveLength(2);
    expect(within(stage).getByTestId("story-cast-ines_costa")).toHaveClass("is-speaking");
    expect(within(stage).getByTestId("story-cast-sophie_lemaire")).not.toHaveClass("is-speaking");
    expect(within(stage).getByRole("img", { name: "伊内丝（正在说）" })).toBeInTheDocument();
    expect(within(stage).getByRole("img", { name: "索菲" })).toBeInTheDocument();
    // 只有台上的人，不另画说话人的大头像
    expect(within(dlg).queryByTestId("story-speaker")).toBeNull();
    expect(dlg).toHaveTextContent("旁观");
    expect(dlg).toHaveTextContent("伊内丝与索菲");
    expect(dlg).toHaveTextContent("第 3 章 · 共 5 章");
    expect(within(dlg).getByTestId("story-text")).toHaveTextContent("澪站在缆桩后面");
    expect(within(dlg).queryByTestId("story-later")).toBeNull();
    expect(within(dlg).queryByRole("group", { name: "船票" })).toBeNull();
    const go = within(dlg).getByRole("button", { name: "继续" });
    expect(go).toHaveFocus();
    await user.click(go);
    expect(submitted(calls)).toEqual([{ StoryAnswer: { owner: "player", choice: 0 } }]);
  });

  it("有选项时照常：选项与“稍后再说”；回应之后的结果里台上的人照旧并排，见闻写进结果", async () => {
    const user = userEvent.setup();
    installIpc();
    useGame.setState({ overview: side([{ text: "替她们把风。", cost: 0 }, { text: "转身走开。", cost: 0 }]) });
    render(<StoryDialog />);
    const dlg = screen.getByRole("dialog", { name: "船票" });
    expect(within(dlg).getAllByRole("figure")).toHaveLength(2);
    expect(within(dlg).getByTestId("story-later")).toBeInTheDocument();
    await user.click(within(dlg).getByTestId("story-choice-0"));
    act(() =>
      useGame.setState({
        overview: withStory({
          last: {
            day: 40,
            kind: "side",
            key: "ines_sophie:c3",
            title: "船票",
            choice: "替她们把风。",
            reply: "索菲上了船。伊内丝在码头站到天黑。",
            success: null,
            outcomes: [{ kind: "news", value: 0, text: "索菲去了伦敦。", persons: ["sophie_lemaire"] }],
            speaker: { kind: "portrait", person: "sophie_lemaire", asset: "t16-sophie_lemaire-24", name: "索菲" },
            ended: false,
          },
        }),
      }),
    );
    const res = await screen.findByTestId("story-result");
    expect(within(res).getByTestId("story-cast-sophie_lemaire")).toHaveClass("is-speaking");
    expect(within(res).getByTestId("story-outcomes")).toHaveTextContent("记进了见闻簿：索菲去了伦敦。");
    expect(res).toHaveTextContent("旁观");
  });
});

describe("旧后端：没有这些字段、gossip 统一拒绝", () => {
  it("人物窗口只有“见过的人”与“关系图”，详情里没有人际与近况，命令栏没有小红点，也不提交已读", async () => {
    const user = userEvent.setup();
    useGame.setState({ overview: { ...overview, story: undefined } });
    const calls = installIpc({ persons: () => ({ persons: [ines] }), person: () => detailOf(ines), gossip: rejected });
    render(<PeoplePanel />);
    await user.click(await screen.findByTestId("person-ines_costa"));
    const d = await screen.findByRole("article", { name: "伊内丝·达·科斯塔" });
    await waitFor(() => expect(calls).toHaveBeenCalledWith("gossip", { loc: null, limit: 1 }));
    expect(screen.getAllByRole("tab").map((x) => x.textContent)).toEqual(["见过的人", "关系图"]);
    expect(within(d).queryByTestId("person-ties")).toBeNull();
    expect(within(d).queryByTestId("person-news")).toBeNull();
    expect(useGame.getState().error).toBeNull();
    expect(submitted(calls)).toEqual([]);
    render(<CommandBar tabs={["port", "people", "settings"]} active="port" open onSelect={() => {}} />);
    expect(screen.queryByTestId("cmd-dot")).toBeNull();
  });

  it("后端没给 news_unread 但 gossip 能用：照样出现“见闻”（未读数取 gossip 的）", async () => {
    useGame.setState({ overview: { ...overview, story: undefined } });
    installIpc({ persons: () => ({ persons: [ines] }), gossip: () => book });
    render(<PeoplePanel />);
    const tab = await screen.findByRole("tab", { name: "见闻" });
    expect(tab).toHaveTextContent("2");
  });

  it("普通的章节对话框照旧：说话人的大头像、没有“台上的人”", () => {
    installIpc();
    useGame.setState({
      overview: withStory({
        pending: {
          day: 30,
          fleet: 0,
          kind: "chapter",
          key: "c2",
          chapter: 2,
          total: 7,
          story: "盐与潮",
          title: "红蜡封的信",
          text: "信差递来一封信。",
          speaker: { kind: "portrait", asset: "keeper-mediterranean-bank-a", name: "佩德雷拉老爷" },
          choices: [{ text: "拆开。", cost: 0 }],
        },
      }),
    });
    render(<StoryDialog />);
    const dlg = screen.getByRole("dialog", { name: "红蜡封的信" });
    expect(within(dlg).getByTestId("story-speaker")).toBeInTheDocument();
    expect(within(dlg).queryByTestId("story-cast")).toBeNull();
    expect(within(dlg).getByTestId("story-later")).toBeInTheDocument();
    expect(dlg).not.toHaveTextContent("旁观");
  });
});
