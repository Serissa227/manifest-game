// A9（docs/UI-CONTRACT.md I5 的 A9 追加）：没被选中的主角此刻停在这里时，人物卡片与详情写一句她的船（persons.fleets）；
// 真正一起上过学的人，详情里多一节“同窗”（school_memory：学院名取开局目录、结业日、结业时的情谊与约定、后来有没有再见）。
// 旧后端（没有 fleets、没有 school_memory）时与以前一样。
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import PeoplePanel from "../components/people/PeoplePanel";
import { academyNames, fleetShips } from "../components/people/peopleKit";
import { dayDate } from "../i18n";
import { setLocale } from "../i18n/locale";
import type { PersonCard, PersonDetail, PersonFleetView, SchoolMemory, WorldCatalog } from "../ipc/types";
import { useGame } from "../store/game";
import { installIpc, overview, statics } from "./fixtures";

const person = (o: Partial<PersonCard> & Pick<PersonCard, "key" | "name">): PersonCard => ({
  portrait: null,
  age: 17,
  kind: "protagonist",
  role: "",
  where: null,
  affinity: 40,
  heart: null,
  heart_stage: null,
  bond: null,
  relation: [],
  call_name: "你",
  can_recruit: false,
  requests: 0,
  ...o,
});

const detailOf = (p: PersonCard, extra: Partial<PersonDetail> = {}): PersonDetail => ({
  ...p,
  here: true,
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

const mio = person({ key: "mio", name: "一条澪", where: "澄港" });
const ase = person({ key: "ase", name: "阿濑", kind: "story" });

const catalog = {
  current: "terra16",
  worlds: [
    {
      key: "terra16",
      scenarios: [
        {
          key: "s1553",
          protagonists: [{ key: "mio", academy: { key: "kyoto_court", name: "京都公家的女官见习", city: "京都" } }],
          templates: [
            { key: "custom_naha_envoy", academy: { key: "naha_kumemura", name: "久米村的通事学堂", city: "那霸" } },
            { key: "custom_other", academy: { key: "kyoto_court", name: "另一个名字", city: "京都" } },
          ],
        },
      ],
    },
  ],
} as unknown as WorldCatalog;

const fleets: PersonFleetView[] = [{ person: "mio", loc: 0, cell: { x: 1, y: 1 }, ships: ["swallow", "no_such_hull"] }];

const memory = (o: Partial<SchoolMemory> = {}): SchoolMemory => ({
  family: "mio",
  academies: ["kyoto_court"],
  graduated_on: 1460,
  affection: { affinity: 62, heart: 30, relations: ["classmate"], experiences: 5, bond: "B" },
  promise: true,
  memories: ["七夕那夜的歌"],
  parted: true,
  reunited_on: 2000,
  ...o,
});

beforeEach(() => {
  setLocale("zh-CN");
  useGame.setState({ statics, overview, version: 1, error: null, message: null, selectedLoc: 0 });
});

describe("A9 的纯逻辑", () => {
  it("学院名取开局目录里主角与模板的学院卡，同一 key 先来的为准", () => {
    const names = academyNames(catalog);
    expect(names.get("kyoto_court")).toBe("京都公家的女官见习");
    expect(names.get("naha_kumemura")).toBe("久米村的通事学堂");
    expect(academyNames(null).size).toBe(0);
  });

  it("人物的船：认得的船型写名字，不认得的不写，艘数照实；没有这位或没有船时为 null", () => {
    expect(fleetShips(fleets, "mio", statics.ships)).toEqual({ names: ["单桅帆船"], count: 2 });
    expect(fleetShips(fleets, "ase", statics.ships)).toBeNull();
    expect(fleetShips([{ ...fleets[0], ships: [] }], "mio", statics.ships)).toBeNull();
    expect(fleetShips(undefined, "mio", statics.ships)).toBeNull();
  });
});

describe("人物页：人物的船与同窗", () => {
  it("卡片与详情写船停在这里；同窗一节写学院、结业日、结业时的情谊与约定、后来又见着了", async () => {
    const user = userEvent.setup();
    const calls = installIpc({
      persons: () => ({ persons: [mio, ase], fleets }),
      person: (a) => (a.key === "mio" ? detailOf(mio, { school_memory: memory() }) : detailOf(ase)),
      world_catalog: () => catalog,
    });
    render(<PeoplePanel />);
    const card = await screen.findByTestId("person-mio");
    expect(card).toHaveTextContent("船在这里：单桅帆船");
    expect(screen.getByTestId("person-ase")).not.toHaveTextContent("船在这里");
    await user.click(card);
    const d = await screen.findByRole("article", { name: "一条澪" });
    expect(within(d).getByTestId("person-fleet")).toHaveTextContent("船在这里：单桅帆船");
    const school = within(d).getByTestId("person-school");
    expect(within(school).getByRole("heading", { name: "同窗" })).toBeInTheDocument();
    await waitFor(() => expect(school).toHaveTextContent("京都公家的女官见习的同学"));
    expect(calls).toHaveBeenCalledWith("world_catalog", {});
    expect(school).toHaveTextContent(`${dayDate(1460)}结业`);
    expect(school).toHaveTextContent("结业时情谊 62");
    expect(school).toHaveTextContent("羁绊 B");
    expect(school).toHaveTextContent("一起经历过 5 件事");
    expect(school).toHaveTextContent("有过约定");
    expect(school).toHaveTextContent(`结业后分开，${dayDate(2000)}又见着了。`);
    // 学院 key 不直接露给玩家
    expect(school).not.toHaveTextContent("kyoto_court");
  });

  it("还没再见、一直没分开、没有羁绊与约定、学院名查不到时各有一句", async () => {
    const user = userEvent.setup();
    let m = memory({ reunited_on: null, promise: false, affection: { affinity: 20, heart: 0, relations: [], experiences: 0, bond: null }, academies: ["nowhere"] });
    installIpc({
      persons: () => ({ persons: [mio] }),
      person: () => detailOf(mio, { school_memory: m }),
      world_catalog: () => catalog,
    });
    const { unmount } = render(<PeoplePanel />);
    await user.click(await screen.findByTestId("person-mio"));
    let school = await screen.findByTestId("person-school");
    expect(school).toHaveTextContent("一起上过学");
    expect(school).toHaveTextContent("结业后各奔东西，还没再见过。");
    expect(school).not.toHaveTextContent("羁绊");
    expect(school).not.toHaveTextContent("有过约定");
    expect(school).not.toHaveTextContent("一起经历过");
    // 没有 fleets 时不写船
    expect(screen.queryByTestId("person-fleet")).toBeNull();
    unmount();

    m = memory({ parted: false, reunited_on: null });
    render(<PeoplePanel />);
    await user.click(await screen.findByTestId("person-mio"));
    school = await screen.findByTestId("person-school");
    expect(school).toHaveTextContent("结业后一直没分开。");
  });

  it("船型都不认得时只写艘数", async () => {
    const user = userEvent.setup();
    installIpc({
      persons: () => ({ persons: [mio], fleets: [{ ...fleets[0], ships: ["a", "b", "c"] }] }),
      person: () => detailOf(mio),
    });
    render(<PeoplePanel />);
    expect(await screen.findByTestId("person-mio")).toHaveTextContent("船在这里：3 艘");
    await user.click(screen.getByTestId("person-mio"));
    expect(await screen.findByTestId("person-fleet")).toHaveTextContent("船在这里：3 艘");
  });

  it("旧后端：没有 fleets、没有 school_memory 时与以前一样，也不去取开局目录", async () => {
    const user = userEvent.setup();
    const calls = installIpc({
      persons: () => ({ persons: [mio] }),
      person: () => detailOf(mio),
    });
    render(<PeoplePanel />);
    await user.click(await screen.findByTestId("person-mio"));
    const d = await screen.findByRole("article", { name: "一条澪" });
    expect(within(d).queryByTestId("person-school")).toBeNull();
    expect(within(d).queryByTestId("person-fleet")).toBeNull();
    expect(screen.getByTestId("person-mio")).not.toHaveTextContent("船在这里");
    expect(calls.mock.calls.some(([c]) => c === "world_catalog")).toBe(false);
  });
});
