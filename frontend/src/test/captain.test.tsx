// 主角身世（docs/ECONOMY.md 第 5 节）：有身世数据时的开局向导（生日、星座与年龄，身世问答、属性与算学奇才、启航前的汇总）、
// 提交的 CreateCaptain、顶栏头像的船长卡（含旧存档的旧版星宫）、旧存档的补建身世、行情窗口按算学开放手调参数，以及英文界面。
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "../App";
import AnalysisPanel from "../components/panels/AnalysisPanel";
import PortPanel from "../components/panels/PortPanel";
import StartScreen from "../components/StartScreen";
import { setLocale } from "../i18n/locale";
import type { CaptainCreation, Command, Overview } from "../ipc/types";
import { START_SPEC, useForecast } from "../store/forecast";
import { useGame } from "../store/game";
import { captainProfile, captainStatics, captainStaticsEn, installIpc, overview, port, startedGame } from "./fixtures";

function reset() {
  useGame.setState({ statics: captainStatics, overview: null, version: 0, selectedLoc: null, selectedFleet: null, error: null, message: null });
}

function currentStep(): string {
  const nav = screen.getByRole("navigation", { name: "开局步骤" });
  const cur = within(nav)
    .getAllByRole("button")
    .find((b) => b.getAttribute("aria-current") === "step");
  return (cur?.textContent ?? "").replace(/^\d+/, "");
}

async function next(user: UserEvent) {
  await user.click(screen.getByRole("button", { name: "下一步" }));
}

/** 点“下一步”走到某一步（途中各步都已完成）。 */
async function goTo(user: UserEvent, label: string) {
  for (let i = 0; i < 12 && currentStep() !== label; i++) await next(user);
  expect(currentStep()).toBe(label);
}

/** 在身世一步依次回答（选项名），答完停在“属性”。 */
async function answerAll(user: UserEvent, names: string[]) {
  await goTo(user, "身世");
  for (const n of names) {
    await user.click(screen.getByRole("radio", { name: n }));
    await next(user);
  }
  expect(currentStep()).toBe("属性");
}

/** 生日一步点一个星座（读屏名“白羊座（3月21日–4月19日）”）：生日跳到它的头一天。 */
async function pickSign(user: UserEvent, label: string) {
  await goTo(user, "生日");
  await user.click(screen.getByRole("radio", { name: label }));
}

/** 生日一步直接选月与日。 */
async function pickDate(user: UserEvent, month: number, day: number) {
  await user.selectOptions(screen.getByLabelText("月"), String(month));
  await user.selectOptions(screen.getByLabelText("日"), String(day));
}

const card = () => screen.getByRole("complementary", { name: "船长卡" });
const ageSlider = () => screen.getByRole("slider", { name: "年龄" });
const pointsLeft = () => screen.getByTestId("cw-points-left").textContent;
/** 属性一步某项的数值（读 “航海 3（…）” 的读屏名）。 */
function attrValue(name: string): number {
  const el = screen.getByLabelText(new RegExp(`^${name} \\d+（`));
  return Number(el.textContent);
}

/** 提交的 CreateCaptain（开局还会先提交行情情报 SetInfoMode，跳过它）。 */
function submitted(calls: ReturnType<typeof installIpc>): CaptainCreation & { owner: string } {
  const c = calls.mock.calls
    .filter(([cmd]) => cmd === "submit")
    .map(([, args]) => (args as { command: Record<string, unknown> }).command)
    .find((command) => "CreateCaptain" in command) as { CreateCaptain: CaptainCreation & { owner: string } };
  return c.CreateCaptain;
}

/** 等到提交了 CreateCaptain。 */
const createdCaptain = { command: expect.objectContaining({ CreateCaptain: expect.anything() }) };

