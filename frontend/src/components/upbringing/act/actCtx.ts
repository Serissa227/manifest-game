// 行动制界面各块共用的东西：两份视图、名字、发命令。由 ActScreen 造好往下传。
import type { ActView } from "../../../ipc/actTypes";
import type { Command, UpbringingView } from "../../../ipc/types";
import type { ActNames } from "./actKit";

export interface ActCtx {
  view: UpbringingView;
  act: ActView;
  names: ActNames;
  /** 地图与地点场景用的城市键（townMaps.actTownKey：按本阶段的地点键对图，对不上用视图的 town.key） */
  town: string | null;
  /** 当前城市在地图数据里的编号（BuyItem 的 loc）；认不出时为 null */
  loc: number | null;
  /** 正在等一条命令的结果 */
  busy: boolean;
  /** 发一条命令；成功返回 true（失败的原因由外壳的提示条显示） */
  send: (cmd: Command) => Promise<boolean>;
}

export const OWNER = { owner: "player" } as const;
