// 配乐导演：看当前的场景决定放哪首曲子、配什么环境声、什么时候奏短乐句，并管理音频引擎的生命周期。
//
// 场景 → 曲目（按优先级）：
// - 开局画面：主题曲《船货清单》；
// - 遭遇海盗、海战进行中：《黑帆》（第九批的世界里按交战处换地方变奏，
//   黎凡特、红海与奥斯曼港口的海上是《新月的战鼓》，见 zones.ts 的 battleTrackOf；经典世界照旧）；
// - 旗舰队停在港口 / 城市：按所属势力的文化放对应的港口曲（地中海、北地、低地、沙漠、群岛、东方），
//   停在殖民点（殖民地或荒野海湾）：《拓荒者的篝火》；
// - 在海上遇到暴风雨：《怒涛》（天气好了回到原来的航海曲，从离开的那一段接着奏）；
// - 在海上：按舰队所在海区的地域放七首航海曲之一（内海、北方冷海、沙漠海岸与南方海路、南洋群岛、东方海域、新大陆沿岸、远洋，见 zones.ts）；
//   第九批的世界按海区数据的 music 字段（音乐分区）选（伊比利亚、印度洋、明的沿海、日本的内海……），港口曲有新文化的专属曲时用它；
// - 养成中（Overview.mode === "upbringing"）：节日、比赛、结业与事件的情绪（mood）换曲，平时在“这个阶段的曲子 + 家乡曲 + 通用的平时曲 + 主题曲”里
//   轮换，见 upbringing.ts；轮换的状态（UbRotation）与随机源在这里：正在放的就是轮到的那一首、它放完一遍进了留白（并且放够了一分钟）时轮到下一首，
//   立即换（不等场景稳定）；事件、比赛、节日、结业的曲子放的时候轮换停着不走。养成的曲子不配海浪与海鸥（环境声为空）。
// 环境声跟着地点（海上 / 港内 / 标题画面）与当地天气（风力、雨、暴风雨）走。
// 出港、入港、发现发现物、一笔大赚时在正在放的曲子上方奏几秒短乐句（见 cues.ts），曲子压低、不换曲；
// 时间线上的事揭晓（改写了历史、没能改变、照着史实）与期限迫近时，同样奏一句时间线的短乐句（见 stings.ts，由历史的天平与事件对话框触发）。
//
// 曲目池与轮换（第九批 A01，2026-11-11，见 pools.ts）：上面每个情境（一片海、一座港口、风暴、雾、海战，养成的事件与比赛）对的是一个曲目池，
// 不止一首时轮着放——一遍奏完进了留白就换下一首，离开这个情境够久再回来也换；海上起雾时放《雾号》。经典世界的池里只有原来的那一首。
// 轮换的状态（PoolRotations）在这里，与养成平时的轮换各管各的。
//
// 防止频繁切换：场景要稳定 1.5 秒才换曲，一首曲子至少放 8 秒（高倍速下港口与海上、海区与海区、晴与暴风雨来回切时不至于每几秒换一次）；
// 海盗与海战立即切换。天况至少保持 3 秒才改环境声。短乐句之间至少隔 6 秒，海盗与海战的场面、点唱机（指定曲目）时不奏。
// 浏览器要求先有一次用户操作才能出声：第一次点击或按键时才创建音频引擎；静音时不创建，切到后台时暂停（可在设置里改）。
//
// 配乐风格（设置里“配乐风格”，缺省管弦）：同一首曲子（同一个编号）有管弦版（真实乐器的采样，orchestra/）与复古合成版两套编配。
// 采样什么时候取：
// - 第一次用户操作之前一个采样也不取（那之前也出不了声）；音乐关着（总静音，或音乐音量为 0）时一个也不取，管弦版当作合成版放；
// - 首屏（选世界、开局画面）只取正在放的那一首（主题曲）的采样，同时只下载一个文件；
// - 进了主界面，正在放的那一首的采样排在最前（同时三个）；当前的曲子放起来以后，浏览器空闲时在后台一个一个取
//   短乐句与“接下来最可能放的”几首（见 likelyNext：出港后的航海曲或目的港的港口曲、海战、暴风雨；养成中是事件会换到的几首）。
// 放哪一套：什么都还没放时最多等 4 秒采样，之后先放合成版；换到另一首时，那一首的采样还没下载到就立即先放合成版，
// 只差解码时等一会儿（旧曲子接着放）；采样到了在合成版的下一段开头换成管弦版（handoff，两套分段一样时；不一样时交叉淡化）。
// 加载失败的先放合成版，一分钟后再试；短乐句的采样没好时奏合成版的短乐句。换风格时正在放的曲子交叉淡化换成另一套编配。
//
// 音效（sfx/）共用这里创建的音频引擎：创建引擎时把它的音效播放器接给 sfx 模块（bindSfx），音效音量随偏好变化。
import { useEffect } from "react";
import { create } from "zustand";
import { localWeather } from "../components/hudWeather";
import { locById } from "../ipc/byId";
import type { Overview, SkyKind, StaticView } from "../ipc/types";
import { flagship, useGame } from "../store/game";
import type { AmbienceScene } from "./ambience";
import { cuesOf } from "./cues";
import { MusicEngine } from "./engine";
import { FIRST_SCREEN_PARALLEL, PARALLEL, pauseDownloads, setDownloadLimit, type Priority } from "./orchestra/bank";
import { ORCH_JINGLES, ORCH_TRACKS } from "./orchestra/tracks";
import { ORCH_STINGS } from "./orchestra/tracks/stings";
import { PoolRotations, primaryPick, type PoolPick, type ScenePool } from "./pools";
import { useAudioPrefs, type AudioPrefs, type MusicStyle } from "./prefs";
import type { TrackDef } from "./score";
import { bindSfx } from "./sfx";
import { TRACKS, type TrackId } from "./tracks";
import { JINGLES, type CueId } from "./tracks/jingles";
import { STINGS, type StingId } from "./tracks/stings";
import { storySting, useStingRequests } from "./stings";
import { everydayPool, nextRotation, peekRotation, rotationDue, syncRotation, ubPoolOf, UB_EVENT_TRACKS, upbringingScene, useUbMusic, type UbMusicDigest, type UbRotation } from "./upbringing";
import { battlePoolOf, fogPoolOf, isBattleTrack, portPoolIn, seaPoolOf, stormPoolOf } from "./zones";

