// 音效：素材清单的完整性与体积、事件表、限频与变体轮换、“全部卖出”的一串、同时限数；
// 从游戏状态的差认出买卖、出港入港、修船、造船厂、雇船员、补给、存取款、改速度、海盗的自动结算；
// 卷轴提示与错误的文字；全局点击委托的判断；战报 → 炮声；播放器（假的音频上下文）：叠层、限频、短乐句让开、上下文挂起时不放。
import { describe, expect, it } from "vitest";
import type { Overview, TacticalBattle } from "../../ipc/types";
import { SFX_DEFAULT, sfxGain } from "../engine";
import { DEFAULT_PREFS } from "../prefs";
import { continuous, errorEvent, messageEvent, newNotices, stateEvents } from "./detect";
import { isSfxId, SFX, SFX_IDS, sfxDef, UI_SAMPLES, type SfxId } from "./events";
import { battleCues } from "./index";
import { Gate, makeRoom, MAX_VOICES, Rotation, SaleBurst } from "./limit";
import { SfxPlayer, sfxUrl } from "./player";
import { SFX_SAMPLES, type SfxFile, type SfxSampleId } from "./samples";
import { changeSfx, clickSfx, QUIET, sliderRate, sliderStep, SLIDER_DETENTS } from "./ui";

const MB = 1000 * 1000;

/** public/audio/sfx 下的全部 MP3：路径 → base64 的 data URL（Vite 的 ?inline）。 */
const PUBLIC_FILES = import.meta.glob<string>("../../../public/audio/sfx/**/*.mp3", { query: "?inline", import: "default", eager: true });
const PREFIX = "../../../public/audio/sfx/";

function dataBytes(url: string): number {
  const b64 = url.slice(url.indexOf(",") + 1);
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return (b64.length * 3) / 4 - pad;
}

const SAMPLE_IDS = Object.keys(SFX_SAMPLES) as SfxSampleId[];
const FILES: SfxFile[] = SAMPLE_IDS.flatMap((k): readonly SfxFile[] => SFX_SAMPLES[k].files);

describe("音效素材清单", () => {
  it("清单里的每个文件都在 public/audio/sfx 下，大小与清单一致；那里也没有清单外的文件", () => {
    expect(FILES.length).toBeGreaterThan(40);
    for (const f of FILES) {
      const url = PUBLIC_FILES[PREFIX + f.file];
      expect(url, f.file).toBeTruthy();
      expect(url.startsWith("data:audio/mpeg;base64,"), f.file).toBe(true);
      expect(dataBytes(url), f.file).toBe(f.bytes);
      expect(f.hash, f.file).toMatch(/^[0-9a-f]{8}$/);
    }
    const listed = new Set(FILES.map((f) => PREFIX + f.file));
    expect(Object.keys(PUBLIC_FILES).filter((f) => !listed.has(f))).toEqual([]);
    expect(new Set(FILES.map((f) => f.file)).size).toBe(FILES.length);
  });

  it("游戏里新增的音效总共不超过 2 MB", () => {
    const total = FILES.reduce((s, f) => s + f.bytes, 0);
    expect(total).toBeLessThanOrEqual(2 * MB);
    expect(total).toBeGreaterThan(0.1 * MB);
  });

  it("每种素材 2–4 个变体；每个文件的增益、长度、起音标记合理；界面的声音都很短", () => {
    for (const k of SAMPLE_IDS) {
      const set = SFX_SAMPLES[k];
      expect(set.files.length, k).toBeGreaterThanOrEqual(2);
      expect(set.files.length, k).toBeLessThanOrEqual(4);
      expect(set.note.length, k).toBeGreaterThan(2);
      for (const f of set.files) {
        expect(Number.isFinite(f.gain) && f.gain > 0 && f.gain < 50, f.file).toBe(true);
        expect(f.length, f.file).toBeGreaterThan(0.015);
        expect(f.length, f.file).toBeLessThan(3);
        // 起音标记：文件开头没有长的静音（多数只有 3 毫秒的淡入；几层叠成的，第一层轻的晚一点才过 0.5% 的线）
        expect(f.mark, f.file).toBeGreaterThanOrEqual(0);
        expect(f.mark, f.file).toBeLessThan(0.05);
      }
    }
    for (const k of UI_SAMPLES) for (const f of SFX_SAMPLES[k].files) expect(f.length, f.file).toBeLessThanOrEqual(0.35);
  });

  it("文件地址带部署的挂载路径与内容哈希", () => {
    const f = SFX_SAMPLES["ui.click"].files[0];
    expect(sfxUrl(f)).toBe(`${import.meta.env.BASE_URL}audio/sfx/${f.file}?v=${f.hash}`);
  });
});

