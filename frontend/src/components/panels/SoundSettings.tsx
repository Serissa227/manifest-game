// 设置里的“声音”一节：音乐、环境声与音效的音量、静音（总的，连音效一起）、后台播放、配乐风格（管弦 / 复古合成）、
// 曲目（随场景或一直播放指定的一首，可当点唱机用）。
// 与“画面”一节一样只保存在本机、立即生效，不经过“保存设置”。换风格时正在放的曲子交叉淡化换成另一套编配。
// 拖音效音量的滑条时，滑条按档位的轻响就是新音量下的音效，边拖边能听出大小。
// 新界面（v2）：标题行右边写“立即生效”（末尾的说明就不再重复这一句），配乐风格（只有两种）用分段控件；v1 不变。
import { useMusicStatus } from "../../audio/director";
import { MUSIC_STYLES, useAudioPrefs, type AudioPrefs, type MusicStyle } from "../../audio/prefs";
import { TRACK_IDS } from "../../audio/tracks";
import { t } from "../../i18n";
import { Select } from "../common";
import { musicHint, trackTitle } from "../../audio/labels";
import { useIsV2 } from "../../ui/uiMode";
import { PnSection } from "./PanelKit";
import { Segmented } from "./Segmented";

function Volume({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const n = Math.round(value * 100);
  return (
    <label className="field pn-st-volume">
      <span>{label}</span>
      <input type="range" aria-label={label} min={0} max={100} step={1} value={n} onChange={(e) => onChange(Number(e.target.value) / 100)} />
      <output>{n}</output>
    </label>
  );
}

const STYLE_LABEL: Readonly<Record<MusicStyle, "stStyleOrchestral" | "stStyleSynth">> = { orchestral: "stStyleOrchestral", synth: "stStyleSynth" };

export function SoundSection() {
  const prefs = useAudioPrefs();
  const status = useMusicStatus();
  const set = (patch: Partial<AudioPrefs>) => prefs.set(patch);
  const v2 = useIsV2();
  const styles = MUSIC_STYLES.map((s) => ({ value: s, label: t(STYLE_LABEL[s]) }));
  return (
    <PnSection title={t("stSound")} icon="music" className="pn-form" testId="settings-sound">
      {v2 && <p className="v2-st-instant">{t("v2.system.st.instant")}</p>}
      <Volume label={t("stMusicVolume")} value={prefs.music} onChange={(music) => set({ music })} />
      <Volume label={t("stAmbienceVolume")} value={prefs.ambience} onChange={(ambience) => set({ ambience })} />
      <Volume label={t("stSfxVolume")} value={prefs.sfx} onChange={(sfx) => set({ sfx })} />
      <div className="row">
        <label className="field">
          <input type="checkbox" aria-label={t("stMute")} checked={prefs.muted} onChange={(e) => set({ muted: e.target.checked })} />
          <span>{t("stMute")}</span>
        </label>
        <label className="field">
          <input type="checkbox" aria-label={t("stBackground")} checked={prefs.background} onChange={(e) => set({ background: e.target.checked })} />
          <span>{t("stBackground")}</span>
        </label>
      </div>
      {v2 ? (
        <Segmented<MusicStyle> label={t("stStyle")} value={prefs.style} options={styles} onChange={(style) => set({ style })} />
      ) : (
        <Select<MusicStyle> label={t("stStyle")} value={prefs.style} options={styles} onChange={(style) => set({ style })} />
      )}
      <Select<string>
        label={t("stTrack")}
        value={prefs.pick}
        options={[{ value: "auto", label: t("stTrackAuto") }, ...TRACK_IDS.map((id) => ({ value: id, label: trackTitle(id) }))]}
        onChange={(pick) => set({ pick: pick as AudioPrefs["pick"] })}
      />
      <p className="sub pn-st-help" data-testid="sound-now">
        {musicHint(prefs.muted, status.track, status.resting, status.active, status.orchestral).split("\n")[0]}
      </p>
      {prefs.style === "orchestral" && status.loading && (
        <p className="sub pn-st-help" data-testid="sound-loading">
          {t("stStyleLoading")}
        </p>
      )}
      <p className="sub pn-st-help">{t(v2 ? "v2.system.st.soundHelp" : "stSoundHelp")}</p>
    </PnSection>
  );
}