/** 场景的配乐。 */
export interface MusicScene {
  track: TrackId;
  ambience: AmbienceScene;
  /** 需要立即切换（海盗、海战） */
  urgent: boolean;
}

/**
 * 由当前状态得出场景的配乐（纯函数）。ub 是养成主画面发布的摘要，rot 是养成平时的轮换（都是养成中才用得到；
 * 没给轮换时平时放这个阶段的曲子）。
 * pick：从这个情境的曲目池里取哪一首（第九批 A01，见 pools.ts）；缺省取原来的那一首（primary），配乐导演传它的轮换。
 */
export function sceneOf(
  /** 是否已进入可以开局的状态（桌面版总是 true；为 false 时放主题曲） */
  signedIn: boolean,
  statics: StaticView | null,
  overview: Overview | null,
  ub: UbMusicDigest | null = null,
  rot: UbRotation | null = null,
  pick: PoolPick = primaryPick,
): MusicScene {
  const title: MusicScene = { track: "title", ambience: { place: "title", sky: null, wind: 0 }, urgent: false };
  if (!signedIn || !overview) return title;
  if (overview.mode === "upbringing") {
    const u = upbringingScene(overview, ub, rot);
    // 事件与比赛的曲子有曲目池（一件事同一首，下一件换另一首）；平时的轮换、节日、结业没有
    const pool = ubPoolOf(u.track);
    return { track: pool ? pick(pool) : u.track, ambience: { place: "none", sky: null, wind: 0 }, urgent: u.urgent };
  }
  const w = localWeather(overview);
  const weather = { sky: (w?.sky ?? null) as SkyKind | null, wind: w?.wind_strength ?? 3 };
  const fleet = flagship(overview);
  const docked = fleet?.docked ?? null;
  const place: AmbienceScene["place"] = docked !== null ? "port" : "sea";
  const ambience: AmbienceScene = { place, ...weather };
  // 海战曲按交战处的海区选地方变奏（黎凡特与奥斯曼的海上是《新月的战鼓》），经典世界总是《黑帆》，见 zones.ts 的 battleTrackOf
  if ((overview.pending_battles?.length ?? 0) > 0 || (overview.tactical_battles?.length ?? 0) > 0) return { track: pick(battlePoolOf(w?.region, statics)), ambience, urgent: true };
  if (docked !== null) return { track: pick(portPoolAt(statics, docked, overview.minute)), ambience, urgent: false };
  if (weather.sky === "storm") return { track: pick(stormPoolOf(w?.region, statics)), ambience, urgent: false };
  // 海上起雾：海区写了音乐分区的世界里有《雾号》（没有轮换时照旧放这片海的航海曲）
  const fog = weather.sky === "fog" ? fogPoolOf(w?.region, fleet, statics) : null;
  if (fog) return { track: pick(fog), ambience, urgent: false };
  return { track: pick(seaPoolOf(w?.region, fleet, statics)), ambience, urgent: false };
}

