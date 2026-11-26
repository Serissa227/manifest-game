// 曲目池与轮换（第九批 A01）。
//
// 原来出海以后每个情境只对一首曲子：一片海一首航海曲、一种文化一首港口曲、暴风雨一首、海战一首（另有奥斯曼的变奏），养成的每种事件一首。
// 现在每个情境对一个“曲目池”（ScenePool）：
// - primary：没有轮换时放的那一首——就是原来的规矩（zones.ts 的 seaTrackOf、portTrackIn、battleTrackOf，养成的 eventTrack），
//   纯函数 sceneOf 不给轮换时仍然返回它，原有的测试与行为一点不变；
// - tracks：有轮换时轮着放的曲子，第一首先放（多半就是 primary；大西洋的远洋原来借伊比利亚沿岸的一首，池里换成了自己的《信风带》）。
// 池是怎么定的见 zones.ts（海、港口、风暴、雾、海战）与 upbringing.ts（养成的事件）；只在数据明写了音乐分区 / 势力风格的世界里才有不止一首的池
// （经典世界的海区不写 music、势力不写 style，池里只有 primary，一切照旧）。
//
// 轮换的规矩（状态在 PoolRotations 里，由配乐导演持有；随机源注入，测试里固定种子）：
// - 第一次进这个情境先放池的第一首，其余洗成一副牌（与养成平时的轮换同一套洗牌：一副放完再洗，同一首不连着放）；
// - 一遍奏完、进了留白（POOL_RULES 的 rest 秒，让余音散掉、留一段只有海浪的空白）并且这一首累计听够了 min 秒：轮到下一首，立即换；
//   海战与养成的事件不在放的时候换（rest 为 null：一场海战、一件事从头到尾是同一首）；
// - 离开这个情境再回来（进港又出港、风暴过去、下一场海战、下一件心动的事）：离开了至少 away 秒、而且上一首累计听了至少 heard 秒，
//   回来时轮到下一首；离开得短（风暴只刮了一小会儿）就接着放原来那一首——引擎会从离开的那一段接上。
// 时间一律用音频时间（AudioContext.currentTime）：页面在后台、音频挂起时不算。
import type { TrackId } from "./tracks";
import { nextRotation, startRotation, type UbRotation } from "./upbringing";

/** 情境的种类（决定轮换的节奏，见 POOL_RULES）。 */
export type PoolKind = "sea" | "port" | "storm" | "battle" | "event";

/** 一个情境的曲目池。 */
export interface ScenePool {
  /** 没有轮换时放的那一首（原来的规矩） */
  primary: TrackId;
  /** 有轮换时轮着放的曲子，第一首先放；只有一首时不轮 */
  tracks: readonly TrackId[];
  kind: PoolKind;
}

/** 从曲目池里取这一刻该放的那一首。 */
export type PoolPick = (pool: ScenePool) => TrackId;

/** 不轮换：放原来的那一首（sceneOf 的缺省）。 */
export const primaryPick: PoolPick = (pool) => pool.primary;

/** 轮换的节奏（秒）。 */
export interface PoolRule {
  /** 离开再回来时换下一首：上一首至少累计听了这么久 */
  heard: number;
  /** ……并且离开了至少这么久 */
  away: number;
  /** 一遍奏完、在留白里停了这么久就换下一首；null 表示放着的时候不换 */
  rest: number | null;
  /** ……并且这一首至少累计听了这么久 */
  min: number;
}

export const POOL_RULES: Readonly<Record<PoolKind, PoolRule>> = {
  // 航海曲的留白有 25–45 秒：停 12 秒（只有海浪）再换下一首
  sea: { heard: 40, away: 45, rest: 12, min: 50 },
  // 港口曲的留白 10–18 秒
  port: { heard: 40, away: 45, rest: 5, min: 50 },
  // 风暴的曲子只歇 3–6 秒
  storm: { heard: 20, away: 30, rest: 2, min: 40 },
  // 一场海战从头到尾同一首，下一场换
  battle: { heard: 15, away: 20, rest: null, min: 0 },
  // 养成的事件：一件事同一首，下一件同样情绪的事换
  event: { heard: 10, away: 10, rest: null, min: 0 },
};

