// 比赛对话框（FRAMEWORK §7.10）：节日与学院的比赛可以玩小游戏，也可以"按实力结算"（关掉对话框，不提交，到日子由后端按属性与准备结算）。
// 六种小游戏都只记录玩家的选择，交给后端按种子确定地算名次（同样的输入同样的名次）。
//   配对（贝合、记忆牌）：翻两张，同面就配上，次数有限。
//   作诗（歌合、联句、加扎勒、班顿）：每句从几个词里挑一个，旁边是季语、韵脚之类的提示。
//   节奏（蹴鞠、号子、鼓、套环）：拍点从左往右走，在它经过判定线时按空格或点击。
//   辩论（论辩、讲会、星问）：每回合看对方的论点，出一张手牌；克制关系由数据给。
//   竞渡（龙舟、赛船、独木舟）：每一程选一种走法，各有风险。
//   辨识（闻香、斗茶、辨宝石与金银）：看线索，给每个样品认一个答案。
// 11-03 手感：
// - 顶上一行写清这局怎么赢（ct-rule）；辩论另写一行克制关系，论点的种类显示中文；
// - 选了就地写效果：作诗每句、辩论每回合加几分，竞渡每种走法顺利 / 失手各几分，配对刚翻的一对配没配上；
//   交卷按钮上面的“胜算”一栏跟着变（后端 contest_preview：与结算同一套算法；辨识的对错与竞渡的失手结算前不给）；
// - 键盘玩到底：数字键 1–9 选、↑↓ 换一步、←→ 在一步里挪、回车交卷、Esc 按实力结算；退格撤回（辩论、竞渡）；
//   选完一步焦点自动到下一步，都选好了到交卷按钮；Tab 只在对话框里转，关掉后焦点回到打开它的按钮；
// - 交卷以后不马上关：写出名次、各人的分、你的分是怎么来的（实力 + 小游戏 + 临场）和赢 / 输的原因（后端 contest_outcome）；
//   后端没给讲解时照旧直接关掉。
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { t, tk } from "../../i18n";
import { tz } from "../../i18n/zhOnly";
import { api } from "../../ipc/api";
import type {
  ContestOutcome,
  ContestPreview,
  ContestStep,
  ContestView,
} from "../../ipc/types";
import { useGame } from "../../store/game";
import { useIsV2 } from "../../ui/uiMode";
import { InlineError, KeyHints, type KeyHint } from "../feedback";
import { keyLabel } from "../feedback/keys";
import { PortraitArt } from "../portrait/PortraitArt";
import { captainPortrait } from "../start/captain";
import {
  debateEdge,
  debateParams,
  digitKey,
  identifyParams,
  matchDone,
  matchFlip,
  matchPairs,
  matchParams,
  matchStart,
  nearestBeat,
  nextOpen,
  poemParams,
  raceParams,
  rhythmGrade,
  rhythmHits,
  rhythmParams,
  signed,
} from "./contestKit";

type Submit = (moves: unknown[]) => void;
/** 小游戏把自己的按键处理挂在这里：对话框收到的按键（Esc、Tab 以外）先交给它，处理了返回 true */
type KeyHandler = (e: KeyboardEvent<HTMLElement>) => boolean;

/** 后端的预估与它对应的输入（还没回来、或后端没有这个查询时 view 为 null） */
interface Live {
  view: ContestPreview | null;
  moves: unknown[] | null;
  /** 输入已经变了、新的预估还没回来 */
  stale: boolean;
}

interface GameProps {
  c: ContestView;
  onDone: Submit;
  /** 现在的输入（没选的一步是 null）：对话框照它向后端要预估 */
  onMoves: (moves: unknown[]) => void;
  live: Live;
  keys: MutableRefObject<KeyHandler | null>;
  /** 交卷以后的讲解（辨识的对错、竞渡的失手画在各步旁边） */
  outcome: ContestOutcome | null;
  /** 正在交卷或已经交卷：不能再改 */
  locked: boolean;
  /** 胜算一栏（各小游戏放在交卷按钮上面） */
  odds: ReactNode;
}

/** 交卷做不了的原因（“就到这里 / 吟出 / 交卷”不可用时）的 id。同一时刻只开一个比赛对话框、里面只有一个交卷按钮，用固定的 id 不会重复
 *（不用 useId：旧界面里多一次 useId 会让后面挂上的 id 全部错开一位，DOM 就与改版前不同了） */
const WHY_ID = "ct-why";

/** 新界面：交卷按钮不可用时，在它上面就地写出原因（InlineError tone="blocked"），按钮 aria-describedby 指过来——
 *  不然按钮只是灰了，第一眼像坏了（触屏也看不到悬停提示）。旧界面什么都不渲染，按钮也不带 aria-describedby。 */
function GoWhy({ show, reason }: { show: boolean; reason: string }) {
  return show ? (
    <InlineError
      tone="blocked"
      id={WHY_ID}
      className="ct-why"
      reason={reason}
    />
  ) : null;
}

/** 回车交卷：焦点在底栏（按实力结算）、交卷按钮本身或撤回上时，回车照按钮自己的意思，不在这里交卷 */
function enterSubmits(e: KeyboardEvent<HTMLElement>): boolean {
  return (
    e.key === "Enter" &&
    !(
      e.target instanceof Element &&
      e.target.closest(".ct-foot, .ts-btn-go, .ct-undo")
    )
  );
}

/** 这一步的预估：只有这一步的输入与预估对应的输入相同时才用（刚改了的一步等新的预估回来） */
function stepOf(live: Live, i: number, current: unknown): ContestStep | null {
  if (
    !live.view ||
    !live.moves ||
    JSON.stringify(live.moves[i] ?? null) !== JSON.stringify(current ?? null)
  )
    return null;
  return live.view.steps[i] ?? null;
}

