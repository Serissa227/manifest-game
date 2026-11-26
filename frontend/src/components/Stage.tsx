// 主舞台：靠港时是港口街景，航行时是航海图（按 store.stage 切换；旗舰队在海上时只能看航海图）。
// 航海图（MapView）始终挂载：不显示时用 visibility 隐藏并压在街景下面，
// 这样 PixiJS 画布保持原尺寸，切回来时不必重建渲染器。
import { t } from "../i18n";
import { useGame } from "../store/game";
import MapView from "./MapView";
import PortScene from "./PortScene";
import VoyageHud from "./VoyageHud";
import ErrorBoundary from "./shell/ErrorBoundary";
import { canSeeTown } from "./shell/shellState";

function StageError({ message }: { message: string }) {
  return (
    <div className="stage-error" role="alert">
      {t("shellStageError", { message })}
    </div>
  );
}

export default function Stage() {
  // 只取“能不能看街景”：每天的概览更新不让舞台（航海图与街景）跟着从这里重渲染
  const town = useGame((s) => canSeeTown(s.overview));
  const stage = useGame((s) => s.stage);
  const shown = town ? stage : "chart";
  return (
    <div className="stage" data-stage={shown} data-testid="stage">
      <div className={shown === "chart" ? "stage-layer stage-chart" : "stage-layer stage-chart is-hidden"} data-testid="stage-chart">
        <ErrorBoundary fallback={(m) => <StageError message={m} />}>
          <MapView />
          {shown === "chart" && <VoyageHud />}
        </ErrorBoundary>
      </div>
      {shown === "town" && (
        <div className="stage-layer stage-town" data-testid="stage-town">
          <ErrorBoundary fallback={(m) => <StageError message={m} />}>
            <PortScene />
          </ErrorBoundary>
        </div>
      )}
    </div>
  );
}
