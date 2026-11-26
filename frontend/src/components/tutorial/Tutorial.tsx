// 新手教程：第一次进入航海期（经典世界的新开局、寰宇结业出海）、旗舰队在港、这台设备上没看过时自动开始，也可以在“设置”里重新开始。
// 圈出元素的量法在 spot.ts（任务的“去”也用它，见 Spotlight.tsx）。
// 每一步把界面上的一个真实元素圈出来（周围压暗），旁边是说明框：标题、说明、第几步、上一步 / 下一步、跳过。
// 讲解的是一只小乌鸦（GuideCrow）：它站在说明框的上沿，每换一步就蹦一下、张嘴说一阵，转头朝向被圈出的地方。
// 圈出与压暗只是视觉提示，不挡点击——玩家可以照着说明直接操作；做完这一步要做的事（买了货、点了出港）会自动进入下一步。
// 键盘：说明框里 → / 回车下一步，← 上一步，Esc 跳过。
// 网页自适应：说明框不宽于屏幕（左右各留 12 px）；平板与手机上顶栏收成一行，有的东西收在“菜单”或“更多”里，这几步改圈入口，
// 说明文字换成紧凑顶栏的说法（tut.<id>.textCompact，没有这一句的步骤照旧）。
// 新界面（海图室）的桌面也是一行顶栏，但目标与存档就在顶栏上：这两步另有一句（tut.<id>.textRow，只写中文）。
// FIX4F：出港框（自动航行的出航确认、手动航行的罗经盘）开着时，说明框让开它——放在框的左边、右边、下面或上面，
// 哪儿都放不下（手机）就先收起来，框合上再出来；这时也不压暗（1113b 实测：跳过养成后第一页正压在出港框上）。
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { lookup, t, tk } from "../../i18n";
import { ZH_ONLY, tz, type ZhOnlyKey } from "../../i18n/zhOnly";
import { useLayout } from "../../hooks/useViewport";
import { useIsV2 } from "../../ui/uiMode";
import { useVoyageStore } from "../../hooks/useVoyage";
import { flagship, useGame } from "../../store/game";
import { KeyHints } from "../feedback";
import { pendingKey, useStoryUi } from "../story/storyKit";
import { STEPS, UB_STEPS, baseline, type Baseline } from "./steps";
import { firstVoyage, markUpbringingSeen, useTutorial, useUbActOn, useUbTutorial } from "./tutorialState";
import { measure, reveal, sameBox, type Box } from "./spot";
import { GuideCrow } from "./GuideCrow";

/** 剧情对话框（事件或结果）此刻在不在屏幕上。 */
function storyOnScreen(): boolean {
  return typeof document !== "undefined" && document.querySelector(".sd-backdrop") !== null;
}

const PAD = 6;
const GAP = 12;
const WIDTH = 360;
/** 站在说明框上沿的小乌鸦露出框外的高度：说明框在目标下方时往下让出这么多，免得乌鸦挡住目标；放在别处时顶上留出这么多。 */
const CROW = 60;
/** 说明框要让开的对话框：出港框（自动航行的出航确认、手动航行的罗经盘）。 */
const AVOID = ['[data-testid="departure-dialog"]', '[data-testid="nav-depart"]'] as const;

/** 说明框的宽度：360 px，窄屏上不超过屏幕宽度减去两边的空隙。 */
function bubbleWidth(): number {
  const vw = window.innerWidth || 1280;
  return Math.max(200, Math.min(WIDTH, vw - GAP * 2));
}

/**
 * 说明框的位置：目标下方放得下就放下方，否则上方；目标很大（街景）时放在它里面靠上；没有目标时居中偏上（corner 时放左下角）。
 * 说明框上沿站着小乌鸦：放在目标下方时再往下让出 CROW，别处顶上至少留出 CROW。
 */
function place(target: Box | null, bubbleH: number, corner: boolean, width = WIDTH): { left: number; top: number } {
  const vw = window.innerWidth || 1280;
  const vh = window.innerHeight || 800;
  const top0 = GAP + CROW;
  const clampX = (x: number) => Math.max(GAP, Math.min(vw - width - GAP, x));
  if (!target && corner) return { left: clampX(GAP * 2), top: Math.max(top0, vh - bubbleH - GAP * 6) };
  if (!target) return { left: clampX((vw - width) / 2), top: Math.max(top0, vh * 0.26) };
  const cx = clampX(target.left + target.width / 2 - width / 2);
  // 说明框不越过屏幕下沿（目标在屏幕外、矮屏上都一样）；比屏幕还高时贴着顶上的乌鸦位
  const clampY = (y: number) => Math.max(top0, Math.min(y, vh - bubbleH - GAP));
  const below = target.top + target.height + PAD + GAP + CROW;
  if (below + bubbleH < vh - GAP) return { left: cx, top: clampY(below) };
  const above = target.top - PAD - GAP - bubbleH;
  if (above > top0) return { left: cx, top: clampY(above) };
  // 放在目标里面靠上
  return { left: cx, top: clampY(target.top + 20) };
}