/** 一步拿了几分：拿满了 / 最多能拿多少 */
function StepNote({ s }: { s: ContestStep | null }) {
  if (!s) return null;
  const full = s.got >= s.best;
  return (
    <span
      className={`ct-step ${full ? "is-full" : s.got > 0 ? "is-part" : "is-zero"}`}
    >
      {full
        ? tz("ct.step.full", { got: s.got })
        : tz("ct.step.part", { got: s.got, best: s.best })}
    </span>
  );
}

/** 数字键的小标（选项前的 1、2、3）：触屏上由样式表藏起来；读屏不念 */
function Num({ n }: { n: number }) {
  return n < 9 ? (
    <span className="ct-num" aria-hidden="true">
      {n + 1}
    </span>
  ) : null;
}

/** 论点种类的中文（数据里的键；没列的照原样） */
function argKind(kind: string): string {
  const key = `ct.arg.${kind}`;
  return key === "ct.arg.observation" ||
    key === "ct.arg.counterexample" ||
    key === "ct.arg.reason" ||
    key === "ct.arg.authority" ||
    key === "ct.arg.example" ||
    key === "ct.arg.logic"
    ? tz(key)
    : kind;
}

/** 在一组按钮里挪焦点（roving tabindex）：找到第 i 个就聚焦 */
function focusIn(root: HTMLElement | null, selector: string) {
  const el = root?.querySelector<HTMLElement>(selector);
  el?.focus();
}

/** 胜算一栏：照现在约多少能赢（大字）、一根条（底色是拿满时，实色是照现在，竖线是不玩时）、小字写不玩 / 拿满与小游戏的加分 */
function Odds({ live, kind }: { live: Live; kind: ContestView["kind"] }) {
  const v = live.view;
  if (!v) return null;
  const hidden = v.pct === null;
  const now = v.pct ?? v.best_pct;
  return (
    <div
      className={`ct-odds${live.stale ? " is-stale" : ""}`}
      role="status"
      title={tz("ct.odds.tip")}
    >
      <span className="ct-odds-label">{tz("ct.odds.label")}</span>
      <span className="ct-odds-bar" aria-hidden="true">
        <span className="ct-odds-best" style={{ width: `${v.best_pct}%` }} />
        <span
          className="ct-odds-fill"
          style={{ width: `${hidden ? v.base_pct : now}%` }}
        />
        <span className="ct-odds-base" style={{ left: `${v.base_pct}%` }} />
      </span>
      <b className="ct-odds-now">
        {hidden
          ? tz("ct.odds.hidden", { pct: v.best_pct })
          : tz("ct.odds.now", { pct: now })}
      </b>
      <span className="ct-odds-meta">
        <span>{tz("ct.odds.base", { pct: v.base_pct })}</span>
        {!hidden && <span>{tz("ct.odds.best", { pct: v.best_pct })}</span>}
        {v.bonus !== null && (
          <span>
            {tz("ct.odds.bonus", { bonus: v.bonus, best: v.best_bonus })}
          </span>
        )}
        {kind === "race" && <span>{tz("ct.odds.race")}</span>}
      </span>
    </div>
  );
}

/** 顶上一行：这局怎么赢 */
function rule(c: ContestView, v: ContestPreview | null): string {
  const unit = v?.unit ?? null;
  const cap = v ? tz("ct.rule.cap", { best: v.best_bonus }) : "";
  switch (c.kind) {
    case "match":
      return (
        (unit !== null
          ? tz("ct.rule.match", { flips: matchParams(c).flips, unit })
          : tz("ct.rule.matchFree", { flips: matchParams(c).flips })) + cap
      );
    case "poem":
      return tz("ct.rule.poem", { n: poemParams(c).lines.length }) + cap;
    case "rhythm":
      return (
        (unit !== null
          ? tz("ct.rule.rhythm", { unit })
          : tz("ct.rule.rhythmFree")) + cap
      );
    case "debate":
      return (
        (unit !== null
          ? tz("ct.rule.debate", { unit })
          : tz("ct.rule.debateFree")) + cap
      );
    case "race":
      return tz("ct.rule.race") + cap;
    case "identify":
      return (
        (unit !== null
          ? tz("ct.rule.identify", { unit })
          : tz("ct.rule.identifyFree")) + cap
      );
  }
}

/** 各小游戏的快捷键提示 */
function hints(kind: ContestView["kind"]): KeyHint[] {
  const submit: KeyHint = { keys: ["Enter"], label: tz("ct.keys.submit") };
  const close: KeyHint = { keys: ["Esc"], label: tz("ct.keys.close") };
  switch (kind) {
    case "poem":
      return [
        { keys: ["1", "2", "3"], label: tz("ct.keys.pick") },
        { keys: ["↑", "↓"], label: tz("ct.keys.line") },
        submit,
        close,
      ];
    case "identify":
      return [
        { keys: ["1", "2", "3"], label: tz("ct.keys.pick") },
        { keys: ["↑", "↓"], label: tz("ct.keys.sample") },
        submit,
        close,
      ];
    case "debate":
    case "race":
      return [
        { keys: ["1", "2", "3"], label: tz("ct.keys.pick") },
        { keys: ["Backspace"], label: tz("ct.keys.undo") },
        submit,
        close,
      ];
    case "match":
      return [
        { keys: ["←", "→", "↑", "↓"], label: tz("ct.keys.move") },
        { keys: ["Enter"], label: tz("ct.keys.flip") },
        close,
      ];
    case "rhythm":
      return [{ keys: [" "], label: tz("ct.keys.tap") }, close];
  }
}

function Keys({ kind }: { kind: ContestView["kind"] }) {
  const items = hints(kind);
  const text = items
    .map((h) => `${h.keys.map((k) => keyLabel(k).text).join("/")} ${h.label}`)
    .join(" · ");
  return (
    <KeyHints
      className="ct-keys"
      items={items}
      v1={<p className="ct-keys-v1">{tz("ct.keys.v1", { text })}</p>}
    />
  );
}

// ───────────── 配对 ─────────────

