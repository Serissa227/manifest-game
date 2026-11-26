// 剧情事件的对话框：推荐角色的故事线的一章，或所有船长都会遇到的奇遇。
// - overview.story.pending 出现（后端在它出现的那天暂停了游戏）时自动弹出：说话人的头像与名字、标题（章节带“第 n 章 · 共 m 章”
//   与故事线的名字）、叙事与 1–3 个选项。选项上写明要付的金币、要交出的货与属性检定的成功率；现金或货不够时不能选。
// - “稍后再说”合上它：章节会一直等着（顶栏的“故事”随时能再打开；手机与平板的紧凑顶栏把它收在菜单里），奇遇当天没有回应就作罢。
// - 回应后显示结果：所选的选项、回应的叙事、检定成败与实际发生的效果；走完最后一章时写明故事告一段落。
// - 有待决海战时先让它。标题、叙事与选项都来自后端数据（按当前语言）。
// - 第九批 I5b：配角之间的一幕（kind = "side"，主角在场旁观）——台上的配角头像并排（说话的那位亮着），标题上方写“旁观”；
//   没有选项时只有“继续”（提交 StoryAnswer 的第 0 项，后端当作“看完了”）。
// - 第九批 I5（故事 2.0）：标题上方写事件的种类（主线、羁绊、请托、来信……）、轨道名、地点与“之后还有 N 件”；夜里的事件画面变暗；
//   选项上另写门槛（requires，中性的小标签）、检定的名字（属性、评价或技能）与后果提示（hint，选项下面一行淡字）；
//   不能选的原因经典故事是代码（cash / cargo），故事 2.0 与怪异是写好的一句话，照写。结果里的剧情旗标不给玩家看。
//   情绪（mood）由配乐导演按 Overview.story.pending 读（audio/upbringing.ts）；插画（art）眼下没有插画位，只挂在 data-art 上。
// - 第十轮 U07F：行动制下，轨道键以 intro_ 开头的剧情（养成开场的人物介绍）不走这个对话框，改由 IntroScreen 整屏放
//   （养成视图还没取到时先不弹，免得闪一下）；行动制没开的旧界面照旧在这里显示。行动制下普通剧情的说话人有立绘时放立绘小图。
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { money, t } from "../../i18n";
import { tz } from "../../i18n/zhOnly";
import type {
  Overview,
  StaticView,
  StoryCastView,
  StoryChoiceView,
  StoryEventView,
  StoryResultView,
  StoryRollView,
  StorySpeakerView,
} from "../../ipc/types";
import { useGame } from "../../store/game";
import { useLayout } from "../../hooks/useViewport";
import { useIsV2 } from "../../ui/uiMode";
import { attributeName } from "../start/captainText";
import { captainPortrait } from "../start/captain";
import { PortraitArt } from "../portrait/PortraitArt";
import { publicImage } from "../../art/imageUrl";
import { loreVariants } from "../../art/lore";
import LoreImage from "../LoreImage";
import { SceneImg } from "../scene/SceneImg";
import { sceneFileOf } from "../scene/sceneKit";
import { sceneArtPath } from "../upbringing/ubKit";
import { WaitingNote } from "../shell/WaitingNote";
import { faceOf } from "../people/peopleKit";
import { useUbActOn } from "../tutorial/tutorialState";
import { IntroScreen } from "./IntroScreen";
import { introAge, isIntroEvent, isIntroKey, useIntroUi } from "./introKit";
import { usePersonAges } from "./personAges";
import { figureOf, figureSrc } from "../../art/portraitCast";
import { FIGURE_SIZE } from "../../art/portraitAssets";
import {
  blockedText,
  captainNameOf,
  castSpeaker,
  fillCaptain,
  kindLabel,
  outcomeTone,
  pendingKey,
  shownOutcomes,
  speakerOf,
  storyResultKey,
  useStoryUi,
} from "./storyKit";

/** 头像的显示边长（CSS 像素）。 */
const PORTRAIT = 176;
/** 旁观的一幕里台上每位的头像边长：两位时大一些，三位以上小一些。 */
const CAST_TWO = 144;
const CAST_MANY = 112;

/** 这件事件是不是旁观的一幕（台上至少有一位配角）。 */
function isSide(p: Pick<StoryEventView, "kind" | "cast">): boolean {
  return p.kind === "side" && !!p.cast && p.cast.length > 0;
}

