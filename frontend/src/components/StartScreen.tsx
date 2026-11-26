// 标题画面：背景是会动的黄昏港湾；左侧是游戏标题与主菜单，右侧是带框的窗口——“新的航程”或“读取存档”。
// “新的航程”是一个分步向导（docs/ECONOMY.md 5.1）：剧本 → 外貌 → 生日 → 姓名 → 身世五问 → 属性 → 启航（随机种子与开始新游戏）。
// 除剧本一步外，右侧始终有一张船长卡随选择更新。数据没有身世（旧数据、旧后端）时只有剧本、外貌、姓名与启航。
// 剧本一步里“推荐选择”（带主角与故事线的剧本）排在最前面、加亮，缺省选中第一位；选了推荐角色时外貌、生日、姓名、身世与属性
// 都已定好，只剩剧本与启航两步，启航页换成这位角色的小传与定好的身世（HeroSummary），开局提交的是数据里定好的主角。
// 开局依次调用 new_game、（选随船传递时）提交 SetInfoMode、set_captain，有身世时再提交 CreateCaptain。
// 没有主角名册的非经典世界（框架测试海域）也走这个向导，开局改调 new_world_game（行情情报随请求），随后照样设置主角、立下身世。
// 读档：存档可能在别的世界，先按读进来的这一局换上静态数据（store 的 enterLoaded）再进入游戏；世界多于一个时存档行写上世界名。
// 启航一步还可以选“行情情报”（docs/ECONOMY.md 第 7 节）：随船传递（推荐，缺省）或实时（经典）。
// 新界面（v2，docs/UI-REDESIGN.md 第 8 节第 1 组）只在 v2 下做的小调整：随机种子从底栏挪进启航一步的正文（底栏只留导航）；
// 读档没有存档时给“开始新的航程”，删除存档用确认对话框。v1 照旧。
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Sprite } from "../art/Sprite";
import { DEFAULT_START_YEAR, eraName, t, tk } from "../i18n";
import { LOCALES, LOCALE_NAMES, chosenLocale, languageChoice, useLocale } from "../i18n/locale";
import { StoryTextPicker } from "./panels/StoryTextPicker";
import { api, errorText } from "../ipc/api";
import { loadMissing } from "./shell/saveSlots";
import type { InfoMode, WorldCatalog, WorldView } from "../ipc/types";
import { setWorld } from "../i18n";
import WorldStart, { WorldPicker } from "./start/WorldStart";
import { CLASSIC_WORLD, hasRoster, needsWorldStep, newGameWorlds, type CustomDraft } from "./start/worldKit";
import { useGame } from "../store/game";
import { Loading } from "./feedback";
import CaptainCard from "./start/CaptainCard";
import { LookStep, NameStep } from "./start/CaptainCreator";
import { AttributesStep, BackgroundStep, BirthdayStep, DraftSummary, Stepper, type SummaryEdit } from "./start/CaptainSteps";
import {
  captainName,
  defaultScenario,
  cleanName,
  freshRoll,
  isFemaleLook,

  lookFromRoll,
  rollLook,
  rollName,
  scenarioFacts,
  stripControls,
  wrapLook,
} from "./start/captain";
import SaveSlots, { type SaveEntry } from "./start/SaveSlots";
import { continueNote, continueSave, useElapsed, waitText } from "./start/continueSave";
import { tz } from "../i18n/zhOnly";
import ScenarioCards from "./start/ScenarioCards";
import { HeroSummary } from "./start/HeroSummary";
import TitleScene from "./start/TitleScene";
import { drawCompassRose, drawMenuCursor } from "./start/titleArt";
import { useCaptainDraft } from "./start/useCaptainDraft";
import { useWizardNav } from "./start/useWizardNav";
import { windowSkin } from "./start/windowSkin";
import { answersOk, birthdayOk, creationOf, heroAttrs, heroCreation, optionOf, wizardSteps, type StepKey } from "./start/wizard";
import MusicToggle from "./shell/MusicToggle";
import { useIsV2 } from "../ui/uiMode";
import { SeedBlock, SeedField } from "./start/SeedField";

type View = "new" | "load";

