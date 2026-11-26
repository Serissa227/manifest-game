// 按需圈出界面上的一处（R10-Q02）：任务的“去”打开面板之后，把要点的入口圈一会儿——与新手教程同一套量法（spot.ts），
// 但不压暗、不挡点击、没有说明框：一圈金色的细框闪几下，几秒后或玩家点了任何地方就收起。
// 引导链的每一步要高亮哪里，由任务视图的 go.panel 决定（panelSpots.ts 把面板键对到准备动作与目标）。
// 航海外壳与养成外壳各挂一个 <Spotlight />。
import { useEffect, useState } from "react";
import { measure, reveal, sameBox, type Box } from "./spot";
import { clearSpotlight, useSpot } from "./spotStore";

/** 等目标出现最多等多久（面板的代码、数据晚到）；等不到就不圈。 */
const WAIT_MS = 2500;
const PAD = 6;

export default function Spotlight() {
  const target = useSpot((s) => s.target);
  const label = useSpot((s) => s.label);
  const seq = useSpot((s) => s.seq);
  const ms = useSpot((s) => s.ms);
  const [box, setBox] = useState<Box | null>(null);

  useEffect(() => {
    if (!target) {
      setBox(null);
      return;
    }
    const began = Date.now();
    let revealed = false;
    let seen = false;
    const update = () => {
      if (!revealed) revealed = reveal(target);
      const b = measure(target);
      if (b) seen = true;
      setBox((prev) => (sameBox(prev, b) ? prev : b));
      const age = Date.now() - began;
      if ((!seen && age > WAIT_MS) || age > ms) clearSpotlight();
    };
    update();
    const id = setInterval(update, 150);
    // 点了任何地方（多半就是点了被圈的那处）就收起；稍等一下再开始听，免得把“去”的那一下也算进来
    let off = () => {};
    const arm = setTimeout(() => {
      const done = () => clearSpotlight();
      window.addEventListener("pointerdown", done, { once: true, capture: true });
      off = () => window.removeEventListener("pointerdown", done, { capture: true });
    }, 250);
    return () => {
      clearInterval(id);
      clearTimeout(arm);
      off();
    };
  }, [target, seq, ms]);

  if (!target || !box) return null;
  return (
    <div className="quest-spot-layer" aria-hidden="true" data-testid="quest-spot">
      <div
        key={seq}
        className="quest-spot"
        style={{ left: box.left - PAD, top: box.top - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2 }}
      />
      {label && (
        <span className="quest-spot-label" style={{ left: Math.max(8, box.left - PAD), top: Math.max(8, box.top - PAD - 26) }}>
          {label}
        </span>
      )}
    </div>
  );
}
