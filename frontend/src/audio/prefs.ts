// 声音偏好：音乐、环境声与音效的音量、静音、切到后台时是否继续播放、曲目（随场景或指定一首）、配乐风格（管弦 / 复古合成）。
// 只保存在本机（与“昼夜光影”一样），立即生效；读写失败（隐私模式等）时按默认值、只在本次运行中生效。
// “静音”是总的静音：音乐、环境声与音效一起静掉；只想关音乐时把音乐音量拖到 0，音效照常。
import { create } from "zustand";
import { isTrackId, type TrackId } from "./tracks";

const KEY = "manifest.audio";

/** 配乐风格：管弦（真实乐器的采样）或复古合成（程序实时合成）。 */
export type MusicStyle = "orchestral" | "synth";

export const MUSIC_STYLES: readonly MusicStyle[] = ["orchestral", "synth"];

export interface AudioPrefs {
  /** 音乐音量 0–1 */
  music: number;
  /** 环境声音量 0–1 */
  ambience: number;
  /** 音效音量 0–1（按钮、交易、出港入港、海战……）；以前存的偏好里没有这一项，按缺省 */
  sfx: number;
  /** 总的静音（音乐、环境声与音效） */
  muted: boolean;
  /** 切到后台（标签页隐藏、窗口最小化）时继续播放 */
  background: boolean;
  /** 曲目：随场景自动选择，或一直播放指定的一首 */
  pick: TrackId | "auto";
  /** 配乐风格：缺省管弦；以前存的偏好里没有这一项，也按管弦 */
  style: MusicStyle;
}

export const DEFAULT_PREFS: AudioPrefs = { music: 0.6, ambience: 0.5, sfx: 0.7, muted: false, background: false, pick: "auto", style: "orchestral" };

function clamp01(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback;
}

/** 是否为已知的配乐风格。 */
export function isMusicStyle(v: unknown): v is MusicStyle {
  return v === "orchestral" || v === "synth";
}

/** 从本机存储读出（字段缺失或不合法时逐项回退到默认值）。 */
export function loadPrefs(): AudioPrefs {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const v = JSON.parse(raw) as Partial<Record<keyof AudioPrefs, unknown>>;
    return {
      music: clamp01(v.music, DEFAULT_PREFS.music),
      ambience: clamp01(v.ambience, DEFAULT_PREFS.ambience),
      sfx: clamp01(v.sfx, DEFAULT_PREFS.sfx),
      muted: typeof v.muted === "boolean" ? v.muted : DEFAULT_PREFS.muted,
      background: typeof v.background === "boolean" ? v.background : DEFAULT_PREFS.background,
      pick: v.pick === "auto" || isTrackId(v.pick) ? v.pick : "auto",
      style: isMusicStyle(v.style) ? v.style : DEFAULT_PREFS.style,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export interface AudioPrefsStore extends AudioPrefs {
  set: (patch: Partial<AudioPrefs>) => void;
}

export const useAudioPrefs = create<AudioPrefsStore>((set, get) => ({
  ...loadPrefs(),
  set: (patch) => {
    set(patch);
    const { music, ambience, sfx, muted, background, pick, style } = get();
    try {
      globalThis.localStorage?.setItem(KEY, JSON.stringify({ music, ambience, sfx, muted, background, pick, style }));
    } catch {
      // 本机存储不可用时只在本次运行中生效
    }
  },
}));