/**
 * 这一刻的情境的曲目池（纯函数）：海上、港口、风暴、雾、海战，养成的事件与比赛；主题曲、养成平时的轮换、节日与结业没有（null）。
 * 配乐导演据此推进轮换（pools.ts 的 PoolRotations）。
 */
export function scenePool(signedIn: boolean, statics: StaticView | null, overview: Overview | null, ub: UbMusicDigest | null = null, rot: UbRotation | null = null): ScenePool | null {
  let got: ScenePool | null = null;
  sceneOf(signedIn, statics, overview, ub, rot, (pool) => {
    got = pool;
    return pool.primary;
  });
  return got;
}

/**
 * 停在这个地点时的港口曲：殖民点（或不认识的地点）放《拓荒者的篝火》，城市按所属势力的文化（势力数据的 style）；
 * 停泊处所在海区写了 music 时可能再换一次（爱琴海与黎凡特海上地中海风格的港口放《酒色的海湾》，红海与海湾上奥斯曼、葡萄牙治下的阿拉伯人的港口
 * 放《乳香与咖啡的码头》，见 zones.ts 的 portTrackIn）。不按地点或势力的 key 认（FRAMEWORK §2）。
 * 返回的是曲目池（zones.ts 的 portPoolIn）：primary 是上面说的那一首，港口多的几种文化另有第二首轮着放，天黑以后进港时傍晚的那一首排在前面。
 */
function portPoolAt(statics: StaticView | null, loc: number, minute?: number | null): ScenePool {
  const l = locById(statics, loc);
  if (!l || l.kind === "site") return { primary: "port_frontier", tracks: ["port_frontier"], kind: "port" };
  const faction = statics?.factions[l.faction];
  const sea = typeof l.region === "number" ? statics?.regions.find((r) => r.id === l.region) : undefined;
  return portPoolIn(faction?.key, faction?.style, sea?.music, minute);
}

/**
 * 接下来最可能放的曲子（按可能性排，不含正在放的这一首；纯函数，测试检查）：后台空闲时按这个顺序预取它们的采样。
 * 养成中：平时的轮换接下来轮到的那一首（给了轮换时），然后是事件会换到的几首（心动、紧张、悲伤、神秘、来信、比赛）。
 * 航海中：停在港口时是出港以后这片海的航海曲，在海上时是目的港的港口曲；然后是要立即切换的海战与暴风雨。没进游戏（首屏）时为空。
 * pick：各个情境的曲目池里取哪一首（缺省取原来的那一首；配乐导演传“下次进这个池时会放的那一首”）。
 */
export function likelyNext(statics: StaticView | null, overview: Overview | null, ub: UbMusicDigest | null = null, rot: UbRotation | null = null, pick: PoolPick = primaryPick): TrackId[] {
  if (!overview) return [];
  const now = sceneOf(true, statics, overview, ub, rot, pick).track;
  const out: TrackId[] = [];
  const add = (id: TrackId) => {
    if (id !== now && !out.includes(id)) out.push(id);
  };
  if (overview.mode === "upbringing") {
    const next = peekRotation(rot);
    if (next) add(next);
    for (const id of UB_EVENT_TRACKS) add(id);
    return out;
  }
  const fleet = flagship(overview);
  const region = localWeather(overview)?.region;
  if (fleet && fleet.docked !== null) add(pick(seaPoolOf(region, fleet, statics)));
  else if (fleet && fleet.dest !== null) add(pick(portPoolAt(statics, fleet.dest, overview.minute)));
  add(pick(battlePoolOf(region, statics)));
  add(pick(stormPoolOf(region, statics)));
  return out;
}

/** 音乐开着：没有总静音，音乐音量也不是 0。关着时一个采样也不取。 */
export function musicOn(p: Pick<AudioPrefs, "muted" | "music">): boolean {
  return !p.muted && p.music > 0;
}