describe("音效事件表", () => {
  it("每一层都用清单里有的素材；每种素材都有事件用到；界面的素材都在清单里", () => {
    const used = new Set<string>();
    for (const id of SFX_IDS) {
      const def = SFX[id];
      expect(def.layers.length, id).toBeGreaterThan(0);
      for (const l of def.layers) {
        expect(SFX_SAMPLES[l.sample], `${id}: ${l.sample}`).toBeTruthy();
        used.add(l.sample);
        expect(l.level, id).toBeLessThanOrEqual(0);
        expect(l.level, id).toBeGreaterThanOrEqual(-40);
      }
      expect(def.gap, id).toBeGreaterThan(0);
      expect(def.perSecond, id).toBeGreaterThanOrEqual(1);
      expect(def.priority, id).toBeGreaterThanOrEqual(0);
      expect(def.priority, id).toBeLessThanOrEqual(3);
    }
    expect(SAMPLE_IDS.filter((k) => !used.has(k))).toEqual([]);
    for (const k of UI_SAMPLES) expect(SFX_SAMPLES[k]).toBeTruthy();
  });

  it("界面的声音比交易与航海的轻（事件表的音量），海战的声音最响", () => {
    const top = (id: SfxId) => Math.max(...SFX[id].layers.map((l) => l.level));
    const uiIds: SfxId[] = ["click", "tab", "open", "close", "toggleOn", "toggleOff", "slider", "notify"];
    const gameIds: SfxId[] = ["buy", "sell", "sellAll", "depart", "arrive", "repair", "shipyard", "resupply"];
    const warIds: SfxId[] = ["fire", "hit", "miss", "sink", "board", "volley"];
    expect(Math.max(...uiIds.map(top))).toBeLessThan(Math.min(...gameIds.map(top)));
    expect(Math.max(...warIds.map(top))).toBe(Math.max(...SFX_IDS.map(top)));
    expect(Math.max(...gameIds.map(top))).toBeLessThan(top("fire"));
    // 高频操作（点按钮、滑条）的声音每次都有细微的变化
    expect(SFX.click.cents).toBeGreaterThan(0);
    expect(SFX.click.db).toBeGreaterThan(0);
    expect(SFX.slider.gap).toBeGreaterThanOrEqual(30);
  });

  it("出港、入港写了“短乐句奏着时省掉”的层，但总留着一层", () => {
    for (const id of ["depart", "arrive"] as const) {
      const layers = sfxDef(id).layers;
      expect(layers.some((l) => l.shy), id).toBe(true);
      expect(layers.some((l) => !l.shy), id).toBe(true);
    }
  });

  it("元素上写的 data-sfx 只认识表里的编号", () => {
    expect(isSfxId("click")).toBe(true);
    expect(isSfxId("sellAll")).toBe(true);
    expect(isSfxId("none")).toBe(false);
    expect(isSfxId("toString")).toBe(false);
    expect(isSfxId(3)).toBe(false);
  });

  it("音效音量：缺省 70%（与偏好的缺省一致），此时总线增益为 1；0 为静音；越大越响，最大约 +6 dB", () => {
    expect(DEFAULT_PREFS.sfx).toBe(SFX_DEFAULT);
    expect(sfxGain(SFX_DEFAULT)).toBeCloseTo(1, 6);
    expect(sfxGain(0)).toBe(0);
    expect(20 * Math.log10(sfxGain(1))).toBeCloseTo(6.2, 1);
    for (let v = 0.05; v <= 1; v += 0.05) expect(sfxGain(v)).toBeGreaterThan(sfxGain(v - 0.05));
    expect(sfxGain(2)).toBe(sfxGain(1));
  });
});