/** 旁观的一幕：台上的配角并排，说话的那位亮着（其余的暗一些）；说话的不在台上时都不加亮。 */
function Cast({
  cast,
  speaker,
}: {
  cast: StoryCastView[];
  speaker: StorySpeakerView;
}) {
  const speaking = castSpeaker(cast, speaker);
  const size = cast.length > 2 ? CAST_MANY : CAST_TWO;
  return (
    <div
      className={speaking >= 0 ? "sd-cast has-speaker" : "sd-cast"}
      role="group"
      aria-label={t("story.cast")}
      data-testid="story-cast"
      data-count={cast.length}
    >
      {cast.map((c, i) => {
        const on = i === speaking;
        return (
          <figure
            key={c.person}
            className={on ? "sd-cast-one is-speaking" : "sd-cast-one"}
            data-person={c.person}
            data-testid={`story-cast-${c.person}`}
          >
            <PortraitArt
              asset={c.portrait}
              fallback={faceOf(c.person)}
              size={size}
              variant="full"
              label={on ? t("story.speaking", { name: c.name }) : c.name}
              className="sd-portrait sd-cast-face"
              live
            />
            <figcaption className="sd-speaker-name">{c.name}</figcaption>
          </figure>
        );
      })}
    </div>
  );
}

/** 说话人的头像与名字（旁白时不显示）。U07F：行动制下，站出来的人（figure）有立绘时放立绘的小图，没有的照旧用胸像。 */
function Speaker({
  overview,
  speaker,
  figure,
}: {
  overview: Overview;
  speaker: StoryEventView["speaker"];
  figure?: { person: string; name: string } | null;
}) {
  const who = speakerOf(speaker, overview);
  const actOn = useUbActOn((s) => s.on);
  const year = overview.world_date?.[0];
  // FIX5F：人人按人物视图给的年纪取立绘（兼定、元亲到了航海期不再是孩子的那张）；只在要取立绘时去问
  usePersonAges(actOn && figure ? year : undefined, figure?.person);
  const fig = actOn && figure ? figureOf(figure.person, introAge(figure.person, year)) : undefined;
  const figSrc = fig ? figureSrc(fig.key, introAge(fig.key, year), "small") : null;
  if (fig && figSrc) {
    const name = figure?.name || who.name;
    const cx = (fig.box[0] + fig.box[2]) / 2 / FIGURE_SIZE[0];
    return (
      <figure className="sd-speaker sd-speaker--figure" data-testid="story-figure" data-figure={fig.id}>
        <img
          className="sd-figure"
          src={figSrc}
          alt={name}
          draggable={false}
          style={{ objectPosition: `${(cx * 100).toFixed(1)}% 0` }}
        />
        {name && <figcaption className="sd-speaker-name">{name}</figcaption>}
      </figure>
    );
  }
  if (!who.asset) return null;
  return (
    <figure
      className="sd-speaker"
      data-testid="story-speaker"
      data-asset={who.asset}
    >
      <PortraitArt
        asset={who.asset}
        fallback={() => captainPortrait(who.look)}
        size={PORTRAIT}
        label={who.name}
        className="sd-portrait"
        live
      />
      {who.name && (
        <figcaption className="sd-speaker-name">{who.name}</figcaption>
      )}
    </figure>
  );
}

/** 这一章站出来的人：先看 figure（R10-FIX8：没有人物卡的人也能站出来、名牌写它的 name），再取 cast 第一位，都没有时是说话的人物。 */
function standing(p: Pick<StoryEventView, "cast" | "speaker" | "figure">): { person: string; name: string } | null {
  if (p.figure) return { person: p.figure.key, name: p.figure.name };
  const c = p.cast?.[0];
  if (c) return { person: c.person, name: c.name };
  return p.speaker.person ? { person: p.speaker.person, name: p.speaker.name } : null;
}

