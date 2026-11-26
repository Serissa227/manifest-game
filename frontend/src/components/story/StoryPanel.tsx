// 顶栏的“故事”：推荐角色的故事线走到了第几章、下一章去哪里（数据里每章的提示），“稍后再说”合上的一章从这里重新打开，
// 以及回应过的章节与奇遇（新的在上）。没有故事线、也没遇到过奇遇的对局（概览里没有 story）不显示。
import { useEffect, useRef } from "react";
import { dayDate, t } from "../../i18n";
import type { Overview, StoryJournalView } from "../../ipc/types";
import { ShellIcon } from "../shell/ShellIcon";
import { captainNameOf, fillCaptain, kindLabel, pendingKey, useStoryUi } from "./storyKit";

/** 经历里一条的种类标签：章节、旁观、相识（FIX5F：开场介绍的幕，后端给 intro）各有名字，其余照旧写“奇遇”。 */
function journalTag(kind: StoryJournalView["kind"]): string {
  if (kind === "chapter") return t("story.panel.chapterTag");
  if (kind === "side") return t("story.panel.sideTag");
  if (kind === "intro") return kindLabel(kind);
  return t("story.panel.encounterTag");
}

/** 故事面板：弹出在顶栏的“故事”按钮下面；inline 时直接排在紧凑顶栏的菜单里（点“继续这一章”顺便合上菜单）。 */
export function StoryPanel({ o, onClose, inline = false }: { o: Pick<Overview, "story" | "captain">; onClose: () => void; inline?: boolean }) {
  const dismissed = useStoryUi((s) => s.dismissed);
  const story = o.story;
  if (!story) return null;
  const line = story.line;
  const captain = captainNameOf(o);
  const waiting = story.pending && pendingKey(story.pending) === dismissed ? story.pending : null;
  const journal = [...story.journal].reverse();
  return (
    <div
      className={inline ? "sp-panel is-inline" : "sp-panel"}
      role={inline ? undefined : "dialog"}
      aria-label={t("story.panel.title")}
      data-testid="story-panel"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      {line && (
        <section className="sp-line">
          <h3>{t("story.panel.progress", { name: line.name, done: line.done, total: line.total })}</h3>
          <div className="sp-bar" role="progressbar" aria-valuemin={0} aria-valuemax={line.total} aria-valuenow={line.done}>
            <div className="sp-bar-fill" style={{ width: `${line.total > 0 ? Math.round((line.done / line.total) * 100) : 0}%` }} />
          </div>
          {line.hint ? (
            <p className="sp-hint" data-testid="story-hint">
              <strong>{t("story.panel.next")}</strong>
              {fillCaptain(line.hint, captain)}
            </p>
          ) : (
            <p className="sp-hint">{t("story.panel.done")}</p>
          )}
        </section>
      )}
      {waiting && (
        <button
          type="button"
          className="btn primary sp-open"
          data-testid="story-reopen"
          onClick={() => {
            useStoryUi.getState().reopen();
            if (inline) onClose();
          }}
        >
          {waiting.kind === "chapter" ? t("story.panel.open") : waiting.title}
        </button>
      )}
      <section className="sp-journal">
        <h4>{t("story.panel.journal")}</h4>
        {journal.length === 0 ? (
          <p className="sp-empty">{t("story.panel.empty")}</p>
        ) : (
          <ol>
            {journal.map((e, i) => (
              <li key={i} className={`sp-entry is-${e.kind}`}>
                <span className="sp-day">{dayDate(e.day)}</span>
                <span className="sp-tag">{journalTag(e.kind)}</span>
                <strong className="sp-title">{e.title}</strong>
                <span className="sp-choice">{fillCaptain(e.choice, captain)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

/** 顶栏的“故事”按钮：故事线的进度（没有故事线时只写“故事”）；有合上的事件在等时带一个小红点。 */
export function StoryButton({ o }: { o: Pick<Overview, "story" | "captain"> }) {
  const open = useStoryUi((s) => s.panel);
  const dismissed = useStoryUi((s) => s.dismissed);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) useStoryUi.getState().setPanel(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);
  const story = o.story;
  if (!story) return null;
  const line = story.line;
  const waiting = !!story.pending && pendingKey(story.pending) === dismissed;
  const label = line ? `${t("story.hud")} ${line.done}/${line.total}` : t("story.hud");
  const title = waiting ? t("story.hudPending") : line ? t("story.hudTitle", { name: line.name, done: line.done, total: line.total }) : t("story.hud");
  return (
    <div className="sp-root" ref={root}>
      <button
        type="button"
        className={waiting ? "hud-story has-alert" : "hud-story"}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={title}
        data-testid="story-button"
        onClick={() => useStoryUi.getState().setPanel(!open)}
      >
        <ShellIcon name="quest" scale={1} />
        <span className="hud-story-label">{label}</span>
      </button>
      {open && <StoryPanel o={o} onClose={() => useStoryUi.getState().setPanel(false)} />}
    </div>
  );
}