describe("限频、变体轮换、一串卖出、同时限数", () => {
  it("同一种音效两次之间至少隔 gap 毫秒；一秒内最多 perSecond 次；不同的音效互不影响", () => {
    const g = new Gate();
    expect(g.allow("click", 0, 45, 8)).toBe(true);
    expect(g.allow("click", 30, 45, 8)).toBe(false);
    expect(g.allow("tab", 30, 45, 8)).toBe(true);
    expect(g.allow("click", 50, 45, 8)).toBe(true);
    // 每 50 毫秒点一下：一秒内只放 8 次
    const h = new Gate();
    let n = 0;
    for (let t = 0; t < 1000; t += 50) if (h.allow("click", t, 45, 8)) n++;
    expect(n).toBe(8);
    // 高倍速下概览一秒来十次，每次都有一笔卖出：一秒最多 4 次，间隔不短于 90 毫秒
    const s = new Gate();
    const times: number[] = [];
    for (let t = 0; t < 3000; t += 100) if (s.allow("sell", t, SFX.sell.gap, SFX.sell.perSecond)) times.push(t);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(SFX.sell.gap);
    for (const t of times) expect(times.filter((u) => u > t - 1000 && u <= t).length).toBeLessThanOrEqual(SFX.sell.perSecond);
    expect(s.lastAt("sell")).toBe(times[times.length - 1]);
    expect(s.lastAt("never")).toBe(-Infinity);
  });

  it("变体轮换：一轮里每个变体各用一次，相邻两次（包括两轮之间）不重复；随机数确定时结果确定", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const r = new Rotation(rand);
    const seq = Array.from({ length: 400 }, () => r.next("coin", 4));
    for (let i = 0; i < seq.length; i += 4) expect([...seq.slice(i, i + 4)].sort()).toEqual([0, 1, 2, 3]);
    for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
    // 两个变体：交替
    const two = Array.from({ length: 20 }, () => r.next("pair", 2));
    for (let i = 1; i < two.length; i++) expect(two[i]).not.toBe(two[i - 1]);
    // 只有一个变体
    expect(r.next("single", 1)).toBe(0);
    seed = 7;
    const again = new Rotation(rand);
    expect(Array.from({ length: 400 }, () => again.next("coin", 4))).toEqual(seq);
  });

  it("全部卖出：第一笔照常“卖出”，紧接着又卖就响一次“全部卖出”，这一串里之后的不再响；隔久了重新算", () => {
    const b = new SaleBurst(1500);
    expect(b.next(0)).toBe("sell");
    expect(b.next(300)).toBe("sellAll");
    expect(b.next(600)).toBe(null);
    expect(b.next(2000)).toBe(null); // 离上一笔 1.4 秒，仍在这一串里
    expect(b.next(4000)).toBe("sell");
    expect(b.next(9000)).toBe("sell");
    // 一次卖掉好几种：直接响“全部卖出”；这一串里之后的（一件件的也好、又一次好几种也好）不再响
    const c = new SaleBurst(1500);
    expect(c.pour(0)).toBe("sellAll");
    expect(c.pour(400)).toBe(null);
    expect(c.next(800)).toBe(null);
    expect(c.next(5000)).toBe("sell");
    // 先卖了一种，紧接着一次卖掉其余的：大的只响一次
    expect(c.pour(5300)).toBe("sellAll");
    expect(c.next(5600)).toBe(null);
    expect(c.pour(9000)).toBe("sellAll");
  });

  it("同时限数：没满时直接放；满了时优先级高的挤掉最早的低优先级声音，否则新的不放", () => {
    const v = (priority: number, start: number) => ({ priority, start });
    expect(makeRoom([v(0, 0)], 0)).toBe("play");
    const full = Array.from({ length: MAX_VOICES }, (_, i) => v(i < 3 ? 0 : 2, i));
    expect(makeRoom(full, 0)).toBe("skip");
    expect(makeRoom(full, 2)).toBe(0);
    expect(makeRoom(full, 3)).toBe(0);
    const war = Array.from({ length: MAX_VOICES }, (_, i) => v(3, i));
    expect(makeRoom(war, 3)).toBe("skip");
    expect(makeRoom([v(1, 5), v(0, 9), v(0, 2)], 1, 3)).toBe(2);
  });
});

// ───────────────────────────── 状态的差

function fleet(over: Partial<Overview["fleets"][number]> = {}): Overview["fleets"][number] {
  return {
    id: 1,
    docked: 3,
    dest: null,
    x: 0,
    y: 0,
    path: [],
    days_at_sea: 0,
    ships: [{ kind: 0, durability: 80, max_durability: 100, capacity: 50, guns: 4, refits: [], resale: 1000 }],
    crew: 20,
    crew_min: 10,
    crew_max: 40,
    morale: 80,
    food: 10,
    water: 10,
    daily_need: 1,
    capacity: 50,
    used: 10,
    cargo: [{ good: 2, qty: 10, avg_cost: 30 }],
    repair_cost: 100,
    ...over,
  };
}

function ov(over: Partial<Overview> = {}): Overview {
  return {
    day: 10,
    year: 1,
    calendar_year: 1502,
    month: 1,
    date: 11,
    season: 0,
    scenario: "s",
    cash: 5000,
    deposit: 0,
    loans: 0,
    net_worth: 20000,
    total_assets: 21000,
    speed: 1,
    ai_mode: "Off",
    budget: null,
    fleets: [fleet()],
    caravans: [],
    others: [],
    winds: [],
    notices: [],
    reorganizations: 0,
    pending_battles: [],
    tactical_battles: [],
    pirates: [],
    fog_version: 0,
    goal: null,
    outcome: null,
    fame: 0,
    colonies: [],
    discoveries_unreported: 0,
    site_claims: [],
    ...over,
  } as Overview;
}

