// TITLE2：有存档时开局停在“读取存档”，后端还是缺省的经典世界——要切到唯一可开局的世界（寰宇），切好之前标题的纪年行不画、存档列表写载入中；
// 别的世界的存档行不写日期，只写那个世界的名字。真值表（逐行）：
// | 目录回来了 | 唯一可开局的世界 == 当前 | 视图 | 切换 | 纪年行 | 存档日期 |
// | 否 | — | 任意 | 否 | 不显示 | 载入中 |
// | 是 | 否 | load | 是 | 切好后寰宇的 | 切好后按寰宇 |
// | 是 | 否 | new | 是（现状） | 左栏藏着 | — |
// | 是 | 是 | 任意 | 否 | 显示 | 当前世界写日期、别的世界只写世界名 |
// | 是 | 有选世界一步 | 任意 | 否 | 显示当前的 | 同上 |
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import StartScreen from "../components/StartScreen";
import { setWorld } from "../i18n";
import type { ProtagonistCard, SaveInfo, ScenarioCard, StaticView, WorldCard, WorldCatalog } from "../ipc/types";
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

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}


const classicStatics: StaticView = { ...statics, world: { currency: "金币", era: "航海历", start_year: 1502, key: "classic", name: "维斯塔海" } };
const terraStatics: StaticView = {
  ...statics,
  world: { currency: "文", era: "公元", start_year: 1553, key: "terra16", name: "寰宇·十六世纪", calendar: { months: [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31], seasons: [3, 3, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3], month_names: [] } },
};
const classicCard: WorldCard = { ...terra16, key: "classic", name: "维斯塔海", scenarios: [] };
const otherCard: WorldCard = { ...terra16, key: "other", name: "另一片海" };
const tsave = (slot: string, day: number): SaveInfo => ({ slot, day, scenario: "更远之处", net_worth: 500, world_key: "terra16", modified: day });
const csave: SaveInfo = { slot: "old", day: 30, scenario: "白手起家", net_worth: 5000, world_key: "classic", modified: 1 };

const ipc = (o: { saves?: SaveInfo[]; catalog?: WorldCatalog | Promise<WorldCatalog>; select?: () => unknown } = {}) =>
  installIpc({
    list_saves: () => o.saves ?? [tsave("a", 231), tsave("b", 90)],
    world_catalog: () => o.catalog ?? { current: null, worlds: [classicCard, terra16] },
    select_world: o.select ?? (() => terraStatics),
  });
const eraText = () => document.querySelector(".title-era")?.textContent ?? null;

describe("TITLE2 唯一可开局的世界与标题的纪年、存档日期（真值表）", () => {
  beforeEach(() => {
    setWorld(classicStatics.world);
    useGame.setState({ statics: classicStatics, overview: null, version: 0, error: null, message: null });
  });

  it("行 1：目录还没回来 → 不切、纪年行不画、存档列表写载入中", async () => {
    const late = deferred<WorldCatalog>();
    const calls = ipc({ catalog: late.promise });
    // 与 App.tsx 一样带 waitWorlds（目录没回来时向导先写“正在读取世界”）
    render(<StartScreen roll={3} waitWorlds />);
    await new Promise((r) => setTimeout(r, 30));
    expect(eraText()).toBeNull();
    expect(document.body.textContent).not.toMatch(/航海历|1502/);
    expect(calls).not.toHaveBeenCalledWith("select_world", expect.anything());
  });

  it("行 2：目录只有寰宇、当前是经典、停在读取存档 → 自动 select_world；切好之前不出现“航海历”“1502”；切好后寰宇的纪年、存档 1553 年起", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const calls = ipc({ select: () => gate.then(() => terraStatics) });
    render(<StartScreen roll={3} />);
    await waitFor(() => expect(calls).toHaveBeenCalledWith("select_world", { world: "terra16" }));
    expect(document.body.textContent).not.toMatch(/航海历|1502/);
    release();
    await waitFor(() => expect(eraText()).toMatch(/公元\s*1553/));
    expect(screen.getByRole("heading", { name: "读取存档" })).toBeInTheDocument();
    const details = [...document.querySelectorAll(".ts-save-detail")].map((e) => e.textContent ?? "");
    expect(details.length).toBe(2);
    for (const d of details) expect(d).toMatch(/155\d年/);
    expect(document.body.textContent).not.toMatch(/航海历|1502/);
  });

  it("行 3：没有存档（向导）→ 照旧切过去，左栏藏着", async () => {
    const calls = ipc({ saves: [] });
    render(<StartScreen roll={3} />);
    await waitFor(() => expect(calls).toHaveBeenCalledWith("select_world", { world: "terra16" }));
    await screen.findByRole("button", { name: "回到标题" });
    expect(document.querySelector(".title-ui")?.hasAttribute("data-wide")).toBe(true);
  });

  it("行 4：当前已是寰宇 → 不切；寰宇的存档写日期，混着的经典存档只写世界名", async () => {
    setWorld(terraStatics.world);
    useGame.setState({ statics: terraStatics });
    const calls = ipc({ saves: [tsave("a", 231), csave] });
    render(<StartScreen roll={3} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "读取存档" })).toBeInTheDocument());
    await waitFor(() => expect(document.querySelectorAll(".ts-save-detail").length).toBe(2));
    expect(calls).not.toHaveBeenCalledWith("select_world", expect.anything());
    expect(eraText()).toMatch(/公元\s*1553/);
    const old = screen.getByRole("button", { name: "读取存档 old" });
    const detail = old.querySelector(".ts-save-detail");
    expect(detail?.textContent).toBe("维斯塔海");
    expect(detail?.textContent).not.toMatch(/\d+年/);
    const far = screen.getByRole("button", { name: "读取存档 a" }).querySelector(".ts-save-detail");
    expect(far?.textContent).toMatch(/1553年/);
  });

  it("行 5：有选世界一步（两个可开局的世界）→ 不自动切，纪年行照当前的写", async () => {
    const calls = ipc({ saves: [], catalog: { current: null, worlds: [terra16, otherCard] } });
    render(<StartScreen roll={3} />);
    await screen.findByTestId("world-terra16");
    expect(calls).not.toHaveBeenCalledWith("select_world", expect.anything());
    expect(eraText()).toMatch(/航海历\s*1502/);
  });
});
