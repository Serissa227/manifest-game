// 游戏外壳：开机画面 → 开局界面 → 主界面。
// 主界面：顶部状态栏（HUD）、中间铺满的主舞台（港口街景 / 航海图）与浮在舞台上的功能窗口、底部命令栏。
// 语言（EXPANSION.md §12）：界面以当前语言为 key 挂载，切换语言时整个界面重新挂载、按新语言重新取字；
// 全局状态（静态数据、概览、打开的窗口与功能页）都在 store 里，重新挂载不丢失。
// 配乐（audio/）：外壳调用一次 useMusic()，按场景换曲；音乐开关在开局画面左下（语言旁）与主界面的顶栏。
// 首屏只带标题画面与开局需要的代码（性能商议 2026-10-07 第 1 条）：主界面（GameShell）与养成主界面按需加载，
// 主界面里的功能面板再各自按需加载（见 components/shell/GameShell.tsx）。开局画面上空闲一会儿就预先加载主界面。
import { Fragment, Suspense, useEffect, useState, type ComponentType } from "react";
import { useMusic } from "./audio/director";
import { useSfx } from "./audio/sfx";
import { installUiTheme } from "./art/ui";
import StartScreen from "./components/StartScreen";
import BootScreen from "./components/shell/BootScreen";
import { Messages } from "./components/shell/Feedback";
import { loadable } from "./components/shell/loadable";
import { LoadBoundary } from "./components/shell/LoadBoundary";
import { useVoyage } from "./hooks/useVoyage";
import { t } from "./i18n";
import { useLocale } from "./i18n/locale";
import { onClock, onError, onTick } from "./ipc/api";
import { useClockStore } from "./store/clock";
import { useGame } from "./store/game";
import "./styles.css";
// 窗口自适应：排在 styles.css 之后（同样的特异度下覆盖外壳的桌面样式）
import "./styles/viewport.css";
import "./styles/compact.css";
// 新界面（试用，docs/UI-REDESIGN.md）：只在 <html data-ui="v2"> 下生效，排在最后；版本由 ui/uiMode.ts 在载入时写到根元素上。
// 样式按模块拆在 styles/ui-v2/ 下，index.css 按固定顺序引入
import "./styles/ui-v2/index.css";
// 航海过程改造（H02 / H05）的船况条、常设命令、补给页的船材与岸与锚地：两套界面共用，排在新界面之后（同样的特异度下覆盖 voyage.css）
import "./styles/seafaring.css";
import "./ui/uiMode";

// 启动时把程序生成的界面贴图（木框、牌匾、羊皮纸……）写入 CSS 变量；没有画布时 CSS 回退到纯色。
installUiTheme();

const GameShell = loadable(() => import("./components/shell/GameShell"));
const UpbringingShell = loadable(() => import("./components/upbringing/UpbringingShell"));

/**
 * 开局画面上空闲一会儿就预先加载主界面的代码：玩家建角色的工夫里载入好，点“启航”时不必再等。
 * 另预先加载养成主界面（P14a：读一个养成中的存档时不再先闪一下载入画面；代码在本机，取来很快）。
 */
function usePrefetchGame(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const id = setTimeout(() => {
      void GameShell.preload().catch(() => {});
      void UpbringingShell.preload().catch(() => {});
    }, 2500);
    return () => clearTimeout(id);
  }, [enabled]);
}

/** 按需加载的整屏界面：代码在路上时显示 ShellLoading，下载失败时可以重试。 */
function Lazy({ view: View }: { view: ComponentType }) {
  return (
    <LoadBoundary screen>
      <Suspense fallback={<ShellLoading />}>
        <View />
      </Suspense>
    </LoadBoundary>
  );
}

/**
 * 主界面的代码还在路上时：先只铺一层底色（加载得快时什么都不闪），0.3 秒后还没到就显示开机画面（“正在载入”）。
 * 开机画面占满整屏，与主界面的位置一致，不会跳动。
 */
function ShellLoading() {
  const [late, setLate] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setLate(true), 300);
    return () => clearTimeout(id);
  }, []);
  return late ? (
    <BootScreen>
      <Messages />
    </BootScreen>
  ) : (
    <main className="app boot-blank" aria-busy="true" />
  );
}

export default function App() {
  const statics = useGame((s) => s.statics);
  // 只看有没有概览、是不是养成中：每天的概览更新不让整个界面从根上重渲染
  const hasOverview = useGame((s) => s.overview !== null);
  const upbringing = useGame((s) => s.overview?.mode === "upbringing");
  const locale = useLocale((s) => s.locale);
  // 旗舰队出港 / 靠港时自动切换舞台
  useVoyage();
  // 配乐与环境声
  useMusic();
  // 音效（按钮、交易、航海、海战）：全局事件委托与游戏状态的变化，共用配乐的音频引擎
  useSfx();
  // 开局画面上（还没开局）空闲一会儿就预先加载主界面
  usePrefetchGame(!!statics && !hasOverview);

  // 窗口标题随语言变化
  useEffect(() => {
    document.title = t("appTitle");
  }, [locale]);

  useEffect(() => {
    void useGame.getState().init();
    const subs = [
      onTick((o) => useGame.getState().applyPushed(o)),
      // 时钟单独存放：运行中每 ≥100 ms 一次，只让读时刻的组件重渲染
      onClock((c) => useClockStore.getState().applyClock(c)),
      onError((m) => useGame.getState().fail(m)),
    ];
    return () => {
      for (const s of subs) void s.then((un) => un());
    };
  }, []);

  let content;
  if (!statics) {
    content = (
      <BootScreen>
        <Messages />
      </BootScreen>
    );
  } else if (!hasOverview) {
    content = (
      <main className="app start-root">
        {/* 世界目录到之前（后端在后台读世界），“新的航程”先写“正在读取世界……”（11-03 启动提速） */}
        <StartScreen waitWorlds />
        <Messages />
      </main>
    );
  } else if (upbringing) {
    content = <Lazy view={UpbringingShell.Component} />;
  } else {
    content = <Lazy view={GameShell.Component} />;
  }
  return <Fragment key={locale}>{content}</Fragment>;
}
