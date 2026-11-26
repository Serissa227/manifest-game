// 本地请求序号（第九批 P03 的前端配套）。
//
// 后端不会替前端判断“这条回复是不是上一局的”：overview.epoch 只是服务端状态的驻留编号，同一个进程里开新局、读档、换世界
// 都不会换；Overview.rev 允许跳号，只能做单调比较。所以前端自己记一个序号：新开局、读档、换世界之后序号加一。
// 每个请求发出时记下当时的序号，回来时序号变了就不再采用——视图、航行视图、航迹预测、
// 迷雾增量都这样丢掉迟到的旧回复，再按新的世界重新问一次。迷雾另有 fog_delta.epoch 配合（换了一局后端按 epoch 给全量）。
// busy / reconnect / resync 三种原因原是给联网传输用的，桌面版不会发出；迷雾与航行视图对它们的处理照旧保留（测试也拿它们当触发）。
//
// 这个模块不依赖任何别的模块（api.ts 与各视图的调度都引用它，不能成环）。

/** 序号为什么加一。 */
export type SeqReason =
  /** 新开局 */
  | "new_game"
  /** 读档 */
  | "load"
  /** 换世界（开局界面选定世界） */
  | "world"
  /** 事件连接被服务端以 1013 关闭（慢连接积压，要求稍后再试）：此刻起手上在路上的回复都作废 */
  | "busy"
  /** 断线重连成功 */
  | "reconnect"
  /** 因 1013 断开后重连成功：随后界面重新读概览，并且从头（since 0、epoch 空）取一次完整的迷雾 */
  | "resync";

type SeqListener = (seq: number, reason: SeqReason) => void;

let current = 0;
const listeners = new Set<SeqListener>();

/** 当前的请求序号。发请求时记下它，回来时用 {@link isCurrentSeq} 判断要不要采用。 */
export function requestSeq(): number {
  return current;
}

/** 这个序号（发请求时记下的）是不是还有效。 */
export function isCurrentSeq(seq: number): boolean {
  return seq === current;
}

/** 序号加一并通知订阅者（视图重新排队、迷雾与航行视图丢掉在路上的请求）。 */
export function bumpRequestSeq(reason: SeqReason): number {
  current += 1;
  for (const f of [...listeners]) f(current, reason);
  return current;
}

/** 订阅序号的变化；返回注销函数。 */
export function onRequestSeq(f: SeqListener): () => void {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

/**
 * 会换掉整局世界的调用（开新局、读档、换世界）：不论成败，回来之后序号加一，再把结果交给调用方。
 * 只在回来时加一就够了：此前发出的请求都在这一刻之前，序号对不上，回复不会被采用；失败也加，因为超时的调用服务端可能已经换了世界。
 */
export async function switchingWorld<T>(reason: "new_game" | "load" | "world", call: Promise<T>): Promise<T> {
  try {
    return await call;
  } finally {
    bumpRequestSeq(reason);
  }
}
