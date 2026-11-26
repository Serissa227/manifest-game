import VoyagePrefs from "./VoyagePrefs";
import { useEffect, useState, type ReactNode } from "react";
import { t, tk } from "../../i18n";
import { LOCALES, LOCALE_NAMES, chosenLocale, currentLocale, isChinese, languageChoice } from "../../i18n/locale";
import { api } from "../../ipc/api";
import type { AiMode, AppSettings, ArrivalPause, Locale, ModelTier, ProviderKind, SettingsView, UpbringingPause } from "../../ipc/types";
import { useGame } from "../../store/game";
import { chineseOnly } from "../start/worldKit";
import { SPEED_TIERS, nearestTier, type DaylightPref } from "../../time/daylight";
import { tierName, tierSecs } from "../../time/speedText";
import { tz } from "../../i18n/zhOnly";
import { useDaylightPref } from "../../time/prefs";
import { useWeatherFxPref } from "../../map/weatherPref";
import { useIsV2, useUiVersion, type UiVersion } from "../../ui/uiMode";
import { ActionButton, NumInput, Select } from "../common";
import { Icon, PnSection } from "./PanelKit";
import { Segmented } from "./Segmented";
import { StoryTextPicker } from "./StoryTextPicker";
import { TutorialSection } from "../tutorial/TutorialSection";
import { SoundSection } from "./SoundSettings";

const MODES: AiMode[] = ["Off", "Offline", "Mock", "Live"];
const PROVIDERS: ProviderKind[] = ["Anthropic", "OpenAiCompatible"];
const TIERS: ModelTier[] = ["Fast", "Balanced", "Quality"];

/** 键按字母排好再序列化：比较两份设置时不受键的先后影响。 */
function stable(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : x,
  );
}

/** 两份设置是不是一样（旧设置文件没有的字段按缺省值算：语言为当前界面语言、结构化输出为开）。 */
function sameSettings(a: AppSettings, b: AppSettings): boolean {
  const norm = (s: AppSettings) => ({ ...s, language: s.language ?? currentLocale(), ai: { ...s.ai, structured: s.ai.structured ?? true } });
  return stable(norm(a)) === stable(norm(b));
}

/**
 * 设置：语言（简体中文 / English，EXPANSION.md §12）、LLM 提供商与模型档位、API 密钥（经系统凭据管理器存储）、预算、结构化输出开关、
 * AI 组合事件的说明（如何接入、效果词表）、Jev 开关与地址、游戏速度、自动存档；
 * 画面：界面风格（海图室 / 经典像素）、昼夜光影（跟随时间 / 始终白天）、天气特效（缺省开）；声音：音乐与环境声的音量、静音、后台播放、曲目。两节只保存在本机、立即生效，不经过“保存设置”。
 * 语言随“保存设置”写入 AppSettings.language，保存后立即切换，并按新语言重新获取静态数据（地名、人名等）。
 *
 * 新界面（v2，docs/UI-REDESIGN.md）的排法（v1 的 DOM 与顺序不变）：
 * - 常用的在前：语言 → 游戏 → 画面 → 声音 → AI 与模型 → Jev → AI 组合事件的说明（收起）→ 新手教程；
 * - 只有两三个选项的（语言、界面风格、昼夜光影、配乐风格）用分段控件，一眼看到全部、一次点击换过去；
 * - “画面”“声音”标出“立即生效”；“保存设置”贴在窗口底边（手机上就在拇指下面），旁边写着有没有没保存的修改。
 */
