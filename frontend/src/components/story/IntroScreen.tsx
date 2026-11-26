// 第十轮 U07F：养成开场的“人物介绍”整屏。
// - 场景图铺满做底（压暗、略虚化，免得水彩立绘像贴在像素画上）；有人物的幕把立绘放在一侧（约八成高、贴底边、按 box 对中），
//   另一侧是名牌（名字大、身份小）与正文；没有人物的幕不放立绘，场景亮一些，正文居中靠下。
// - 一幕一次点击：“继续”、回车、空格、点正文都算；有真选项的幕显示选项，选了以后接着显示那句回话，再点一次结束。
// - 上方一排小点是第几幕；右上角“跳过介绍”把只有“继续”的幕依次答掉（效果照常生效），停在有真选项的那一幕。
// - 回应期间与回话显示时，后端已经没有这一幕了，画面照 useIntroUi.hold 留着这一幕，不露出底下的周初。
import { useEffect, useRef, type CSSProperties, type MouseEvent } from "react";
import { t } from "../../i18n";
import { tz } from "../../i18n/zhOnly";
import type { StoryEventView } from "../../ipc/types";
import { useGame } from "../../store/game";
import { publicImage } from "../../art/imageUrl";
import { figureSrc } from "../../art/portraitCast";
import { FIGURE_SIZE } from "../../art/portraitAssets";
import { sceneArtPath } from "../upbringing/ubKit";
import { fillCaptain } from "./storyKit";
import { usePersonAges } from "./personAges";
import {
  INTRO_TRACKS,
  introAge,
  introFigure,
  introParts,
  introPosition,
  isIntroEvent,
  splitNameplate,
  useIntroUi,
  type IntroReply,
} from "./introKit";

/** 回应这一幕：先把画面留在这一幕上，回来以后看是接着下一幕、显示回话，还是放完了。 */
async function answerIntro(p: StoryEventView, choice: number): Promise<void> {
  if (useIntroUi.getState().hold) return;
  const real = p.choices.length > 1;
  useIntroUi.setState({ hold: { p, reply: null } });
  const r = await useGame.getState().submit({ StoryAnswer: { owner: "player", choice } });
  const story = useGame.getState().overview?.story;
  if (!r) {
    // 被拒或出错：这一幕还在等着，照常再显示
    useIntroUi.setState({ hold: null, skipping: false });
    return;
  }
  if (story?.pending && isIntroEvent(story.pending)) {
    useIntroUi.setState({ hold: null });
    return;
  }
  const last = story?.last;
  if (real && last && last.key === p.key && last.reply) {
    useIntroUi.setState({ hold: { p, reply: { chose: last.choice, text: last.reply } }, skipping: false });
    return;
  }
  useIntroUi.setState({ hold: null, skipping: false });
}

/** 预取一组介绍的场景与立绘（幕与幕之间不出空画面）。 */
function usePreload(track: string, month: number | undefined, year: number | undefined, ages: Readonly<Record<string, number>>) {
  useEffect(() => {
    const beats = INTRO_TRACKS[track];
    if (!beats || typeof Image === "undefined") return;
    for (const b of beats) {
      const scene = sceneArtPath(b.art, "large", month);
      const fig = b.cast ? figureSrc(b.cast, introAge(b.cast, year), "full") : null;
      for (const src of [scene ? publicImage(scene) : null, fig]) {
        if (!src) continue;
        const im = new Image();
        im.decoding = "async";
        im.src = src;
      }
    }
  }, [track, month, year, ages]);
}

/** 一排小点：第几幕 / 共几幕。 */
function Dots({ index, total, done }: { index: number; total: number; done: boolean }) {
  return (
    <ol className="ix-dots" aria-label={tz("intro.progress", { n: index + 1, total })} data-testid="intro-dots">
      {Array.from({ length: total }, (_, i) => (
        <li key={i} className={i < index || done ? "is-past" : i === index ? "is-now" : ""} aria-hidden="true" />
      ))}
    </ol>
  );
}