/** 选项上的小标签：要付的金币、要交出的货、检定（名字与成功率）、门槛（故事 2.0）与不能选的原因。 */
function ChoiceTags({
  statics,
  c,
}: {
  statics: StaticView;
  c: StoryChoiceView;
}) {
  const tags: { text: string; cls: string; title?: string }[] = [];
  if (c.cost > 0)
    tags.push({
      text: t("story.cost", { money: money(c.cost) }),
      cls: "sd-tag",
    });
  if (c.give)
    tags.push({
      text: t("story.give", {
        name: statics.goods[c.give[0]]?.name ?? "?",
        qty: c.give[1],
      }),
      cls: "sd-tag",
    });
  const gaps = c.soft_gap ?? [];
  if (c.check) {
    // 后端给检定的名字（属性、评价或技能，当前语言）；没有名字时按属性表取。
    // U02：有最终成功率 chance 时以它为准（已含原检定与软门槛）
    const attr =
      c.check.name ||
      (statics.captain
        ? attributeName(statics.captain, c.check.attr)
        : c.check.attr);
    tags.push({
      text: t("story.check", { attr, pct: c.chance ?? c.check.pct }),
      cls: "sd-tag",
    });
  } else if (c.chance !== undefined && gaps.length > 0) {
    // U02：门槛差一点也能试——掷骰，写出成功率
    tags.push({
      text: tz("story.chance", { pct: c.chance }),
      cls: "sd-tag is-chance",
    });
  }
  // U02：差的是哪项、有多少、要多少
  for (const g of gaps)
    tags.push({
      text: tz("story.gap", { label: g.label, have: g.have, need: g.need }),
      cls: "sd-tag is-gap",
    });
  // 门槛：后端只给说明、不说满足没有，一律中性的样子（不满足时 blocked 另给原因）
  for (const r of c.requires ?? [])
    tags.push({ text: r, cls: "sd-tag is-req", title: t("story.requires") });
  if (c.blocked)
    tags.push({ text: blockedText(c.blocked), cls: "sd-tag is-blocked" });
  if (tags.length === 0) return null;
  return (
    <span className="sd-choice-tags">
      {tags.map((x, i) => (
        <span key={i} className={x.cls} title={x.title}>
          {x.text}
        </span>
      ))}
    </span>
  );
}

/** 这一件之后还在排队的事件（至少一件时才写）。 */
function Queue({ n }: { n?: number }) {
  if (!n || n <= 0) return null;
  return (
    <span
      className="sd-queue"
      title={t("story.queueTitle", { n })}
      data-testid="story-queue"
    >
      {t("story.queue", { n })}
    </span>
  );
}

/**
 * 标题上方的一行：经典故事线的名字与第几章；旁观的一幕写“旁观”与那条线的名字；
 * 其余写事件的种类（奇遇、主线、羁绊、请托……），故事 2.0 再写轨道名与地点。队列里还有事件时末尾写“之后还有 N 件”。
 */
function Kicker({
  p,
}: {
  p: Pick<
    StoryEventView,
    "kind" | "chapter" | "total" | "story" | "track_name" | "place" | "queue"
  >;
}) {
  const place = p.place ? <span className="sd-place">{p.place}</span> : null;
  if (p.kind === "side") {
    const line = p.track_name || p.story;
    return (
      <p className="sd-kicker is-side">
        <span className="sd-side-badge">{t("story.side")}</span>
        {line && <span className="sd-story-name">{line}</span>}
        {p.chapter && p.total ? (
          <span>{t("story.chapterOf", { n: p.chapter, total: p.total })}</span>
        ) : null}
        {place}
        <Queue n={p.queue} />
      </p>
    );
  }
  if (p.kind === "chapter" && p.chapter && p.total) {
    return (
      <p className="sd-kicker">
        {p.story && <span className="sd-story-name">{p.story}</span>}
        <span>{t("story.chapterOf", { n: p.chapter, total: p.total })}</span>
        <Queue n={p.queue} />
      </p>
    );
  }
  const line = p.track_name || p.story;
  return (
    <p className="sd-kicker" data-testid="story-kicker">
      <span className="sd-kind">{kindLabel(p.kind)}</span>
      {line && <span className="sd-story-name">{line}</span>}
      {place}
      <Queue n={p.queue} />
    </p>
  );
}

