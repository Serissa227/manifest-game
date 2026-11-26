// 剧情事件（推荐角色的故事线与奇遇）的界面小工具：去重键、说话人的头像与名字、效果的写法、“稍后再说”的记忆；
// 第九批 I5b：旁观的一幕里台上哪一位在说话；第九批 I5：事件种类的标签、选项不能选的原因（代码或写好的一句话）、故事 2.0 的效果。
// 纯函数与一个很小的 zustand 仓库，便于测试。
import { create } from "zustand";
import { onGameSwitch } from "../../store/gameSwitch";
import { captainAssetId, mateAssetId } from "../../art/portraitCast";
import { lookup, money, t, tk } from "../../i18n";
import type { Overview, StaticView, StoryCastView, StoryEventView, StoryOutcomeView, StoryResultView, StorySpeakerView } from "../../ipc/types";
import { attributeName } from "../start/captainText";

/** 一件等待回应的事件的键：同一件事件“稍后再说”之后不再自动弹出。 */
export function pendingKey(p: StoryEventView | null | undefined): string {
  return p ? `${p.day}:${p.kind}:${p.key}` : "";
}

/** 一次结果的去重键（不含文字：切换语言后同一个结果不算新结果）。 */
export function storyResultKey(r: StoryResultView | null | undefined): string {
  return r ? `${r.day}:${r.kind}:${r.key}:${r.choice === null ? "-" : "x"}:${r.success === null ? "" : r.success}` : "";
}

/** 叙事里的 {captain} 换成主角的姓名。 */
export function fillCaptain(text: string, captain: string): string {
  return text.split("{captain}").join(captain);
}

/** 主角的姓名（没有时用顶栏的缺省称呼）。 */
export function captainNameOf(o: Pick<Overview, "captain"> | null | undefined): string {
  return o?.captain?.name?.trim() || t("shellCaptainDefault");
}

/** 说话人的头像素材 id 与名字；旁白时素材为 null。 */
export function speakerOf(s: StorySpeakerView, o: Overview | null | undefined): { asset: string | null; name: string; look: number } {
  const look = o?.captain?.portrait ?? 0;
  switch (s.kind) {
    case "captain":
      return { asset: o?.captain_asset ?? captainAssetId(look), name: captainNameOf(o), look };
    case "mate":
      return { asset: mateAssetId({ name: s.name, key: s.mate }), name: s.name, look };
    case "portrait":
      return { asset: s.asset ?? null, name: s.name, look };
    default:
      return { asset: null, name: "", look };
  }
}

/** 带正负号的数值：+3、−2（用真正的减号）。 */
export function signed(n: number, fmt: (v: number) => string = (v) => String(v)): string {
  if (n > 0) return `+${fmt(n)}`;
  if (n < 0) return `−${fmt(-n)}`;
  return fmt(0);
}

/** 事件种类的标签（标题上方的一行：“主线”“羁绊”“请托”……）；认不出的种类按“奇遇”。 */
export function kindLabel(kind: string): string {
  return lookup(`story.kind.${kind}`) ?? t("story.encounter");
}

/**
 * 选项不能选的原因：经典故事给代码（cash / cargo），按 story.blocked.<代码> 写；
 * 故事 2.0 与怪异给后端写好的一句话（当前语言），照写——界面字符串里没有这个代码的就是写好的话。
 */
export function blockedText(blocked: string): string {
  return lookup(`story.blocked.${blocked}`) ?? blocked;
}