/** 池的标识：种类与曲目（顺序也算——天黑进港时晚上的那一首排在前面，是另一个池）。 */
export function poolKey(pool: ScenePool): string {
  return `${pool.kind}:${pool.tracks.join("+")}`;
}

/** 引擎正在放什么（MusicEngine.status() 里轮换要看的部分）。 */
export interface PoolPlaying {
  track: string | null;
  resting: boolean;
  rested: number;
}

interface PoolState {
  kind: PoolKind;
  rot: UbRotation;
  /** 轮到的这一首累计听了多少秒（不含正连着放的这一段） */
  heard: number;
  /** 正连着放的这一段从什么时候开始（音频时间）；没在放时为 null */
  since: number | null;
  /** 什么时候离开这个情境的（音频时间）；正在这个情境里时为 null */
  leftAt: number | null;
}

/** 各个曲目池的轮换（配乐导演持有一个；rand 是洗牌的随机源）。 */
export class PoolRotations {
  private readonly states = new Map<string, PoolState>();
  private active: string | null = null;

  constructor(private readonly rand: () => number = Math.random) {}

  /** 这个池现在轮到哪一首（纯查询，不改状态）；还没进过这个池时是它的第一首。 */
  readonly pick: PoolPick = (pool) => this.states.get(poolKey(pool))?.rot.current ?? pool.tracks[0] ?? pool.primary;

  /**
   * 下次进这个池时会放哪一首（后台预取用，纯查询）：正在这个池里、没进过、离开得还不够久时就是 pick；
   * 离开够久、上一首也听够了时是牌里的下一张。
   */
  preview(pool: ScenePool, now: number | null): TrackId {
    const key = poolKey(pool);
    const st = this.states.get(key);
    if (!st || key === this.active || now === null) return this.pick(pool);
    return this.dueOnReturn(st, now) ? (st.rot.queue[0] ?? st.rot.current) : st.rot.current;
  }

  /** 正连着放的这一段记进累计。 */
  private settle(st: PoolState, now: number): void {
    if (st.since !== null) st.heard += Math.max(0, now - st.since);
    st.since = null;
  }

  private dueOnReturn(st: PoolState, now: number): boolean {
    const rule = POOL_RULES[st.kind];
    return st.leftAt !== null && now - st.leftAt >= rule.away && st.heard >= rule.heard;
  }

  private advance(st: PoolState): void {
    st.rot = nextRotation(st.rot, this.rand);
    st.heard = 0;
    st.since = null;
  }

  /**
   * 配乐导演每次看场景时调用一次：pool 是这一刻的情境的曲目池（没有、或点唱机指定了曲目时为 null），playing 是引擎正在放的（还没有引擎时为 null），
   * now 是音频时间（没有引擎时为 null：不计时，什么都不动）。只有一首的池不记状态。
   * 返回 true 表示轮到的这一首刚奏完一遍、换成了下一首——这一次换曲不必等场景稳定。
   */
  step(pool: ScenePool | null, playing: PoolPlaying | null, now: number | null): boolean {
    if (now === null) return false;
    const key = pool && pool.tracks.length > 1 ? poolKey(pool) : null;
    if (key !== this.active) {
      const prev = this.active !== null ? this.states.get(this.active) : undefined;
      if (prev) {
        this.settle(prev, now);
        prev.leftAt = now;
      }
      this.active = key;
      if (key === null || !pool) return false;
      const st = this.states.get(key);
      if (!st) {
        this.states.set(key, { kind: pool.kind, rot: startRotation(pool.tracks, this.rand), heard: 0, since: null, leftAt: null });
        return false;
      }
      if (this.dueOnReturn(st, now)) this.advance(st);
      st.leftAt = null;
      st.since = null;
      return false;
    }
    if (key === null) return false;
    const st = this.states.get(key);
    if (!st) return false;
    // 引擎正在放的就是轮到的这一首
    const mine = playing !== null && playing.track === st.rot.current ? playing : null;
    if (mine && !mine.resting) {
      if (st.since === null) st.since = now;
      return false;
    }
    this.settle(st, now);
    const rule = POOL_RULES[st.kind];
    if (rule.rest !== null && mine && mine.rested >= rule.rest && st.heard >= rule.min) {
      this.advance(st);
      return true;
    }
    return false;
  }
}