describe("从游戏状态的差认出该响什么", () => {
  const base = ov();

  it("卖出：现金增加、货舱减少；买入：现金减少、货舱增加；转运（两边都动、现金不变）不响", () => {
    expect(stateEvents(base, ov({ cash: 5600, fleets: [fleet({ cargo: [{ good: 2, qty: 0, avg_cost: 30 }] })] }), true)).toEqual(["sale"]);
    expect(stateEvents(base, ov({ cash: 4400, fleets: [fleet({ cargo: [{ good: 2, qty: 30, avg_cost: 30 }] })] }), true)).toEqual(["buy"]);
    // 买一种从没有过的货
    expect(stateEvents(base, ov({ cash: 4000, fleets: [fleet({ cargo: [{ good: 2, qty: 10, avg_cost: 30 }, { good: 5, qty: 8, avg_cost: 120 }] })] }), true)).toEqual(["buy"]);
    // 舰队与商队之间转运
    const withCaravan = ov({ caravans: [{ id: 4, animal: 0, count: 2, guards: 0, at: 3, leg: null, dest: null, capacity: 20, cargo: [], daily_cost: 5 }] });
    const moved = ov({
      fleets: [fleet({ cargo: [{ good: 2, qty: 4, avg_cost: 30 }] })],
      caravans: [{ id: 4, animal: 0, count: 2, guards: 0, at: 3, leg: null, dest: null, capacity: 20, cargo: [{ good: 2, qty: 6, avg_cost: 30 }], daily_cost: 5 }],
    });
    expect(stateEvents(withCaravan, moved, true)).toEqual([]);
    // 商队卖货也算
    const sold = ov({ cash: 5300, caravans: [{ ...moved.caravans[0], cargo: [] }], fleets: moved.fleets });
    expect(stateEvents(moved, sold, true)).toEqual(["sale"]);
    // 同一次更新里卖掉好几种货（一条命令卖光）：是“全部卖出”
    const two = ov({ fleets: [fleet({ cargo: [{ good: 2, qty: 10, avg_cost: 30 }, { good: 7, qty: 5, avg_cost: 90 }] })] });
    expect(stateEvents(two, ov({ cash: 6500, fleets: [fleet({ cargo: [] })] }), true)).toEqual(["saleMany"]);
    // 两种货里只卖了一种
    expect(stateEvents(two, ov({ cash: 5400, fleets: [fleet({ cargo: [{ good: 2, qty: 10, avg_cost: 30 }] })] }), true)).toEqual(["sale"]);
  });

  it("玩家的操作要“刚才有过用户操作”才响（运行中每天的结算也会动现金）；出港、入港与海盗的自动结算不要求", () => {
    const sale = ov({ cash: 5600, fleets: [fleet({ cargo: [] })] });
    expect(stateEvents(base, sale, false)).toEqual([]);
    expect(stateEvents(base, ov({ speed: 0 }), false)).toEqual([]);
    expect(stateEvents(base, ov({ fleets: [fleet({ docked: null })] }), false)).toEqual(["depart"]);
    expect(stateEvents(ov({ fleets: [fleet({ docked: null })] }), base, false)).toEqual(["arrive"]);
  });

  it("出港、入港只看旗舰队；别的舰队进出港不响", () => {
    const two = ov({ fleets: [fleet(), fleet({ id: 2, docked: 5 })] });
    expect(stateEvents(two, ov({ fleets: [fleet(), fleet({ id: 2, docked: null })] }), true)).toEqual([]);
  });

  it("修船、买船、改装、卖船、雇人与解雇、补给粮水", () => {
    const repaired = ov({ cash: 4900, fleets: [fleet({ ships: [{ ...fleet().ships[0], durability: 100 }] })] });
    expect(stateEvents(base, repaired, true)).toEqual(["repair"]);
    const bought = ov({ cash: 1000, fleets: [fleet({ ships: [...fleet().ships, { ...fleet().ships[0] }] })] });
    expect(stateEvents(base, bought, true)).toEqual(["shipyard"]);
    const refit = ov({ cash: 4500, fleets: [fleet({ ships: [{ ...fleet().ships[0], refits: [2] }] })] });
    expect(stateEvents(base, refit, true)).toEqual(["shipyard"]);
    const soldShip = ov({ cash: 6000, fleets: [fleet({ ships: [] })] });
    expect(stateEvents(bought, soldShip, true)).toContain("receive");
    expect(stateEvents(base, ov({ cash: 4800, fleets: [fleet({ crew: 30 })] }), true)).toEqual(["hire"]);
    expect(stateEvents(base, ov({ fleets: [fleet({ crew: 15 })] }), true)).toEqual(["hire"]);
    expect(stateEvents(base, ov({ cash: 4900, fleets: [fleet({ food: 30, water: 30 })] }), true)).toEqual(["resupply"]);
    // 在海上：修船、雇人、补给都不算
    const sea = ov({ fleets: [fleet({ docked: null })] });
    expect(stateEvents(sea, ov({ fleets: [fleet({ docked: null, ships: [{ ...fleet().ships[0], durability: 100 }] })] }), true)).toEqual([]);
  });

  it("银行：存款与还贷是付钱，取款与借款是收钱；只有利息变了不算", () => {
    expect(stateEvents(base, ov({ cash: 3000, deposit: 2000 }), true)).toEqual(["pay"]);
    expect(stateEvents(ov({ cash: 3000, deposit: 2000 }), base, true)).toEqual(["receive"]);
    expect(stateEvents(base, ov({ cash: 9000, loans: 4000 }), true)).toEqual(["receive"]);
    expect(stateEvents(ov({ cash: 9000, loans: 4000 }), base, true)).toEqual(["pay"]);
    expect(stateEvents(base, ov({ cash: 4990, deposit: 12 }), true)).toEqual([]);
  });

  it("改速度：暂停、继续、加快、放慢", () => {
    expect(stateEvents(base, ov({ speed: 0 }), true)).toEqual(["pause"]);
    expect(stateEvents(ov({ speed: 0 }), base, true)).toEqual(["resume"]);
    expect(stateEvents(base, ov({ speed: 4 }), true)).toEqual(["speedUp"]);
    expect(stateEvents(ov({ speed: 8 }), base, true)).toEqual(["speedDown"]);
  });

  it("海盗的遭遇自动结算了（没有转成战术海战）：远处的炮声；转成战术海战时不响", () => {
    const pirates = ov({ pending_battles: [{ id: 7, fleet: 1, pirate_ships: 2, pirate_guns: 12, pirate_crew: 40 }] });
    expect(stateEvents(pirates, base, false)).toEqual(["volley"]);
    expect(stateEvents(pirates, ov({ tactical_battles: [7] }), false)).toEqual([]);
  });

  it("读档、新开局、日子倒退、一次跳过好几天：不算；同一个对象也不算", () => {
    const sale = ov({ cash: 9000, fleets: [fleet({ cargo: [] })] });
    expect(continuous(base, sale)).toBe(true);
    expect(stateEvents(base, { ...sale, scenario: "t" }, true)).toEqual([]);
    expect(stateEvents(base, { ...sale, day: 9 }, true)).toEqual([]);
    expect(stateEvents(base, { ...sale, day: 16 }, true)).toEqual([]);
    expect(stateEvents(base, { ...sale, fleets: [fleet({ id: 9, cargo: [] })] }, true)).toEqual([]);
    expect(stateEvents(base, base, true)).toEqual([]);
    expect(stateEvents(null, base, true)).toEqual([]);
    expect(stateEvents(base, null, true)).toEqual([]);
  });

  it("航海日志里新出现的提醒（同一种只是数字变了不算）", () => {
    const low = (days: string) => ({ kind: "lowSupplies", args: [["fleet", "1"], ["days", days]] as [string, string][] });
    expect(newNotices(base, ov({ notices: [low("4")] }))).toBe(1);
    expect(newNotices(ov({ notices: [low("4")] }), ov({ notices: [low("3")] }))).toBe(0);
    expect(newNotices(ov({ notices: [low("4")] }), ov({ notices: [low("3"), { kind: "loanOverdue", args: [["loan", "2"]] }] }))).toBe(1);
    expect(newNotices(base, { ...ov({ notices: [low("4")] }), scenario: "t" })).toBe(0);
  });
});

