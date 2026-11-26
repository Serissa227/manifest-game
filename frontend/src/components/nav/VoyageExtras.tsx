// H08 航行视图上的三样小东西：航海日志（侧栏，缺省收起，原处留一个一键展开的小按钮）、甲板闲话（角上冒一句、几秒后淡掉，
// 偶尔带一个可选的小互动）、新系统第一次出现时的一句话提示（天气团、帆影、所见、喊话、航海日志；设置里可关）。
// 都写在这个文件里：航行视图只加一行 <VoyageExtras nav={nav} />。
import { useEffect, useState } from "react";
import { refreshNav } from "../../hooks/useNavigation";
import { tz } from "../../i18n/zhOnly";
import { api } from "../../ipc/api";
import type { NavView } from "../../ipc/types";
import { useGame } from "../../store/game";
import { journalText, pendingHint, type Hint } from "./voyageKit";

type Journal = NonNullable<NavView["journal"]>;

const CAT_MARK: Record<string, string> = { weather: "☁", sight: "◎", decision: "✎", loss: "!", port: "⚓" };

function JournalPanel({ journal }: { journal: Journal }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" className="nav-journal-tab" onClick={() => setOpen(true)} data-testid="nav-journal-open" title={tz("journal.title")}>
        {tz("journal.title")}
        {journal.entries.length > 0 && <small>{journal.entries.length}</small>}
      </button>
    );
  }
  const days = journal.entries.length > 0 ? journal.entries[journal.entries.length - 1].day - journal.start_day + 1 : 1;
  return (
    <aside className="nav-journal" aria-label={tz("journal.title")} data-testid="nav-journal">
      <header>
        <h4>{tz("journal.title")}</h4>
        <button type="button" className="chart-btn" onClick={() => setOpen(false)} data-testid="nav-journal-close" aria-label={tz("journal.close")}>
          ×
        </button>
      </header>
      <p className="nav-journal-meta">{journal.from ? tz("journal.from", { from: journal.from, n: days }) : tz("journal.days", { n: days })}</p>
      {journal.entries.length === 0 ? (
        <p className="nav-journal-empty">{tz("journal.empty")}</p>
      ) : (
        <ol>
          {[...journal.entries].reverse().map((e, i) => (
            <li key={i} className={`nav-journal-${e.cat}`}>
              <span className="mark" aria-hidden="true">
                {CAT_MARK[e.cat] ?? "·"}
              </span>
              <small>{tz("journal.day", { n: e.day - journal.start_day + 1 })}</small> {journalText(e)}
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}

/**
 * 甲板闲话：时钟走着时冒出来 9 秒后淡掉（淡掉了就不再显示同一句）；暂停着时一直留着，等你看完。
 * 有小互动时按钮一直在，直到淡掉或按下。
 */
function BanterBubble({ banter }: { banter: NonNullable<NavView["banter"]> }) {
  const [gone, setGone] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const running = useGame((s) => (s.overview?.speed ?? 0) > 0);
  useEffect(() => {
    setAnswer(null);
  }, [banter.id]);
  useEffect(() => {
    if (!running) return;
    const id = banter.id;
    const t = window.setTimeout(() => setGone(id), 9000);
    return () => window.clearTimeout(t);
  }, [banter.id, running]);
  if (gone === banter.id) return null;
  const reply = async () => {
    if (!banter.reply) return;
    const r = await useGame.getState().submit({ BanterReply: { owner: "player" } });
    if (r) setAnswer(banter.reply.answer);
    void refreshNav();
  };
  return (
    <div className={running ? "nav-banter fading" : "nav-banter"} role="status" data-testid="nav-banter">
      {banter.speaker && <b>{banter.speaker}</b>}
      <span>{answer ?? banter.text}</span>
      {banter.reply && !banter.replied && !answer && (
        <button type="button" className="chart-btn" onClick={() => void reply()} data-testid="nav-banter-reply">
          {banter.reply.label}
        </button>
      )}
    </div>
  );
}

/** 新系统第一次出现时的一句话提示（每样只出一次，记在本机；设置里可关）。 */
function seen(h: Hint): boolean {
  try {
    return localStorage.getItem(`manifest.hint.${h}`) === "1";
  } catch {
    return false;
  }
}

function markSeen(h: Hint) {
  try {
    localStorage.setItem(`manifest.hint.${h}`, "1");
  } catch {
    // 本机存储用不了：这一局里每次都会提示，不影响别的
  }
}

function HintToast({ nav }: { nav: NavView }) {
  const [enabled, setEnabled] = useState(true);
  const [, bump] = useState(0);
  useEffect(() => {
    void api.getSettings().then(
      (s) => setEnabled((s.settings as { voyage_hints?: boolean }).voyage_hints !== false),
      () => undefined,
    );
  }, []);
  const hint = enabled ? pendingHint(nav, seen) : null;
  if (!hint) return null;
  const close = () => {
    markSeen(hint);
    bump((n) => n + 1);
  };
  return (
    <div className="nav-hint" role="note" data-testid={`nav-hint-${hint}`}>
      <span>{tz(`hint.${hint}`)}</span>
      <button type="button" className="chart-btn" onClick={close}>
        {tz("hint.ok")}
      </button>
    </div>
  );
}

export default function VoyageExtras({ nav }: { nav: NavView }) {
  return (
    <>
      {nav.journal && <JournalPanel journal={nav.journal} />}
      {nav.banter && <BanterBubble banter={nav.banter} />}
      <HintToast nav={nav} />
    </>
  );
}