/** 实际用的配乐风格：音乐关着时按复古合成（反正听不见，不为它取采样）。 */
export function effectiveStyle(p: Pick<AudioPrefs, "muted" | "music" | "style">): MusicStyle {
  return musicOn(p) ? p.style : "synth";
}

/** 正在播放什么（给顶栏按钮与设置里的“正在播放”）。 */
export interface MusicStatus {
  /** 引擎已经在出声（有过一次用户操作、没有静音） */
  active: boolean;
  track: TrackId | null;
  /** 一遍奏完后的留白中 */
  resting: boolean;
  /** 正在放的是管弦版 */
  orchestral: boolean;
  /** 选了管弦版、正在加载要放的曲子的采样 */
  loading: boolean;
}

export const useMusicStatus = create<MusicStatus>(() => ({ active: false, track: null, resting: false, orchestral: false, loading: false }));

const SETTLE_MS = 1500;
const DWELL_MS = 8000;
const SKY_HOLD_MS = 3000;
/** 两个短乐句之间至少隔这么久（高倍速下连着出港、入港时不至于响个不停）。 */
const CUE_GAP_MS = 6000;
/** 管弦版：什么都还没放时最多等采样这么久，之后先放合成版。 */
export const FIRST_WAIT_MS = 4000;
/**
 * 管弦版：换到另一首、它的采样都已下载好只差解码时，旧曲子接着放最多等这么久，之后先放合成版。
 * 采样还没下载到时不等，立即先放合成版。
 */
export const SWITCH_WAIT_MS = 3000;
/** 管弦版：要立即切换的场景（海盗、海战）只差解码时最多等这么久。这首的采样在主界面空闲时就在后台预取。 */
export const URGENT_WAIT_MS = 1500;
/** 加载失败之后隔这么久再试。 */
const RETRY_MS = 60000;

/** 这首曲子在这种风格下的编配。 */
export function trackFor(id: TrackId, style: MusicStyle): TrackDef {
  return style === "orchestral" ? ORCH_TRACKS[id] : TRACKS[id];
}

/** 这个短乐句在这种风格下的编配。 */
export function cueFor(id: CueId, style: MusicStyle): TrackDef {
  return style === "orchestral" ? ORCH_JINGLES[id] : JINGLES[id];
}

/** 这个时间线的短乐句在这种风格下的编配。 */
export function stingFor(id: StingId, style: MusicStyle): TrackDef {
  return style === "orchestral" ? ORCH_STINGS[id] : STINGS[id];
}

/** 管弦版一首曲子的采样加载到哪一步了：开始的时刻、状态、状态改变的时刻（毫秒）。 */
export interface LoadState {
  since: number;
  state: "loading" | "ready" | "failed";
  at: number;
  /** 后台预取（还没轮到要放）；轮到要放时改为前台，等待从那一刻起算 */
  idle?: boolean;
}

/**
 * 这一刻该放哪一套编配（纯函数，测试检查）。合成版总是现成的；管弦版要等这首的采样加载好（ready）——
 * 什么都还没放时最多等 FIRST_WAIT_MS；正在放的就是这一首（先顶上的合成版）时一直放着等；
 * 换到另一首时：采样还没下载到（arrived 为假）就立即先放合成版，只差解码时旧曲子接着放、最多等 SWITCH_WAIT_MS（要立即切换的场景 URGENT_WAIT_MS）；
 * 加载失败或超时就放合成版。返回 null 表示先不动。
 */
export function chooseDef(
  want: TrackId,
  style: MusicStyle,
  ready: boolean,
  load: LoadState | undefined,
  playing: { id: TrackId | null; def: TrackDef | null },
  now: number,
  urgent = false,
  arrived = false,
): TrackDef | null {
  if (style === "synth") return TRACKS[want];
  if (ready) return ORCH_TRACKS[want];
  if (!load || load.state === "failed") return TRACKS[want];
  const waited = now - load.since;
  if (playing.def === null) return waited >= FIRST_WAIT_MS ? TRACKS[want] : null;
  if (playing.id === want) return playing.def;
  if (!arrived) return TRACKS[want];
  return waited >= (urgent ? URGENT_WAIT_MS : SWITCH_WAIT_MS) ? TRACKS[want] : null;
}

/** 导演：订阅状态、在合适的时候换曲、管理引擎。random：养成平时轮换的随机源（测试里换成固定种子的）。 */
class MusicDirector {
  constructor(private readonly random: () => number = Math.random) {
    this.pools = new PoolRotations(random);
  }