function MatchGame({
  c,
  onDone,
  onMoves,
  live,
  keys,
  outcome,
  locked,
  odds,
}: GameProps) {
  const p = useMemo(() => matchParams(c), [c]);
  const [s, setS] = useState(() => matchStart(p));
  const [cursor, setCursor] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const done = matchDone(p, s);
  const why = useIsV2() && s.moves.length === 0;
  useEffect(() => onMoves(s.moves), [s.moves, onMoves]);
  // 刚翻完的一对：配上了没有
  const last = s.moves[s.moves.length - 1];
  const hit = last ? s.matched[last[0]] && s.matched[last[1]] : null;
  const unit = live.view?.unit ?? null;
  const go = useRef<HTMLButtonElement>(null);
  /** 翻完以后焦点要不要挪：配上的牌变成不可用、焦点会掉到页面上，挪到下一张还扣着的牌；次数用完挪到交卷 */
  const refocus = useRef(false);
  const flip = (i: number) => {
    if (locked) return;
    const next = matchFlip(p, s, i);
    setS(next);
    if (matchDone(p, next)) {
      refocus.current = true;
      return;
    }
    let to = i;
    for (let n = 1; next.matched[to] && n <= p.faces.length; n++)
      to = (i + n) % p.faces.length;
    setCursor(to);
    refocus.current = to !== i;
  };
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    if (done) go.current?.focus();
    else focusIn(root.current, `[data-card="${cursor}"]`);
  });
  // 方向键在牌桌上挪（跳过已经配上的牌）
  const move = (dx: number, dy: number) => {
    let i = cursor;
    for (let n = 0; n < p.faces.length; n++) {
      const col = (i % p.cols) + dx;
      const row = Math.floor(i / p.cols) + dy;
      if (
        col < 0 ||
        col >= p.cols ||
        row < 0 ||
        i + dx + dy * p.cols >= p.faces.length
      )
        return;
      i = row * p.cols + col;
      if (!s.matched[i]) break;
    }
    setCursor(i);
    focusIn(root.current, `[data-card="${i}"]`);
  };
  const onKey: KeyHandler = (e) => {
    if (locked) return false;
    const dir: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (dir[e.key]) {
      move(...dir[e.key]);
      return true;
    }
    return false;
  };
  useEffect(() => {
    keys.current = onKey;
  });
  return (
    <div className="ct-match" ref={root}>
      <p className="ct-status">
        {t("ct.matchStatus", { pairs: matchPairs(s), left: p.flips - s.used })}
      </p>
      {hit !== null && (
        <p className={`ct-flash ${hit ? "is-hit" : "is-miss"}`} role="status">
          {hit
            ? unit !== null
              ? tz("ct.match.hit", { unit })
              : tz("ct.match.hitFree")
            : tz("ct.match.miss")}
        </p>
      )}
      <div
        className="ct-cards"
        style={{ gridTemplateColumns: `repeat(${p.cols}, minmax(0, 1fr))` }}
      >
        {p.faces.map((f, i) => {
          const up = s.matched[i] || s.open.includes(i);
          return (
            <button
              key={i}
              type="button"
              data-card={i}
              data-first={i === 0 ? "" : undefined}
              tabIndex={i === cursor ? 0 : -1}
              className={`ct-card${up ? " is-up" : ""}${s.matched[i] ? " is-matched" : ""}`}
              aria-label={up ? f : t("ct.cardDown", { n: i + 1 })}
              disabled={done || s.matched[i] || locked}
              onClick={() => flip(i)}
            >
              {up ? f : "？"}
            </button>
          );
        })}
      </div>
      {odds}
      <GoWhy show={why} reason={t("v2.dialogs.contest.whyMatch")} />
      {!outcome && (
        <button
          ref={go}
          type="button"
          className="ts-btn ts-btn-go"
          disabled={s.moves.length === 0 || locked}
          aria-describedby={why ? WHY_ID : undefined}
          onClick={() => onDone(s.moves)}
        >
          {done ? t("ct.finish") : t("ct.stopHere")}
        </button>
      )}
    </div>
  );
}

// ───────────── 作诗 ─────────────

