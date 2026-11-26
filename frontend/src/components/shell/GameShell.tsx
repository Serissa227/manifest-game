// 已开局的主界面（从 App.tsx 拆出，按需加载——性能商议 2026-10-07 第 1 条：首屏只要标题画面与开局需要的代码）：
// 顶部状态栏（HUD）、中间铺满的主舞台（港口街景 / 航海图）与浮在舞台上的功能窗口、底部命令栏、各种对话框。
// 功能面板各自按需加载（港口窗口开局就打开，跟着主界面一起加载）：第一次打开时在窗口里稍等片刻，
// 指针移到命令栏的按钮上（或键盘聚焦）时就开始预先加载，点下去时通常已经到了。
import { Suspense, useEffect, type SyntheticEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import BattleDialog from "../BattleDialog";
import CommandBar from "../CommandBar";
import StoryDialog from "../story/StoryDialog";
import Stage from "../Stage";
import TopBar from "../TopBar";
import Window from "../Window";
import PortPanel from "../panels/PortPanel";
import { loadable, type Loadable } from "./loadable";
import { Delayed, LoadBoundary } from "./LoadBoundary";
import Tutorial from "../tutorial/Tutorial";
import { Loading, ShortcutHelp } from "../feedback";
import { Messages, Notices, OutcomeBanner } from "./Feedback";
import { TAB_ICONS, WINDOW_ID, WINDOW_LAYOUT, canSeeTown, closeWindow, commandTabId, commandTabs, openWindow, showStage, useShell, watchWindowTriggers } from "./shellState";
import { useGlobalHotkeys } from "./hotkeys";
import { steerKeysActive } from "../nav/useSteerKeys";
import { togglePause } from "../../hooks/useNavigation";
import { useIsV2 } from "../../ui/uiMode";
import { readViewport, useLayout, windowCovers } from "../../hooks/useViewport";
import { t, tk } from "../../i18n";
import { useGame, type Tab } from "../../store/game";
import { LeaveConfirmHost } from "./LeaveConfirm";
import ItineraryChip from "../routing/ItineraryChip";
import Spotlight from "../tutorial/Spotlight";
import QuestRoute from "./QuestRoute";
import QuestTracker from "./QuestTracker";

/** 各功能面板按需加载（港口窗口不在这里：跟着主界面一起加载，开局就打开）。 */
const PANELS: Record<Exclude<Tab, "port">, Loadable<object>> = {
  history: loadable(() => import("../history/HistoryPanel")),
  secrets: loadable(() => import("../history/SecretsPanel")),
  people: loadable(() => import("../people/PeoplePanel")),
  quests: loadable(() => import("../people/QuestsPanel")),
  items: loadable(() => import("../items/InventoryPanel")),
  codex: loadable(() => import("../items/CodexPanel")),
  fleet: loadable(() => import("../panels/FleetPanel")),
  mates: loadable(() => import("../panels/MatesPanel")),
  battle: loadable(() => import("../panels/TacticalPanel")),
  futures: loadable(() => import("../panels/FuturesPanel")),
  analysis: loadable(() => import("../panels/AnalysisPanel")),
  caravan: loadable(() => import("../panels/CaravanPanel")),
  industry: loadable(() => import("../panels/IndustryPanel")),
  colonies: loadable(() => import("../panels/ColoniesPanel")),
  explore: loadable(() => import("../panels/ExplorePanel")),
  reports: loadable(() => import("../panels/ReportsPanel")),
  intel: loadable(() => import("../panels/IntelPanel")),
  settings: loadable(() => import("../panels/SettingsPanel")),
  debug: loadable(() => import("../panels/DebugPanel")),
};

/** 浏览器空闲时执行（没有 requestIdleCallback 时稍后执行）；返回取消函数。 */
function whenIdle(fn: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(fn, { timeout: PREWARM_IDLE_MS });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(fn, 0);
  return () => clearTimeout(id);
}

/** 预热时每一块最多等这么久的空闲（毫秒）。 */
const PREWARM_IDLE_MS = 2000;

/**
 * 进入主界面后，空闲时把各功能面板与图表库（echarts）的代码一块接一块地预先加载（P14a）：
 * 代码在本机磁盘上，取来只要几毫秒，但没取过的面板第一次打开要经过一次 Suspense——React 19 会把占位至少留 300 毫秒，
 * 看起来就是“点了以后窗口空一下”。预热过以后 loadable 直接渲染已经到了的代码，不再经过 Suspense。
 */
function usePrewarmPanels() {
  useEffect(() => {
    const queue: (() => Promise<unknown>)[] = [...Object.values(PANELS).map((p) => p.preload), () => import("echarts")];
    let dead = false;
    let cancel = () => {};
    const next = () => {
      const load = queue.shift();
      if (dead || !load) return;
      cancel = whenIdle(() => {
        if (dead) return;
        void load()
          .catch(() => {})
          .finally(next);
      });
    };
    next();
    return () => {
      dead = true;
      cancel();
    };
  }, []);
}

/** 预先加载某个功能面板的代码（指针移到命令栏的按钮上、键盘聚焦时）。 */
function preloadPanel(tab: Tab): void {
  if (tab !== "port" && tab in PANELS) void PANELS[tab].preload().catch(() => {});
}

/** 命令栏按钮的 id → 功能页（cmd-tab-xxx）。 */
function tabOfTarget(target: EventTarget | null): Tab | null {
  const el = target instanceof Element ? target.closest<HTMLElement>("[id^='cmd-tab-']") : null;
  return el ? (el.id.slice("cmd-tab-".length) as Tab) : null;
}

function PanelFor({ tab }: { tab: Tab }) {
  const devMode = useGame((s) => s.devMode);
  if (tab === "port") return <PortPanel />;
  if (tab === "debug" && !devMode) return null;
  const Panel = PANELS[tab].Component;
  return <Panel />;
}

/** 已开局的主界面。data-layout（窗口自适应）：手机上功能窗口是整页的、顶栏与命令栏换成紧凑的样子（见 hooks/useViewport.ts）。 */
export default function GameShell() {
  // 只取功能页列表（浅比较）：每天的概览更新不让整个外壳重渲染
  const tabs = useGame(useShallow((s) => commandTabs(s.overview, s.devMode, s.statics)));
  const tab = useGame((s) => s.tab);
  const open = useShell((s) => s.windowOpen);
  const screen = useLayout();
  // 空闲时把各功能面板的代码预热好，第一次打开不再空一下
  usePrewarmPanels();
  const v2 = useIsV2();
  // 新界面的全局快捷键（shell/hotkeys.ts）：空格暂停 / 继续、Esc 关掉最上层、回车按主按钮、M 切换街景 / 航海图
  useGlobalHotkeys(v2, {
    pause: () => void togglePause(),
    closeWindow: open ? closeWindow : null,
    toggleStage: () => {
      const g = useGame.getState();
      if (!canSeeTown(g.overview)) return;
      // 与命令栏的舞台切换同一个动作：手机与竖放的平板上窗口盖满舞台，切换时收起；新界面切到航海图时也收起（showStage）
      showStage(g.stage === "town" ? "chart" : "town");
    },
    spaceTaken: steerKeysActive,
  });

  useEffect(() => {
    // 进入主界面时默认打开当前功能页（开局是港口）；之后切换功能页、设施或地点时自动重新打开。
    // 手机与竖放的平板上窗口会盖满舞台：先让玩家看到港口街景，点建筑或命令栏再打开
    if (windowCovers(readViewport())) closeWindow();
    else openWindow();
    return watchWindowTriggers();
  }, []);

  const layout = WINDOW_LAYOUT[tab];
  const select = (k: Tab) => {
    if (k === tab && open) closeWindow();
    else openWindow(k);
  };
  // 指针移到命令栏的按钮上、键盘聚焦时预先加载那个面板
  const warm = (e: SyntheticEvent) => {
    const k = tabOfTarget(e.target);
    if (k) preloadPanel(k);
  };
  return (
    <main className="app game" data-layout={screen} onPointerOver={warm} onFocus={warm}>
      <TopBar />
      <LeaveConfirmHost />
      <div className="shell-main" data-window={open ? layout.placement : "none"}>
        <Stage />
        <Notices />
        {/* 舞台上方居中的一叠小条（R10-Q02）：任务追踪条、在港时任务的航线小卡、H07 多站行程的“下一站” */}
        <div className="stage-chips">
          <QuestTracker />
          <QuestRoute />
          <ItineraryChip />
        </div>
        {open && (
          <Window
            key={tab}
            id={WINDOW_ID}
            role="tabpanel"
            labelledBy={tabs.includes(tab) ? commandTabId(tab) : undefined}
            title={tk(`tab.${tab}`)}
            icon={TAB_ICONS[tab]}
            placement={layout.placement}
            size={layout.size}
            onClose={closeWindow}
          >
            {/* 第一次打开某个面板时稍等它的代码（窗口大小不变；快的时候不出现“载入中”）；下载失败时可以重试 */}
            <LoadBoundary resetKey={tab}>
              <Suspense
                fallback={
                  <Delayed>
                    {/* 新界面：一行“载入中”与几道骨架细条（不是空状态的虚线框）；旧界面照旧 */}
                    <Loading
                      v1={
                        <p className="empty" role="status">
                          {t("loading")}
                        </p>
                      }
                    />
                  </Delayed>
                }
              >
                <PanelFor tab={tab} />
              </Suspense>
            </LoadBoundary>
          </Window>
        )}
        <OutcomeBanner />
        <Messages />
      </div>
      <CommandBar tabs={tabs} active={tab} open={open} onSelect={select} />
      <BattleDialog />
      <StoryDialog />
      {/* 新手教程：第一次进入航海期时自动开始，也可以从“设置”里重新开始 */}
      <Tutorial />
      {/* 任务的“去”打开面板后圈一下入口（R10-Q02，与教程同一套圈法） */}
      <Spotlight />
      {/* 新界面：按“?”打开全部快捷键（旧界面不挂） */}
      <ShortcutHelp />
    </main>
  );
}