/** 一条效果的写法（名字按当前语言从静态数据里取）；不给玩家看的效果（剧情旗标）与认不出的种类为空串。 */
export function outcomeText(o: StoryOutcomeView, statics: StaticView | null): string {
  const discovery = () => statics?.discoveries?.find((d) => d.id === o.discovery)?.name ?? "?";
  const attr = () => (statics?.captain && o.attr ? attributeName(statics.captain, o.attr) : (o.attr ?? "?"));
  const person = () => o.person_name ?? o.person ?? "?";
  switch (o.kind) {
    case "cash":
      return t("story.out.cash", { v: signed(o.value, money) });
    case "goods":
      return t("story.out.goods", { good: statics?.goods[o.good ?? -1]?.name ?? "?", v: signed(o.value) });
    case "reputation":
      return t("story.out.reputation", { faction: statics?.factions[o.faction ?? -1]?.name ?? "?", v: signed(o.value) });
    case "rumor":
    case "reveal":
      return tk(`story.out.${o.kind}`, { discovery: discovery() });
    case "chart":
      return t("story.out.chart", { region: statics?.regions[o.region ?? -1]?.name ?? "?" });
    case "mate":
      // 故事 2.0 的离队也是 mate（value 为 -1）
      return t(o.value < 0 ? "story.out.mate_leave" : "story.out.mate", { mate: o.mate_name ?? o.mate ?? "?" });
    case "mate_busy":
      return t("story.out.mate_busy", { mate: o.mate_name ?? o.mate ?? "?" });
    case "attr":
      return t("story.out.attr", { attr: attr(), v: signed(o.value) });
    case "repair":
    case "damage":
      return tk(`story.out.${o.kind}`, { v: o.value });
    case "news":
      return t("story.out.news", { text: o.text ?? "" });
    case "growth":
      return t("story.out.growth", { attr: attr(), v: signed(o.value) });
    case "skill":
      // B12：后端给当前语言的技能名（skill_name）；旧后端只给 key 时照旧不写 key 本身
      return o.skill_name ? t("story.out.skillNamed", { skill: o.skill_name, v: signed(o.value) }) : t("story.out.skill", { v: signed(o.value) });
    case "affinity":
    case "heart":
      return tk(`story.out.${o.kind}`, { name: person(), v: signed(o.value) });
    case "relation": {
      // 配角之间的关系：text 已经是“甲 / 乙 · 关系名”
      const tie = (o.persons?.length ?? 0) > 1;
      const end = o.value < 0;
      if (tie) return t(end ? "story.out.tieEnd" : "story.out.tie", { text: o.text ?? "" });
      return t(end ? "story.out.relationEnd" : "story.out.relation", { name: person(), label: o.text ?? "" });
    }
    case "item":
      return t(o.value < 0 ? "story.out.itemGive" : "story.out.item", { name: o.item_name ?? o.item ?? "?", n: Math.abs(o.value) });
    case "memory":
      return t("story.out.memory", { title: o.title ?? "" });
    case "title":
      return t("story.out.title", { title: o.title ?? "" });
    case "letter":
      return t("story.out.letter", { name: person(), text: o.text ?? "" });
    case "fame":
    case "morale":
    case "crew":
    case "supplies":
      return tk(`story.out.${o.kind}`, { v: signed(o.value) });
    case "flag":
      // 剧情旗标是内部状态（key 没有显示名），不给玩家看
      return "";
    default: {
      // 新后端多出来的种类：界面字符串里有就照写，没有就不显示（不把键名露给玩家）
      const key = `story.out.${(o as { kind: string }).kind}`;
      return lookup(key) === undefined ? "" : tk(key, { v: signed(o.value) });
    }
  }
}

/** 结果里要列出来的效果：写得出来的（剧情旗标与认不出的种类不列）。 */
export function shownOutcomes(outcomes: readonly StoryOutcomeView[], statics: StaticView | null): { o: StoryOutcomeView; text: string }[] {
  return outcomes.map((o) => ({ o, text: outcomeText(o, statics) })).filter((x) => x.text !== "");
}

/**
 * 效果是好是坏（界面着色）：扣钱、受损、士气下降、失去水手、有人离队为坏；
 * 见闻、来信与关系不分好坏（结下宿敌也是关系）；回忆与称号算好。
 */