  private engine: MusicEngine | null = null;
  /** 养成平时的轮换（见 upbringing.ts）；还没进过养成时为 null */
  private ubRot: UbRotation | null = null;
  /** 各个情境的曲目池的轮换（见 pools.ts）；换了音频引擎时重来 */
  private pools: PoolRotations;
  /** 轮到的这一首从什么时候（音频时间）开始放；正在放的还不是它时为 null */
  private ubSince: { track: TrackId; at: number } | null = null;
  private playing: TrackId | null = null;
  /** 正在放的那一套编配（管弦版或合成版） */
  private playingDef: TrackDef | null = null;
  /** 这个引擎里管弦版各曲目的采样加载到哪一步了 */
  private loads = new Map<TrackDef, LoadState>();
  /** 短乐句的采样已经开始在后台加载 */
  private cuesWarm = false;
  /** 后台预取排的是哪几首（按顺序；变了才重排） */
  private bgKey = "";
  /** 下载排到最前的是哪一首 */
  private focused: TrackId | null = null;
  /** 最近一次想放的曲子 */
  private want: TrackId | null = null;
  private since = 0;
  private pending: { track: TrackId; since: number } | null = null;
  private sky: { value: SkyKind | null; since: number; applied: SkyKind | null } = { value: null, since: 0, applied: null };
  private place: AmbienceScene["place"] | null = null;
  private lastWind = -1;
  private offs: (() => void)[] = [];
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCue = -Infinity;

  attach(): void {
    const onGesture = () => this.unlock();
    for (const ev of ["pointerdown", "keydown", "touchend"]) window.addEventListener(ev, onGesture, { capture: true });
    const onVisible = () => this.applyRunning();
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(() => this.update(), 1000);
    this.offs.push(
      () => {
        for (const ev of ["pointerdown", "keydown", "touchend"]) window.removeEventListener(ev, onGesture, { capture: true });
      },
      () => document.removeEventListener("visibilitychange", onVisible),
      () => clearInterval(timer),
      useGame.subscribe((s, p) => {
        if (s.overview !== p.overview || s.statics !== p.statics) this.update();
        if (s.overview !== p.overview) this.cue(p.overview, s.overview);
      }),
      useUbMusic.subscribe(() => this.update()),
      useStingRequests.subscribe((s, p) => {
        if (s.seq !== p.seq && s.id) this.sting(s.id);
      }),
      useAudioPrefs.subscribe((s, p) => this.prefsChanged(s, p)),
    );
    // 第一次用户操作之前不取采样（首屏的带宽留给首屏）；音乐关着时整个下载队列暂停
    pauseDownloads(!musicOn(useAudioPrefs.getState()));
    this.update();
  }

  /** 这一刻实际用的配乐风格（音乐关着时按复古合成）。 */
  private style(): MusicStyle {
    return effectiveStyle(useAudioPrefs.getState());
  }

  detach(): void {
    for (const off of this.offs) off();
    this.offs = [];
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    if (this.engine) bindSfx(null);
    this.engine?.close();
    this.engine = null;
    useMusicStatus.setState({ active: false, track: null, resting: false, orchestral: false, loading: false });
  }

  /** 第一次用户操作：创建引擎（静音时不创建）；之后的操作在浏览器挂起音频时把它唤醒。 */
  private unlock(): void {
    const prefs = useAudioPrefs.getState();
    if (prefs.muted) return;
    if (!this.engine) {
      const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
      if (!Ctor) return;
      try {
        this.engine = new MusicEngine(new Ctor({ latencyHint: "playback" }));
      } catch {
        return;
      }
      this.engine.setVolumes(prefs.music, prefs.ambience, false, prefs.sfx);
      this.engine.start();
      bindSfx(this.engine.sfx);
      this.playing = null;
      this.playingDef = null;
      this.pools = new PoolRotations(this.random);
      this.loads = new Map();
      this.cuesWarm = false;
      this.bgKey = "";
      this.focused = null;
      this.place = null;
      this.lastWind = -1;
      this.sky.applied = null;
    }
    this.applyRunning();
    this.update(true);
  }

  /** 该不该出声：没有静音，且页面可见或允许后台播放。 */
  private shouldRun(): boolean {
    const p = useAudioPrefs.getState();
    return !p.muted && (p.background || document.visibilityState !== "hidden");
  }

