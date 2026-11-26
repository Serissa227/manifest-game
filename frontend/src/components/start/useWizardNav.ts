// 向导的位置与导航（开局向导与补建身世共用）：当前步、身世一步里的第几问、上一步 / 下一步、跳到某步（步骤条见 CaptainSteps.tsx）。
// 一步完成了才能往后走；步骤条上只能跳到前面各步都已完成的那一步。
import { useState } from "react";
import type { StepKey } from "./wizard";

export interface WizardPos {
  step: StepKey;
  /** 身世一步里是第几问 */
  q: number;
}

export interface WizardNav {
  pos: WizardPos;
  index: number;
  /** 这一步（身世一步时是这一问）完成了，可以往下走 */
  canNext: boolean;
  isLast: boolean;
  reachable: (i: number) => boolean;
  next: () => void;
  prev: () => void;
  /** 跳到某一步：进入身世时停在第一道没答的题 */
  goTo: (step: StepKey) => void;
}

export function useWizardNav({
  steps,
  questions,
  ready,
  answered,
}: {
  steps: StepKey[];
  /** 身世问题数 */
  questions: number;
  /** 某一步是否完成 */
  ready: (step: StepKey) => boolean;
  /** 第 q 问是否已答 */
  answered: (q: number) => boolean;
}): WizardNav {
  const [pos, setPos] = useState<WizardPos>({ step: steps[0], q: 0 });
  const index = Math.max(0, steps.indexOf(pos.step));
  const canNext = pos.step === "background" ? answered(pos.q) : ready(pos.step);
  return {
    pos,
    index,
    canNext,
    isLast: index === steps.length - 1,
    reachable: (i) => steps.slice(0, i).every(ready),
    next: () => {
      if (!canNext) return;
      if (pos.step === "background" && pos.q + 1 < questions) return setPos({ step: "background", q: pos.q + 1 });
      const to = steps[index + 1];
      if (to) setPos({ step: to, q: 0 });
    },
    prev: () => {
      if (pos.step === "background" && pos.q > 0) return setPos({ step: "background", q: pos.q - 1 });
      const to = steps[index - 1];
      if (to) setPos({ step: to, q: to === "background" ? Math.max(0, questions - 1) : 0 });
    },
    goTo: (step) => {
      if (step === "background") {
        const open = Array.from({ length: questions }, (_, q) => q).find((q) => !answered(q));
        setPos({ step, q: open ?? 0 });
      } else setPos({ step, q: 0 });
    },
  };
}