function PoemGame({
  c,
  onDone,
  onMoves,
  live,
  keys,
  outcome,
  locked,
  odds,
}: GameProps) {
  const p = useMemo(() => poemParams(c), [c]);
  const [picks, setPicks] = useState<(number | null)[]>(() =>
    p.lines.map(() => null),
  );
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const go = useRef<HTMLButtonElement>(null);
  /** 选完一句以后要把焦点挪到哪：下一句（下标）或交卷按钮 */
  const focusNext = useRef<number | "go" | null>(null);
  const missing = picks.filter((x) => x === null).length;
  const why = useIsV2() && missing > 0;
  useEffect(() => onMoves(picks), [picks, onMoves]);
  useEffect(() => {
    const to = focusNext.current;
    focusNext.current = null;
    if (to === "go") go.current?.focus();
    else if (to !== null)
      focusIn(root.current, `[data-line="${to}"] [role=radio][tabindex="0"]`);
  });
  /** 选第 i 句的第 j 个词；advance：选完跳到下一句没选的（都选好了跳到“吟出”） */
  const choose = (i: number, j: number, advance: boolean) => {
    if (locked || j < 0 || j >= (p.lines[i]?.options.length ?? 0)) return;
    const next = picks.map((x, k) => (k === i ? j : x));
    setPicks(next);
    if (!advance) {
      focusNext.current = i;
      return;
    }
    const n = nextOpen(next, i);
    setActive(n < 0 ? i : n);
    focusNext.current = n < 0 ? "go" : n;
  };
  const onKey: KeyHandler = (e) => {
    if (locked) return false;
    const d = digitKey(e);
    if (d !== null) {
      choose(active, d, true);
      return true;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const n = Math.min(
        p.lines.length - 1,
        Math.max(0, active + (e.key === "ArrowDown" ? 1 : -1)),
      );
      setActive(n);
      focusIn(root.current, `[data-line="${n}"] [role=radio][tabindex="0"]`);
      return true;
    }
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const len = p.lines[active]?.options.length ?? 0;
      if (len === 0) return false;
      const cur = picks[active];
      const j =
        cur === null ? 0 : (cur + (e.key === "ArrowRight" ? 1 : len - 1)) % len;
      choose(active, j, false);
      return true;
    }
    if (enterSubmits(e) && missing === 0) {
      onDone(picks as number[]);
      return true;
    }
    return false;
  };
  useEffect(() => {
    keys.current = onKey;
  });
  return (
    <div className="ct-poem" ref={root}>
      {p.theme && (
        <p className="ct-theme">{t("ct.theme", { theme: p.theme })}</p>
      )}
      {p.hints.length > 0 && <p className="ct-hints">{p.hints.join(" · ")}</p>}
      <ol className="ct-lines">
        {p.lines.map((l, i) => (
          <li
            key={i}
            data-line={i}
            className={
              i === active && !locked && missing > 0 ? "is-now" : undefined
            }
            onFocus={() => setActive(i)}
          >
            <span className="ct-prompt">{l.prompt}</span>
            <div className="ct-pick">
              <span
                className="ct-options"
                role="radiogroup"
                aria-label={t("ct.lineN", { n: i + 1 })}
              >
                {l.options.map((o, j) => (
                  <button
                    key={j}
                    type="button"
                    role="radio"
                    aria-checked={picks[i] === j}
                    tabIndex={(picks[i] ?? 0) === j ? 0 : -1}
                    data-first={i === 0 && j === 0 ? "" : undefined}
                    disabled={locked}
                    className={picks[i] === j ? "ct-opt is-on" : "ct-opt"}
                    onClick={() => {
                      setActive(i);
                      choose(i, j, true);
                    }}
                  >
                    <Num n={j} />
                    {o}
                  </button>
                ))}
              </span>
              {picks[i] !== null && <StepNote s={stepOf(live, i, picks[i])} />}
            </div>
          </li>
        ))}
      </ol>
      <p className="ct-preview">
        {p.lines
          .map((l, i) =>
            picks[i] !== null
              ? l.prompt.replace("＿", l.options[picks[i]!])
              : l.prompt,
          )
          .join(" / ")}
      </p>
      {odds}
      <GoWhy
        show={why}
        reason={t("v2.dialogs.contest.whyPoem", { n: missing })}
      />
      {!outcome && (
        <button
          ref={go}
          type="button"
          className="ts-btn ts-btn-go"
          disabled={picks.some((x) => x === null) || locked}
          aria-describedby={why ? WHY_ID : undefined}
          onClick={() => onDone(picks as number[])}
        >
          {t("ct.recite")}
        </button>
      )}
    </div>
  );
}

// ───────────── 节奏 ─────────────