describe("开局向导：生日、身世与属性", () => {
  let calls: ReturnType<typeof installIpc>;
  beforeEach(() => {
    calls = installIpc();
    reset();
  });

  it("七步的步骤条：完成一步才能往后；身世没答完时“属性”“启航”去不了", async () => {
    const user = userEvent.setup();
    render(<StartScreen roll={0} />);
    const nav = screen.getByRole("navigation", { name: "开局步骤" });
    const steps = within(nav).getAllByRole("button");
    expect(steps.map((b) => b.textContent)).toEqual(["1剧本", "2外貌", "3生日", "4姓名", "5身世", "6属性", "7启航"]);
    // 生日有随机的默认值、姓名有默认名：前五步都去得了；身世没答，属性与启航去不了
    expect(steps.slice(1, 5).every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
    expect(within(nav).getByRole("button", { name: /属性/ })).toBeDisabled();
    expect(within(nav).getByRole("button", { name: /启航/ })).toBeDisabled();

    await user.click(within(nav).getByRole("button", { name: /身世/ }));
    expect(currentStep()).toBe("身世");
    expect(screen.getByRole("heading", { name: "你的家世" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下一步" })).toBeDisabled();
    expect(screen.getByText("选一项才能继续。")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "港口商人之家" }));
    expect(screen.getByRole("button", { name: "下一步" })).toBeEnabled();
    // 上一步从第一问回到姓名
    await user.click(screen.getByRole("button", { name: "上一步" }));
    expect(currentStep()).toBe("姓名");
  });

  it("生日：十二星座按现实的日期划分；点星座跳到它的头一天，改月与日时星座跟着变；摩羯座跨年；随机生日", async () => {
    const user = userEvent.setup();
    render(<StartScreen roll={0} />);
    await goTo(user, "生日");
    expect(screen.getByRole("heading", { name: "你的生辰" })).toBeInTheDocument();
    const group = screen.getByRole("radiogroup", { name: "十二星座" });
    expect(within(group).getAllByRole("radio").map((r) => r.getAttribute("aria-label"))).toEqual([
      "白羊座（3月21日–4月19日）",
      "金牛座（4月20日–5月20日）",
      "双子座（5月21日–6月21日）",
      "巨蟹座（6月22日–7月22日）",
      "狮子座（7月23日–8月22日）",
      "处女座（8月23日–9月22日）",
      "天秤座（9月23日–10月23日）",
      "天蝎座（10月24日–11月22日）",
      "射手座（11月23日–12月21日）",
      "摩羯座（12月22日–1月19日）",
      "水瓶座（1月20日–2月18日）",
      "双鱼座（2月19日–3月20日）",
    ]);
    // 旧版星宫只为旧存档保留，不在可选的星座里
    expect(within(group).queryByRole("radio", { name: /提灯座|羽笔座/ })).toBeNull();

    // 点水瓶座：生日跳到 1 月 20 日；星座卡片写出日期、加点与生日的士气
    await user.click(screen.getByRole("radio", { name: "水瓶座（1月20日–2月18日）" }));
    expect(screen.getByLabelText("月")).toHaveValue("1");
    expect(screen.getByLabelText("日")).toHaveValue("20");
    const sign = screen.getByTestId("cw-sign-card");
    expect(sign).toHaveTextContent("水瓶座");
    expect(sign).toHaveTextContent("1月20日–2月18日");
    expect(sign).toHaveTextContent("算学 +1");
    expect(sign).toHaveTextContent("每年生日，旗舰的船员士气 +5");
    expect(within(card()).getByText("水瓶座")).toBeInTheDocument();
    expect(within(card()).getByText("1月20日生 · 18 岁")).toBeInTheDocument();

    // 2 月 18 日还是水瓶座，2 月 19 日换成双鱼座（航海 +1）
    await pickDate(user, 2, 18);
    expect(screen.getByRole("radio", { name: "水瓶座（1月20日–2月18日）" })).toBeChecked();
    await user.selectOptions(screen.getByLabelText("日"), "19");
    expect(screen.getByRole("radio", { name: "双鱼座（2月19日–3月20日）" })).toBeChecked();
    expect(screen.getByTestId("cw-sign-card")).toHaveTextContent("航海 +1");
    expect(screen.getByTestId("cw-sign-card")).toHaveTextContent("生于航海历 1484 年 2 月 19 日");
    expect(within(card()).getByText("双鱼座")).toBeInTheDocument();

    // 摩羯座跨年：1 月 10 日与 12 月 25 日都是摩羯座；12 月 21 日还是射手座
    await pickDate(user, 1, 10);
    expect(screen.getByRole("radio", { name: "摩羯座（12月22日–1月19日）" })).toBeChecked();
    await pickDate(user, 12, 25);
    expect(screen.getByRole("radio", { name: "摩羯座（12月22日–1月19日）" })).toBeChecked();
    await user.selectOptions(screen.getByLabelText("日"), "21");
    expect(screen.getByRole("radio", { name: "射手座（11月23日–12月21日）" })).toBeChecked();

    // 随机生日：生日变了，年龄也随机，仍在允许的范围里
    const before = screen.getByTestId("cw-sign-card").textContent;
    await user.click(screen.getByRole("button", { name: "随机生日" }));
    expect(screen.getByTestId("cw-sign-card").textContent).not.toBe(before);
    expect(screen.getByText(/^(1[6-9]|[2-3]\d|4[0-5]) 岁$/)).toBeInTheDocument();
  });

  it("年龄：缺省 18 岁；滑块、常用年龄与 −/+ 都能快速调（按钮可用键盘），出生年份随之变；最低 16、最高 45", async () => {
    const user = userEvent.setup();
    render(<StartScreen roll={0} />);
    await goTo(user, "生日");
    const slider = ageSlider();
    expect(slider).toHaveValue("18");
    expect(slider).toHaveAttribute("min", "16");
    expect(slider).toHaveAttribute("max", "45");
    expect(slider).toHaveAttribute("aria-valuetext", "18 岁");
    expect(screen.getByText("18 岁")).toBeInTheDocument();
    expect(screen.getByTestId("cw-born-year")).toHaveTextContent("生于航海历 1484 年");
    const quick = within(screen.getByRole("group", { name: "常用年龄" }));
    expect(quick.getAllByRole("button").map((b) => b.textContent)).toEqual(["16", "18", "20", "25", "30", "40"]);
    expect(quick.getByRole("button", { name: "18 岁" })).toHaveAttribute("aria-pressed", "true");

    // 滑块拖到 30：年龄、读屏文字、出生年份、快捷按钮与船长卡一起变
    fireEvent.change(slider, { target: { value: "30" } });
    expect(screen.getByText("30 岁")).toBeInTheDocument();
    expect(slider).toHaveAttribute("aria-valuetext", "30 岁");
    expect(screen.getByTestId("cw-born-year")).toHaveTextContent("生于航海历 1472 年");
    expect(quick.getByRole("button", { name: "30 岁" })).toHaveAttribute("aria-pressed", "true");
    expect(quick.getByRole("button", { name: "18 岁" })).toHaveAttribute("aria-pressed", "false");
    expect(within(card()).getByText(/· 30 岁$/)).toBeInTheDocument();

    // 快捷按钮 16：最低，“小一岁”随之禁用；“大一岁”到 17
    await user.click(quick.getByRole("button", { name: "16 岁" }));
    expect(slider).toHaveValue("16");
    expect(screen.getByTestId("cw-born-year")).toHaveTextContent("生于航海历 1486 年");
    expect(screen.getByRole("button", { name: "小一岁" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "大一岁" }));
    expect(screen.getByText("17 岁")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "小一岁" }));
    expect(slider).toHaveValue("16");

    // 键盘：焦点在快捷按钮上按回车或空格
    quick.getByRole("button", { name: "40 岁" }).focus();
    await user.keyboard("{Enter}");
    expect(slider).toHaveValue("40");
    quick.getByRole("button", { name: "25 岁" }).focus();
    await user.keyboard(" ");
    expect(slider).toHaveValue("25");
    expect(screen.getByTestId("cw-born-year")).toHaveTextContent("生于航海历 1477 年");

    // 最高 45：“大一岁”禁用；生日这一步完成，可以往下
    fireEvent.change(slider, { target: { value: "45" } });
    expect(screen.getByText("45 岁")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "大一岁" })).toBeDisabled();
    expect(screen.getByTestId("cw-born-year")).toHaveTextContent("生于航海历 1457 年");
    expect(screen.getByRole("button", { name: "下一步" })).toBeEnabled();
  });

  it("身世问答：一问一页；选项列出加点与开局效果，选中后显示叙述；船长卡随之更新；返回时保留回答；随机回答", async () => {
    const user = userEvent.setup();
    render(<StartScreen roll={0} />);
    await goTo(user, "身世");
    expect(screen.getByText("第 1 问，共 3 问")).toBeInTheDocument();
    expect(screen.getByText("你出生在什么样的人家？")).toBeInTheDocument();
    const merchant = screen.getByRole("radio", { name: "港口商人之家" }).closest("label") as HTMLElement;
    expect(within(merchant).getByText("交易 +2")).toBeInTheDocument();
    expect(within(merchant).getByText("开局资金 +10%")).toBeInTheDocument();
    const scribes = screen.getByRole("radio", { name: "灯塔修道院的抄写员" }).closest("label") as HTMLElement;
    expect(within(scribes).getByText("算学 +2")).toBeInTheDocument();
    expect(within(scribes).getByText("内海的海图")).toBeInTheDocument();
    // 船长卡：没答的题是“……”
    expect(within(card()).getByLabelText("你的家世：……")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "港口商人之家" }));
    expect(screen.getByTestId("cw-option-text")).toHaveTextContent("你生在商行的后院。");
    expect(within(card()).getByLabelText("你的家世：港口商人之家")).toBeInTheDocument();
    await next(user);
    expect(screen.getByRole("heading", { name: "你的少年" })).toBeInTheDocument();
    expect(screen.getByText("第 2 问，共 3 问")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "上一步" }));
    expect(screen.getByRole("radio", { name: "港口商人之家" })).toBeChecked();
    await next(user);

    // 随机回答：选中其中一项，再随机一次换成另一项
    await user.click(screen.getByRole("button", { name: "随机回答" }));
    const picked = ["在大学学算学与天文", "海军见习生"].filter((n) => (screen.getByRole("radio", { name: n }) as HTMLInputElement).checked);
    expect(picked).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "随机回答" }));
    expect((screen.getByRole("radio", { name: picked[0] }) as HTMLInputElement).checked).toBe(false);
    await next(user);
    // 第三问的开局效果：贷款与货物
    const debt = screen.getByRole("radio", { name: "还清家族的债务" }).closest("label") as HTMLElement;
    expect(within(debt).getByText("一笔 8,000 金币 的贷款（12 个月还清）")).toBeInTheDocument();
    const world = screen.getByRole("radio", { name: "去新大陆看看" }).closest("label") as HTMLElement;
    expect(within(world).getByText("货舱里多 丝绸 ×5")).toBeInTheDocument();
  });

  it("属性：身世与星座的点不能减；自由分配 5 点、单项不过 7；分完才能往下；随机与重新分配", async () => {
    const user = userEvent.setup();
    render(<StartScreen roll={0} />);
    await pickSign(user, "金牛座（4月20日–5月20日）");
    await answerAll(user, ["港口商人之家", "在大学学算学与天文", "还清家族的债务"]);
    expect(screen.getByRole("heading", { name: "你的本事" })).toBeInTheDocument();
    // 起点 1；交易 +2（家世）+1（金牛座）；算学 +2；管理 +1
    expect([attrValue("航海"), attrValue("交易"), attrValue("武艺"), attrValue("管理"), attrValue("算学"), attrValue("口才")]).toEqual([1, 4, 1, 2, 3, 1]);
    expect(pointsLeft()).toBe("尚余 5 点");
    expect(screen.getByRole("button", { name: "交易 减一点" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下一步" })).toBeDisabled();

    for (let i = 0; i < 3; i++) await user.click(screen.getByRole("button", { name: "交易 加一点" }));
    expect(attrValue("交易")).toBe(7);
    expect(screen.getByRole("button", { name: "交易 加一点" })).toBeDisabled();
    expect(pointsLeft()).toBe("尚余 2 点");
    expect(screen.getByText(/交易税 −7%/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "交易 减一点" }));
    expect(attrValue("交易")).toBe(6);
    expect(pointsLeft()).toBe("尚余 3 点");

    await user.click(screen.getByRole("button", { name: "重新分配" }));
    expect(pointsLeft()).toBe("尚余 5 点");
    expect(attrValue("交易")).toBe(4);
    await user.click(screen.getByRole("button", { name: "随机分配" }));
    expect(pointsLeft()).toBe("尚余 0 点");
    expect(screen.getByRole("button", { name: "下一步" })).toBeEnabled();
    // 没有一项超过开局上限；船长卡上的属性与这里一致
    const values = ["航海", "交易", "武艺", "管理", "算学", "口才"].map(attrValue);
    expect(values.every((v) => v <= 7)).toBe(true);
    expect(values.reduce((a, b) => a + b, 0)).toBe(1 + 4 + 1 + 2 + 3 + 1 + 5);
    expect(within(card()).getByLabelText(`交易 ${values[1]}`)).toBeInTheDocument();
  });

  it("算学到 7：本人是算学奇才，挑一种奇才之法；开局依次调用 new_game、set_captain 与 CreateCaptain，命令与所选一致", async () => {
    const user = userEvent.setup();
    render(<StartScreen roll={0} />);
    await pickSign(user, "水瓶座（1月20日–2月18日）");
    await pickDate(user, 2, 12);
    expect(screen.getByRole("radio", { name: "水瓶座（1月20日–2月18日）" })).toBeChecked();
    await answerAll(user, ["灯塔修道院的抄写员", "在大学学算学与天文", "去新大陆看看"]);
    // 1 + 2 + 2 + 1（水瓶座）= 6：还不是奇才
    expect(attrValue("算学")).toBe(6);
    expect(screen.queryByTestId("cw-genius")).toBeNull();
    expect(screen.getByText("算学到 7，你本人就是算学奇才，可以挑一种奇才之法。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "算学 加一点" }));
    const genius = screen.getByTestId("cw-genius");
    expect(genius).toHaveTextContent("你的算学已到 7");
    // 默认第一种；换成回归术
    expect(within(genius).getByRole("radio", { name: "递减权重均价（简单指数平滑）" })).toBeChecked();
    await user.click(within(genius).getByRole("radio", { name: "回归术（均值回归 AR(1)）" }));
    expect(within(card()).getByText("奇才之法：回归术")).toBeInTheDocument();
    expect(screen.getByText(/同时追踪 10 条预测/)).toBeInTheDocument();
    for (let i = 0; i < 4; i++) await user.click(screen.getByRole("button", { name: "航海 加一点" }));
    expect(pointsLeft()).toBe("尚余 0 点");

    await goTo(user, "启航");
    const summary = screen.getByTestId("cw-summary");
    expect(summary).toHaveTextContent("新晋船主 · 从澄港启航");
    expect(summary).toHaveTextContent("灯塔修道院的抄写员 · 在大学学算学与天文 · 去新大陆看看");
    expect(summary).toHaveTextContent("回归术（均值回归 AR(1)）");
    expect(summary).toHaveTextContent("内海的海图、货舱里多 丝绸 ×5");
    expect(within(summary).getByText("水瓶座")).toBeInTheDocument();
    // 出生年份 = 开局年份 1502 − 年龄（没动过年龄：缺省 18 岁）
    expect(summary).toHaveTextContent("生于航海历 1484 年 2 月 12 日");
    const year = 1484;

    await user.click(screen.getByRole("button", { name: "开始新游戏" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", createdCaptain));
    // 依次：新游戏、行情情报（缺省随船传递，这一局的第一条命令）、主角的名字与外貌、身世
    const order = calls.mock.calls
      .map(([c, a]) => (c === "submit" ? Object.keys((a as { command: object }).command)[0] : c))
      .filter((x) => ["new_game", "SetInfoMode", "set_captain", "CreateCaptain"].includes(x));
    expect(order).toEqual(["new_game", "SetInfoMode", "set_captain", "CreateCaptain"]);
    expect(submitted(calls)).toEqual({
      owner: "player",
      birthday: { year, month: 2, day: 12 },
      answers: ["lighthouse_scribes", "university", "new_world"],
      alloc: [4, 0, 0, 0, 1, 0],
      genius: "ar1",
    });
    // 三步都完成后才进入游戏
    await waitFor(() => expect(useGame.getState().overview).not.toBeNull());
  });

  it("改了身世后，超出开局上限的自由点数退回待分配；算学不到 7 时命令不带奇才之法", async () => {
    const user = userEvent.setup();
    render(<StartScreen roll={0} />);
    await pickSign(user, "金牛座（4月20日–5月20日）");
    await answerAll(user, ["灯塔修道院的抄写员", "海军见习生", "还清家族的债务"]);
    // 交易：1 + 1（金牛座）= 2，自由分配 5 点到 7
    for (let i = 0; i < 5; i++) await user.click(screen.getByRole("button", { name: "交易 加一点" }));
    expect(attrValue("交易")).toBe(7);
    expect(pointsLeft()).toBe("尚余 0 点");
    // 回到家世改成“港口商人之家”（交易 +2）：交易仍是 7，多出的 2 点退回
    await user.click(within(screen.getByRole("navigation", { name: "开局步骤" })).getByRole("button", { name: /身世/ }));
    expect(screen.getByRole("heading", { name: "你的家世" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "港口商人之家" }));
    await goTo(user, "属性");
    expect(attrValue("交易")).toBe(7);
    expect(pointsLeft()).toBe("尚余 2 点");
    expect(screen.getByRole("button", { name: "下一步" })).toBeDisabled();
    expect(within(screen.getByRole("navigation", { name: "开局步骤" })).getByRole("button", { name: /启航/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "武艺 加一点" }));
    await user.click(screen.getByRole("button", { name: "武艺 加一点" }));
    await goTo(user, "启航");
    await user.click(screen.getByRole("button", { name: "开始新游戏" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", createdCaptain));
    const c = submitted(calls);
    expect(c.answers).toEqual(["merchant_house", "naval_cadet", "family_debt"]);
    expect(c.alloc).toEqual([0, 3, 2, 0, 0, 0]);
    expect(c.genius).toBeNull();
  });

  it("启航前的汇总：“修改”跳回对应的步骤", async () => {
    const user = userEvent.setup();
    render(<StartScreen roll={0} />);
    await answerAll(user, ["港口商人之家", "海军见习生", "去新大陆看看"]);
    await user.click(screen.getByRole("button", { name: "随机分配" }));
    await goTo(user, "启航");
    expect(screen.getByText("身世一经立下，这一局就不能再改。确认无误，就起锚吧。")).toBeInTheDocument();
    expect(screen.getByTestId("cw-summary")).toHaveTextContent("开局资金 +10%、货舱里多 丝绸 ×5");
    await user.click(screen.getByRole("button", { name: "修改身世" }));
    expect(currentStep()).toBe("身世");
    expect(screen.getByRole("heading", { name: "你的家世" })).toBeInTheDocument();
    await goTo(user, "启航");
    await user.click(screen.getByRole("button", { name: "修改生日" }));
    expect(currentStep()).toBe("生日");
    await goTo(user, "启航");
    await user.click(screen.getByRole("button", { name: "修改属性" }));
    expect(currentStep()).toBe("属性");
  });

  it("CreateCaptain 被拒绝时仍然进入游戏，并显示错误", async () => {
    calls = installIpc({
      submit: () => {
        throw { code: "captain.points", message: "自由分配的点数必须正好是 5" };
      },
    });
    const user = userEvent.setup();
    render(<StartScreen roll={0} />);
    await answerAll(user, ["港口商人之家", "海军见习生", "去新大陆看看"]);
    await user.click(screen.getByRole("button", { name: "随机分配" }));
    await goTo(user, "启航");
    await user.click(screen.getByRole("button", { name: "开始新游戏" }));
    await waitFor(() => expect(useGame.getState().overview).not.toBeNull());
    expect(useGame.getState().error).not.toBeNull();
  });
});

describe("游戏里的船长卡与补建身世", () => {
  let calls: ReturnType<typeof installIpc>;
  beforeEach(() => {
    calls = installIpc();
    startedGame();
  });

  it("悬停顶栏头像显示船长卡：生辰与年龄、星座、身世、属性与奇才之法", async () => {
    const user = userEvent.setup();
    installIpc({ static_data: () => captainStatics });
    useGame.setState({
      statics: captainStatics,
      overview: { ...overview, captain: { name: "林远舟", portrait: 3 }, profile: captainProfile },
    });
    render(<App />);
    const button = await screen.findByRole("button", { name: "查看船长卡" });
    expect(screen.queryByTestId("hud-profile")).toBeNull();
    await user.hover(button);
    const pop = await screen.findByTestId("hud-profile");
    expect(within(pop).getByText("林远舟 船长")).toBeInTheDocument();
    expect(within(pop).getByText(`2月12日生 · ${overview.calendar_year - 1480} 岁`)).toBeInTheDocument();
    expect(within(pop).getByText("水瓶座")).toBeInTheDocument();
    expect(within(pop).getByLabelText("你的家世：灯塔修道院的抄写员")).toBeInTheDocument();
    expect(within(pop).getByLabelText("算学 7")).toBeInTheDocument();
    expect(within(pop).getByText("奇才之法：回归术")).toBeInTheDocument();
    expect(within(pop).queryByRole("button", { name: "补建身世" })).toBeNull();
    await user.unhover(button);
    expect(screen.queryByTestId("hud-profile")).toBeNull();
    // 点击固定、Esc 收起
    await user.click(button);
    expect(screen.getByTestId("hud-profile")).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-expanded", "true");
  });

  it("旧存档的主角记着旧版星宫：船长卡照常显示它的名字（按记下的 key，不按生日重新判定）", async () => {
    const user = userEvent.setup();
    installIpc({ static_data: () => captainStatics });
    // 12 月 5 日生：按现在的规则是射手座，旧版本记下的是提灯座
    const legacy = { ...captainProfile, birthday: { year: 1480, month: 12, day: 5 }, sign: "lantern", sign_name: "提灯座" };
    useGame.setState({ statics: captainStatics, overview: { ...overview, captain: { name: "林远舟", portrait: 3 }, profile: legacy } });
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "查看船长卡" }));
    const pop = screen.getByTestId("hud-profile");
    expect(within(pop).getByText("提灯座")).toBeInTheDocument();
    expect(within(pop).queryByText("射手座")).toBeNull();
    expect(within(pop).getByText(`12月5日生 · ${overview.calendar_year - 1480} 岁`)).toBeInTheDocument();
  });

  it("旧存档没有主角档案：船长卡说明可以补建一次；补建走生日、身世、属性，提交 CreateCaptain（不列开局效果）", async () => {
    const user = userEvent.setup();
    const withProfile: Overview = { ...overview, captain: { name: "林远舟", portrait: 3 }, profile: captainProfile };
    calls = installIpc({ static_data: () => captainStatics, submit: () => ({ outcome: "Done", overview: withProfile }) });
    useGame.setState({ statics: captainStatics, overview: { ...overview, captain: { name: "林远舟", portrait: 3 }, profile: null } });
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "查看船长卡" }));
    const pop = screen.getByTestId("hud-profile");
    expect(within(pop).getByText("这位船长还没有立下身世。")).toBeInTheDocument();
    await user.click(within(pop).getByRole("button", { name: "补建身世" }));

    const dialog = screen.getByRole("dialog", { name: "补建身世" });
    expect(within(dialog).getByText("为 林远舟 补上生辰、身世与属性。开局效果不再发放。")).toBeInTheDocument();
    const nav = within(dialog).getByRole("navigation", { name: "开局步骤" });
    expect(within(nav).getAllByRole("button").map((b) => b.textContent)).toEqual(["1生日", "2身世", "3属性", "4启航"]);
    // 补建身世也按现行的星座：先把生日放到 1 月 1 日（摩羯座），再点狮子座，生日跳到 7 月 23 日；年龄缺省 18 岁
    await user.selectOptions(within(dialog).getByLabelText("月"), "1");
    await user.selectOptions(within(dialog).getByLabelText("日"), "1");
    expect(within(dialog).getByRole("radio", { name: "摩羯座（12月22日–1月19日）" })).toBeChecked();
    await user.click(within(dialog).getByRole("radio", { name: "狮子座（7月23日–8月22日）" }));
    expect(within(dialog).getByLabelText("月")).toHaveValue("7");
    expect(within(dialog).getByLabelText("日")).toHaveValue("23");
    expect(within(dialog).getByRole("slider", { name: "年龄" })).toHaveValue("18");
    await user.click(within(dialog).getByRole("button", { name: "下一步" }));
    for (const n of ["灯塔修道院的抄写员", "海军见习生", "还清家族的债务"]) {
      await user.click(within(dialog).getByRole("radio", { name: n }));
      await user.click(within(dialog).getByRole("button", { name: "下一步" }));
    }
    await user.click(within(dialog).getByRole("button", { name: "随机分配" }));
    await user.click(within(dialog).getByRole("button", { name: "下一步" }));
    const summary = within(dialog).getByTestId("cw-summary");
    expect(summary).not.toHaveTextContent("开局效果");
    await user.click(within(dialog).getByRole("button", { name: "立下身世" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", expect.anything()));
    const cmd = calls.mock.calls.find(([c]) => c === "submit")?.[1].command as Command;
    expect("CreateCaptain" in cmd && cmd.CreateCaptain.answers).toEqual(["lighthouse_scribes", "naval_cadet", "family_debt"]);
    expect("CreateCaptain" in cmd && cmd.CreateCaptain.birthday).toEqual({ year: 1484, month: 7, day: 23 });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "补建身世" })).toBeNull());
    expect(useGame.getState().message).toBe("身世已立下。");
    expect(useGame.getState().overview?.profile).toEqual(captainProfile);
  });

  it("数据没有身世时：船长卡只有头像与名字，没有补建入口", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "查看船长卡" }));
    const pop = screen.getByTestId("hud-profile");
    expect(within(pop).getByText("这位船长还没有立下身世。")).toBeInTheDocument();
    expect(within(pop).queryByRole("button", { name: "补建身世" })).toBeNull();
  });
});

