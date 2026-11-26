// 新手教程的状态：是否在进行、到第几步、是否已经看完（看完或跳过后不再自动出现）。
// “看完”只保存在本机（localStorage 的 manifest.tutorial）；读写失败（隐私模式等）时按没看过处理、只在本次运行中生效。
import { create } from "zustand";

const KEY = "manifest.tutorial";
/** 第九批的养成教程（养成主画面的第一个月）：单独记"看过没有"。 */
const UB_KEY = "manifest.tutorial.upbringing";

function loadDone(key: string = KEY): boolean {
  try {
    return globalThis.localStorage?.getItem(key) === "done";
  } catch {
    return false;
  }
}

function saveDone(done: boolean, key: string = KEY): void {
  try {
    if (done) globalThis.localStorage?.setItem(key, "done");
    else globalThis.localStorage?.removeItem(key);
  } catch {
    // 本机存储不可用时只在本次运行中生效
  }
}

export interface TutorialState {
  active: boolean;
  step: number;
  /** 看完或跳过过（不再在新开局时自动出现） */
  done: boolean;
  start: () => void;
  go: (step: number) => void;
  /** 结束（看完或跳过）：记下已看过 */
  finish: () => void;
}

export const useTutorial = create<TutorialState>((set) => ({
  active: false,
  step: 0,
  done: loadDone(),
  start: () => set({ active: true, step: 0 }),
  go: (step) => set({ step }),
  finish: () => {
    saveDone(true);
    set({ active: false, step: 0, done: true });
  },
}));

/** 养成教程的状态（与出海的教程同样的形状，各记各的）。 */
export const useUbTutorial = create<TutorialState>((set) => ({
  active: false,
  step: 0,
  done: loadDone(UB_KEY),
  start: () => set({ active: true, step: 0 }),
  go: (step) => set({ step }),
  finish: () => {
    saveDone(true, UB_KEY);
    set({ active: false, step: 0, done: true });
  },
}));

/**
 * U06F2：养成视图带着行动制（`act`）时为 true（UpbringingScreen 写）。原来的九步养成教程圈的是旧界面的块，
 * 行动制下全部落空——这时不启动那套教程（已经开了的先收起，不算看过）。教程本身不删、不改。
 */
export const useUbActOn = create<{ on: boolean; known: boolean }>(() => ({ on: false, known: false }));
// U07F：known——养成视图已经取到（取到之前不知道是不是行动制；开场的人物介绍要等它，免得先闪一下普通的剧情弹窗）

/** 测试用：清掉养成教程的“已看过”。 */
export function resetUbTutorial(): void {
  saveDone(false, UB_KEY);
  useUbTutorial.setState({ active: false, step: 0, done: false });
}

/** 这一次运行里见过养成画面（R10-Q02：之后进到航海外壳就是“第一次进入航海期”）。只在内存里，不存本机。 */
let upbringingSeen = false;

export function markUpbringingSeen(): void {
  upbringingSeen = true;
}

/**
 * 是不是第一次进入航海期（出海教程据此自动开始）：经典世界的新开局（第 0–1 天），
 * 或这一次运行里先在养成里、现在已经出海（寰宇结业那天；跳过养成的开局是给玩过的人的，不算）。
 */
export function firstVoyage(o: { day: number; mode?: "upbringing" | "voyage" }): boolean {
  if (o.mode === "upbringing") return false;
  return o.day <= 1 || upbringingSeen;
}

/** 测试用：清掉“已看过”。 */
export function resetTutorial(): void {
  saveDone(false);
  useTutorial.setState({ active: false, step: 0, done: false });
}