describe("卷轴提示与错误的文字", () => {
  it("存档、读档（中文与英文）；其余为一般的提示", () => {
    expect(messageEvent("已存档：save1")).toBe("save");
    expect(messageEvent("Saved: my game")).toBe("save");
    expect(messageEvent("已读档：save1")).toBe("load");
    expect(messageEvent("Loaded: save2")).toBe("load");
    expect(messageEvent("抵达卡迪尔港。")).toBe("notify");
    expect(messageEvent("卖出香料 10 件，得 1,200 金币（盈亏 +300）")).toBe("notify");
  });

  it("钱不够（交易所的提示与后端的“现金不足”，中文与英文）是空钱袋；其余错误是“被拒”", () => {
    expect(errorEvent("现金不够。")).toBe("broke");
    expect(errorEvent("Not enough cash.")).toBe("broke");
    expect(errorEvent("现金不足：需要 1200，现有 800")).toBe("broke");
    expect(errorEvent("Not enough gold: need 1200, have 800.")).toBe("broke");
    expect(errorEvent("舱位不足：需要 20，空余 5")).toBe("error");
    expect(errorEvent("network down")).toBe("error");
  });
});

// ───────────────────────────── 全局点击委托

function el(html: string): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = html;
  document.body.appendChild(div);
  return div;
}