describe("行情窗口：主角的算学决定能否手调参数", () => {
  beforeEach(() => {
    installIpc();
    startedGame();
    useForecast.setState({ loc: null, good: null, spec: START_SPEC, horizon: 15, mode: "daily", monthlyHorizon: 6, view: "work", reviewId: null, draft: null });
  });

  const withNumeracy = (n: number) => ({
    ...captainProfile,
    attrs: captainProfile.attrs.map(([k, v]) => [k, k === "numeracy" ? n : v] as [typeof k, number]),
  });

  it("算学不到 4：拟合窗口与参数都锁定，并说明需要多少", async () => {
    useGame.setState({ statics: captainStatics, overview: { ...overview, profile: withNumeracy(3) } });
    render(<AnalysisPanel />);
    expect(await screen.findByTestId("fc-manual-locked")).toHaveTextContent("主角的算学到 4 才能手调参数与拟合窗口");
    expect(screen.getByLabelText("用最近几天的价")).toBeDisabled();
    for (const box of screen.getAllByRole("checkbox", { name: "自动" })) expect(box).toBeDisabled();
  });

  it("算学到 4，或旧存档没有主角档案：可以手调", async () => {
    useGame.setState({ statics: captainStatics, overview: { ...overview, profile: withNumeracy(4) } });
    const { unmount } = render(<AnalysisPanel />);
    await screen.findByTestId("fc-work");
    expect(screen.queryByTestId("fc-manual-locked")).toBeNull();
    expect(screen.getByLabelText("用最近几天的价")).toBeEnabled();
    for (const box of screen.getAllByRole("checkbox", { name: "自动" })) expect(box).toBeEnabled();
    unmount();
    useGame.setState({ statics: captainStatics, overview: { ...overview, profile: null } });
    render(<AnalysisPanel />);
    await screen.findByTestId("fc-work");
    expect(screen.queryByTestId("fc-manual-locked")).toBeNull();
  });
});

