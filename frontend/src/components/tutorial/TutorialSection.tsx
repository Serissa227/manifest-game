// 设置里的“新手教程”一节：从头再看一遍（看完或跳过后，新开局不再自动出现，想看就从这里打开）。
// 新界面（v2）另有一个“全部快捷键”键：打开按“?”出来的那张卡（11-03 操作手感：快捷键要在设置或帮助里找得到；触屏上不显示）。
import { t } from "../../i18n";
import { tz } from "../../i18n/zhOnly";
import { useIsV2 } from "../../ui/uiMode";
import { Kbd, openShortcutHelp } from "../feedback";
import { PnSection } from "../panels/PanelKit";
import { useTutorial } from "./tutorialState";

export function TutorialSection() {
  const v2 = useIsV2();
  return (
    <PnSection title={t("tut.settingsTitle")} icon="quest" className="pn-form" testId="settings-tutorial">
      <p className="sub pn-st-help">{t("tut.settingsHelp")}</p>
      <button type="button" className="btn" onClick={() => useTutorial.getState().start()}>
        {t("tut.settingsStart")}
      </button>
      {v2 && (
        <p className="pn-st-keys">
          <span className="sub">{tz("hk.settingsHelp")}</span>
          <button type="button" className="btn" onClick={openShortcutHelp}>
            {tz("hk.settingsOpen")}
            <Kbd k="?" />
          </button>
        </p>
      )}
    </PnSection>
  );
}