describe("全局点击委托：一下点击该响什么", () => {
  it("普通按钮、链接“嗒”；页签翻页；按钮里的图标、文字也算点在按钮上", () => {
    const root = el('<button id="a"><span id="a-in">买入</span></button><a id="l" href="#x">链接</a><div role="tablist"><button role="tab" id="t">卖出</button></div>');
    expect(clickSfx(root.querySelector("#a"))).toBe("click");
    expect(clickSfx(root.querySelector("#a-in"))).toBe("click");
    expect(clickSfx(root.querySelector("#l"))).toBe("click");
    expect(clickSfx(root.querySelector("#t"))).toBe("tab");
    root.remove();
  });

  it("禁用的按钮不响：disabled、aria-disabled、在禁用的 fieldset 里", () => {
    const root = el('<button id="d" disabled><span id="d-in">x</span></button><button id="ad" aria-disabled="true">y</button><fieldset disabled><button id="f">z</button></fieldset>');
    expect(clickSfx(root.querySelector("#d"))).toBeNull();
    expect(clickSfx(root.querySelector("#d-in"))).toBeNull();
    expect(clickSfx(root.querySelector("#ad"))).toBeNull();
    expect(clickSfx(root.querySelector("#f"))).toBeNull();
    root.remove();
  });

  it("data-sfx：写 none 不响（元素本身或外面的容器）；写一个编号就响那个；不认识的编号照常“嗒”", () => {
    const root = el(
      '<button id="n" data-sfx="none">x</button><div data-sfx="none"><button id="nc">y</button></div>' +
        '<button id="s" data-sfx="save">存</button><div data-sfx="coin"><button id="bad">z</button></div>' +
        '<div data-sfx="none"><button id="over" data-sfx="tab">页</button></div><div id="plain">字</div>',
    );
    expect(clickSfx(root.querySelector("#n"))).toBeNull();
    expect(clickSfx(root.querySelector("#nc"))).toBeNull();
    expect(clickSfx(root.querySelector("#s"))).toBe("save");
    expect(clickSfx(root.querySelector("#bad"))).toBe("click");
    expect(clickSfx(root.querySelector("#over"))).toBe("tab");
    expect(clickSfx(root.querySelector("#plain"))).toBeNull();
    expect(clickSfx(null)).toBeNull();
    root.remove();
  });

  it("顶栏的暂停与倍速按钮本身不响（速度变了由状态的变化出声）", () => {
    expect(QUIET.length).toBeGreaterThan(0);
    const root = el('<div data-testid="speed"><button id="p">暂停</button><button id="x2">2×</button></div>');
    expect(clickSfx(root.querySelector("#p"))).toBeNull();
    expect(clickSfx(root.querySelector("#x2"))).toBeNull();
    root.remove();
  });

  it("勾选框：勾上与取消各一声；单选与下拉“嗒”；文字输入框不响；写了 data-sfx=none 的不响", () => {
    const root = el('<input id="c" type="checkbox"><input id="r" type="radio"><select id="s"><option>1</option></select><input id="t" type="text"><span data-sfx="none"><input id="q" type="checkbox"></span>');
    const c = root.querySelector("#c") as HTMLInputElement;
    c.checked = true;
    expect(changeSfx(c)).toBe("toggleOn");
    c.checked = false;
    expect(changeSfx(c)).toBe("toggleOff");
    expect(changeSfx(root.querySelector("#r"))).toBe("click");
    expect(changeSfx(root.querySelector("#s"))).toBe("click");
    expect(changeSfx(root.querySelector("#t"))).toBeNull();
    expect(changeSfx(root.querySelector("#q"))).toBeNull();
    root.remove();
  });

  it("滑条按档位：分成 20 档，音高随位置升高", () => {
    const root = el('<input id="v" type="range" min="0" max="100" value="0"><input id="w" type="range" min="16" max="45" value="45"><input id="t" type="text">');
    const v = root.querySelector("#v") as HTMLInputElement;
    expect(sliderStep(v)).toEqual({ step: 0, frac: 0 });
    v.value = "52";
    expect(sliderStep(v)?.step).toBe(10);
    v.value = "100";
    expect(sliderStep(v)).toEqual({ step: SLIDER_DETENTS, frac: 1 });
    expect(sliderStep(root.querySelector("#w"))).toEqual({ step: SLIDER_DETENTS, frac: 1 });
    expect(sliderStep(root.querySelector("#t"))).toBeNull();
    expect(sliderRate(0)).toBeCloseTo(0.85);
    expect(sliderRate(1)).toBeCloseTo(1.2);
    expect(sliderRate(0.5)).toBeGreaterThan(sliderRate(0.4));
    root.remove();
  });
});