  private applyRunning(): void {
    const e = this.engine;
    if (!e) return;
    if (this.suspendTimer) {
      clearTimeout(this.suspendTimer);
      this.suspendTimer = null;
    }
    const p = useAudioPrefs.getState();
    if (this.shouldRun()) {
      e.setVolumes(p.music, p.ambience, false, p.sfx);
      e.resume();
    } else {
      // 先淡出再挂起，省电
      e.setVolumes(p.music, p.ambience, true, p.sfx);
      this.suspendTimer = setTimeout(() => {
        if (!this.shouldRun()) e.suspend();
      }, 400);
    }
    this.publish();
  }

  private prefsChanged(s: AudioPrefs, p: AudioPrefs): void {
    if (s.muted !== p.muted && !s.muted && !this.engine) {
      // 点“取消静音”本身就是一次用户操作
      this.unlock();
      return;
    }
    if (s.muted !== p.muted || s.background !== p.background || s.music !== p.music || s.ambience !== p.ambience || s.sfx !== p.sfx) this.applyRunning();
    if (s.pick !== p.pick || s.style !== p.style || musicOn(s) !== musicOn(p)) this.update(true);
  }

  /** 根据当前场景决定换不换曲、环境声怎么变。force 为真时跳过稳定等待（刚解锁、换了指定曲目）。 */
  private update(force = false): void {
    const g = useGame.getState();
    const ub = useUbMusic.getState().digest;
    const prefs = useAudioPrefs.getState();
    // 养成平时的轮换：一首放完就轮到下一首，立即换（一首刚放完，正是换的时候，不必等场景稳定）
    if (this.rotate(g.overview, ub, prefs)) force = true;
    // 曲目池的轮换（海上、港口、风暴、海战，养成的事件）：点唱机（指定了曲目）时不走；轮到的那一首刚奏完一遍时立即换
    const audioNow = this.engine ? this.engine.ctx.currentTime : null;
    const pool = prefs.pick === "auto" ? scenePool(true, g.statics, g.overview, ub, this.ubRot) : null;
    if (this.pools.step(pool, this.engine?.status() ?? null, audioNow)) force = true;
    const scene = sceneOf(true, g.statics, g.overview, ub, this.ubRot, this.pools.pick);
    const want: TrackId = prefs.pick === "auto" ? scene.track : prefs.pick;
    this.want = want;
    const now = performance.now();
    if (!this.pending || this.pending.track !== want) this.pending = { track: want, since: now };
    const style = effectiveStyle(prefs);
    // 首屏（还没进游戏）同时只下载一个采样；音乐关着时一个也不取
    const firstScreen = !g.overview;
    setDownloadLimit(firstScreen ? FIRST_SCREEN_PARALLEL : PARALLEL);
    pauseDownloads(!musicOn(prefs));
    const e = this.engine;
    if (e) {
      // 要放的曲子换了：它的采样下载排到最前，换走的那一首排着的降回后台
      if (style === "orchestral" && want !== this.focused) {
        this.focused = want;
        e.focus(ORCH_TRACKS[want]);
      }
      const urgent = scene.urgent || prefs.pick !== "auto";
      const settled = force || urgent || now - this.pending.since >= SETTLE_MS;
      const dwelt = force || urgent || this.playing === null || now - this.since >= DWELL_MS;
      // 换一首曲子要等场景稳定；同一首只是换了编配（换风格、管弦版的采样刚加载好）立即换
      if (want === this.playing || (settled && dwelt)) {
        const def = this.resolve(want, style, e, now, urgent);
        if (def && def !== this.playingDef) {
          // 先顶上的合成版 → 采样到了的管弦版：在下一段开头接上，接不上时交叉淡化
          const handed = want === this.playing && this.playingDef === TRACKS[want] && def === ORCH_TRACKS[want] && e.handoff(def);
          if (!handed) {
            const fade = this.playing === null ? 1.2 : urgent && want !== this.playing ? 1.2 : 2.5;
            e.play(def, fade);
          }
          this.playing = want;
          this.playingDef = def;
          this.since = now;
        }
      }
      // 主界面里、当前的曲子放起来以后：后台空闲时预取短乐句与接下来最可能放的几首
      if (!firstScreen && style === "orchestral" && this.playingDef) {
        this.warmBackground(
          e,
          likelyNext(g.statics, g.overview, ub, this.ubRot, (p) => this.pools.preview(p, audioNow)),
        );
      }
      this.updateAmbience(scene.ambience, now, e);
    }
    this.publish();
  }

