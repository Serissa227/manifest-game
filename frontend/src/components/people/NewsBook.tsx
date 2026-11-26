// 配角之间的线（docs/UI-CONTRACT.md I5b，TERRA16-PLUS §8）：见闻簿，以及人物详情里的“人际”与“近况”。
// - 见闻是主角知道的那部分：亲眼看到、听说或信里写的（小图标区分），最近的在前；写着日子、地点与哪条线，
//   涉及的人物画成小圆头像（认识的人点了看那位的详情）。没读过的带一个小红点。
// - 打开见闻簿时，把这一次看到的没读过的条目提交一次 MarkNewsRead（后台的事：失败时不弹错误，下次打开再试）；
//   这一次打开期间它们仍带着小红点，让玩家看得出哪些是新的。
// - “人际”：这位与别人的关系——对方的头像、名字、关系名与自何时；GL / BL / BG / GB 只是关系名旁一个很小的色点，不写成标签。
// - 旧后端：gossip 统一拒绝时人物窗口里不出现这一页（PeoplePanel 判断）；详情里没有 ties / news 时这两节不出现。
import { useEffect, useRef, useState } from "react";
import { useView } from "../../hooks/useView";
import { t, tk } from "../../i18n";
import { api } from "../../ipc/api";
import type { NewsItem, PersonTie, WorldDate } from "../../ipc/types";
import { useGame } from "../../store/game";
import { PortraitArt } from "../portrait/PortraitArt";
import { ShellIcon } from "../shell/ShellIcon";
import { NEWS_ICON, peopleIndex, personFace, sortNews, type PeopleIndex } from "./peopleKit";
import { EmptyState, Loading } from "../feedback";

/** 近况最多列几条（契约：至多 5 条）。 */
const RECENT_MAX = 5;

function dateOf(d: WorldDate): string {
  return t("ub.dateYmd", { y: d[0], m: d[1], d: d[2] });
}

/** 把这些见闻标为已读。后台的事：成功时换上新的概览（未读数随之更新），失败时不打扰。 */
async function markNewsRead(ids: string[]): Promise<void> {
  try {
    const r = await api.submit({ MarkNewsRead: { owner: "player", ids } });
    const g = useGame.getState();
    if (r?.overview) g.setOverview(r.overview);
    g.refreshViews();
  } catch {
    // 后端还不认这个命令或拒绝了：下次打开见闻簿时再试
  }
}

/** 一张小圆头像：认识的人可以点（看那位的详情），不认识的只画占位脸。 */
function MiniFace({ person, index, size, onPick }: { person: string; index: PeopleIndex; size: number; onPick?: (key: string) => void }) {
  const who = index.get(person);
  const face = <PortraitArt {...personFace(person, who?.portrait ?? null)} size={size} variant="face" className="pp-mini" />;
  if (!who || !onPick) {
    return (
      <span className="pp-mini-wrap" title={who?.name}>
        {face}
      </span>
    );
  }
  return (
    <button type="button" className="pp-mini-wrap" title={who.name} aria-label={t("pp.open", { name: who.name })} onClick={() => onPick(person)} data-testid={`news-face-${person}`}>
      {face}
    </button>
  );
}

/** 一条见闻：种类的小图标、没读过的小点、日子、地点、哪条线、一段话、涉及的人物。 */
export function NewsLine({ item, index, unread, onPick }: { item: NewsItem; index: PeopleIndex; unread: boolean; onPick?: (key: string) => void }) {
  const kind = tk(`pp.news.kind.${item.kind}`);
  const persons = item.persons ?? [];
  return (
    <li className={unread ? "pp-news is-unread" : "pp-news"} data-kind={item.kind} data-testid={`news-${item.id}`}>
      <span className="pp-news-kind" role="img" aria-label={kind} title={kind}>
        <ShellIcon name={NEWS_ICON[item.kind] ?? "intel"} scale={2} />
      </span>
      <div className="pp-news-body">
        <p className="pp-news-meta">
          {unread && <span className="pp-news-dot" role="img" aria-label={t("pp.news.unread")} />}
          <span className="pp-news-date">{dateOf(item.day)}</span>
          {item.place && <span className="pp-news-place">{item.place}</span>}
          {item.track_name && <span className="pp-news-track">{item.track_name}</span>}
        </p>
        <p className="pp-news-text">{item.text}</p>
        {persons.length > 0 && (
          <span className="pp-news-faces" role="group" aria-label={t("pp.news.persons")}>
            {persons.map((k) => (
              <MiniFace key={k} person={k} index={index} size={26} onPick={onPick} />
            ))}
          </span>
        )}
      </div>
    </li>
  );
}

