// 养成中的主界面（第九批，FRAMEWORK §7.14；从 App.tsx 拆出，按需加载）：主角还没有出海时整屏显示养成，
// 代替港口街景、海图与命令栏。养成的事件照旧由 StoryDialog 弹出；提示照常。
// 结业那天后端把 mode 换成 voyage，界面回到 GameShell。
import { useLayout } from "../../hooks/useViewport";
import { ShortcutHelp } from "../feedback";
import { Messages, Notices, OutcomeBanner } from "../shell/Feedback";
import StoryDialog from "../story/StoryDialog";
import Tutorial from "../tutorial/Tutorial";
import Spotlight from "../tutorial/Spotlight";
import QuestTracker from "../shell/QuestTracker";
import UpbringingScreen from "./UpbringingScreen";

export default function UpbringingShell() {
  const screen = useLayout();
  return (
    <main className="app game upbringing" data-layout={screen}>
      <UpbringingScreen />
      {/* R10-Q02 任务追踪条（养成期的置顶任务）；“去”圈出城里的地点或养成画面的某一块 */}
      <div className="stage-chips ub-chips">
        <QuestTracker upbringing />
      </div>
      <Spotlight />
      <Notices />
      <OutcomeBanner />
      <Messages />
      <StoryDialog />
      {/* 养成教程：养成中、这台设备上没看过时自动开始（小乌鸦讲养成主画面的几块） */}
      <Tutorial track="upbringing" />
      {/* 新界面：按“?”打开全部快捷键（与主界面同一张卡；旧界面不挂） */}
      <ShortcutHelp context="upbringing" />
    </main>
  );
}