/** 等待回应的事件：头像、标题、叙事与选项。 */
function EventView({
  statics,
  overview,
  p,
  onLater,
}: {
  statics: StaticView;
  overview: Overview;
  p: StoryEventView;
  onLater: () => void;
}) {
  const submit = useGame((s) => s.submit);
  const uid = useId();
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
  }, []);
  const captain = captainNameOf(overview);
  // 紧凑顶栏（手机与平板）没有单独的“故事”键，它收在菜单里
  const compact = useLayout() !== "desktop";
  const side = isSide(p);
  const answer = async (choice: number) => {
    setBusy(true);
    // 旁观的一幕：记下台上的人，结果对话框照旧并排画出来
    if (side && p.cast) useStoryUi.getState().rememberCast(p.key, p.cast);
    try {
      await submit({ StoryAnswer: { owner: "player", choice } });
    } finally {
      setBusy(false);
    }
  };
  const v2 = useIsV2();
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    // 新界面：↑ ↓（← →）在能选的选项之间移动焦点（到头绕回），Home / End 到第一个 / 最后一个；回车照常按焦点所在的选项
    if (
      v2 &&
      !e.altKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      [
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "Home",
        "End",
      ].includes(e.key)
    ) {
      const items = [
        ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
          ".sd-choice:not(:disabled)",
        ),
      ];
      if (items.length === 0) return;
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? items.length - 1
            : e.key === "ArrowUp" || e.key === "ArrowLeft"
              ? (at <= 0 ? items.length : at) - 1
              : (at + 1) % items.length;
      e.preventDefault();
      e.stopPropagation();
      items[next].focus();
      return;
    }
    if (e.key !== "Escape") return;
    e.stopPropagation();
    onLater();
  };
  const firstOpen = p.choices.findIndex((c) => !c.blocked);
  // 旁观的一幕没有选项：只有“继续”（没有“稍后再说”）
  const onlyContinue = side && p.choices.length === 0;
  // 夜里的事件：遮罩更暗、纸面压暗一些
  const night = p.night === true;
  const nudgeKey = useStoryUi((s) => s.nudgeKey);
  const nudgeOn = nudgeKey !== "" && nudgeKey === pendingKey(p);
  const nudge = useStoryUi((s) => (nudgeOn ? s.nudge : 0));
  const nudgeText = useStoryUi((s) => s.nudgeText);
  const sceneArt = p.art
    ? sceneArtPath(p.art, "large", overview?.world_date?.[1])
    : null;
  const modalClass = [
    "sd-modal",
    side ? "is-side" : "",
    night ? "is-night" : "",
    nudge > 0 ? (nudge % 2 ? "is-nudged" : "is-nudged-2") : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      className={night ? "sd-backdrop is-night" : "sd-backdrop"}
      data-testid="story-dialog"
      data-kind={p.kind}
      data-night={night ? "" : undefined}
      data-mood={p.mood}
      data-art={p.art}
    >
      <div
        className={modalClass}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${uid}-title`}
        aria-label={t("story.dialogLabel", { title: p.title })}
        onKeyDown={onKey}
      >
        {side && p.cast ? (
          <Cast cast={p.cast} speaker={p.speaker} />
        ) : (
          <Speaker overview={overview} speaker={p.speaker} figure={standing(p)} />
        )}
        <div className="sd-body">
          {/* 生物遭遇、传说之船、秘境等带插画 key 的事件：有这张图才显示，按当时的时辰与天气挑一版（art/lore.ts）；
              养成事件的插画是活动场景或回忆插画（按世界日历的当月挑季节版） */}
          {loreVariants(p.art).length > 0 ? (
            <LoreImage
              art={p.art}
              size="large"
              className="sd-art"
              testId="story-art"
              night={night}
            />
          ) : (
            sceneArt && (
              <SceneImg
                className="sd-art"
                src={publicImage(sceneArt)}
                file={sceneFileOf(sceneArt)}
                testId="story-art"
                lazy={false}
              />
            )
          )}
          <Kicker p={p} />
          <h2
            id={`${uid}-title`}
            className={side ? "sd-title is-side" : "sd-title"}
          >
            {p.title}
          </h2>
          <p className="sd-text" data-testid="story-text">
            {fillCaptain(p.text, captain)}
          </p>
          {onlyContinue ? (
            <div className="sd-actions">
              <button
                ref={first}
                type="button"
                className="btn primary"
                data-testid="story-continue"
                data-hotkey={v2 ? "primary" : undefined}
                disabled={busy}
                onClick={() => void answer(0)}
              >
                {t("story.continue")}
              </button>
            </div>
          ) : (
            <div className="sd-choices" role="group" aria-label={p.title}>
              {p.choices.map((c, i) => (
                <button
                  key={i}
                  ref={i === firstOpen ? first : undefined}
                  type="button"
                  className="sd-choice"
                  data-testid={`story-choice-${i}`}
                  disabled={busy || !!c.blocked}
                  onClick={() => void answer(i)}
                >
                  <span className="sd-choice-text">
                    {fillCaptain(c.text, captain)}
                  </span>
                  <ChoiceTags statics={statics} c={c} />
                  {c.hint && (
                    <span className="sd-choice-hint">
                      {fillCaptain(c.hint, captain)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          {busy && <WaitingNote className="sd-waiting" />}
          {/* U06F9：开着剧情框时别处点了被拒：在框里写为什么（晃动见 modalClass） */}
          {nudge > 0 && nudgeText && (
            <p className="sd-nudge" role="alert" data-testid="story-nudge">
              {nudgeText}
            </p>
          )}
          {!onlyContinue && (
            <div className="sd-foot">
              <button
                type="button"
                className="sd-later"
                data-testid="story-later"
                onClick={onLater}
                disabled={busy}
              >
                {t("story.later")}
              </button>
              {p.last_day ? (
                // 最后一天：不再写“会一直等你”
                <small className="sd-note sd-note-last" data-testid="story-last-day">
                  {tz("story.lastDay")}
                </small>
              ) : (
                p.kind === "chapter" && (
                  <small className="sd-note">
                    {t(compact ? "story.laterHintMenu" : "story.laterHint")}
                  </small>
                )
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 回应之后：所选的选项、回应的叙事、检定成败与实际发生的效果。 */
function ResultView({
  statics,
  overview,
  r,
  roll,
  onClose,
}: {
  statics: StaticView;
  overview: Overview;
  r: StoryResultView;
  roll: StoryRollView | null;
  onClose: () => void;
}) {
  const uid = useId();
  const v2 = useIsV2();
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
  }, []);
  const captain = captainNameOf(overview);
  // 旁观的一幕的结果：台上的人照旧并排（结果里没有 cast，用回应时记下的）
  const remembered = useStoryUi((s) => s.sideCast);
  const cast =
    r.kind === "side" &&
    remembered &&
    remembered.key === r.key &&
    remembered.cast.length > 0
      ? remembered.cast
      : null;
  // 剧情旗标这类内部状态不列出来；全是这些时写“没有带来什么变化”
  const outcomes = shownOutcomes(r.outcomes, statics);
  return (
    <div className="sd-backdrop" data-testid="story-result" data-kind={r.kind}>
      <div
        className={r.kind === "side" ? "sd-modal is-side" : "sd-modal"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${uid}-title`}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        {cast ? (
          <Cast cast={cast} speaker={r.speaker} />
        ) : (
          <Speaker
            overview={overview}
            speaker={r.speaker}
            figure={r.speaker.person ? { person: r.speaker.person, name: r.speaker.name } : null}
          />
        )}
        <div className="sd-body">
          {r.kind === "side" && <Kicker p={{ kind: "side" }} />}
          <h2
            id={`${uid}-title`}
            className={r.kind === "side" ? "sd-title is-side" : "sd-title"}
          >
            {r.title}
          </h2>
          {r.choice && (
            <p className="sd-chose">
              {t("story.youChose", { choice: fillCaptain(r.choice, captain) })}
            </p>
          )}
          {roll && (
            // U02：掷出的骰点（骰子转一下再落定；减少动态效果时不转）
            <p
              className={roll.success ? "sd-roll is-pass" : "sd-roll is-fail"}
              data-testid="story-roll"
            >
              <span className="sd-die" aria-hidden="true">
                {roll.roll}
              </span>
              {tz("story.roll", { roll: roll.roll, chance: roll.chance })}
            </p>
          )}
          {r.success !== null && (
            <p
              className={r.success ? "sd-check is-pass" : "sd-check is-fail"}
              data-testid="story-check"
            >
              {r.success ? t("story.success") : t("story.failure")}
            </p>
          )}
          {r.reply && (
            <p className="sd-text sd-reply" data-testid="story-reply">
              {fillCaptain(r.reply, captain)}
            </p>
          )}
          <ul className="sd-outcomes" data-testid="story-outcomes">
            {outcomes.length === 0 ? (
              <li className="sd-out is-same">{t("story.nothing")}</li>
            ) : (
              outcomes.map(({ o, text }, i) => (
                <li
                  key={i}
                  className={`sd-out is-${outcomeTone(o)}`}
                  data-kind={o.kind}
                >
                  {fillCaptain(text, captain)}
                </li>
              ))
            )}
          </ul>
          {r.ended && (
            <p className="sd-ended" data-testid="story-ended">
              {t("story.ended")}
            </p>
          )}
          <div className="sd-actions">
            <button
              ref={close}
              type="button"
              className="btn primary"
              data-hotkey={v2 ? "primary" : undefined}
              onClick={onClose}
            >
              {t("story.continue")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 剧情对话框（没有剧情状态的旧后端不显示）。 */
export default function StoryDialog() {
  const statics = useGame((s) => s.statics);
  const dismissed = useStoryUi((s) => s.dismissed);
  // 按字段选取（P14a）：平时只看 story 与挡在前面的海战；整份概览只在有待答的事或没看过的结果（要画对话框、算提醒）时取
  const story = useGame((s) => s.overview?.story ?? null);
  const blocked = useGame((s) => (s.overview?.pending_battles?.length ?? 0) > 0);
  const last = story?.last ?? null;
  const lastKey = storyResultKey(last);
  // 打开主界面时已有的结果视为已读；之后出现的新结果弹出，合上后记为已读
  const [seen, setSeen] = useState(lastKey);
  // U07F：行动制下，开场的人物介绍（intro_ 轨道）整屏放；回应中与回话显示时由 useIntroUi.hold 留住那一幕
  const actOn = useUbActOn((s) => s.on);
  const actKnown = useUbActOn((s) => s.known);
  const introHold = useIntroUi((s) => s.hold);
  const holding = actOn && !!introHold;
  // S02nF7：换局带进来的那份结果（存档里的上一次）不算新的
  const carried = useStoryUi((s) => s.carried);
  const unseen = !!last && lastKey !== seen && lastKey !== carried && last.choice !== null;
  const wanted = holding || !!story?.pending || unseen;
  const overview = useGame((s) => (wanted ? s.overview : null));
  // 最后一天的提醒（P11）：这件事过了今天就不再等着，后端这一天会再把时钟叫停一次——玩家早先点过“稍后再说”的，
  // 把对话框重新交到面前（只在合上之后的日子里，合上的当天不反复弹）
  const dismissedDay = useStoryUi((s) => s.dismissedDay);
  const waiting = story?.pending ?? null;
  const remind = !!overview && !!waiting && !!waiting.last_day && pendingKey(waiting) === dismissed && overview.day > dismissedDay;
  useEffect(() => {
    if (remind) useStoryUi.getState().reopen();
  }, [remind]);
  if (!statics || !overview || !story) return null;
  // 待决海战先处理
  if (blocked) return null;
  const p = story.pending;
  const mode = overview.mode;
  if (p && isIntroEvent(p) && actOn) {
    return (
      <IntroScreen
        p={p}
        reply={introHold && introHold.p.key === p.key ? introHold.reply : null}
        captain={captainNameOf(overview)}
        month={overview.world_date?.[1]}
        year={overview.world_date?.[0]}
      />
    );
  }
  if (holding && introHold) {
    return (
      <IntroScreen
        p={introHold.p}
        reply={introHold.reply}
        captain={captainNameOf(overview)}
        month={overview.world_date?.[1]}
        year={overview.world_date?.[0]}
      />
    );
  }
  // 养成视图还没取到（不知道是不是行动制）时，介绍先不弹普通的对话框，免得闪一下
  if (p && isIntroEvent(p) && mode === "upbringing" && !actKnown) return null;
  // 当天没有回应、作罢的奇遇不再弹出结果
  // 介绍的结果不另弹结果框（回话已在介绍里放过；只有“继续”的幕没有回话）
  const fresh = unseen && last && !(actOn && isIntroKey(last.key)) ? last : null;
  // S02nF7：几件事排着队时，答完一件先把它的回应与结果给玩家看，点了“继续”（合上）再出下一件——
  // 以前下一件一到就盖过去，前面那几件的结果（例如“寄往里斯本的信送到了”）都没显示。开场介绍的连续幕不走这里（fresh 已排除）
  if (fresh && p) {
    return (
      <ResultView
        key={lastKey}
        statics={statics}
        overview={overview}
        r={fresh}
        roll={story.last_roll ?? null}
        onClose={() => setSeen(lastKey)}
      />
    );
  }
  if (p && pendingKey(p) !== dismissed) {
    return (
      <EventView
        key={pendingKey(p)}
        statics={statics}
        overview={overview}
        p={p}
        onLater={() => useStoryUi.getState().dismiss(pendingKey(p), overview.day)}
      />
    );
  }
  if (fresh && !p)
    return (
      <ResultView
        key={lastKey}
        statics={statics}
        overview={overview}
        r={fresh}
        roll={story.last_roll ?? null}
        onClose={() => setSeen(lastKey)}
      />
    );
  return null;
}
