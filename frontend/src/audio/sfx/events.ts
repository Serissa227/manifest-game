// 音效事件表：游戏里的每一种音效由哪几层素材叠成、多响、多久能再响一次、同时响太多时谁先让开。
//
// 音量（level）以 dB 计，相对素材的参考响度（samples.ts：每个文件都校到 K 计权后最响一段 −20 dB）；
// 这些值在缺省音效音量（70%，此时音效总线的增益为 1）下，用本地试音台离线渲染量过（见 DECISIONS“音效”一节的测量）：
// 界面的点击很轻（峰值约 −30 dBFS），翻页、开关窗口稍明显，交易与航海的事件明显一些（峰值 −20～−14 dBFS），
// 炮声最响（峰值约 −10 dBFS）。配乐整首的均方根约 −21 dBFS、峰值约 −5 dBFS。
import type { SfxSampleId } from "./samples";

/** 一层：一种素材，在事件开头之后 at 秒放。 */
export interface SfxLayer {
  sample: SfxSampleId;
  /** 音量（dB，相对素材的参考响度） */
  level: number;
  /** 相对事件开头的延迟（秒） */
  at?: number;
  /** 延迟的随机出入（± 秒） */
  jitter?: number;
  /** 快慢（同时变调），缺省 1 */
  rate?: number;
  /** 短乐句（出港、入港、发现、大赚）正在奏时省掉这一层，免得叠成一团 */
  shy?: boolean;
}

/** 一种音效。 */
export interface SfxDef {
  layers: readonly SfxLayer[];
  /** 优先级 0–3：同时发声太多时，低的先让开（界面 0–1，交易与航海 2，海战 3） */
  priority: number;
  /** 同一种音效两次之间至少隔多久（毫秒） */
  gap: number;
  /** 一秒内最多几次 */
  perSecond: number;
  /** 每次随机的音高（± 音分）与音量（± dB）：同一个声音连着响也有细微的变化 */
  cents: number;
  db: number;
  /** 素材还没解码好时，最多晚多久还放（毫秒）；界面的声音晚了就不放 */
  late: number;
  /** 短乐句正在奏时整个不放（例如一般的提示） */
  quietInJingle?: boolean;
}

const ui = (sample: SfxSampleId, level: number, over: Partial<SfxDef> = {}): SfxDef => ({
  layers: [{ sample, level }],
  priority: 0,
  gap: 45,
  perSecond: 8,
  cents: 60,
  db: 1.5,
  late: 0,
  ...over,
});

