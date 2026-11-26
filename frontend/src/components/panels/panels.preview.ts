// 面板合成画面的预览（npx vite-node scripts/art-preview.ts panels）：舰队画面、海盗船画面。
import type { Preview } from "../../art/px";
import { composeFleetScene, fleetSceneHeight, pirateScene, type ShipLook } from "./panelArt";

export default function preview(): Preview[] {
  const flag = "#c8373a";
  const fleet: ShipLook[] = [
    { kind: 5, sail: "square", flag },
    { kind: 1, sail: "square", flag, damaged: true },
    { kind: 0, sail: "lateen", flag },
  ];
  const scene = (looks: ShipLook[], season: number, w: number, frame: number) =>
    composeFleetScene(looks, season, w, fleetSceneHeight(looks), frame);
  const small: ShipLook[] = [{ kind: 0, sail: "lateen", flag: "#2e86c1" }];
  const big: ShipLook[] = [{ kind: 7, sail: "square", flag: "#2e86c1" }, { kind: 2, sail: "square", flag: "#2e86c1" }];
  const five: ShipLook[] = [...fleet, { kind: 3, sail: "lateen", flag }, { kind: 6, sail: "lateen", flag }];
  return [
    { name: "fleet-300", px: scene(fleet, 0, 300, 0), scale: 2 },
    { name: "fleet-300-f7", px: scene(fleet, 2, 300, 7), scale: 2 },
    { name: "fleet-small", px: scene(small, 1, 300, 3), scale: 2 },
    { name: "fleet-big", px: scene(big, 3, 300, 3), scale: 2 },
    { name: "fleet-five", px: scene(five, 1, 300, 5), scale: 2 },
    { name: "pirate", px: pirateScene({ kind: 3, sail: "lateen", pirate: true }), scale: 2 },
  ];
}
