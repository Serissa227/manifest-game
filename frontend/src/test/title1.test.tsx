// TITLE1：带名册的世界（寰宇）开局时左栏（标题、菜单、语言、剧情文本、音乐）别被藏得回不来。真值表（逐行一条测试）：
// | 存档 | 点过菜单 / 动过向导 | 有名册世界 | view | 左栏 |
// | 0    | —                  | 是         | new（第一步返回键“回到标题”可点） | 藏着，点返回后出现 |
// | >0   | 否                 | 是         | load（菜单最上面“继续”）         | 在 |
// | >0   | 是（点了“新的航程”）| 是         | new，返回 → load                 | 藏着 → 出现 |
// | 任意 | —                  | 否         | 不变（new）                       | 在 |
// 另：存档在玩家点了“新的航程”之后才读回来 → 仍是 new。
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import StartScreen from "../components/StartScreen";
import type { ProtagonistCard, SaveInfo, ScenarioCard, WorldCard } from "../ipc/types";
import { useGame } from "../store/game";
import { installIpc, statics } from "./fixtures";

const hero = (key: string, name: string): ProtagonistCard => ({
  key,
  name,
  name_en: null,
  gender: "f",
  born: [1540, 6, 21],
  home: "下田",
  region: "日本·土佐",
  tagline: `${name}的一句话`,
  style: "",
  playstyle: "",
  tags: [],
  difficulty: 2,
  strengths: [],
  start_ship: "小早",
  known: [],
  academy: { key: "kyoto", name: "宫中", city: "京都" },
  keepsake: "",
  portraits: [{ from_age: 12, asset: `t16-${key}-12` }],
  bonds: [],
});
const plusUltra: ScenarioCard = {
  key: "plus_ultra",
  name: "更远之处",
  description: "",
  start_date: [1553, 1, 1],
  control_date: [1553, 1, 1],
  upbringing: true,
  protagonists: [hero("mio", "一条澪")],
  templates: [],
  goal: { kind: "story", target: 0, years: null },
  options: { history_toggle: true, skip_upbringing: true },
};
const terra16: WorldCard = {
  key: "terra16",
  name: "寰宇·十六世纪",
  tagline: "",
  description: "",
  map_key: "earth",
  era: "公元",
  start_year: 1553,
  currency: "金币",
  modules: ["upbringing"],
  scenarios: [plusUltra],
};
const plain: WorldCard = { ...terra16, key: "plain", name: "没有名册的世界", scenarios: [{ ...plusUltra, protagonists: [], templates: [] }] };
const save = (slot: string): SaveInfo => ({ slot, day: 30, scenario: "更远之处", net_worth: 500, world_key: "terra16", modified: 80 });

/** 手动放行的回复。 */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const wide = () => document.querySelector(".title-ui")?.hasAttribute("data-wide") ?? false;
const ipc = (saves: SaveInfo[] | Promise<SaveInfo[]>, worlds: WorldCard[] = [terra16]) =>
  installIpc({
    list_saves: () => saves,
    world_catalog: () => ({ current: worlds[0].key, worlds }),
    select_world: () => ({ ...statics, world: { ...statics.world, key: worlds[0].key } }),
  });

describe("TITLE1 标题画面的左栏（真值表）", () => {
  beforeEach(() => {
    useGame.setState({ statics: { ...statics, world: { ...statics.world, key: "terra16" } }, overview: null, version: 0, error: null, message: null });
  });

  it("行 1：没有存档 → 向导、左栏藏着；第一步返回键写“回到标题”可点，点了左栏出现、语言与剧情文本都在", async () => {
    const user = userEvent.setup();
    ipc([]);
    render(<StartScreen roll={3} />);
    const back = await screen.findByRole("button", { name: "回到标题" });
    expect(back).toBeEnabled();
    expect(wide()).toBe(true);
    await user.click(back);
    expect(wide()).toBe(false);
    expect(screen.getByRole("combobox", { name: "语言 / Language" })).toBeInTheDocument();
    expect(screen.getByTestId("title-story-text")).toBeInTheDocument();
  });

  it("行 2：有存档、没动过 → 存档列表、左栏在、菜单最上面是“继续”", async () => {
    ipc([save("mine")]);
    render(<StartScreen roll={3} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "读取存档" })).toBeInTheDocument());
    expect(wide()).toBe(false);
    const menu = screen.getByRole("navigation");
    expect(menu.querySelector("button")?.textContent).toMatch(/继续/);
  });

  it("行 3：有存档、点了“新的航程” → 向导、左栏藏着；返回 → 存档列表", async () => {
    const user = userEvent.setup();
    ipc([save("mine")]);
    render(<StartScreen roll={3} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "读取存档" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "新的航程" }));
    const back = await screen.findByRole("button", { name: "回到标题" });
    expect(wide()).toBe(true);
    await user.click(back);
    expect(screen.getByRole("heading", { name: "读取存档" })).toBeInTheDocument();
    expect(wide()).toBe(false);
  });

  it("行 4：没有名册的世界 → 不自动切（仍是新的航程）、左栏在", async () => {
    ipc([save("mine")], [plain]);
    render(<StartScreen roll={3} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "新的航程" })).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByRole("heading", { name: "新的航程" })).toBeInTheDocument();
    expect(wide()).toBe(false);
  });

  it("存档在玩家点了“新的航程”之后才读回来 → 仍是向导", async () => {
    const user = userEvent.setup();
    const late = deferred<SaveInfo[]>();
    ipc(late.promise);
    render(<StartScreen roll={3} />);
    await user.click(await screen.findByRole("button", { name: "新的航程" }));
    late.resolve([save("mine")]);
    await screen.findByRole("button", { name: "回到标题" });
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByRole("button", { name: "回到标题" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "读取存档" })).toBeNull();
  });
});