export const SFX = {
  // ── 界面
  /** 点按钮 */
  click: ui("ui.click", -26.5),
  /** 切换页签、切换舞台（港口街景 / 航海图）、港口设施的分页 */
  tab: ui("ui.tab", -26.5, { gap: 70, perSecond: 6 }),
  /** 打开功能窗口 */
  open: ui("ui.open", -25.5, { priority: 1, gap: 150, perSecond: 4, cents: 50, db: 1, late: 60 }),
  /** 关上功能窗口 */
  close: ui("ui.close", -24, { priority: 1, gap: 150, perSecond: 4, cents: 50, db: 1, late: 60 }),
  /** 勾选（开） */
  toggleOn: { ...ui("ui.toggle", -21.5, { gap: 60, perSecond: 6, cents: 40, db: 1 }), layers: [{ sample: "ui.toggle", level: -21.5, rate: 1.06 }] },
  /** 取消勾选（关）：同一个搭扣，低一点 */
  toggleOff: { ...ui("ui.toggle", -22.5, { gap: 60, perSecond: 6, cents: 40, db: 1 }), layers: [{ sample: "ui.toggle", level: -22.5, rate: 0.9 }] },
  /** 滑条的档位（音高随位置升高，由调用方给出快慢） */
  slider: ui("ui.tick", -35, { gap: 38, perSecond: 18, cents: 0, db: 1 }),
  /** 操作被拒或失败 */
  error: ui("ui.error", -17, { priority: 1, gap: 400, perSecond: 2, cents: 30, db: 1, late: 80 }),
  /** 一般的提示（卷轴提示、航海日志里新出现的提醒） */
  notify: ui("ui.notify", -27.5, { gap: 1500, perSecond: 1, cents: 40, db: 1, late: 100, quietInJingle: true }),

  // ── 交易
  /** 买入（付钱） */
  buy: { layers: [{ sample: "coin.pay", level: -15 }], priority: 2, gap: 90, perSecond: 4, cents: 60, db: 1.5, late: 250 },
  /** 卖出（收钱） */
  sell: { layers: [{ sample: "coin.take", level: -14 }], priority: 2, gap: 90, perSecond: 4, cents: 60, db: 1.5, late: 250 },
  /** 全部卖出：一大串钱币 */
  sellAll: { layers: [{ sample: "coin.pour", level: -14.5 }], priority: 2, gap: 900, perSecond: 1, cents: 40, db: 1, late: 250 },
  /** 钱不够：空钱袋一拍 */
  broke: { layers: [{ sample: "coin.purse", level: -19 }], priority: 2, gap: 500, perSecond: 2, cents: 40, db: 1, late: 150 },

  // ── 航海与港口
  /** 出港：起锚的铁链，接着升帆（短乐句《起锚》奏着时只留铁链） */
  depart: {
    layers: [
      { sample: "sea.chain", level: -12 },
      { sample: "sea.sail", level: -13, at: 0.85, shy: true },
    ],
    priority: 2,
    gap: 4000,
    perSecond: 1,
    cents: 30,
    db: 1,
    late: 400,
  },
  /** 入港：抛缆，船舷靠上码头（短乐句《入港》奏着时只留靠岸的一下） */
  arrive: {
    layers: [
      { sample: "sea.rope", level: -14, shy: true },
      { sample: "sea.dock", level: -15, at: 0.32 },
    ],
    priority: 2,
    gap: 4000,
    perSecond: 1,
    cents: 30,
    db: 1,
    late: 400,
  },
  /** 修船：锤子敲三下 */
  repair: {
    layers: [
      { sample: "sea.hammer", level: -13 },
      { sample: "sea.hammer", level: -14, at: 0.3, jitter: 0.03 },
      { sample: "sea.hammer", level: -15, at: 0.6, jitter: 0.03 },
    ],
    priority: 2,
    gap: 1000,
    perSecond: 1,
    cents: 50,
    db: 1.5,
    late: 300,
  },
  /** 造船厂（买船、改装）：锤子两下，再放下一块船板 */
  shipyard: {
    layers: [
      { sample: "sea.hammer", level: -12 },
      { sample: "sea.hammer", level: -13, at: 0.28, jitter: 0.03 },
      { sample: "sea.dock", level: -18, at: 0.6, rate: 1.15 },
    ],
    priority: 2,
    gap: 1000,
    perSecond: 1,
    cents: 50,
    db: 1.5,
    late: 300,
  },
  /** 雇船员（解雇也是）：几个人踩着甲板走过 */
  hire: {
    layers: [
      { sample: "sea.step", level: -17.5 },
      { sample: "sea.step", level: -18.5, at: 0.26, jitter: 0.02 },
      { sample: "sea.step", level: -18.5, at: 0.52, jitter: 0.02 },
      { sample: "sea.step", level: -20.5, at: 0.8, jitter: 0.03 },
    ],
    priority: 2,
    gap: 1000,
    perSecond: 1,
    cents: 70,
    db: 1.5,
    late: 300,
  },
  /** 补给粮水：粮袋落地、水桶磕一下 */
  resupply: { layers: [{ sample: "sea.crate", level: -16 }], priority: 2, gap: 800, perSecond: 1, cents: 50, db: 1, late: 300 },

  // ── 存档、读档、时间
  /** 存档：合上航海日志 */
  save: { layers: [{ sample: "log.close", level: -17.5 }], priority: 1, gap: 600, perSecond: 2, cents: 30, db: 1, late: 200 },
  /** 读档：翻开航海日志 */
  load: { layers: [{ sample: "log.open", level: -21 }], priority: 1, gap: 600, perSecond: 2, cents: 30, db: 1, late: 200 },
  /** 加快：两下由低到高的轻响 */
  speedUp: {
    layers: [
      { sample: "ui.tick", level: -31, rate: 0.95 },
      { sample: "ui.tick", level: -30, at: 0.065, rate: 1.19 },
    ],
    priority: 1,
    gap: 100,
    perSecond: 6,
    cents: 20,
    db: 1,
    late: 0,
  },
  /** 放慢：两下由高到低 */
  speedDown: {
    layers: [
      { sample: "ui.tick", level: -30, rate: 1.19 },
      { sample: "ui.tick", level: -31, at: 0.065, rate: 0.95 },
    ],
    priority: 1,
    gap: 100,
    perSecond: 6,
    cents: 20,
    db: 1,
    late: 0,
  },
  /** 暂停：扣上搭扣 */
  pause: { layers: [{ sample: "time.stop", level: -21 }], priority: 1, gap: 200, perSecond: 4, cents: 40, db: 1, late: 60 },
  /** 继续：拨开搭扣 */
  resume: { layers: [{ sample: "time.go", level: -21.5 }], priority: 1, gap: 200, perSecond: 4, cents: 40, db: 1, late: 60 },

  // ── 海战
  /** 开炮 */
  fire: { layers: [{ sample: "war.cannon", level: -6.5 }], priority: 3, gap: 80, perSecond: 6, cents: 90, db: 1.5, late: 150 },
  /** 远处的一阵炮声（自动结算的海战） */
  volley: {
    layers: [
      { sample: "war.cannonFar", level: -13.5 },
      { sample: "war.cannonFar", level: -15.5, at: 0.45, jitter: 0.08 },
      { sample: "war.cannonFar", level: -17.5, at: 1.1, jitter: 0.12 },
    ],
    priority: 3,
    gap: 2500,
    perSecond: 1,
    cents: 80,
    db: 1.5,
    late: 300,
  },
  /** 命中 */
  hit: { layers: [{ sample: "war.hit", level: -8 }], priority: 3, gap: 80, perSecond: 6, cents: 60, db: 1.5, late: 150 },
  /** 落空：落进海里 */
  miss: { layers: [{ sample: "war.splash", level: -10 }], priority: 3, gap: 80, perSecond: 6, cents: 60, db: 1.5, late: 150 },
  /** 击沉：一声大的破裂，接着落水 */
  sink: {
    layers: [
      { sample: "war.hit", level: -6, rate: 0.85 },
      { sample: "war.splash", level: -7, at: 0.35, rate: 0.85 },
    ],
    priority: 3,
    gap: 400,
    perSecond: 2,
    cents: 40,
    db: 1,
    late: 200,
  },
  /** 接舷：刀剑相碰，脚步冲过去 */
  board: {
    layers: [
      { sample: "sea.step", level: -15, rate: 1.1 },
      { sample: "war.clash", level: -10, at: 0.12 },
      { sample: "sea.step", level: -16, at: 0.2, rate: 1.1 },
      { sample: "war.clash", level: -11, at: 0.42, jitter: 0.04 },
    ],
    priority: 3,
    gap: 400,
    perSecond: 2,
    cents: 50,
    db: 1.5,
    late: 200,
  },
} as const satisfies Readonly<Record<string, SfxDef>>;

/** 音效的编号。 */
export type SfxId = keyof typeof SFX;

export const SFX_IDS = Object.keys(SFX) as SfxId[];

/** 是否为已知的音效编号（元素上写的 data-sfx 用）。 */
export function isSfxId(v: unknown): v is SfxId {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(SFX, v);
}

/** 这一种音效的定义。 */
export function sfxDef(id: SfxId): SfxDef {
  return SFX[id];
}

/** 界面一类的素材（一打开页面就先下载，解锁音频后先解码，点第一下就有声音）。 */
export const UI_SAMPLES: readonly SfxSampleId[] = ["ui.click", "ui.tab", "ui.open", "ui.close", "ui.toggle", "ui.tick", "ui.error", "ui.notify"];