/**
 * 让开对话框的位置：框的左边、右边、下面、上面，取第一个整个放得下的；都放不下时为 null（说明框先收起来）。
 * 放在框的上面或下面时，乌鸦站在说明框上沿，也要留出它的高度。
 */
function placeAside(avoid: Box, bubbleH: number, width: number): { left: number; top: number } | null {
  const vw = window.innerWidth || 1280;
  const vh = window.innerHeight || 800;
  const top0 = GAP + CROW;
  if (vh - GAP - top0 >= bubbleH) {
    const sideTop = Math.max(top0, Math.min(avoid.top + CROW, vh - bubbleH - GAP));
    if (avoid.left - GAP - width >= GAP) return { left: avoid.left - GAP - width, top: sideTop };
    if (avoid.left + avoid.width + GAP + width <= vw - GAP) return { left: avoid.left + avoid.width + GAP, top: sideTop };
  }
  const cx = Math.max(GAP, Math.min(vw - width - GAP, avoid.left + avoid.width / 2 - width / 2));
  const below = avoid.top + avoid.height + GAP + CROW;
  if (below + bubbleH <= vh - GAP) return { left: cx, top: below };
  const above = avoid.top - GAP - bubbleH;
  if (above >= top0) return { left: cx, top: above };
  return null;
}

/**
 * track：出海与交易（voyage，缺省）或养成（upbringing，第九批）。两条路线各有自己的步骤与"看过没有"，界面与操作一样。
 */
