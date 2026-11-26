// 开局向导的“外貌”与“姓名”两步。
// 外貌：24 种外貌的缩略图（编号 0–11 与 13–24，界面上依次是第 1–24 种）、◀ ▶ 逐个翻看与“随机”；大图在侧栏的船长卡上。
// 头像是 AI 生成的时代肖像（缩略图用脸部特写），缺图时回退到程序头像。
// 姓名：输入与“随机”。
import { captainAssetId } from "../../art/portraitCast";
import { Sprite } from "../../art/Sprite";
import { t } from "../../i18n";
import { PortraitArt } from "../portrait/PortraitArt";
import { CAPTAIN_LOOK_IDS, CAPTAIN_NAME_MAX, CAPTAIN_PORTRAITS, captainPortrait, cleanName, lookNumber, stepLook } from "./captain";
import { drawArrowIcon } from "./titleArt";

export function LookStep({
  look,
  onLook,
  onRandomLook,
  headingId,
}: {
  look: number;
  onLook: (look: number) => void;
  onRandomLook: () => void;
  headingId: string;
}) {
  return (
    <div className="ts-field cw-looks">
      <div className="ts-looks-head">
        <span className="ts-field-label">
          <span id={`${headingId}-looks`}>{t("start.looks")}</span>
          <span className="ts-look-count" aria-hidden>
            {t("start.lookCount", { n: lookNumber(look), total: CAPTAIN_PORTRAITS })}
          </span>
        </span>
        <span className="cw-look-nav">
          <button type="button" className="ts-btn ts-btn-arrow" aria-label={t("start.prevLook")} onClick={() => onLook(stepLook(look, -1))}>
            <Sprite px={drawArrowIcon("left")} scale={2} />
          </button>
          <button type="button" className="ts-btn ts-btn-arrow" aria-label={t("start.nextLook")} onClick={() => onLook(stepLook(look, 1))}>
            <Sprite px={drawArrowIcon("right")} scale={2} />
          </button>
          <button type="button" className="ts-btn ts-btn-small" aria-label={t("start.randomLook")} onClick={onRandomLook}>
            {t("start.random")}
          </button>
        </span>
      </div>
      <div className="ts-looks" role="radiogroup" aria-labelledby={`${headingId}-looks`}>
        {CAPTAIN_LOOK_IDS.map((i) => (
          <label key={i} className={i === look ? "ts-look is-selected" : "ts-look"}>
            <input
              type="radio"
              name="captain-look"
              className="ts-sr"
              checked={i === look}
              aria-label={t("start.lookN", { n: lookNumber(i) })}
              onChange={() => onLook(i)}
            />
            <PortraitArt asset={captainAssetId(i)} fallback={() => captainPortrait(i)} size={52} />
          </label>
        ))}
      </div>
    </div>
  );
}

export function NameStep({
  name,
  onName,
  onRandomName,
}: {
  name: string;
  onName: (name: string) => void;
  onRandomName: () => void;
}) {
  const shown = cleanName(name);
  return (
    <div className="ts-field cw-name">
      <label htmlFor="ts-captain-name">{t("start.captainName")}</label>
      <div className="ts-field-row">
        <input
          id="ts-captain-name"
          className="ts-input"
          value={name}
          maxLength={CAPTAIN_NAME_MAX}
          autoComplete="off"
          spellCheck={false}
          placeholder={t("start.captainNameHint")}
          aria-invalid={!shown}
          aria-describedby={shown ? undefined : "ts-captain-name-hint"}
          onChange={(e) => onName(e.target.value)}
        />
        <button type="button" className="ts-btn" aria-label={t("start.randomName")} onClick={onRandomName}>
          {t("start.random")}
        </button>
      </div>
      {!shown && (
        <p id="ts-captain-name-hint" className="ts-hint is-warn" role="alert">
          {t("start.captainNameEmpty")}
        </p>
      )}
    </div>
  );
}