/** 标题：把“Manifest · 船货清单”拆成英文大字与中文副标（读屏仍读整句）；下面是纪年（航海历 1502 年）与一句编年背景。 */
function Logo({ world }: { world?: WorldView }) {
  const title = t("appTitle");
  const [en, zh] = title.includes("·") ? title.split("·").map((s) => s.trim()) : [title, ""];
  return (
    <div className="title-logo">
      <Sprite px={drawCompassRose()} scale={3} className="title-emblem" />
      <h1 className="title-name">
        <span className="title-name-en">{en}</span>
        {zh && <span className="ts-sr"> · </span>}
        {zh && <span className="title-name-zh">{zh}</span>}
      </h1>
      <p className="title-tagline">{t("start.tagline")}</p>
      {world?.era && (
        <p className="title-era">
          <span className="title-era-year">{t("start.eraLine", { era: eraName(world.era), year: world.start_year ?? DEFAULT_START_YEAR })}</span>
          {/* 这句编年背景（巨人之门）是经典世界的；别的世界（寰宇）没有对应的话，只写纪年 */}
          {(world.key ?? CLASSIC_WORLD) === CLASSIC_WORLD && <span className="title-era-lore">{t("start.eraLore")}</span>}
        </p>
      )}
    </div>
  );
}

/** 语言下拉（标题画面左下）：选中即保存进设置并切换（EXPANSION.md §12）。 */
function LanguageSwitch() {
  const locale = useLocale((s) => s.locale);
  return (
    <label className="title-lang">
      <span className="title-lang-label">{t("stLanguage")}</span>
      <select
        aria-label={t("stLanguage")}
        value={languageChoice(locale)}
        onChange={(e) => {
          // L01F：选“中文”时回到用户选过的那一套剧情文本（原文或 Gemini），不悄悄改回原文
          const next = LOCALES.find((l) => l === e.target.value);
          if (next) void useGame.getState().changeLanguage(chosenLocale(next));
        }}
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
    </label>
  );
}

function MenuItem({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" className={active ? "title-menu-item is-active" : "title-menu-item"} aria-pressed={active} onClick={onClick}>
      <Sprite px={drawMenuCursor()} scale={3} className="title-menu-cursor" />
      <span>{label}</span>
    </button>
  );
}

/** 主菜单的“继续”（11-03）：一键读最近写入的存档；下面一行小字写明是哪一局。读档途中不能再点。 */
function ContinueItem({ save, busy, onLoad }: { save: SaveEntry; busy: boolean; onLoad: (slot: string) => void }) {
  return (
    <button
      type="button"
      className="title-menu-item title-menu-continue"
      data-testid="start-continue"
      disabled={busy}
      onClick={() => onLoad(save.slot)}
    >
      <Sprite px={drawMenuCursor()} scale={3} className="title-menu-cursor" />
      <span>{tz("start.continue")}</span>
      <small className="title-menu-note">{continueNote(save)}</small>
    </button>
  );
}

/** 汇总里的剧本一行：剧本名与起始港。 */
function ScenarioRow({ name, port }: { name: string; port?: string }) {
  return (
    <div className="cw-summary-row">
      <dt>{t("cap.cf.scenario")}</dt>
      <dd>{port ? t("cap.cf.scenarioValue", { scenario: name, port }) : name}</dd>
    </div>
  );
}