describe("战术海战：战报 → 炮声、命中、落空、击沉、接舷", () => {
  const unit = (id: number, player: boolean) => ({ id, player, ship: 0, kind: 0, q: 0, r: 0, facing: 0, hp: 10, max_hp: 10, crew: 5, guns: 4, mp: 2, mp_left: 2, status: "Active" });
  const battle = (log: TacticalBattle["log"]): TacticalBattle => ({ id: 1, fleet: 1, pirate: 2, started: 0, turn: 1, radius: 4, wind: 0, units: [unit(1, true), unit(2, false)], log }) as unknown as TacticalBattle;

  it("新出现的条目按先后错开：我方开炮在左、敌方在右且轻一点，0.4 秒后命中或落空；击沉；接舷；别的条目不响", () => {
    const before = battle([[1, { Fire: { from: 1, to: 2, damage: 3 } }]]);
    const after = battle([
      [1, { Fire: { from: 1, to: 2, damage: 3 } }],
      [1, { Fire: { from: 1, to: 2, damage: 0 } }],
      [1, { Fire: { from: 2, to: 1, damage: 4 } }],
      [1, { Sunk: { unit: 2 } }],
      [1, "RetreatFailed"],
      [2, { Board: { from: 1, to: 2, captured: true } }],
    ]);
    const cues = battleCues(before, after);
    expect(cues.map((c) => c.id)).toEqual(["fire", "miss", "fire", "hit", "sink", "board"]);
    expect(cues[0]).toMatchObject({ at: 0, pan: -0.25, gain: 0 });
    expect(cues[1].at).toBeCloseTo(0.4);
    expect(cues[2]).toMatchObject({ pan: 0.3, gain: -3 });
    expect(cues[2].at).toBeCloseTo(0.6);
    for (let i = 1; i < cues.length; i++) expect(cues[i].at).toBeGreaterThanOrEqual(cues[i - 1].at);
  });

  it("没有新条目、换了一场海战、第一次看到这场海战：不响；一批最多 8 件", () => {
    const b = battle([[1, { Fire: { from: 1, to: 2, damage: 3 } }]]);
    expect(battleCues(b, b)).toEqual([]);
    expect(battleCues(null, b)).toEqual([]);
    expect(battleCues(b, { ...b, id: 2, log: [...b.log, ...b.log] })).toEqual([]);
    const many = battle(Array.from({ length: 30 }, () => [1, { Board: { from: 1, to: 2, captured: false } }] as TacticalBattle["log"][number]));
    expect(battleCues(battle([]), many).length).toBe(8);
  });
});

// ───────────────────────────── 播放器（假的音频上下文）

interface FakeNode {
  kind: string;
  connected: FakeNode[];
  started?: { when: number; offset: number };
  stopped?: number;
  gain?: { value: number; events: unknown[] };
  playbackRate?: { value: number };
  pan?: { value: number };
  buffer?: { duration: number };
}

/** 只记录节点、连接与排的时刻的假音频上下文（jsdom 没有 Web Audio）。 */
class FakeContext {
  currentTime = 10;
  sampleRate = 44100;
  state = "running";
  nodes: FakeNode[] = [];
  private param(value: number) {
    const events: unknown[] = [];
    return {
      value,
      events,
      setValueAtTime: (v: number, t: number) => events.push(["set", v, t]),
      linearRampToValueAtTime: (v: number, t: number) => events.push(["ramp", v, t]),
      cancelScheduledValues: (t: number) => events.push(["cancel", t]),
    };
  }
  private node(kind: string, extra: object = {}): FakeNode & { connect: (n: FakeNode) => FakeNode; disconnect: () => void } {
    const n = {
      kind,
      connected: [] as FakeNode[],
      connect(to: FakeNode) {
        n.connected.push(to);
        return to;
      },
      disconnect() {},
      ...extra,
    };
    this.nodes.push(n);
    return n;
  }
  createGain() {
    return this.node("gain", { gain: this.param(1) });
  }
  createStereoPanner() {
    return this.node("pan", { pan: { value: 0 } });
  }
  createBufferSource() {
    const n = this.node("source", { playbackRate: { value: 1 }, buffer: null });
    return Object.assign(n, {
      start(when: number, offset = 0) {
        n.started = { when, offset };
      },
      stop(t: number) {
        n.stopped = t;
      },
      addEventListener() {},
    });
  }
  decodeAudioData(): Promise<AudioBuffer> {
    const data = new Float32Array(2205);
    data[132] = 0.5; // 起音在 3 毫秒处
    return Promise.resolve({ duration: 0.05, length: 2205, sampleRate: 44100, numberOfChannels: 1, getChannelData: () => data } as unknown as AudioBuffer);
  }
}

async function loadedPlayer(rand: () => number = () => 0.5) {
  const ctx = new FakeContext();
  const origFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) })) as unknown as typeof fetch;
  const dest = ctx.createGain();
  const p = new SfxPlayer(ctx as unknown as BaseAudioContext, dest as unknown as AudioNode, rand);
  try {
    expect(await p.load(SAMPLE_IDS)).toBe(true);
  } finally {
    globalThis.fetch = origFetch;
  }
  expect(p.ready(SAMPLE_IDS)).toBe(true);
  return { ctx, p };
}

const sources = (ctx: FakeContext) => ctx.nodes.filter((n) => n.kind === "source" && n.started);

