// H05 岸与锚地面板的文字与命令（组件在 ShorePanel.tsx；分开放，组件文件只导出组件）。
import { tz, type ZhOnlyKey } from "../../i18n/zhOnly";
import type { NavView, ShoreBlock, ShoreOrder, ShoreTask } from "../../ipc/types";
import { useGame } from "../../store/game";

/** biomes.txt 的地貌代码（与内核 geo::Biome 一致）。 */
const BIOME_CODES = new Set(["I", "T", "B", "F", "G", "M", "K", "D", "S", "J", "W", "A", "V", "X"]);

export function taskText(task: ShoreTask): string {
  return tz(`shore.task.${task}` as ZhOnlyKey);
}

export function blockText(block: ShoreBlock): string {
  return tz(`shore.block.${block}` as ZhOnlyKey);
}

export function gainText(task: ShoreTask, gain: number): string {
  return tz(`shore.gain.${task}` as ZhOnlyKey, { n: gain });
}

/** 地貌代码 → “雨林、草原”（不认识的代码略去）。 */
export function biomeNames(codes: string[]): string {
  return codes
    .filter((c) => BIOME_CODES.has(c))
    .map((c) => tz(`shore.biome.${c}` as ZhOnlyKey))
    .join("、");
}

/** “岸上”按钮上写什么（营地进行中写天数）；没有这一项时为 null。 */
export function shoreButton(nav: NavView): string | null {
  const s = nav.shore;
  if (!s) return null;
  if (s.camp) return tz("shore.openBusy", { d: s.camp.elapsed, n: s.camp.days });
  return tz("shore.open");
}

async function submit(fleet: number, order: ShoreOrder): Promise<boolean> {
  const r = await useGame.getState().submit({ Shore: { owner: "player", fleet, order } });
  return !!r;
}

export function sendShore(fleet: number, tasks: ShoreTask[]): Promise<boolean> {
  return submit(fleet, { start: { tasks } });
}

export function sendRecall(fleet: number): Promise<boolean> {
  return submit(fleet, "recall");
}

export function sendNets(fleet: number, on: boolean): Promise<boolean> {
  return submit(fleet, { nets: { on } });
}