/** 开局设置：行情情报（docs/ECONOMY.md 第 7 节）。 */
function InfoChoice({ value, onChange }: { value: InfoMode; onChange: (v: InfoMode) => void }) {
  return (
    <fieldset className="cw-info" data-testid="start-info">
      <legend>{t("info.title")}</legend>
      {(["carried", "live"] as const).map((m) => (
        <label key={m} className="cw-info-opt">
          <input type="radio" name="start-info" value={m} checked={value === m} onChange={() => onChange(m)} />
          <span className="cw-info-name">{tk(`info.mode.${m}`)}</span>
          <small>{tk(`info.mode.${m}Hint`)}</small>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * 开始界面：按向导选择剧本、创建船长后开局，或读取存档。roll 固定默认姓名、外貌、生日与各“随机”的结果（测试用）。
 * waitWorlds（外壳传入，11-03 启动提速）：世界目录还没到时（后端还在后台读世界），“新的航程”先显示“正在读取世界……”，
 * 不先露出经典世界的向导；没给时照旧（直接渲染开局画面的测试）。
 */
export default function StartScreen({ roll, waitWorlds = false }: { roll?: number; waitWorlds?: boolean } = {}) {
  const v2 = useIsV2();
  const statics = useGame((s) => s.statics);
  const newGame = useGame((s) => s.newGame);
  const newWorldGame = useGame((s) => s.newWorldGame);
  const uid = useId();
  const [view, setView] = useState<View>("new");
  // TITLE1：玩家点过菜单项或动过向导（点、按键）以后，存档晚到也不再把人从向导拽到存档列表
  const touched = useRef(false);
  const touch = () => {
    touched.current = true;
  };
  // 单栏排布（窄屏：标题在上、窗口在下）时，点了菜单就把窗口滚到眼前（网页自适应）
  const windowRef = useRef<HTMLElement>(null);
  const choose = (v: View) => {
    touch();
    setView(v);
    if (typeof window !== "undefined" && window.innerWidth <= 1000) {
      setTimeout(() => windowRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }), 0);
    }
  };
  const [scenario, setScenario] = useState<string>("");
  const [seed, setSeed] = useState("");
  const [info, setInfo] = useState<InfoMode>("carried");
  const [saves, setSaves] = useState<SaveEntry[]>([]);
  // TITLE1：存档列表读回来了没有（读回来以后才决定要不要自动切到存档列表，只切一次）
  const [savesLoaded, setSavesLoaded] = useState(false);
  const autoLoadDone = useRef(false);
  const [busy, setBusy] = useState(false);
  const [skin] = useState(windowSkin);

  // 船长：默认给一个随机的原创名字与外貌；姓名未被手动改过时，换外貌会换成相应性别的名字
  const [roll0] = useState(() => roll ?? freshRoll());
  const [look, setLook] = useState(() => lookFromRoll(roll0));
  const [lookRoll, setLookRoll] = useState(roll0);
  const [nameRoll, setNameRoll] = useState(roll0);
  const [name, setName] = useState(() => captainName(roll0, isFemaleLook(lookFromRoll(roll0))));
  const [nameAuto, setNameAuto] = useState(true);
  // 身世草稿（生日、五问、属性）
  const defs = statics?.captain ?? null;
  const draftApi = useCaptainDraft(defs, roll0);

  useEffect(() => {
    api
      .listSaves()
      .then((list) => setSaves(list as SaveEntry[]))
      .catch(() => setSaves([]))
      .finally(() => setSavesLoaded(true));
  }, []);

  // 第九批：世界目录（旧后端没有这个命令时为 null，界面与以前相同）。可见的世界多于一个时，"新的航程"先选世界。
  // 有别的世界时经典世界不再列出（newGameWorlds）：只剩一个世界时不选世界，直接切到那个世界开局。
  const [catalog, setCatalog] = useState<WorldCatalog | null>(null);
  // 世界目录还在路上：后端在后台读世界（寰宇要几秒），读好才回（11-03 启动提速）
  const [catalogPending, setCatalogPending] = useState(true);
  // 已确认的世界（null：还在选世界）与选世界一步里高亮的那个
  const [worldKey, setWorldKey] = useState<string | null>(null);
  const [worldPick, setWorldPick] = useState<string | null>(null);
  const [switchFailed, setSwitchFailed] = useState(false);
  useEffect(() => {
    api
      .worldCatalog()
      .then((c) => {
        setCatalog(c);
        const shown = newGameWorlds(c.worlds);
        setWorldPick(shown.some((w) => w.key === c.current) ? c.current : (shown[0]?.key ?? null));
      })
      .catch(() => setCatalog(null))
      .finally(() => setCatalogPending(false));
  }, []);
  // 正在读的存档（“继续”或存档列表）；读档与等世界各自记着等了几秒，等久了写明原因
  const [loadingSlot, setLoadingSlot] = useState<string | null>(null);
  const loadSec = useElapsed(loadingSlot !== null);
  const worldWaiting = waitWorlds && catalogPending;
  const worldSec = useElapsed(worldWaiting && view === "new");
  // 新开局可选的世界（有别的世界时不列经典）；读档行照旧按全部世界写世界名
  const newCatalog = catalog ? { ...catalog, worlds: newGameWorlds(catalog.worlds) } : null;
  const worldStep = needsWorldStep(newCatalog);
  const activeWorld = newCatalog?.worlds.find((w) => w.key === (worldStep ? worldKey : newCatalog.worlds[0]?.key)) ?? null;
  const rosterWorld = activeWorld && activeWorld.key !== CLASSIC_WORLD && hasRoster(activeWorld) ? activeWorld : null;
  /**
   * TITLE1：带名册的世界（寰宇）里向导要整宽、左栏藏着（data-wide）——有存档时开局先停在存档列表（左栏与“继续”都在），
   * 只在存档第一次读回来、玩家还没点过菜单也没动过向导时切一次；没有名册世界（目录还没回来、经典世界）时不动。
   */
  useEffect(() => {
    if (autoLoadDone.current || !savesLoaded || !rosterWorld) return;
    autoLoadDone.current = true;
    if (saves.length > 0 && !touched.current) setView("load");
  }, [savesLoaded, rosterWorld, saves.length]);
  /** 确认世界：让后端切到这个世界并换上它的静态数据（属性表、剧本、纪年都随世界变化）。 */
  const confirmWorld = async (key: string) => {
    setBusy(true);
    try {
      if (statics?.world?.key !== key) {
        const next = await api.selectWorld(key);
        setWorld(next.world);
        useGame.getState().setStatics(next);
      }
      setWorldKey(key);
    } catch (err) {
      useGame.getState().fail(err);
      // TITLE2：切世界失败（旧后端、出错）：别让标题与存档列表一直停在载入中，按眼下的世界照常显示
      setSwitchFailed(true);
    } finally {
      setBusy(false);
    }
  };

  // 只剩一个世界、而眼下的静态数据属于别的世界（经典隐藏后只剩寰宇）：自动切过去，切好之前先显示载入中
  const onlyWorld = newCatalog && !worldStep ? (newCatalog.worlds[0]?.key ?? null) : null;
  // （经典是开局时的缺省世界，不用切；切过一次以后 worldKey 就是它）
  // TITLE2：不管停在哪个视图都要切——TITLE1 起有存档时先停在存档列表，原来只在向导里切，标题的纪年与存档日期就一直按经典世界算
  const needsSwitch = onlyWorld !== null && onlyWorld !== CLASSIC_WORLD && worldKey !== onlyWorld && statics?.world?.key !== onlyWorld;
  // TITLE2：世界还没定（目录没回来，或还要切到唯一的那个世界）：标题的纪年行先不画、存档列表先写载入中，免得露出别的世界的历法
  const worldUnsettled = catalogPending || (needsSwitch && !switchFailed);
  useEffect(() => {
    if (needsSwitch && onlyWorld && !busy) void confirmWorld(onlyWorld);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在需要切换时触发一次；confirmWorld 每次渲染都是新函数
  }, [needsSwitch, onlyWorld]);

  const chosen = scenario || defaultScenario(statics);
  const chosenScenario = statics?.scenarios.find((s) => s.key === chosen);
  const port = statics && chosenScenario ? scenarioFacts(statics, chosenScenario).port : undefined;
  // 推荐角色：主角都已定好（数据没有身世时照常走向导）
  const hero = defs ? (chosenScenario?.hero ?? null) : null;
  const cleaned = cleanName(name);
  const shownName = hero ? hero.name : cleaned;
  const startYear = statics?.world?.start_year ?? DEFAULT_START_YEAR;
  const steps = wizardSteps(defs, !!hero);
  const creation = defs ? (hero ? heroCreation(defs, hero, startYear) : creationOf(defs, draftApi.draft, startYear)) : null;
  /** 这一步是否完成（完成了才能往后走）。 */
  const ready = (step: StepKey): boolean => {
    switch (step) {
      case "scenario":
        return !!chosenScenario;
      case "birthday":
        return !!defs && birthdayOk(defs, draftApi.draft);
      case "name":
        return !!cleaned;
      case "background":
        return !!defs && answersOk(defs, draftApi.draft.answers);
      case "attrs":
        return draftApi.left === 0;
      default:
        return true;
    }
  };
  const nav = useWizardNav({
    steps,
    questions: defs?.questions.length ?? 0,
    ready,
    answered: (q) => !!defs && optionOf(defs, q, draftApi.draft.answers[q]) !== undefined,
  });
  const pos = nav.pos;
  const canStart = hero
    ? !!chosenScenario && creation !== null
    : !!cleaned && !!chosenScenario && (!defs || creation !== null) && steps.slice(0, -1).every(ready);

  if (!statics) return <p>{t("loading")}</p>;

  const chooseLook = (next: number) => {
    const i = wrapLook(next);
    setLook(i);
    if (nameAuto && isFemaleLook(i) !== isFemaleLook(look)) setName(captainName(nameRoll, isFemaleLook(i)));
  };
  const randomLook = () => {
    const r = lookRoll + 1;
    setLookRoll(r);
    chooseLook(rollLook(r, look));
  };
  const randomName = () => {
    const next = rollName(nameRoll, cleaned, isFemaleLook(look));
    setNameRoll(next.roll);
    setName(next.name);
    setNameAuto(true);
  };
  const typeName = (v: string) => {
    setName(stripControls(v));
    setNameAuto(false);
  };

  const start = async () => {
    if (!canStart || busy) return;
    setBusy(true);
    try {
      const captain = hero ? { name: hero.name, portrait: hero.look } : { name: cleaned, portrait: look };
      if (activeWorld && activeWorld.key !== CLASSIC_WORLD) {
        // 没有主角名册的非经典世界（框架测试海域……）也走这个向导，但 new_game 只开经典世界：照选世界那条路调用 new_world_game。
        // 推荐角色的姓名、外貌与身世由后端按剧本给出；其余照经典向导，开局后再设置主角、立下身世
        await newWorldGame(
          { world: activeWorld.key, scenario: chosen, seed: seed ? Number(seed) : null, info },
          hero ? undefined : { captain, creation: creation ?? undefined },
        );
      } else {
        await newGame(chosen, seed ? Number(seed) : undefined, captain, creation ?? undefined, info);
      }
    } finally {
      setBusy(false);
    }
  };
  // 回车：最后一步开局，其余各步相当于“下一步”
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (nav.isLast) void start();
    else nav.next();
  };

  const load = async (slot: string) => {
    setBusy(true);
    setLoadingSlot(slot);
    try {
      // 存档可能在别的世界：先按它换上静态数据再进入游戏
      await useGame.getState().enterLoaded(await api.loadGame(slot));
    } catch (err) {
      // R10-FE4：标题画面直接读档失败也写人话（同 FE2 的做法），后端原文只进控制台
      console.warn(`读档 ${slot} 失败：`, errorText(err));
      useGame.getState().fail(tz(loadMissing(err) ? "load.missingTitle" : "load.failedTitle", { slot }));
    } finally {
      setBusy(false);
      setLoadingSlot(null);
    }
  };
  // 已下线的世界（旧剧本）：有别的世界时经典世界的存档不能读，只能删（存档列表与“继续”相同）
  const retired = (key: string) => key === CLASSIC_WORLD && !!newCatalog && !newCatalog.worlds.some((w) => w.key === CLASSIC_WORLD);
  // “继续”稳妥些：世界目录还没到、不知道经典世界下没下线时，先不拿经典的存档当“继续”
  const resume = continueSave(saves, (key) => retired(key) || (key === CLASSIC_WORLD && catalogPending));
  // 删除存档（列表里那一行或确认对话框已经问过“真的要删吗”）：换上后端返回的新列表
  const remove = async (slot: string) => {
    setBusy(true);
    try {
      setSaves((await api.deleteSave(slot)) as SaveEntry[]);
      useGame.getState().notify(t("start.saveDeleted", { slot }));
    } catch (err) {
      useGame.getState().fail(err);
    } finally {
      setBusy(false);
    }
  };

  // 自创主角的初始草稿：沿用标题画面随机出的名字与外貌（第九批的自创只需要姓名、外貌、性别与生日）
  const customDraft: CustomDraft = { name: cleaned || name, look, gender: isFemaleLook(look) ? "f" : "m", month: 1, day: 1 };

  const ids = { scenarios: `${uid}-scenarios`, captain: `${uid}-captain`, window: `${uid}-window`, step: `${uid}-step` };
  const heading = (() => {
    switch (pos.step) {
      case "look":
        return t("start.captainTitle");
      case "birthday":
        return t("cap.head.birthday");
      case "name":
        return t("cap.head.name");
      case "background":
        return defs?.questions[pos.q]?.title ?? t("cap.step.background");
      case "attrs":
        return t("cap.head.attrs");
      default:
        return t("cap.head.confirm");
    }
  })();
  const d = draftApi.draft;

  return (
    <div className="title-screen" style={skin}>
      <TitleScene />
      <div className="title-ui" data-wide={view === "new" && rosterWorld ? "" : undefined}>
        <header className="title-side">
          <Logo world={worldUnsettled ? undefined : statics.world} />
          <nav className="title-menu" aria-label={t("start.menuLabel")}>
            {resume && <ContinueItem save={resume} busy={busy} onLoad={(slot) => void load(slot)} />}
            <MenuItem active={view === "new"} label={t("start.menuNew")} onClick={() => choose("new")} />
            <MenuItem
              active={view === "load"}
              label={saves.length > 0 ? t("paren", { text: t("start.menuLoad"), note: saves.length }) : t("start.menuLoad")}
              onClick={() => choose("load")}
            />
          </nav>
          {loadingSlot !== null && (
            <p className="title-wait" role="status" data-testid="start-loading-save">
              {waitText("save", loadSec)}
            </p>
          )}
          {/* 左下：语言与音乐开关 */}
          <div className="title-controls">
            <LanguageSwitch />
            <StoryTextPicker variant="title" />
            <MusicToggle />
          </div>
          <p className="title-footer">{t("start.footer")}</p>
        </header>

        <section className="ts-window" aria-labelledby={ids.window} ref={windowRef} onPointerDownCapture={touch} onKeyDownCapture={touch}>
          <div className="ts-plaque">
            <h2 id={ids.window}>{view === "new" ? t("start.menuNew") : t("startLoad")}</h2>
          </div>

          {view === "new" && worldWaiting ? (
            <div className="ts-body" data-testid="world-loading">
              <Loading text={waitText("world", worldSec)} />
            </div>
          ) : view === "new" && worldStep && worldKey === null && newCatalog ? (
            <form
              className="ts-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (worldPick) void confirmWorld(worldPick);
              }}
            >
              <div className="ts-body">
                <WorldPicker catalog={newCatalog} chosen={worldPick} onChoose={setWorldPick} />
              </div>
              <footer className="ts-launch">
                <div className="ts-launch-row">
                  <div className="cw-nav">
                    <button type="submit" className="ts-btn ts-btn-next" disabled={!worldPick || busy}>
                      {t("cap.next")}
                    </button>
                  </div>
                </div>
              </footer>
            </form>
          ) : view === "new" && needsSwitch ? (
            <Loading />
          ) : view === "new" && rosterWorld ? (
            <WorldStart
              key={rosterWorld.key}
              world={rosterWorld}
              onBack={worldStep ? () => setWorldKey(null) : () => setView("load")}
              backLabel={worldStep ? undefined : tz("ws.backToTitle")}
              attrName={(k) => statics.captain?.attributes.find((a) => a.key === k)?.name ?? k}
              initialCustom={customDraft}
            />
          ) : view === "new" ? (
            <form className="ts-form" onSubmit={submit}>
              <Stepper steps={steps} nav={nav} />
              <div className="ts-body">
                {pos.step === "scenario" ? (
                  <section className="ts-section">
                    <h3 id={ids.scenarios} className="ts-heading">
                      {t("startTitle")}
                    </h3>
                    <ScenarioCards statics={statics} chosen={chosen} onChoose={setScenario} headingId={ids.scenarios} />
                  </section>
                ) : (
                  <div className="cw-layout">
                    <section className="cw-main" aria-labelledby={ids.step}>
                      <h3 id={ids.step} className="ts-heading">
                        {heading}
                      </h3>
                      {pos.step === "look" && (
                        <LookStep look={look} onLook={chooseLook} onRandomLook={randomLook} headingId={ids.captain} />
                      )}
                      {pos.step === "birthday" && defs && <BirthdayStep api={draftApi} startYear={startYear} era={statics.world?.era} />}
                      {pos.step === "name" && <NameStep name={name} onName={typeName} onRandomName={randomName} />}
                      {pos.step === "background" && defs && <BackgroundStep key={pos.q} api={draftApi} qi={pos.q} statics={statics} />}
                      {pos.step === "attrs" && defs && <AttributesStep api={draftApi} />}
                      {pos.step === "confirm" &&
                        (hero && defs && chosenScenario ? (
                          <HeroSummary defs={defs} statics={statics} scenario={chosenScenario} hero={hero} port={port} startYear={startYear} />
                        ) : defs ? (
                          <>
                            <p className="ts-lead">{t("cap.lead.confirm")}</p>
                            <DraftSummary
                              api={draftApi}
                              statics={statics}
                              startYear={startYear}
                              withEffects
                              onEdit={(step: SummaryEdit) => nav.goTo(step)}
                            >
                              <ScenarioRow name={chosenScenario?.name ?? ""} port={port} />
                            </DraftSummary>
                          </>
                        ) : (
                          <dl className="cw-summary" data-testid="cw-summary">
                            <ScenarioRow name={chosenScenario?.name ?? ""} port={port} />
                          </dl>
                        ))}
                      {pos.step === "confirm" && <InfoChoice value={info} onChange={setInfo} />}
                      {pos.step === "confirm" && v2 && <SeedBlock value={seed} onChange={setSeed} />}
                    </section>
                    <CaptainCard
                      defs={defs}
                      data={
                        hero && defs
                          ? {
                              name: hero.name,
                              look: hero.look,
                              birthday: { month: hero.month, day: hero.day, age: hero.age },
                              answers: hero.answers,
                              attrs: heroAttrs(defs, hero).attrs,
                              alloc: heroAttrs(defs, hero).alloc,
                              methods: hero.genius ? [hero.genius] : [],
                            }
                          : {
                              name: cleaned,
                              look,
                              birthday: defs ? { month: d.month, day: d.day, age: d.age } : null,
                              answers: defs ? d.answers : undefined,
                              attrs: defs ? draftApi.attrs : null,
                              alloc: defs ? draftApi.alloc : null,
                              methods: draftApi.method ? [draftApi.method] : [],
                            }
                      }
                      testId="captain-card"
                      foldable={v2}
                    />
                  </div>
                )}
              </div>

              <footer className="ts-launch">
                {shownName && port && <p className="ts-voyage-line">{t("start.voyageLine", { name: shownName, port })}</p>}
                <div className="ts-launch-row">
                  {pos.step === "confirm" && !v2 && <SeedField value={seed} onChange={setSeed} />}
                  <div className="cw-nav">
                    {worldStep && nav.index === 0 ? (
                      <button type="button" className="ts-btn" onClick={() => setWorldKey(null)}>
                        {t("ws.backToWorlds")}
                      </button>
                    ) : (
                      <button type="button" className="ts-btn" onClick={nav.prev} disabled={nav.index === 0}>
                        {t("cap.prev")}
                      </button>
                    )}
                    {pos.step === "confirm" ? (
                      <button type="submit" className="ts-btn ts-btn-go" disabled={!canStart || busy}>
                        {t("startNew")}
                      </button>
                    ) : (
                      <button type="submit" className="ts-btn ts-btn-next" disabled={!nav.canNext}>
                        {t("cap.next")}
                      </button>
                    )}
                  </div>
                </div>
                {busy && (
                  <p className="ts-hint" role="status">
                    {t("start.starting")}
                  </p>
                )}
              </footer>
            </form>
          ) : (
            <div className="ts-body">
              <p className="ts-lead">{t("start.loadHint")}</p>
              {worldUnsettled ? (
                <Loading text={waitText("world", worldSec)} />
              ) : (
              <SaveSlots
                saves={saves}
                busy={busy}
                onLoad={(slot) => void load(slot)}
                onDelete={remove}
                onNew={() => choose("new")}
                worldName={needsWorldStep(catalog) ? (key) => catalog?.worlds.find((w) => w.key === key)?.name : undefined}
                retired={retired}
                currentWorld={statics.world?.key}
                foreignName={(key) => catalog?.worlds.find((w) => w.key === key)?.name}
              />
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