/** 详情里的“人际”：这位与别人的关系（点一位看那位的详情）。 */
export function TiesSection({ ties, onPick }: { ties: PersonTie[] | undefined; onPick: (key: string) => void }) {
  if (!ties || ties.length === 0) return null;
  return (
    <section className="pp-ties" aria-label={t("pp.ties")} data-testid="person-ties">
      <h5>{t("pp.ties")}</h5>
      <ul>
        {ties.map((x) => (
          <li key={`${x.person}:${x.kind}`}>
            <button type="button" className="pp-tie" title={t("pp.open", { name: x.name })} onClick={() => onPick(x.person)} data-testid={`tie-${x.person}`}>
              <PortraitArt {...personFace(x.person, x.portrait)} size={36} variant="face" className="pp-mini" />
              <span className="pp-tie-body">
                <span className="pp-tie-name">{x.name}</span>
                <span className="pp-tie-label" data-kind={x.kind}>
                  {x.tags && x.tags.length > 0 && <i className="pp-tie-dot" data-tag={x.tags[0]} aria-hidden="true" />}
                  {x.label}
                </span>
                {x.since && <small className="pp-tie-since">{t("pp.tieSince", { date: dateOf(x.since) })}</small>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 详情里的“近况”：这位最近的几条见闻。 */
export function RecentSection({ news, index, onPick }: { news: NewsItem[] | undefined; index: PeopleIndex; onPick: (key: string) => void }) {
  if (!news || news.length === 0) return null;
  return (
    <section className="pp-recent" aria-label={t("pp.recent")} data-testid="person-news">
      <h5>{t("pp.recent")}</h5>
      <ul className="pp-news-list is-compact">
        {sortNews(news)
          .slice(0, RECENT_MAX)
          .map((x) => (
            <NewsLine key={x.id} item={x} index={index} unread={!x.read} onPick={onPick} />
          ))}
      </ul>
    </section>
  );
}

/**
 * 见闻簿（人物窗口的一页）。at 为筛选的港口（不筛选时为 undefined）；取不到（旧后端拒绝）时当作没有见闻。
 * 点涉及的人物的头像看那位的详情。新界面里只看一处、那里没有见闻时，“下一步”看全部的见闻（onShowAll：取消筛选）。
 */
export function NewsBook({ at, onPick, onShowAll }: { at: number | undefined; onPick: (key: string) => void; onShowAll?: () => void }) {
  const view = useView(`gossip:${at ?? ""}`, () => api.gossip(at === undefined ? {} : { loc: at }), { quiet: true });
  // 人物 key → 名字与头像：认识的人（不按港口筛选的那一份，与“见过的人”共用）
  const persons = useView("persons:", () => api.persons(undefined), { quiet: true });
  const data = view.status === "error" ? null : view.data;
  const items = view.status === "error" ? [] : data ? sortNews(data.items) : null;
  const index = peopleIndex(persons.data?.persons ?? []);

  // 这一次打开期间看到的没读过的条目：各提交一次 MarkNewsRead；它们在这一次打开期间仍带着小点
  const sent = useRef(new Set<string>());
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    const ids = (data?.items ?? []).filter((x) => !x.read && !sent.current.has(x.id)).map((x) => x.id);
    if (ids.length === 0) return;
    for (const id of ids) sent.current.add(id);
    setFresh((prev) => new Set([...prev, ...ids]));
    void markNewsRead(ids);
  }, [data]);

  return (
    <section className="pp-newsbook" aria-label={t("pp.news.list")} data-testid="news-book">
      {items === null ? (
        <Loading v1={<p className="ts-empty">{t("loading")}</p>} />
      ) : items.length === 0 ? (
        <EmptyState
          text={at !== undefined ? t("pp.news.emptyHere") : t("pp.news.empty")}
          hint={at !== undefined ? t("v2.fleet.pp.newsHereHint") : undefined}
          action={at !== undefined && onShowAll ? { label: t("v2.fleet.pp.newsAll"), onClick: onShowAll } : undefined}
          v1={<p className="ts-empty">{at !== undefined ? t("pp.news.emptyHere") : t("pp.news.empty")}</p>}
        />
      ) : (
        <ul className="pp-news-list">
          {items.map((x) => (
            <NewsLine key={x.id} item={x} index={index} unread={!x.read || fresh.has(x.id)} onPick={onPick} />
          ))}
        </ul>
      )}
    </section>
  );
}