  /**
   * 养成平时的轮换：按最新的摘要更新曲目池；正在放的就是轮到的那一首、它放完一遍进了留白（并且放够了时间）时轮到下一首。
   * 返回 true 表示刚轮到下一首（这一次换曲不等场景稳定）。没出声、点唱机（指定了曲目）时轮换不走。
   */
  private rotate(overview: Overview | null, ub: UbMusicDigest | null, prefs: AudioPrefs): boolean {
    if (overview?.mode !== "upbringing") return false;
    // 还没有摘要（养成主画面暂时收回）时不动曲目池，接着放轮到的那一首
    if (ub) this.ubRot = syncRotation(this.ubRot, everydayPool(ub), this.random);
    const rot = this.ubRot;
    const e = this.engine;
    if (!rot || !e || prefs.pick !== "auto") return false;
    const st = e.status();
    const now = e.ctx.currentTime;
    if (this.ubSince?.track !== rot.current) this.ubSince = st.track === rot.current ? { track: rot.current, at: now } : null;
    if (!this.ubSince || !rotationDue(st, rot.current, this.ubSince.at, now)) return false;
    this.ubRot = nextRotation(rot, this.random);
    this.ubSince = null;
    return true;
  }

  /** 这一刻该放的编配（管弦版的采样没加载时开始加载）；null 表示先不动。 */
  private resolve(want: TrackId, style: MusicStyle, e: MusicEngine, now: number, urgent: boolean): TrackDef | null {
    // 音乐关着：正在放的这一首照旧放着（不必为听不见的声音换编配），换曲时放合成版
    if (!musicOn(useAudioPrefs.getState()) && want === this.playing && this.playingDef) return this.playingDef;
    if (style === "orchestral") {
      const orch = ORCH_TRACKS[want];
      const ready = e.ready(orch);
      const load = ready ? this.loads.get(orch) : this.load(orch, e, now);
      return chooseDef(want, style, ready, load, { id: this.playing, def: this.playingDef }, now, urgent, e.arrived(orch));
    }
    return chooseDef(want, style, true, undefined, { id: this.playing, def: this.playingDef }, now, urgent);
  }

  /**
   * 开始（或重新开始）加载一首管弦版曲子的采样；已经在加载的照旧。加载完成后重新决定放什么。
   * priority 为 idle 时是后台预取；后台在取的曲子轮到要放时挪到前台，等待从这一刻起算。
   */
  private load(def: TrackDef, e: MusicEngine, now: number, priority: Priority = "play"): LoadState {
    const cur = this.loads.get(def);
    const stale = !!cur && (cur.state === "ready" || (cur.state === "failed" && now - cur.at >= RETRY_MS));
    if (cur && !stale) {
      if (priority === "play" && cur.idle && cur.state === "loading") {
        cur.idle = false;
        cur.since = now;
        void e.prepare(def);
      }
      return cur;
    }
    const fresh: LoadState = { since: now, state: "loading", at: now, idle: priority === "idle" };
    this.loads.set(def, fresh);
    e.prepare(def, false, priority).then(
      (ok) => {
        fresh.state = ok ? "ready" : "failed";
        fresh.at = performance.now();
        if (this.engine === e) this.update();
      },
      () => {
        fresh.state = "failed";
        fresh.at = performance.now();
      },
    );
    return fresh;
  }

  /**
   * 主界面里、当前的曲子放起来以后：把短乐句（各种移调，引擎一直留着）与接下来最可能放的几首的采样排进后台，
   * 浏览器空闲时一个一个下载、解码（下载队列里有要马上放的文件时让它先走）。
   * 顺序：最可能的下一首、短乐句（出港入港时就要用）、其余几首；场景变了按新的顺序重排。
   */
  private warmBackground(e: MusicEngine, next: readonly TrackId[]): void {
    // 键以“|”开头：next 为空时也与初始的空键不同（第一次照样预取短乐句）
    const key = ["|", ...next].join(" ");
    if (key === this.bgKey) return;
    this.bgKey = key;
    const cues = [...Object.values(ORCH_JINGLES), ...Object.values(ORCH_STINGS)];
    if (!this.cuesWarm) {
      this.cuesWarm = true;
      e.keepCues(cues);
      for (const c of cues) void e.prepare(c, true, "idle");
    }
    const now = performance.now();
    for (const id of next) this.load(ORCH_TRACKS[id], e, now, "idle");
    const [first, ...rest] = next.map((id) => ({ track: ORCH_TRACKS[id] }));
    e.orderBackground([
      ...(first ? [first] : []),
      ...cues.map((track) => ({ track, cue: true })),
      ...rest,
    ]);
  }