describe("播放器", () => {
  it("一个音效按事件表叠层：每层一个缓冲源，按延迟排好；从对齐后的起音处开始放", async () => {
    const { ctx, p } = await loadedPlayer();
    expect(p.play("repair", {}, 0)).toBe(true);
    const s = sources(ctx);
    expect(s.length).toBe(SFX.repair.layers.length);
    expect(s[0].started?.when).toBeCloseTo(10);
    expect(s[1].started?.when).toBeCloseTo(10.3, 1);
    expect(s[2].started?.when).toBeCloseTo(10.6, 1);
    // 假解码出来的起音在 3 毫秒处，清单里的标记也在 3 毫秒上下：偏移只是两者之差（0–0.2 秒）
    for (const n of s) expect(n.started!.offset).toBeGreaterThanOrEqual(0);
    for (const n of s) expect(n.started!.offset).toBeLessThan(0.2);
    expect(p.stamp).toBe(1);
  });

  it("限频：同一种音效太快地连着来只放第一个；延迟放的按真正响起的时刻算", async () => {
    const { ctx, p } = await loadedPlayer();
    expect(p.play("click", {}, 0)).toBe(true);
    expect(p.play("click", {}, 20)).toBe(false);
    expect(p.play("click", {}, 60)).toBe(true);
    expect(p.play("fire", { delay: 0 }, 1000)).toBe(true);
    expect(p.play("fire", { delay: 0.6 }, 1000)).toBe(true);
    expect(sources(ctx).length).toBe(4);
  });

  it("每次的音高与音量有细微的随机：点按钮的快慢在 ±60 音分以内", async () => {
    let k = 0;
    const seq = [0, 1, 0.5, 0.25];
    const { ctx, p } = await loadedPlayer(() => seq[k++ % seq.length]);
    for (let i = 0; i < 6; i++) p.play("click", {}, i * 100);
    const rates = sources(ctx).map((n) => n.playbackRate!.value);
    expect(new Set(rates.map((r) => r.toFixed(4))).size).toBeGreaterThan(1);
    for (const r of rates) expect(Math.abs(1200 * Math.log2(r))).toBeLessThanOrEqual(60.001);
  });

  it("短乐句奏着时：写了 shy 的层省掉，一般的提示不放，音效总线压低约 4 dB 再回来", async () => {
    const { ctx, p } = await loadedPlayer();
    p.jingle(10.1, 15);
    expect(p.inJingle(10)).toBe(true);
    expect(p.inJingle(16)).toBe(false);
    expect(p.play("depart", {}, 0)).toBe(true);
    const shyCount = SFX.depart.layers.filter((l) => "shy" in l && l.shy).length;
    expect(sources(ctx).length).toBe(SFX.depart.layers.length - shyCount);
    expect(p.play("notify", {}, 0)).toBe(false);
    const bus = ctx.nodes[1];
    const ramps = (bus.gain?.events ?? []).filter((e) => (e as unknown[])[0] === "ramp") as [string, number, number][];
    expect(ramps[0][1]).toBeCloseTo(0.63);
    expect(ramps[0][2]).toBeCloseTo(10.15);
    expect(ramps[1][1]).toBe(1);
    expect(ramps[1][2]).toBeCloseTo(15.6);
    // 短乐句过去之后照常
    ctx.currentTime = 20;
    expect(p.play("arrive", {}, 30000)).toBe(true);
    expect(sources(ctx).length).toBe(SFX.depart.layers.length - shyCount + SFX.arrive.layers.length);
  });

  it("音频上下文挂起（切到后台）或关了时不放，免得恢复的一刻一起冒出来；恢复之后照常", async () => {
    const { ctx, p } = await loadedPlayer();
    ctx.state = "suspended";
    expect(p.play("click", {}, 0)).toBe(false);
    ctx.state = "closed";
    expect(p.play("sell", {}, 0)).toBe(false);
    expect(sources(ctx).length).toBe(0);
    ctx.state = "running";
    expect(p.play("click", {}, 0)).toBe(true);
    expect(sources(ctx).length).toBe(1);
  });

  it("同时响的太多：低优先级的新声音不放，海战的声音挤掉最早的界面声音", async () => {
    const { ctx, p } = await loadedPlayer();
    for (let i = 0; i < MAX_VOICES; i++) p.play("click", {}, i * 1000);
    expect(sources(ctx).length).toBe(MAX_VOICES);
    // 同一时刻（音频时钟没走）再来界面的声音：满了、优先级不比别人高
    expect(p.play("tab", {}, 99000)).toBe(true);
    expect(sources(ctx).length).toBe(MAX_VOICES);
    p.play("fire", {}, 99000);
    expect(sources(ctx).length).toBe(MAX_VOICES + 1);
    expect(sources(ctx)[0].stopped).toBeDefined();
  });
});