export function outcomeTone(o: StoryOutcomeView): "up" | "down" | "same" {
  if (o.kind === "news" || o.kind === "letter" || o.kind === "relation" || o.kind === "flag") return "same";
  if (o.kind === "damage" || o.kind === "mate_busy") return "down";
  if (o.kind === "mate") return o.value < 0 ? "down" : "up";
  if (o.kind === "rumor" || o.kind === "reveal" || o.kind === "chart" || o.kind === "repair" || o.kind === "memory" || o.kind === "title") return "up";
  return o.value > 0 ? "up" : o.value < 0 ? "down" : "same";
}

/**
 * 旁观的一幕（I5b）：台上哪一位在说话——按说话人的人物 key 认，其次按航海士 key、头像素材、名字；
 * 旁白、主角或台下的人说话时为 -1（台上的人都不加亮）。
 */
export function castSpeaker(cast: readonly StoryCastView[], s: StorySpeakerView): number {
  if (s.kind === "none" || s.kind === "captain") return -1;
  const by = (f: (c: StoryCastView) => boolean) => cast.findIndex(f);
  if (s.person) {
    const i = by((c) => c.person === s.person);
    if (i >= 0) return i;
  }
  if (s.mate) {
    const i = by((c) => c.person === s.mate);
    if (i >= 0) return i;
  }
  if (s.asset) {
    const i = by((c) => c.portrait === s.asset);
    if (i >= 0) return i;
  }
  return s.name ? by((c) => c.name === s.name) : -1;
}

/** 剧情对话框的界面状态：“稍后再说”合上的是哪一件事件，顶栏的故事面板开没开。 */
interface StoryUi {
  /** 合上的事件（pendingKey） */
  dismissed: string;
  /** 合上的那一天（世界日）：到了这件事的最后一天、又不是合上的当天时，对话框重新交到玩家面前（没记下日子的不再打扰） */
  dismissedDay: number;
  /** 故事面板是否打开 */
  panel: boolean;
  /** 刚回应过的旁观的一幕的台上的人（结果里没有 cast，结果对话框照旧并排画出来）：事件的 key 与台上的人 */
  sideCast: { key: string; cast: StoryCastView[] } | null;
  dismiss: (key: string, day?: number) => void;
  /** 重新打开合上的事件 */
  reopen: () => void;
  setPanel: (open: boolean) => void;
  rememberCast: (key: string, cast: StoryCastView[]) => void;
  /**
   * U06F9：剧情框开着时别处的命令被后端拒了（“眼前有事等你回应，先看完”）：对话框晃一下、框底写这一句。
   * nudge 每次加一（对话框按它重放晃动），nudgeText 是要写的那句。
   */
  nudge: number;
  nudgeText: string;
  /** 被晃的是哪件事（pendingKey）：换了事件就不再写 */
  nudgeKey: string;
  poke: (text: string, key: string) => void;
  /**
   * S02nF7：新开局、读档、换世界以后，新一局头一份概览里带来的 story.last 的去重键——那是存档里的上一次结果，
   * 只记下、不当新的结果弹出；之后变了才弹（store/gameSwitch.ts）。
   */
  carried: string;
}

export const useStoryUi = create<StoryUi>((set) => ({
  dismissed: "",
  dismissedDay: Number.POSITIVE_INFINITY,
  panel: false,
  sideCast: null,
  dismiss: (key, day = Number.POSITIVE_INFINITY) => set({ dismissed: key, dismissedDay: day }),
  reopen: () => set({ dismissed: "", dismissedDay: Number.POSITIVE_INFINITY, panel: false }),
  setPanel: (open) => set({ panel: open }),
  rememberCast: (key, cast) => set({ sideCast: { key, cast } }),
  nudge: 0,
  nudgeText: "",
  nudgeKey: "",
  poke: (text, key) => set((s) => ({ nudge: s.nudge + 1, nudgeText: text, nudgeKey: key })),
  carried: "",
}));

// 换局以后头一份概览里的 story.last：记下它（读档后不把存档里上一次的结果再弹一次）
onGameSwitch((o) => {
  if (o) useStoryUi.setState({ carried: storyResultKey(o.story?.last) });
});
