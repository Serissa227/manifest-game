import { useSyncExternalStore } from "react";
import { onRequestSeq, requestSeq } from "../ipc/sequence";

/**
 * 本地请求序号（ipc/sequence.ts）：新开局、读档、换世界、重连之后加一。
 * 把它放进“发请求的 effect”的依赖里，序号一变 effect 就清理（在路上的回复不再采用）并重新发请求。
 */
export function useRequestSeq(): number {
  return useSyncExternalStore((notify) => onRequestSeq(() => notify()), requestSeq, requestSeq);
}