  /**
   * 概览变了：看这一刻有没有出港、入港、发现、大赚，有就在正在放的曲子上方奏短乐句（同一刻只奏优先级最高的一个）。
   * 没出声、点唱机模式（指定了曲目）、海盗与海战的场面、养成中、离上一个短乐句不到 6 秒时不奏。
   */
  private cue(prev: Overview | null, next: Overview | null): void {
    const e = this.engine;
    if (!e || !this.shouldRun() || useAudioPrefs.getState().pick !== "auto") return;
    // 事件对话框里一件历史的事有了成败：时间线的短乐句
    const story = storySting(prev?.story?.last, next?.story?.last);
    if (story) {
      this.sting(story);
      return;
    }
    // 养成中没有出港、入港这些航海的短乐句
    if (next?.mode === "upbringing") return;
    const [id] = cuesOf(prev, next);
    if (!id) return;
    if (sceneOf(true, useGame.getState().statics, next, useUbMusic.getState().digest, this.ubRot).urgent) return;
    const now = performance.now();
    if (now - this.lastCue < CUE_GAP_MS) return;
    // 管弦版的短乐句要等它的采样加载好；没好时奏合成版的
    const orch = this.style() === "orchestral" && e.ready(ORCH_JINGLES[id], true);
    if (e.cue(orch ? ORCH_JINGLES[id] : JINGLES[id])) this.lastCue = now;
  }

  /**
   * 时间线的短乐句：与出港、入港的短乐句同一套规矩——没出声、点唱机模式、海盗与海战的场面、离上一个短乐句不到 6 秒时不奏；
   * 管弦版的采样没加载好时奏合成版的。
   */
  private sting(id: StingId): void {
    const e = this.engine;
    if (!e || !this.shouldRun() || useAudioPrefs.getState().pick !== "auto") return;
    const g = useGame.getState();
    const track = sceneOf(true, g.statics, g.overview, useUbMusic.getState().digest, this.ubRot).track;
    if (isBattleTrack(track)) return;
    const now = performance.now();
    if (now - this.lastCue < CUE_GAP_MS) return;
    const orch = this.style() === "orchestral" && e.ready(ORCH_STINGS[id], true);
    if (e.cue(orch ? ORCH_STINGS[id] : STINGS[id])) this.lastCue = now;
  }

  private updateAmbience(a: AmbienceScene, now: number, e: MusicEngine): void {
    if (a.sky !== this.sky.value) this.sky = { ...this.sky, value: a.sky, since: now };
    const skyReady = now - this.sky.since >= SKY_HOLD_MS || this.place !== a.place;
    const sky = skyReady ? this.sky.value : this.sky.applied;
    if (this.place !== a.place || sky !== this.sky.applied || this.lastWind !== a.wind) {
      e.setAmbience({ place: a.place, sky, wind: a.wind });
      this.place = a.place;
      this.sky.applied = sky;
      this.lastWind = a.wind;
    }
  }

  private publish(): void {
    const e = this.engine;
    const st = e?.status();
    const orchestralWanted = this.style() === "orchestral";
    const load = this.want ? this.loads.get(ORCH_TRACKS[this.want]) : undefined;
    const next: MusicStatus = {
      active: !!e && this.shouldRun(),
      track: (st?.track as TrackId | null | undefined) ?? null,
      resting: st?.resting ?? false,
      orchestral: st?.orchestral ?? false,
      loading: !!e && orchestralWanted && load?.state === "loading",
    };
    const cur = useMusicStatus.getState();
    if (cur.active !== next.active || cur.track !== next.track || cur.resting !== next.resting || cur.orchestral !== next.orchestral || cur.loading !== next.loading) {
      useMusicStatus.setState(next);
    }
  }
}

/** 由外壳在 App 中调用一次：启动配乐导演。random 是养成平时轮换的随机源（缺省 Math.random；测试里传固定种子的，只在挂载时取一次）。 */
export function useMusic(random?: () => number): void {
  useEffect(() => {
    const d = new MusicDirector(random);
    d.attach();
    return () => d.detach();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 随机源只在挂载时取一次（配乐导演整个生命周期只有一个）
  }, []);
}