describe("酒馆：算学奇才的去向", () => {
  it("传闻说出奇才这一季落脚的港口与他会的法子；没有传闻时不显示", async () => {
    installIpc({
      port: () => ({ ...port, genius_rumor: { mate: 3, name: "卡里姆", loc: 1, methods: ["linear", "ar1"] } }),
    });
    startedGame();
    useGame.setState({ facility: "tavern" });
    const { unmount } = render(<PortPanel />);
    expect(await screen.findByTestId("tavern-genius")).toHaveTextContent(
      "酒客们说：算学奇才卡里姆这一季在柳湾的酒馆落脚，据说会最小二乘直线、回归术。",
    );
    unmount();
    installIpc();
    render(<PortPanel />);
    await screen.findByText("本港酒馆的航海士");
    expect(screen.queryByTestId("tavern-genius")).toBeNull();
  });
});

describe("英文界面：开局向导", () => {
  afterEach(() => setLocale("zh-CN"));

  it("步骤条、标题、属性与效果都是英文", async () => {
    installIpc();
    reset();
    setLocale("en");
    const user = userEvent.setup();
    render(<StartScreen roll={0} />);
    const nav = screen.getByRole("navigation", { name: "Getting started" });
    expect(within(nav).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "1Scenario",
      "2Looks",
      "3Birthday",
      "4Name",
      "5Background",
      "6Attributes",
      "7Set sail",
    ]);
    await user.click(within(nav).getByRole("button", { name: /Birthday/ }));
    expect(screen.getByRole("heading", { name: "Your birthday" })).toBeInTheDocument();
    // （这份数据的星座名是中文；英文数据见下一个用例）日期区间按英文写
    await user.click(screen.getByRole("radio", { name: "水瓶座 (20 Jan – 18 Feb)" }));
    expect(screen.getByTestId("cw-sign-card")).toHaveTextContent("On each birthday, flagship crew morale +5");
    expect(screen.getByTestId("cw-sign-card")).toHaveTextContent("Born 20 Jan 1484, Mariner's Reckoning");
    await user.click(within(nav).getByRole("button", { name: /Background/ }));
    for (const n of ["港口商人之家", "海军见习生", "还清家族的债务"]) {
      await user.click(screen.getByRole("radio", { name: n }));
      await user.click(screen.getByRole("button", { name: "Next" }));
    }
    expect(screen.getByRole("heading", { name: "Your talents" })).toBeInTheDocument();
    expect(screen.getByTestId("cw-points-left")).toHaveTextContent("5 left");
    // 交易：起点 1 + 家世 2，再加一点
    await user.click(screen.getByRole("button", { name: "Add a point to 交易" }));
    expect(screen.getByText(/Trade tax −4%/)).toBeInTheDocument();
  });

  it("星座用标准的英文名（Aries…Pisces）与英文日期；年龄的滑块、快捷按钮与出生年份也是英文", async () => {
    installIpc();
    useGame.setState({ statics: captainStaticsEn, overview: null, version: 0, selectedLoc: null, selectedFleet: null, error: null, message: null });
    setLocale("en");
    const user = userEvent.setup();
    render(<StartScreen roll={0} />);
    await user.click(within(screen.getByRole("navigation", { name: "Getting started" })).getByRole("button", { name: /Birthday/ }));
    const group = screen.getByRole("radiogroup", { name: "The twelve star signs" });
    expect(within(group).getAllByRole("radio").map((r) => r.getAttribute("aria-label"))).toEqual([
      "Aries (21 Mar – 19 Apr)",
      "Taurus (20 Apr – 20 May)",
      "Gemini (21 May – 21 Jun)",
      "Cancer (22 Jun – 22 Jul)",
      "Leo (23 Jul – 22 Aug)",
      "Virgo (23 Aug – 22 Sep)",
      "Libra (23 Sep – 23 Oct)",
      "Scorpio (24 Oct – 22 Nov)",
      "Sagittarius (23 Nov – 21 Dec)",
      "Capricorn (22 Dec – 19 Jan)",
      "Aquarius (20 Jan – 18 Feb)",
      "Pisces (19 Feb – 20 Mar)",
    ]);
    await user.click(screen.getByRole("radio", { name: "Aries (21 Mar – 19 Apr)" }));
    const sign = screen.getByTestId("cw-sign-card");
    expect(sign).toHaveTextContent("Aries");
    expect(sign).toHaveTextContent("21 Mar – 19 Apr");
    expect(sign).toHaveTextContent("About Aries.");
    expect(sign).toHaveTextContent("Born 21 Mar 1484, Mariner's Reckoning");
    expect(within(screen.getByRole("complementary", { name: "Captain's card" })).getByText("Aries")).toBeInTheDocument();
    // 年龄：缺省 18，快捷按钮 “Age 16”，出生年份随之变
    const slider = screen.getByRole("slider", { name: "Age" });
    expect(slider).toHaveValue("18");
    expect(slider).toHaveAttribute("aria-valuetext", "18 years old");
    await user.click(within(screen.getByRole("group", { name: "Common ages" })).getByRole("button", { name: "Age 16" }));
    expect(slider).toHaveValue("16");
    expect(screen.getByTestId("cw-born-year")).toHaveTextContent("Born in 1486, Mariner's Reckoning");
    // 摩羯座跨年
    await user.selectOptions(screen.getByLabelText("Month"), "1");
    await user.selectOptions(screen.getByLabelText("Day"), "5");
    expect(screen.getByRole("radio", { name: "Capricorn (22 Dec – 19 Jan)" })).toBeChecked();
  });
});
