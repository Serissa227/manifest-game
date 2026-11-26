// 世界图被港口或实时航海覆盖时停止绘制；切回世界图时仍使用原来的相机与资源。
import { navActive, useNavStore } from "../hooks/useNavigation";
import { useGame } from "../store/game";

interface Ticker {
  started: boolean;
  start: () => void;
  stop: () => void;
}

export function watchMapVisibility(container: Pick<HTMLElement, "clientWidth" | "clientHeight">, ticker: Ticker) {
  const sync = () => {
    const game = useGame.getState();
    const town = game.stage === "town" && (game.overview?.fleets[0]?.docked ?? null) !== null;
    const voyage = navActive(game.statics, game.overview) && useNavStore.getState().view === "nav";
    const run = container.clientWidth > 0 && container.clientHeight > 0 && !town && !voyage;
    if (run && !ticker.started) ticker.start();
    else if (!run && ticker.started) ticker.stop();
  };
  const game = useGame.subscribe((s, old) => {
    if (s.stage !== old.stage || s.overview !== old.overview || s.statics !== old.statics) sync();
  });
  const nav = useNavStore.subscribe((s, old) => {
    if (s.view !== old.view) sync();
  });
  sync();
  return { sync, dispose: () => { game(); nav(); } };
}
