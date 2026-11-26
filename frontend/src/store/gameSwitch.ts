// 换局（S02nF7）：新开局、读档、换世界之后，新一局的头一份概览到了通知一次；换局失败（读档失败等）也通知一次（带 null）。
// 用它的：航行视图重取（hooks/useNavigation.ts 的换局序号）、剧情结果的“存档里带来的上一次结果不当新的弹”（components/story/StoryDialog.tsx）。
// 序号前进（ipc/sequence.ts 的 switchingWorld）是在后端换好局、调用方放进新概览之前，所以等概览真的换了才通知，
// 不在序号前进的当下通知（那时手上的还是上一局的概览）。
import { onRequestSeq } from "../ipc/sequence";
import type { Overview } from "../ipc/types";
import { useGame } from "./game";

/** o：新一局的头一份概览；null：换局没成（还在原来那一局）。 */
export type GameSwitchListener = (o: Overview | null) => void;

const listeners = new Set<GameSwitchListener>();
/** 换了局、新一局的概览还没到。 */
let waiting = false;

function emit(o: Overview | null): void {
  for (const f of [...listeners]) f(o);
}

onRequestSeq((_seq, reason) => {
  if (reason === "new_game" || reason === "load" || reason === "world") waiting = true;
});

useGame.subscribe((s, prev) => {
  if (!waiting || !s.overview || s.overview === prev.overview) return;
  waiting = false;
  emit(s.overview);
});

/** 订阅换局；返回注销函数。 */
export function onGameSwitch(f: GameSwitchListener): () => void {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

/** 换局没成（读档失败、开局失败）：不再等新概览，告诉各处回到原来那一局（例如重取航行视图）。 */
export function gameSwitchFailed(): void {
  if (!waiting) return;
  waiting = false;
  emit(null);
}
