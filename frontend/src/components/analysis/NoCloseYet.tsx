// 行情窗口的空状态：还没有收盘价（开局当天、刚到一处新港）。
// 说明为什么空；新界面（v2）里另给补充一句与“下一天”（推进一天之后行情窗口自己重新查询）。
// 旧界面（v1）与原来的 <Empty text={t("fc.noData")} /> 一模一样（EmptyState 的缺省写法）。
// 行情窗口与交易所抽屉里的小预测图共用（抽屉里加 className 换成紧凑的样子）。
// 抽屉里不带“下一天”（stepDay={false}）：那里已经有成交的主按钮，一处只放一个主按钮（docs/UI-REDESIGN.md 第 4 节）；
// 而且在买卖明细里推进一天与这一行要做的事（成交）不是一回事，容易误点。只留说明“过一天就有了”。
import { t } from "../../i18n";
import { useGame } from "../../store/game";
import { EmptyState } from "../feedback";

export function NoCloseYet({ className, stepDay = true }: { className?: string; stepDay?: boolean }) {
  return (
    <EmptyState
      className={className}
      text={t("fc.noData")}
      hint={t("v2.analysis.fc.noDataHint")}
      action={stepDay ? { label: t("stepDay"), onClick: () => void useGame.getState().step(1) } : undefined}
    />
  );
}