export default function SettingsPanel() {
  const [view, setView] = useState<SettingsView | null>(null);
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [key, setKey] = useState("");
  const daylight = useDaylightPref((s) => s.pref);
  const setDaylight = useDaylightPref((s) => s.setPref);
  const weatherFx = useWeatherFxPref((s) => s.on);
  const setWeatherFx = useWeatherFxPref((s) => s.setOn);
  const ui = useUiVersion((s) => s.ui);
  const setUi = useUiVersion((s) => s.setUi);
  const v2 = useIsV2();
  // B11：当前世界的内容只有中文时，在语言一节说明（不停用英文：界面字符串照常切换）
  const zhOnly = useGame((s) => chineseOnly(s.statics?.world?.languages));

  useEffect(() => {
    api
      .getSettings()
      .then((v) => {
        setView(v);
        setDraft(v.settings);
      })
      .catch((e: unknown) => useGame.getState().fail(e));
  }, []);

  if (!view || !draft) return null;
  const ai = draft.ai;
  const setAi = (patch: Partial<AppSettings["ai"]>) => setDraft({ ...draft, ai: { ...ai, ...patch } });
  const hasKey = view.keys.find(([p]) => p === ai.provider)?.[1] ?? false;
  // 结构化输出默认开启（旧设置文件没有这个字段）
  const structured = ai.structured ?? true;
  const apply = (v: SettingsView) => {
    setView(v);
    setDraft(v.settings);
    useGame.getState().setDevMode(v.settings.dev_mode);
  };

  // 旧设置没有 language 时显示当前界面语言（首次启动按系统语言）
  const language: Locale = draft.language ?? currentLocale();
  const languageOptions = LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] }));
  const daylightOptions: { value: DaylightPref; label: string }[] = [
    { value: "clock", label: t("pnStDaylightClock") },
    { value: "day", label: t("pnStDaylightDay") },
  ];
  // 界面风格：缺省的海图室在前
  const skinOptions: { value: UiVersion; label: string }[] = [
    { value: "v2", label: t("pnStUiSkinChart") },
    { value: "v1", label: t("pnStUiSkinClassic") },
  ];

  const languageSection = (
    <PnSection title={t("stLanguage")} icon="map" className="pn-form" testId="settings-language">
      {/* L01F：两套中文都显示为“中文”；选“中文”时回到用户选过的那一套剧情文本 */}
      {v2 && languageOptions.length <= 3 ? (
        <Segmented<Locale> label={t("stLanguage")} value={languageChoice(language)} options={languageOptions} onChange={(l) => setDraft({ ...draft, language: chosenLocale(l) })} />
      ) : (
        <Select<Locale> label={t("stLanguage")} value={languageChoice(language)} options={languageOptions} onChange={(l) => setDraft({ ...draft, language: chosenLocale(l) })} />
      )}
      {isChinese(language) && (
        <StoryTextPicker
          variant="settings"
          value={language}
          v2={v2}
          onChanged={(next: Locale) => {
            setDraft({ ...draft, language: next });
            setView({ ...view, settings: { ...view.settings, language: next } });
          }}
        />
      )}
      <p className="sub pn-st-help">{t("stLanguageHelp")}</p>
      {zhOnly && <p className="sub pn-st-help" data-testid="settings-zh-only">{t("stLanguageZhOnly")}</p>}
    </PnSection>
  );
  const aiSection = (
    <PnSection title={t("stAi")} icon="intel" className="pn-form">
      <Select
        label={t("stMode")}
        value={ai.mode}
        options={MODES.map((m) => ({ value: m, label: tk(`mode.${m}`) }))}
        onChange={(mode) => setAi({ mode })}
      />
      <Select
        label={t("stProvider")}
        value={ai.provider}
        options={PROVIDERS.map((p) => ({ value: p, label: tk(`provider.${p}`) }))}
        onChange={(provider) => setAi({ provider })}
      />
      <label className="field">
        <span>{t("stBaseUrl")}</span>
        <input aria-label={t("stBaseUrl")} value={ai.base_url} onChange={(e) => setAi({ base_url: e.target.value })} />
      </label>
      <Select
        label={t("stTier")}
        value={ai.tier}
        options={TIERS.map((x) => ({ value: x, label: tk(`tier.${x}`) }))}
        onChange={(tier) => setAi({ tier })}
      />
      <fieldset className="pn-fieldset">
        <legend>{t("stModels")}</legend>
        {TIERS.map((tier, i) => (
          <label key={tier} className="field">
            <span>{tk(`tier.${tier}`)}</span>
            <input
              aria-label={`${t("stModels")} ${tk(`tier.${tier}`)}`}
              value={ai.models[i]}
              onChange={(e) => {
                const models = [...ai.models] as [string, string, string];
                models[i] = e.target.value;
                setAi({ models });
              }}
            />
          </label>
        ))}
      </fieldset>
      <div className="row pn-keyrow">
        <label className="field">
          <span>{t("stKeyStatus", { label: t("stKey"), status: hasKey ? t("stKeySaved") : t("stKeyMissing") })}</span>
          <input
            type="password"
            autoComplete="off"
            aria-label={t("stKey")}
            placeholder={t("stKeyPlaceholder")}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </label>
        <ActionButton
          disabled={!key.trim()}
          onClick={async () => {
            try {
              // 只更新密钥状态，不覆盖尚未保存的其他修改
              setView(await api.setApiKey(ai.provider, key));
              setKey("");
            } catch (e) {
              useGame.getState().fail(e);
            }
          }}
        >
          {t("stKeySave")}
        </ActionButton>
        <ActionButton
          kind="danger"
          disabled={!hasKey}
          onClick={async () => {
            try {
              setView(await api.clearApiKey(ai.provider));
            } catch (e) {
              useGame.getState().fail(e);
            }
          }}
        >
          {t("stKeyClear")}
        </ActionButton>
      </div>
      <NumInput
        label={t("stBudgetCalls")}
        value={ai.monthly_calls}
        min={0}
        onChange={(monthly_calls) => setAi({ monthly_calls })}
      />
      <NumInput
        label={t("stBudgetTokens")}
        value={ai.monthly_tokens}
        min={0}
        step={1000}
        onChange={(monthly_tokens) => setAi({ monthly_tokens })}
      />
      <div className="pn-structured">
        <label className="field">
          <input
            type="checkbox"
            aria-label={t("pnStStructured")}
            checked={structured}
            onChange={(e) => setAi({ structured: e.target.checked })}
          />
          <span>{t("pnStStructured")}</span>
        </label>
        <p className="sub pn-st-help">{t("pnStStructuredHelp")}</p>
      </div>
    </PnSection>
  );
  // AI 组合事件的说明（如何接入、效果词表）：v2 下引言之后的部分收在“展开说明”里
  const composedMore: ReactNode = (
    <>
      <h4 className="pn-h4">
        <Icon name="settings" />
        {t("pnStHowTo")}
      </h4>
      <ol className="pn-st-steps">
        <li>{t("pnStStep1")}</li>
        <li>{t("pnStStep2")}</li>
        <li>{t("pnStStep3")}</li>
        <li>{t("pnStStep4")}</li>
      </ol>
      <h4 className="pn-h4">
        <Icon name="quest" />
        {t("pnStVocab")}
      </h4>
      <ul className="pn-st-vocab">
        <li>{t("pnStVocabGoods")}</li>
        <li>{t("pnStVocabLocal")}</li>
        <li>{t("pnStVocabSea")}</li>
        <li>{t("pnStVocabFaction")}</li>
        <li>{t("pnStVocabWorld")}</li>
      </ul>
      <p className="sub pn-st-help">{t("pnStVocabNote")}</p>
    </>
  );
  const composedSection = (
    <PnSection title={t("pnStComposed")} icon="ai_event" className="pn-form pn-st-composed" testId="settings-composed">
      <p className="pn-st-intro">{t("pnStComposedIntro")}</p>
      {v2 ? (
        <details className="v2-st-more">
          <summary>{t("v2.system.st.more")}</summary>
          {composedMore}
        </details>
      ) : (
        composedMore
      )}
    </PnSection>
  );
  const jevSection = (
    <PnSection title={t("stJev")} icon="star" className="pn-form">
      {!view.jev_available && <p className="sub">{t("stJevUnavailable")}</p>}
      <label className="field">
        <input
          type="checkbox"
          aria-label={t("stJevEnabled")}
          checked={ai.jev_enabled}
          onChange={(e) => setAi({ jev_enabled: e.target.checked })}
        />
        <span>{t("stJevEnabled")}</span>
      </label>
      <label className="field">
        <span>{t("stJevUrl")}</span>
        <input aria-label={t("stJevUrl")} value={ai.jev_url} onChange={(e) => setAi({ jev_url: e.target.value })} />
      </label>
    </PnSection>
  );
  const gameSection = (
    <PnSection title={t("stGame")} icon="settings" className="pn-form">
      {/* 默认速度：慢 / 普通 / 快三档（旧设置里的其他倍速显示为最近的一档） */}
      <Select<number>
        label={t("stSpeed")}
        value={nearestTier(draft.speed)}
        options={SPEED_TIERS.map((n) => ({ value: n, label: tz("time.tierOption", { name: tierName(n), secs: tierSecs(n), sea: tierSecs(n, true) }) }))}
        onChange={(speed) => setDraft({ ...draft, speed })}
      />
      <NumInput
        label={t("stAutosave")}
        value={draft.autosave_days}
        min={0}
        max={360}
        onChange={(autosave_days) => setDraft({ ...draft, autosave_days })}
      />
      {/* 抵达时自动暂停：旧后端没有这一项时不显示 */}
      {draft.arrival_pause !== undefined && (
        <Select<ArrivalPause>
          label={t("stArrivalPause")}
          value={draft.arrival_pause}
          options={[
            { value: "flagship", label: t("stArrivalFlagship") },
            { value: "any", label: t("stArrivalAny") },
            { value: "off", label: t("stArrivalOff") },
          ]}
          onChange={(arrival_pause) => setDraft({ ...draft, arrival_pause })}
        />
      )}
      {/* 手动航行中途的分钟暂停（关掉后一律不停；抵达锚地那一次开着时还要看上面的“抵达时自动暂停”）：旧后端没有这一项时不显示 */}
      {draft.navigation_pause !== undefined && (
        <label className="field">
          <input
            type="checkbox"
            aria-label={t("stNavigationPause")}
            checked={draft.navigation_pause}
            onChange={(e) => setDraft({ ...draft, navigation_pause: e.target.checked })}
          />
          <span>{t("stNavigationPause")}</span>
        </label>
      )}
      {/* H03 / H08：航海的几项开关（新文件 VoyagePrefs） */}
      <VoyagePrefs draft={draft} setDraft={setDraft} />
      {/* U05：养成期播放的停顿方式（养成画面的周条上也有同一个下拉框）；旧后端没有这一项时不显示 */}
      {draft.upbringing_pause !== undefined && (
        <Select<UpbringingPause>
          label={tz("settings.upbringingPause")}
          value={draft.upbringing_pause}
          options={[
            { value: "week", label: tz("ub.wk.pause.week") },
            { value: "month", label: tz("ub.wk.pause.month") },
            { value: "event", label: tz("ub.wk.pause.event") },
          ]}
          onChange={(upbringing_pause) => setDraft({ ...draft, upbringing_pause })}
        />
      )}
      <label className="field">
        <input
          type="checkbox"
          aria-label={t("stDevMode")}
          checked={draft.dev_mode}
          onChange={(e) => setDraft({ ...draft, dev_mode: e.target.checked })}
        />
        <span>{t("stDevMode")}</span>
      </label>
    </PnSection>
  );
  const displaySection = (
    <PnSection title={t("pnStDisplay")} icon="summer" className="pn-form" testId="settings-display">
      {v2 && <p className="v2-st-instant">{t("v2.system.st.instant")}</p>}
      {/* 界面风格：海图室（缺省）/ 经典像素——只保存在本机、立即生效（ui/uiMode.ts）；
          海图室里用分段控件，经典像素里用原来的下拉框（v1 下没有 v2 的类与单选组） */}
      {v2 ? (
        <Segmented<UiVersion> label={t("pnStUiSkin")} value={ui} options={skinOptions} onChange={setUi} testId="settings-ui-skin" />
      ) : (
        <Select<UiVersion> label={t("pnStUiSkin")} value={ui} options={skinOptions} onChange={setUi} />
      )}
      <p className="sub pn-st-help">{t(v2 ? "v2.system.st.uiSkinHelp" : "pnStUiSkinHelp")}</p>
      {v2 ? (
        <Segmented<DaylightPref> label={t("pnStDaylight")} value={daylight} options={daylightOptions} onChange={setDaylight} />
      ) : (
        <Select<DaylightPref> label={t("pnStDaylight")} value={daylight} options={daylightOptions} onChange={setDaylight} />
      )}
      {/* v2：“立即生效 · 只存在本机”已写在标题行的小签上，说明不再重复这一句 */}
      <p className="sub pn-st-help">{t(v2 ? "v2.system.st.daylightHelp" : "pnStDaylightHelp")}</p>
      {/* 天气特效（缺省开）：海图上的压暗、雨线与闪电，以及旗舰在暴风雨里时的全画面雨幕——只保存在本机、立即生效（map/weatherPref.ts） */}
      <label className="field">
        <input type="checkbox" aria-label={tz("st.weatherFx")} checked={weatherFx} onChange={(e) => setWeatherFx(e.target.checked)} data-testid="settings-weather-fx" />
        <span>{tz("st.weatherFx")}</span>
      </label>
      <p className="sub pn-st-help">{tz("st.weatherFxHelp")}</p>
    </PnSection>
  );
  const save = (
    <ActionButton
      kind="primary"
      onClick={async () => {
        try {
          apply(await api.saveSettings({ ...draft, language }));
          // 语言变了：立即切换（界面按新语言重新挂载），提示用新语言说
          if (language !== currentLocale()) await useGame.getState().applyLocale(language);
          useGame.getState().notify(t("stSaved"));
        } catch (e) {
          useGame.getState().fail(e);
        }
      }}
    >
      {t("stSave")}
    </ActionButton>
  );

  if (v2) {
    const dirty = !sameSettings({ ...draft, language }, view.settings);
    return (
      <div data-testid="settings-panel" className="pn pn-settings v2-settings">
        {languageSection}
        {gameSection}
        {displaySection}
        <SoundSection />
        {aiSection}
        {jevSection}
        {composedSection}
        <TutorialSection />
        <div className="pn-savebar v2-st-savebar">
          <p className={dirty ? "v2-st-savestate is-dirty" : "v2-st-savestate"} role="status" data-testid="settings-savestate">
            {dirty ? t("v2.system.st.dirty") : t("v2.system.st.clean")}
          </p>
          {save}
        </div>
      </div>
    );
  }

  return (
    <div data-testid="settings-panel" className="pn pn-settings">
      {languageSection}
      {aiSection}
      {composedSection}
      {jevSection}
      {gameSection}
      {displaySection}
      <SoundSection />
      <TutorialSection />
      <div className="pn-savebar">{save}</div>
    </div>
  );
}
