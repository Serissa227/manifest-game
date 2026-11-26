// 音乐开关：顶栏（存档一排）里一个小按钮；开局画面在左下的语言下拉旁。
// 悬停提示写正在播放的曲名（后面跟着是管弦版还是复古合成版）；点击切换静音（静音时不创建音频，省电）。
import { useMusicStatus } from "../../audio/director";
import { musicHint } from "../../audio/labels";
import { useAudioPrefs } from "../../audio/prefs";
import { t } from "../../i18n";
import { ShellIcon } from "./ShellIcon";

export default function MusicToggle() {
  const muted = useAudioPrefs((s) => s.muted);
  const set = useAudioPrefs((s) => s.set);
  const { active, track, resting, orchestral } = useMusicStatus();
  return (
    <button
      type="button"
      className="music-toggle"
      aria-pressed={!muted}
      aria-label={t("musicToggle")}
      title={musicHint(muted, track, resting, active, orchestral)}
      data-testid="music-toggle"
      onClick={() => set({ muted: !muted })}
    >
      <ShellIcon name={muted ? "music_off" : "music"} scale={1} />
    </button>
  );
}