function RhythmGame({
  c,
  onDone,
  onMoves,
  keys,
  outcome,
  locked,
  odds,
}: GameProps) {
  const p = useMemo(() => rhythmParams(c), [c]);
  const length = (p.beats[p.beats.length - 1] ?? 0) + 1200;
  const [start, setStart] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [taps, setTaps] = useState<number[]>([]);
  const [last, setLast] = useState<string | null>(null);
  const [grades, setGrades] = useState({ perfect: 0, good: 0, miss: 0 });
  const raf = useRef(0);
  const track = useRef<HTMLDivElement>(null);
  const go = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (start === null) return;
    const loop = () => {
      const t0 = performance.now() - start;
      setNow(t0);
      if (t0 < length) raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, [start, length]);
  const running = start !== null && now < length;
  const finished = start !== null && !running;
  // 开始前问一次“不打”的预估（规则一行要每拍的分值）；打的时候不来回问后端，打完了再问；打完把焦点放到交卷上
  useEffect(() => {
    if (start === null) onMoves([]);
  }, [start, onMoves]);
  useEffect(() => {
    if (!finished) return;
    onMoves(taps);
    go.current?.focus();
  }, [finished, taps, onMoves]);
  const begin = () => {
    if (locked || start !== null) return;
    setStart(performance.now());
    track.current?.focus();
  };
  const tap = () => {
    if (!running || start === null || locked) return;
    const at = Math.round(performance.now() - start);
    setTaps((x) => [...x, at]);
    const g = rhythmGrade(nearestBeat(p.beats, at).diff, p.window);
    setLast(g);
    setGrades((x) => ({ ...x, [g]: x[g] + 1 }));
  };
  const onKey: KeyHandler = (e) => {
    if (locked) return false;
    if (e.key === " " || e.key === "Enter") {
      if (start === null) begin();
      else if (running) tap();
      else if (e.key === "Enter" && enterSubmits(e)) onDone(taps);
      else return false;
      return true;
    }
    return false;
  };
  useEffect(() => {
    keys.current = onKey;
  });
  // 拍点在 1.5 秒内从右走到判定线
  const lead = 1500;
  return (
    <div className="ct-rhythm">
      <div
        className="ct-track"
        ref={track}
        tabIndex={-1}
        onPointerDown={tap}
        role="button"
        aria-label={t("ct.tap")}
      >
        <span className="ct-line" />
        {p.beats.map((b, i) => {
          const x = (b - now) / lead;
          if (start === null || x < -0.1 || x > 1) return null;
          return (
            <span
              key={i}
              className="ct-beat"
              style={{ left: `${10 + x * 90}%` }}
            />
          );
        })}
        {last && (
          <span className={`ct-grade ct-grade--${last}`}>
            {tk(`ct.grade.${last}`)}
          </span>
        )}
      </div>
      {start !== null && (
        <p className="ct-status ct-grades">{tz("ct.rhythm.grades", grades)}</p>
      )}
      {start === null ? (
        <button
          type="button"
          className="ts-btn ts-btn-go"
          data-first=""
          disabled={locked}
          onClick={begin}
        >
          {t("ct.begin")}
        </button>
      ) : running ? (
        <p className="ct-status">{t("ct.rhythmHelp")}</p>
      ) : (
        <>
          <p className="ct-status ct-hits">
            {tz("ct.rhythm.hits", {
              hits: rhythmHits(p.beats, p.window, taps),
              beats: p.beats.length,
            })}
          </p>
          {odds}
          {!outcome && (
            <button
              ref={go}
              type="button"
              className="ts-btn ts-btn-go"
              disabled={locked}
              onClick={() => onDone(taps)}
            >
              {t("ct.finish")}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ───────────── 辩论 ─────────────

function edgeText(edge: -1 | 0 | 1): string {
  return edge === 1
    ? tz("ct.edge.win")
    : edge === 0
      ? tz("ct.edge.tie")
      : tz("ct.edge.lose");
}

function DebateGame({
  c,
  onDone,
  onMoves,
  live,
  keys,
  outcome,
  locked,
  odds,
}: GameProps) {
  const p = useMemo(() => debateParams(c), [c]);
  const [played, setPlayed] = useState<string[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const go = useRef<HTMLButtonElement>(null);
  const focusAfter = useRef(false);
  const round = played.length;
  const done = round >= p.rounds.length;
  const hand = p.hand.filter((h) => !played.includes(h.key));
  const unit = live.view?.unit ?? null;
  useEffect(
    () => onMoves(p.rounds.map((_, i) => played[i] ?? null)),
    [played, p.rounds, onMoves],
  );
  useEffect(() => {
    if (!focusAfter.current) return;
    focusAfter.current = false;
    if (done) go.current?.focus();
    else focusIn(root.current, ".ct-hand .ct-opt");
  });
  const play = (key: string) => {
    if (locked || done) return;
    setPlayed([...played, key]);
    focusAfter.current = true;
  };
  const undo = () => {
    if (locked || played.length === 0) return;
    setPlayed(played.slice(0, -1));
    focusAfter.current = true;
  };
  const onKey: KeyHandler = (e) => {
    if (locked) return false;
    const d = digitKey(e);
    if (d !== null && !done) {
      if (hand[d]) play(hand[d].key);
      return true;
    }
    if (e.key === "Backspace") {
      undo();
      return true;
    }
    if (enterSubmits(e) && done) {
      onDone(played);
      return true;
    }
    return false;
  };
  useEffect(() => {
    keys.current = onKey;
  });
  const opponent = p.rounds[round]?.opponent;
  return (
    <div className="ct-debate" ref={root}>
      {p.topic && (
        <p className="ct-theme">{t("ct.topic", { topic: p.topic })}</p>
      )}
      {p.beats.length > 0 && (
        <p className="ct-beats">
          <span className="ct-beats-label">{tz("ct.beatsLabel")}</span>
          {p.beats
            .map(([a, b]) => tz("ct.beats", { a: argKind(a), b: argKind(b) }))
            .join(" · ")}
        </p>
      )}
      <ol className="ct-rounds">
        {p.rounds.slice(0, Math.min(round + 1, p.rounds.length)).map((r, i) => {
          const mine = p.hand.find((h) => h.key === played[i]);
          const edge = mine
            ? debateEdge(p.beats, mine.kind, r.opponent.kind)
            : 0;
          const step = mine ? stepOf(live, i, mine.key) : null;
          return (
            <li key={i} className={i === round ? "is-now" : undefined}>
              <p className="ct-opp">
                <span className="ct-kind">{argKind(r.opponent.kind)}</span>
                {r.opponent.text}
              </p>
              {mine && (
                <p className={`ct-mine ct-edge${edge}`}>
                  <span className="ct-kind">{argKind(mine.kind)}</span>
                  <span className="ct-mine-text">{mine.text}</span>
                  <span
                    className={`ct-step ${edge === 1 ? "is-full" : "is-zero"}`}
                  >
                    {step
                      ? tz("ct.edge.points", {
                          edge: edgeText(edge),
                          got: step.got,
                        })
                      : edgeText(edge)}
                  </span>
                </p>
              )}
            </li>
          );
        })}
      </ol>
      {!done ? (
        <ul className="ct-hand" aria-label={t("ct.hand")}>
          {hand.map((h, n) => {
            const e = opponent ? debateEdge(p.beats, h.kind, opponent.kind) : 0;
            return (
              <li key={h.key}>
                <button
                  type="button"
                  className={`ct-opt ct-edge-hint${e}`}
                  data-first={n === 0 ? "" : undefined}
                  disabled={locked}
                  onClick={() => play(h.key)}
                >
                  <Num n={n} />
                  <span className="ct-kind">{argKind(h.kind)}</span>
                  <span className="ct-opt-text">{h.text}</span>
                  <span className={`ct-vs ct-vs${e}`}>
                    {e === 1 && unit !== null
                      ? tz("ct.edge.points", { edge: edgeText(e), got: unit })
                      : edgeText(e)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {played.length > 0 && !locked && (
        <button type="button" className="ts-btn ct-undo" onClick={undo}>
          {tz("ct.undo")}
        </button>
      )}
      {odds}
      {done && !outcome && (
        <button
          ref={go}
          type="button"
          className="ts-btn ts-btn-go"
          disabled={locked}
          onClick={() => onDone(played)}
        >
          {t("ct.finish")}
        </button>
      )}
    </div>
  );
}

// ───────────── 竞渡 ─────────────

function RaceGame({
  c,
  onDone,
  onMoves,
  live,
  keys,
  outcome,
  locked,
  odds,
}: GameProps) {
  const p = useMemo(() => raceParams(c), [c]);
  const [picks, setPicks] = useState<string[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const go = useRef<HTMLButtonElement>(null);
  const focusAfter = useRef(false);
  const leg = picks.length;
  const done = leg >= p.legs.length;
  useEffect(
    () => onMoves(p.legs.map((_, i) => picks[i] ?? null)),
    [picks, p.legs, onMoves],
  );
  useEffect(() => {
    if (!focusAfter.current) return;
    focusAfter.current = false;
    if (done) go.current?.focus();
    else focusIn(root.current, ".ct-legs li.is-now .ct-opt");
  });
  const choose = (key: string) => {
    if (locked || done) return;
    setPicks([...picks, key]);
    focusAfter.current = true;
  };
  const undo = () => {
    if (locked || picks.length === 0) return;
    setPicks(picks.slice(0, -1));
    focusAfter.current = true;
  };
  const onKey: KeyHandler = (e) => {
    if (locked) return false;
    const d = digitKey(e);
    if (d !== null && !done) {
      const o = p.legs[leg]?.options[d];
      if (o) choose(o.key);
      return true;
    }
    if (e.key === "Backspace") {
      undo();
      return true;
    }
    if (enterSubmits(e) && done) {
      onDone(picks);
      return true;
    }
    return false;
  };
  useEffect(() => {
    keys.current = onKey;
  });
  // 正在选的这一程：预估给的每种走法顺利 / 失手各几分（预估对应的输入就是现在的输入时才用）
  const fresh =
    live.view &&
    live.moves &&
    JSON.stringify(live.moves) ===
      JSON.stringify(p.legs.map((_, i) => picks[i] ?? null));
  const worth = (key: string) =>
    fresh ? live.view!.options.find((o) => o.key === key) : undefined;
  return (
    <div className="ct-race" ref={root}>
      <ol className="ct-legs">
        {p.legs.map((l, i) => {
          const step = i < leg ? stepOf(live, i, picks[i]) : null;
          const res = outcome?.steps[i];
          const failed = res && "failed" in res ? res.failed : null;
          return (
            <li
              key={i}
              className={i < leg ? "is-done" : i === leg ? "is-now" : undefined}
            >
              <p>{l.text}</p>
              {i === leg && (
                <span className="ct-options">
                  {l.options.map((o, n) => {
                    const w = worth(o.key);
                    return (
                      <button
                        key={o.key}
                        type="button"
                        className="ct-opt"
                        data-first={i === 0 && n === 0 ? "" : undefined}
                        disabled={locked}
                        onClick={() => choose(o.key)}
                      >
                        <Num n={n} />
                        <span className="ct-opt-text">{o.text}</span>
                        {w && (
                          <small className="ct-worth">
                            {tz("ct.race.option", { win: w.win, lose: w.lose })}
                          </small>
                        )}
                        {o.risk > 0 && (
                          <small className="is-cost">
                            {t("ub.riskN", { pct: Math.round(o.risk / 100) })}
                          </small>
                        )}
                      </button>
                    );
                  })}
                </span>
              )}
              {i < leg && (
                <span className="ct-picked">
                  {l.options.find((o) => o.key === picks[i])?.text}
                  {step && step.win !== undefined && (
                    <span className="ct-step is-part">
                      {tz("ct.race.expect", {
                        got: step.got,
                        win: step.win,
                        lose: step.lose ?? 0,
                      })}
                    </span>
                  )}
                  {failed !== null && (
                    <span
                      className={`ct-verdict ${failed ? "is-bad" : "is-good"}`}
                    >
                      {failed ? tz("ct.race.failed") : tz("ct.race.ok")}
                    </span>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {picks.length > 0 && !locked && (
        <button type="button" className="ts-btn ct-undo" onClick={undo}>
          {tz("ct.undo")}
        </button>
      )}
      {odds}
      {done && !outcome && (
        <button
          ref={go}
          type="button"
          className="ts-btn ts-btn-go"
          disabled={locked}
          onClick={() => onDone(picks)}
        >
          {t("ct.finish")}
        </button>
      )}
    </div>
  );
}

// ───────────── 辨识 ─────────────

function IdentifyGame({
  c,
  onDone,
  onMoves,
  keys,
  outcome,
  locked,
  odds,
}: GameProps) {
  const p = useMemo(() => identifyParams(c), [c]);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const go = useRef<HTMLButtonElement>(null);
  const focusNext = useRef<number | "go" | null>(null);
  const all = p.samples.every((s) => picks[s.key]);
  const missing = p.samples.filter((s) => !picks[s.key]).length;
  const why = useIsV2() && !all;
  useEffect(
    () => onMoves(p.samples.map((s) => picks[s.key] ?? null)),
    [picks, p.samples, onMoves],
  );
  useEffect(() => {
    const to = focusNext.current;
    focusNext.current = null;
    if (to === "go") go.current?.focus();
    else if (to !== null)
      focusIn(
        root.current,
        `[data-sample="${to}"] [role=option][tabindex="0"]`,
      );
  });
  const choose = (i: number, answer: string, advance: boolean) => {
    const s = p.samples[i];
    if (locked || !s) return;
    const next = { ...picks, [s.key]: answer };
    setPicks(next);
    if (!advance) {
      focusNext.current = i;
      return;
    }
    const n = nextOpen(
      p.samples.map((x) => next[x.key] ?? null),
      i,
    );
    setActive(n < 0 ? i : n);
    focusNext.current = n < 0 ? "go" : n;
  };
  const onKey: KeyHandler = (e) => {
    if (locked) return false;
    const d = digitKey(e);
    if (d !== null) {
      const a = p.answers[d];
      if (a) choose(active, a.key, true);
      return true;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const n = Math.min(
        p.samples.length - 1,
        Math.max(0, active + (e.key === "ArrowDown" ? 1 : -1)),
      );
      setActive(n);
      focusIn(root.current, `[data-sample="${n}"] [role=option][tabindex="0"]`);
      return true;
    }
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const s = p.samples[active];
      if (!s || p.answers.length === 0) return false;
      const cur = p.answers.findIndex((a) => a.key === picks[s.key]);
      const len = p.answers.length;
      const j =
        cur < 0 ? 0 : (cur + (e.key === "ArrowRight" ? 1 : len - 1)) % len;
      choose(active, p.answers[j].key, false);
      return true;
    }
    if (enterSubmits(e) && all) {
      onDone(p.samples.map((s) => picks[s.key]));
      return true;
    }
    return false;
  };
  useEffect(() => {
    keys.current = onKey;
  });
  const answerName = (key: string | null) =>
    p.answers.find((a) => a.key === key)?.name ?? key ?? "";
  return (
    <div className="ct-identify" ref={root}>
      <ol className="ct-samples">
        {p.samples.map((s, i) => {
          const res = outcome?.steps[i];
          const verdict = res && "correct" in res ? res : null;
          const cur = p.answers.findIndex((a) => a.key === picks[s.key]);
          return (
            <li
              key={s.key}
              data-sample={i}
              className={
                i === active && !locked && missing > 0 ? "is-now" : undefined
              }
              onFocus={() => setActive(i)}
            >
              <p className="ct-clues">
                <b>{t("ct.sampleN", { n: i + 1 })}</b> {s.clues.join("；")}
              </p>
              <div
                className="ct-answers"
                role="listbox"
                aria-label={t("ct.sampleN", { n: i + 1 })}
              >
                {p.answers.map((a, j) => (
                  <button
                    key={a.key}
                    type="button"
                    role="option"
                    value={a.key}
                    aria-selected={picks[s.key] === a.key}
                    tabIndex={(cur < 0 ? 0 : cur) === j ? 0 : -1}
                    data-first={i === 0 && j === 0 ? "" : undefined}
                    disabled={locked}
                    className={
                      picks[s.key] === a.key ? "ct-opt is-on" : "ct-opt"
                    }
                    onClick={() => {
                      setActive(i);
                      choose(i, a.key, true);
                    }}
                  >
                    <Num n={j} />
                    {a.name}
                  </button>
                ))}
              </div>
              {verdict && (
                <span
                  className={`ct-verdict ${verdict.correct ? "is-good" : "is-bad"}`}
                >
                  {verdict.correct
                    ? tz("ct.identify.right")
                    : tz("ct.identify.wrong", {
                        answer: answerName(verdict.answer),
                      })}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {!outcome && <p className="ct-status">{tz("ct.identify.later")}</p>}
      {odds}
      <GoWhy
        show={why}
        reason={t("v2.dialogs.contest.whyIdentify", { n: missing })}
      />
      {!outcome && (
        <button
          ref={go}
          type="button"
          className="ts-btn ts-btn-go"
          disabled={!all || locked}
          aria-describedby={why ? WHY_ID : undefined}
          onClick={() => onDone(p.samples.map((s) => picks[s.key]))}
        >
          {t("ct.finish")}
        </button>
      )}
    </div>
  );
}

// ───────────── 交卷以后 ─────────────

/** 赢 / 输的原因：一句话 */
function explain(o: ContestOutcome, bestBonus: number | null): string {
  const me = o.field.findIndex((f) => f.you);
  const you = o.field[me];
  if (!you || o.field.length < 2) return tz("ct.res.alone");
  const name = (f: ContestOutcome["field"][number]) => f.name ?? f.key;
  const bonus = o.bonus ?? 0;
  if (me === 0) {
    const second = o.field[1];
    if (bonus > 0 && you.score - bonus < second.score)
      return tz("ct.res.bonusWon", {
        bonus,
        name: name(second),
        score: second.score,
      });
    if (second.score === you.score)
      return tz("ct.res.tieWon", { name: name(second) });
    return tz("ct.res.lead", {
      name: name(second),
      gap: you.score - second.score,
    });
  }
  const top = o.field[0];
  const gap = top.score - you.score;
  if (gap === 0) return tz("ct.res.tie", { name: name(top) });
  if (bestBonus !== null && bestBonus - bonus > gap)
    return tz("ct.res.close", { name: name(top), gap, more: gap + 1 });
  return tz("ct.res.strong", { name: name(top), score: top.score, gap });
}

function Result({
  o,
  bestBonus,
  onClose,
}: {
  o: ContestOutcome;
  bestBonus: number | null;
  onClose: () => void;
}) {
  const ok = useRef<HTMLButtonElement>(null);
  const win = o.rank === 1;
  useEffect(() => {
    ok.current?.focus();
    ok.current?.scrollIntoView?.({ block: "nearest" });
  }, []);
  const jitter = signed(o.jitter);
  return (
    <section
      className={`ct-result ${win ? "is-win" : "is-lose"}`}
      aria-label={tz("ct.res.title")}
      role="status"
    >
      <p className="ct-result-rank">
        {win && <b>{tz("ct.res.win")}</b>}
        <span>{tz("ct.res.rank", { rank: o.rank, total: o.total })}</span>
      </p>
      <p className="ct-result-why">{explain(o, bestBonus)}</p>
      <ol className="ct-field">
        {o.field.map((f, i) => (
          <li key={f.key} className={f.you ? "is-you" : undefined}>
            <span className="ct-field-rank">{i + 1}</span>
            <span className="ct-field-name">
              {f.you ? tz("ct.res.you") : (f.name ?? f.key)}
            </span>
            <span className="ct-field-score">
              {tz("ct.res.score", { score: f.score })}
            </span>
          </li>
        ))}
      </ol>
      {o.bonus !== null && (
        <p className="ct-result-sum">
          {o.strength !== null
            ? tz("ct.res.sum", {
                score: o.score,
                strength: o.strength,
                bonus: o.bonus,
                jitter,
              })
            : tz("ct.res.sumShort", { score: o.score, bonus: o.bonus, jitter })}
        </p>
      )}
      <button
        ref={ok}
        type="button"
        className="ts-btn ts-btn-go"
        onClick={onClose}
      >
        {tz("ct.res.ok")}
      </button>
    </section>
  );
}

function face(key: string) {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return () => captainPortrait(h % 24);
}

const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export default function ContestDialog({
  contest,
  onClose,
}: {
  contest: string;
  onClose: () => void;
}) {
  const submit = useGame((s) => s.submit);
  const [c, setC] = useState<ContestView | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ContestOutcome | null>(null);
  const [moves, setMoves] = useState<unknown[] | null>(null);
  const [live, setLive] = useState<Omit<Live, "stale">>({
    view: null,
    moves: null,
  });
  const keys = useRef<KeyHandler | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  useEffect(() => {
    let alive = true;
    api
      .contest(contest)
      .then((v) => alive && setC(v))
      .catch((e) => {
        useGame.getState().fail(e);
        onClose();
      });
    return () => {
      alive = false;
    };
  }, [contest, onClose]);
  // 关掉以后焦点还给打开它的按钮（“去比赛”）
  useEffect(() => {
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    return () => {
      if (opener && document.contains(opener))
        opener.focus({ preventScroll: true });
    };
  }, []);
  // 载入后把焦点放进小游戏（第一句的第一个词、第一张牌、“开始”……），键盘马上能用
  useEffect(() => {
    if (!c || !panel.current) return;
    (
      panel.current.querySelector<HTMLElement>("[data-first]") ?? panel.current
    ).focus({ preventScroll: true });
  }, [c]);
  // 输入一变就向后端要预估；只认最后一次的回答
  useEffect(() => {
    if (!c || moves === null || outcome) return;
    const n = ++seq.current;
    api
      .contestPreview(contest, moves)
      .then((v) => {
        if (n === seq.current) setLive({ view: v ?? null, moves });
      })
      .catch(() => {
        // 旧后端没有这个查询、或输入还不合法：不显示预估，小游戏照样能玩
      });
  }, [c, contest, moves, outcome]);
  // 按实力结算：不玩小游戏，到日子由后端按属性与准备结算。U04 起寰宇的比赛要报名才结算，还没报名就先替玩家报上
  const autoResolve = async () => {
    if (c?.can_register) {
      setBusy(true);
      await submit({
        PlayContest: { owner: "player", contest, moves: { register: true } },
      });
      setBusy(false);
    }
    onClose();
  };
  const onMoves = useCallback(
    (m: unknown[]) =>
      setMoves((old) =>
        old && JSON.stringify(old) === JSON.stringify(m) ? old : m,
      ),
    [],
  );
  const finish = (m: unknown[]) => {
    if (busy || outcome) return;
    setBusy(true);
    void (async () => {
      const r = await submit({
        PlayContest: { owner: "player", contest, moves: m },
      });
      let o: ContestOutcome | null = null;
      if (r) {
        try {
          o = (await api.contestOutcome(contest, m)) ?? null;
        } catch {
          o = null;
        }
      }
      setBusy(false);
      // 后端讲得出名次怎么来的就留下来讲；交卷失败（错误已经在提示条里）或讲不出时照旧关掉
      if (o) setOutcome(o);
      else onClose();
    })();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // 对话框里的按键不传给下面的养成画面
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      if (!busy) onClose();
      return;
    }
    if (e.key === "Tab" && panel.current) {
      // 只算 Tab 走得到的（各组选项是 roving tabindex：每组只有一个 tabindex=0）
      const items = [
        ...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ].filter((el) => el.tabIndex >= 0);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (
        e.shiftKey &&
        (document.activeElement === first ||
          !panel.current.contains(document.activeElement))
      ) {
        e.preventDefault();
        last.focus();
      } else if (
        !e.shiftKey &&
        (document.activeElement === last ||
          !panel.current.contains(document.activeElement))
      ) {
        e.preventDefault();
        first.focus();
      }
      return;
    }
    if (busy || outcome) return;
    if (keys.current?.(e)) e.preventDefault();
  };
  const state: Live = {
    ...live,
    stale:
      live.moves !== null &&
      JSON.stringify(live.moves) !== JSON.stringify(moves),
  };
  const props = (game: ContestView): GameProps => ({
    c: game,
    onDone: finish,
    onMoves,
    live: state,
    keys,
    outcome,
    locked: busy || outcome !== null,
    odds: outcome ? null : <Odds live={state} kind={game.kind} />,
  });
  return (
    <div
      className="ct-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={c?.name ?? t("loading")}
      data-testid="contest"
      onKeyDown={onKeyDown}
    >
      <div className="ct-dialog parchment" ref={panel} tabIndex={-1}>
        {!c ? (
          <p>{t("loading")}</p>
        ) : (
          <>
            <header className="ct-head">
              <h3>{c.name}</h3>
              <span className="ct-kindname">{tk(`ct.kind.${c.kind}`)}</span>
              <span className="ct-auto">
                {t("ct.auto", { pct: c.auto_pct })}
              </span>
            </header>
            <p className="ct-rule">{rule(c, live.view)}</p>
            {c.rivals.length > 0 && (
              <ul className="ct-rivals" aria-label={t("ct.rivals")}>
                {c.rivals.map((r) => (
                  <li key={r.key}>
                    <PortraitArt
                      asset={r.portrait}
                      fallback={face(r.key)}
                      size={40}
                    />
                    <span>{r.name}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="ct-body" aria-busy={busy}>
              {c.kind === "match" && <MatchGame {...props(c)} />}
              {c.kind === "poem" && <PoemGame {...props(c)} />}
              {c.kind === "rhythm" && <RhythmGame {...props(c)} />}
              {c.kind === "debate" && <DebateGame {...props(c)} />}
              {c.kind === "race" && <RaceGame {...props(c)} />}
              {c.kind === "identify" && <IdentifyGame {...props(c)} />}
            </div>
            {outcome ? (
              <Result
                o={outcome}
                bestBonus={live.view?.best_bonus ?? null}
                onClose={onClose}
              />
            ) : (
              <footer className="ct-foot">
                <Keys kind={c.kind} />
                <button
                  type="button"
                  className="ts-btn"
                  onClick={() => void autoResolve()}
                  disabled={busy}
                >
                  {t("ct.autoResolve")}
                </button>
              </footer>
            )}
          </>
        )}
      </div>
    </div>
  );
}
