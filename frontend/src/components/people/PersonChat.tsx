// 人物的自由对话（docs/UI-CONTRACT.md I10）：AI 打开、人在同一处时出现。玩家写一句（≤200 字）提交 TalkFree；
// 模型的回复随概览的 chat 推回（异步，先显示"……"）。好感、话题、请托这些结果由内核裁决，写在每句下面的小标签里。
// 新界面（v2；旧界面不变）：有一个小标题；“说”旁边是回车的小键帽；不能聊的原因就地写在输入框下面（不只在占位字里）并与输入框关联；
// 手机上输入框窄：占位字用短的“说点什么……”，字数上限写在下面“今天还能聊 n 句”那一行。
import { useId, useState } from "react";
import { useLayout } from "../../hooks/useViewport";
import { t } from "../../i18n";
import type { PersonDetail } from "../../ipc/types";
import { useGame } from "../../store/game";
import { useIsV2 } from "../../ui/uiMode";
import { InlineError, Kbd } from "../feedback";

const MAX = 200;

export function PersonChat({ person, busy, onSay }: { person: PersonDetail; busy: boolean; onSay: (text: string) => void }) {
  const chat = person.chat;
  const turns = useGame((s) => (s.overview?.chat && s.overview.chat.person === person.key ? s.overview.chat.turns : null));
  const [draft, setDraft] = useState("");
  const v2 = useIsV2();
  const phone = useLayout() === "phone";
  const whyId = useId();
  if (!chat) return null;
  const can = chat.enabled && chat.left_today > 0 && !busy;
  // 今天聊不了（AI 关着、聊完了、对方在忙）：原因（不算正在提交的那一会儿）
  const blocked = !(chat.enabled && chat.left_today > 0);
  const why = chat.blocked_reason ?? t("pp.chatOff");
  // 新界面的手机：短占位字，上限另写
  const shortHint = v2 && phone;
  const send = () => {
    const text = draft.trim().slice(0, MAX);
    if (!text || !can) return;
    onSay(text);
    setDraft("");
  };
  return (
    <section className="pp-chat" aria-label={t("pp.chat")}>
      {v2 && (
        <h5 className="pp-chat-title" aria-hidden="true">
          {t("pp.chat")}
        </h5>
      )}
      {turns && turns.length > 0 && (
        <ol className="pp-chat-turns">
          {turns.map((x) => (
            <li key={x.seq} className={`pp-chat-turn pp-chat-turn--${x.who}`} data-status={x.status}>
              <p>{x.status === "pending" ? t("pp.chatPending") : x.text}</p>
              {x.status === "fallback" && <small className="pp-chat-fallback">{t("pp.chatFallback")}</small>}
              {x.effects.length > 0 && (
                <ul className="pp-chat-effects">
                  {x.effects.map((e, i) => (
                    <li key={i} data-kind={e.kind}>
                      {e.text}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
      <form
        className="pp-chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          type="text"
          value={draft}
          maxLength={MAX}
          disabled={!can}
          // 新界面：聊不了的原因只写在下面的就地说明里，占位字照旧（输入框是灰的）；旧界面原因在占位字里
          placeholder={can || v2 ? (shortHint ? t("v2.fleet.chatPlaceholderShort") : t("pp.chatPlaceholder", { name: person.name })) : why}
          aria-label={t("pp.chat")}
          aria-describedby={v2 && blocked ? whyId : undefined}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="ts-btn ts-btn-small" disabled={!can || !draft.trim()}>
          {t("pp.chatSend")}
          {v2 && can && <Kbd k="Enter" />}
        </button>
      </form>
      {v2 && blocked && <InlineError tone="blocked" id={whyId} reason={why} />}
      {chat.enabled && (
        <small className="pp-chat-left">
          {t("pp.chatLeft", { n: chat.left_today })}
          {shortHint && <span className="pp-chat-limit">{t("v2.fleet.chatLimit", { max: MAX })}</span>}
        </small>
      )}
    </section>
  );
}
