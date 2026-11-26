// 曲名与音乐开关的提示文字（按界面语言）。
import { t } from "../i18n";
import { currentLocale } from "../i18n/locale";
import { TRACKS, type TrackId } from "./tracks";

/** 曲名（中文界面用中文名，英文界面用英文名；只起了中文名的曲子在英文界面也显示中文名）。 */
export function trackTitle(id: TrackId): string {
  const tr = TRACKS[id];
  return currentLocale() === "en" ? (tr.title.en ?? tr.title.zh) : tr.title.zh;
}

/** 悬停提示：正在播放什么（后面跟着是管弦版还是复古合成版）、点击会怎样（两行）。 */
export function musicHint(muted: boolean, track: TrackId | null, resting: boolean, active: boolean, orchestral = false): string {
  if (muted) return t("musicOff");
  if (!active || !track) return `${t("musicWaiting")}\n${t("musicOn")}`;
  const title = trackTitle(track);
  const line = resting ? t("musicResting", { title }) : t("musicNow", { title });
  return `${t("musicStyleTag", { line, style: t(orchestral ? "musicOrchestral" : "musicSynth") })}\n${t("musicOn")}`;
}