export default function Tutorial({ track = "voyage" }: { track?: "voyage" | "upbringing" } = {}) {
  const useStore = track === "upbringing" ? useUbTutorial : useTutorial;
  const STEPS_ = track === "upbringing" ? UB_STEPS : STEPS;
  const active = useStore((s) => s.active);
  const step = useStore((s) => s.step);
  const [box, setBox] = useState<Box | null>(null);
  // 开着的出港框（说明框要让开它）
  const [avoid, setAvoid] = useState<Box | null>(null);
  const [bubbleH, setBubbleH] = useState(200);
  const bubble = useRef<HTMLDivElement | null>(null);
  const next = useRef<HTMLButtonElement | null>(null);
  const base = useRef<Baseline>({ cargo: 0, picking: false });

  // 养成教程让剧情先说（X02）：开局的家乡剧情一进来就弹，教程的说明框原来正压在剧情卡中间。
  // 剧情对话框（待回应的事件或刚回应的结果，都是 .sd-backdrop）开着时养成教程先不开始、已经开始的先藏起来，合上后接着讲。
  const storyPending = useGame((st) => st.overview?.story?.pending ?? null);
  const storyDismissed = useStoryUi((st) => st.dismissed);
  const storyAsk = !!storyPending && pendingKey(storyPending) !== storyDismissed;
  const [storyShown, setStoryShown] = useState(() => track === "upbringing" && storyOnScreen());
  useEffect(() => {
    if (track !== "upbringing") return;
    const id = setInterval(() => setStoryShown(storyOnScreen()), 250);
    return () => clearInterval(id);
  }, [track]);
  const storyUp = track === "upbringing" && (storyAsk || storyShown);
  // U06F2：行动制的画面在时不启动旧的养成教程（它圈的块都不在）；已经开了的收起（不记看过）
  const actOn = useUbActOn((st) => st.on) && track === "upbringing";
  useEffect(() => {
    if (actOn && useStore.getState().active) useStore.setState({ active: false, step: 0 });
  }, [actOn, useStore]);

  // 自动开始（只在进入外壳时判断一次）：养成教程在养成中、没看过、剧情对话框没开着时开始。
  // 出海教程（R10-Q02）：第一次进入航海期、旗舰队在港、没看过——经典世界的新开局（第 0–1 天），或这一次运行里刚从养成结业出海
  // （寰宇结业时约第 1460 天，原来的“第 1 天”永远不成立）。读档直接进来的不算（玩过的人多半看过）。
  useEffect(() => {
    const o = useGame.getState().overview;
    if (track === "upbringing" && o?.mode === "upbringing") markUpbringingSeen();
    const tut = useStore.getState();
    if (tut.done || tut.active || !o || actOn) return;
    if (track === "upbringing" ? o.mode === "upbringing" && !storyUp : firstVoyage(o) && flagship(o)?.docked != null) tut.start();
  }, [track, useStore, storyUp, actOn]);

  const s = STEPS_[Math.min(step, STEPS_.length - 1)];
  // 平板与手机上的紧凑顶栏
  const compact = useLayout() !== "desktop";
  // 新界面的桌面：一行顶栏，目标与存档就在顶栏上
  const row = useIsV2() && !compact;

  // 进入一步：准备界面、记下起点、把焦点放到“下一步”
  useEffect(() => {
    if (!active) return;
    s.prepare?.();
    base.current = baseline();
    next.current?.focus({ preventScroll: true });
  }, [active, step, s]);

  // 做完这一步要做的事：自动进入下一步；退回了上一步的状态（确认航线时回到了港口街景）：自动退回上一步
  useEffect(() => {
    if (!active || (!s.done && !s.undo)) return;
    const check = () => {
      const tut = useStore.getState();
      if (!tut.active || tut.step !== step) return;
      if (s.done?.(base.current)) tut.go(step + 1);
      else if (step > 0 && s.undo?.(base.current)) tut.go(step - 1);
    };
    const offs = [useGame.subscribe(check), useVoyageStore.subscribe(check)];
    return () => offs.forEach((off) => off());
  }, [active, step, s, useStore]);

  // 目标的位置：窗口打开、滚动、界面变化时都可能移动，每 200 毫秒量一次。
  // 目标整个在屏幕外（矮屏上窗口里的内容还没滚到）时，每一步滚一次，把它滚进视野（数据回来得晚也照样）
  useEffect(() => {
    if (!active) return;
    let revealed = false;
    const target = (row && s.rowTarget) || s.target;
    const update = () => {
      if (!revealed) revealed = reveal(target);
      setBox((prev) => {
        const b = measure(target);
        return sameBox(prev, b) ? prev : b;
      });
      setAvoid((prev) => {
        const b = measure(AVOID);
        return sameBox(prev, b) ? prev : b;
      });
    };
    update();
    const id = setInterval(update, 200);
    window.addEventListener("resize", update);
    return () => {
      clearInterval(id);
      window.removeEventListener("resize", update);
    };
  }, [active, s, row]);

  // 说明框的实际高度（换步骤时文字长短不同），用来决定放在目标上方还是下方
  useLayoutEffect(() => {
    const h = bubble.current?.offsetHeight;
    if (h && Math.abs(h - bubbleH) > 2) setBubbleH(h);
  }, [active, step, box, bubbleH]);

  if (!active || storyUp) return null;
  const last = step >= STEPS_.length - 1;
  const { go, finish } = useStore.getState();
  const forward = () => (last ? finish() : go(step + 1));
  const back = () => step > 0 && go(step - 1);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      finish();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      forward();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      back();
    }
  };
  const width = bubbleWidth();
  // 出港框开着：说明框让开它；放不下就先收起来（框合上再出来）
  const aside = avoid ? placeAside(avoid, bubbleH, width) : null;
  if (avoid && !aside) return null;
  const pos = aside ?? place(box, bubbleH, !!s.corner, width);
  const titleId = "tutorial-title";
  // 紧凑顶栏上的说法（有这一句的步骤才换）；新界面桌面的一行顶栏另有自己的说法
  const compactKey = `tut.${s.id}.textCompact`;
  const rowKey = `tut.${s.id}.textRow`;
  const text =
    row && rowKey in ZH_ONLY
      ? tz(rowKey as ZhOnlyKey)
      : compact && lookup(compactKey) !== undefined
        ? tk(compactKey)
        : tk(`tut.${s.id}.text`);
  // 小乌鸦站在说明框上沿，转头朝向被圈出的地方（原图朝右）
  const facing = box && box.left + box.width / 2 < pos.left + width / 2 ? "left" : "right";

  return (
    <div className="tut-layer" data-testid="tutorial" data-step={s.id}>
      {box ? (
        <div
          className="tut-spot"
          aria-hidden="true"
          style={{ left: box.left - PAD, top: box.top - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2 }}
        />
      ) : s.corner || avoid ? null : (
        <div className="tut-dim" aria-hidden="true" />
      )}
      <div
        ref={bubble}
        className="tut-bubble parchment"
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        style={{ left: pos.left, top: pos.top, width }}
        onKeyDown={onKey}
      >
        <GuideCrow
          height={72}
          cue={step}
          facing={facing}
          className={facing === "left" ? "tut-guide is-left" : "tut-guide"}
          label={t("tut.guideLabel")}
          testId="tutorial-guide"
        />
        <div className="tut-head">
          <div className="tut-head-text">
            <h2 id={titleId} className="tut-title">
              {tk(`tut.${s.id}.title`)}
            </h2>
            <span className="tut-count">{t("tut.progress", { n: step + 1, total: STEPS_.length })}</span>
          </div>
        </div>
        <p className="tut-text" data-testid="tutorial-text">
          {text}
        </p>
        {s.done && <p className="tut-try sub">{t("tut.tryIt")}</p>}
        <div className="tut-actions">
          <button type="button" className="btn tut-skip" onClick={finish}>
            {t("tut.skip")}
          </button>
          <span className="tut-spacer" />
          <button type="button" className="btn" onClick={back} disabled={step === 0}>
            {t("tut.prev")}
          </button>
          <button ref={next} type="button" className="btn primary" onClick={forward}>
            {last ? t("tut.finish") : t("tut.next")}
          </button>
        </div>
        {/* 新界面：说明框里能用的键（← → 翻页、Esc 跳过）；旧界面没有，触屏上样式表不显示 */}
        <KeyHints
          className="tut-keys"
          items={[
            { keys: ["ArrowLeft", "ArrowRight"], label: t("v2.dialogs.tut.keys") },
            { keys: ["Esc"], label: t("tut.skip") },
          ]}
        />
      </div>
    </div>
  );
}