export function IntroScreen({
  p,
  reply,
  captain,
  month,
  year,
}: {
  p: StoryEventView;
  reply: IntroReply | null;
  captain: string;
  month: number | undefined;
  year: number | undefined;
}) {
  const hold = useIntroUi((s) => s.hold);
  const skipping = useIntroUi((s) => s.skipping);
  const busy = !!hold && !hold.reply;
  const { track } = introParts(p);
  // FIX5F：人物视图给的年纪（长辈也按年纪取立绘）；回来以后重渲染、重新预取
  const ages = usePersonAges(year, p.figure?.key ?? p.cast?.[0]?.person);
  usePreload(track, month, year, ages);
  // 离开（介绍放完、回到主菜单）时清掉自己的状态
  useEffect(
    () => () => {
      useIntroUi.setState({ hold: null, skipping: false });
    },
    [],
  );

  const only = p.choices.length <= 1;
  const real = !only;
  const pos = introPosition(p);
  const fig = introFigure(p, year);
  const figSrc = fig ? figureSrc(fig.key, introAge(fig.key, year), "full") : null;
  const scene = p.art ? sceneArtPath(p.art, "large", month) : null;
  const plate = splitNameplate(p.title);
  const night = p.night === true;

  // 跳过：只有“继续”的幕依次答掉；碰到有真选项的幕停下
  useEffect(() => {
    if (!skipping || busy || reply) return;
    if (only && p.choices[0] && !p.choices[0].blocked) void answerIntro(p, 0);
    else useIntroUi.setState({ skipping: false });
  }, [skipping, busy, reply, only, p]);

  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    primary.current?.focus({ preventScroll: true });
  }, [p.key, reply]);

  const advance = () => {
    if (reply) {
      useIntroUi.setState({ hold: null });
      return;
    }
    if (busy || skipping || !only) return;
    void answerIntro(p, 0);
  };
  const advanceRef = useRef(advance);
  advanceRef.current = advance;
  // 回车、空格：焦点不在按钮上时也算“继续”（捕获阶段先拿到，免得底下的全局快捷键把空格当成暂停）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const isEnter = e.key === "Enter";
      const isSpace = e.key === " " || e.code === "Space";
      if (!isEnter && !isSpace) return;
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest("button, input, textarea, select, a[href]")) return;
      e.preventDefault();
      e.stopPropagation();
      advanceRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const onText = (e: MouseEvent) => {
    if ((e.target as Element).closest("button")) return;
    advance();
  };

  const box = fig?.box;
  const figStyle = box
    ? ({
        "--fig-cx": ((box[0] + box[2]) / 2 / FIGURE_SIZE[0]).toFixed(4),
      } as CSSProperties)
    : undefined;
  const screenClass = ["ix-screen", fig ? "has-figure" : "no-figure", night ? "is-night" : "", skipping ? "is-skipping" : "", reply ? "is-reply" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={screenClass}
      role="dialog"
      aria-modal="true"
      aria-label={tz("intro.label")}
      data-testid="intro-screen"
      data-track={track}
      data-chapter={introParts(p).chapter}
      data-art={p.art}
    >
      <div className="ix-bg" aria-hidden="true">
        {scene && <img key={scene} src={publicImage(scene)} alt="" draggable={false} />}
        {/* 窄屏、没有人物的幕：铺满时竖屏只裁得到中间一条，另按宽度放一张整图，认得出是哪里 */}
        {scene && !fig && <img key={`${scene}:fit`} className="ix-bg-fit" src={publicImage(scene)} alt="" draggable={false} />}
      </div>
      <div className="ix-shade" aria-hidden="true" />
      <header className="ix-top">
        {pos ? <Dots index={pos.index} total={pos.total} done={!!reply} /> : <span />}
        {!real && !reply && (
          <button
            type="button"
            className="ix-skip"
            data-testid="intro-skip"
            disabled={busy || skipping}
            onClick={() => useIntroUi.setState({ skipping: true })}
          >
            {skipping ? tz("intro.skipping") : tz("intro.skip")}
          </button>
        )}
      </header>
      <div className="ix-stage">
        {fig && figSrc && (
          <img
            key={fig.id}
            className="ix-figure"
            src={figSrc}
            alt={p.figure?.name ?? p.cast?.[0]?.name ?? plate.name}
            style={figStyle}
            draggable={false}
            data-testid="intro-figure"
            data-figure={fig.id}
          />
        )}
      </div>
      <section className="ix-panel" onClick={onText} data-testid="intro-panel">
        <div className="ix-panel-in" key={`${p.key}${reply ? ":reply" : ""}`}>
          <h2 className="ix-plate">
            <span className="ix-name">{plate.name}</span>
            {plate.role && <span className="ix-role">{plate.role}</span>}
          </h2>
          {reply ? (
            <>
              {reply.chose && <p className="ix-chose">{fillCaptain(reply.chose, captain)}</p>}
              <p className="ix-text" data-testid="intro-reply">
                {fillCaptain(reply.text, captain)}
              </p>
            </>
          ) : (
            <p className="ix-text" data-testid="intro-text">
              {fillCaptain(p.text, captain)}
            </p>
          )}
          {reply || only ? (
            <div className="ix-actions">
              <button
                ref={primary}
                type="button"
                className="ix-go"
                data-testid="intro-continue"
                data-hotkey="primary"
                disabled={busy || skipping}
                onClick={advance}
              >
                {t("story.continue")}
              </button>
            </div>
          ) : (
            <div className="ix-choices" role="group" aria-label={plate.name}>
              {p.choices.map((c, i) => (
                <button
                  key={c.key ?? i}
                  ref={i === p.choices.findIndex((x) => !x.blocked) ? primary : undefined}
                  type="button"
                  className="ix-choice"
                  data-testid={`intro-choice-${i}`}
                  disabled={busy || !!c.blocked}
                  onClick={() => void answerIntro(p, i)}
                >
                  {fillCaptain(c.text, captain)}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
