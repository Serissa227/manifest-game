// 拍卖会（TERRA16-PLUS §4，docs/UI-CONTRACT.md I9）：港口窗口里的一页，或从日历的预告打开。
// 预展期可以看拍品、请人鉴定（真伪由鉴定与读过的书决定）；开拍以后每件拍品轮流竞价：写着当前价、领先的人、下一口至少多少、
// 场上还在举牌的出价人（有名有姓，各有脾气），出价或放弃；输掉的拍品写明后路。竞价的经过记在右边的记录里。
// 出价人的回应由后端按数据与种子确定地算出（同样的出价得到同样的结果）。
// 新界面（v2）：近期没有拍卖会时是空状态，补一句预告写在哪里；v1 不变。
import { useCallback, useEffect, useState } from "react";
import { EmptyState, Loading } from "../feedback";
import { useView } from "../../hooks/useView";
import { money, t, tk } from "../../i18n";
import { api } from "../../ipc/api";
import type { AuctionLot, AuctionSummary, AuctionView } from "../../ipc/types";
import { useGame } from "../../store/game";
import { PortraitArt } from "../portrait/PortraitArt";
import { captainPortrait } from "../start/captain";
import { ItemDetail, ItemSlotIcon } from "./ItemParts";
import { defaultBid, normalizeBid } from "./itemKit";

function face(key: string) {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return () => captainPortrait(h % 24);
}

function LotCard({ a, lot, busy, onBid, onPass, onInspect, attrName }: { a: AuctionView; lot: AuctionLot; busy: boolean; onBid: (amount: number) => void; onPass: () => void; onInspect: () => void; attrName: (k: string) => string }) {
  const [amount, setAmount] = useState<number>(() => defaultBid(lot));
  useEffect(() => setAmount(defaultBid(lot)), [lot]);
  const bid = normalizeBid(amount, lot, a.cash);
  const live = a.status === "open" && lot.status === "bidding" && a.here;
  return (
    <li className={`au-lot au-lot--${lot.status}`} data-testid={`lot-${lot.key}`}>
      <div className="au-lot-head">
        <ItemSlotIcon item={lot.line} qty={lot.qty} />
        <div>
          <p className="au-lot-name">{lot.line.name}</p>
          <p className="au-lot-price">
            {lot.current !== null ? t("au.current", { v: money(lot.current) }) : t("au.reserve", { v: money(lot.reserve) })}
            {lot.leader && <span className={lot.leader.you ? "is-good" : undefined}>{lot.leader.you ? t("au.youLead") : t("au.leads", { name: lot.leader.name })}</span>}
          </p>
        </div>
        <span className="au-lot-status">{tk(`au.status.${lot.status}`)}</span>
      </div>
      {lot.bidders.length > 0 && (
        <ul className="au-bidders" aria-label={t("au.bidders")}>
          {lot.bidders.map((b) => (
            <li key={b.key} className={b.active ? "au-bidder" : "au-bidder is-out"}>
              <PortraitArt asset={b.portrait} fallback={face(b.key)} size={36} className="au-bidder-face" />
              <span>{b.name}</span>
              {b.mood && <small>{b.mood}</small>}
            </li>
          ))}
        </ul>
      )}
      <p className="au-inspect">
        {lot.inspection.done ? (
          <span className={lot.inspection.verdict === "fake" ? "is-cost" : lot.inspection.verdict === "genuine" ? "is-good" : undefined}>
            {tk(`au.verdict.${lot.inspection.verdict ?? "unsure"}`)}
            {lot.inspection.note && ` · ${lot.inspection.note}`}
          </span>
        ) : (
          <button type="button" className="ts-btn ts-btn-small" disabled={busy || !lot.inspection.can_inspect || !a.here} title={lot.inspection.blocked_reason} onClick={onInspect}>
            {t("au.inspect")}
          </button>
        )}
      </p>
      {live && (
        <div className="au-bid">
          <label>
            <span>{t("au.yourBid")}</span>
            <input type="number" inputMode="numeric" min={lot.next_min} step={lot.increment} value={amount} onChange={(e) => setAmount(Number(e.target.value))} aria-label={t("au.yourBid")} />
          </label>
          <button type="button" className="ts-btn ts-btn-go au-bid-btn" disabled={busy || bid === null || !lot.enabled} onClick={() => bid !== null && onBid(bid)}>
            {bid === null ? t("au.noCash") : t("au.bid", { v: money(bid) })}
          </button>
          <button type="button" className="ts-btn ts-btn-small" disabled={busy} onClick={onPass}>
            {t("au.pass")}
          </button>
          <small className="au-min">{t("au.min", { v: money(lot.next_min), step: money(lot.increment) })}</small>
        </div>
      )}
      {lot.winner && (
        <p className={lot.winner.you ? "au-won is-good" : "au-won"}>
          {lot.winner.you ? t("au.youWon", { v: money(lot.winner.price) }) : t("au.wonBy", { name: lot.winner.name, v: money(lot.winner.price) })}
          {!lot.winner.you && lot.after_loss && <span className="au-after">{lot.after_loss}</span>}
        </p>
      )}
      {!lot.enabled && lot.blocked_reason && <p className="it-why">{lot.blocked_reason}</p>}
      <details className="au-more">
        <summary>{t("au.details")}</summary>
        <ItemDetail item={lot.line} attrName={attrName} />
      </details>
    </li>
  );
}

const NO_AUCTIONS: AuctionSummary[] = [];

export default function AuctionPanel({ loc }: { loc?: number }) {
  const statics = useGame((s) => s.statics);
  const submit = useGame((s) => s.submit);
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 拍卖会列表（取不到时当作没有）；第一次取到时默认选正在进行或预展中的一场
  const auctions = useView(`auctions:${loc ?? ""}`, () => api.auctions(loc), { quiet: true });
  const list = auctions.status === "error" ? NO_AUCTIONS : (auctions.data?.auctions ?? null);
  useEffect(() => {
    if (list) setKey((k) => k ?? list.find((x) => x.status === "open" || x.status === "preview")?.key ?? list[0]?.key ?? null);
  }, [list]);
  const view = useView(key ? `auction:${key}` : null, () => api.auction(key ?? ""), { quiet: true }).data;

  const attrName = useCallback((k: string) => statics?.captain?.attributes.find((a) => a.key === k)?.name ?? k, [statics]);
  if (list === null) return <Loading v1={<p className="ts-empty">{t("loading")}</p>} />;
  if (list.length === 0) return <EmptyState text={t("au.none")} hint={t("v2.port.auNoneHint")} v1={<p className="ts-empty">{t("au.none")}</p>} />;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="au-panel" data-testid="auction">
      <ul className="au-list" aria-label={t("au.list")}>
        {list.map((x) => (
          <li key={x.key}>
            <button type="button" className={x.key === key ? "au-item is-on" : "au-item"} aria-pressed={x.key === key} onClick={() => setKey(x.key)}>
              <span className="au-item-name">{x.name}</span>
              <span className="au-item-when">
                {tk(`au.phase.${x.status}`)} · {x.days_left > 0 ? t("ub.daysLeft", { n: x.days_left }) : t("ub.today")}
              </span>
              {x.headline && <span className="au-item-headline">{x.headline}</span>}
            </button>
          </li>
        ))}
      </ul>
      {view && (
        <section className="au-room" aria-label={view.name}>
          {!view.here && <p className="it-lead">{t("au.notHere", { port: view.loc_name })}</p>}
          <ul className="au-lots">
            {view.lots.map((lot) => (
              <LotCard
                key={lot.key}
                a={view}
                lot={lot}
                busy={busy}
                attrName={attrName}
                onBid={(amount) => void run(() => submit({ BidAuction: { owner: "player", auction: view.key, lot: lot.key, amount } }))}
                onPass={() => void run(() => submit({ PassAuction: { owner: "player", auction: view.key, lot: lot.key } }))}
                onInspect={() => void run(() => submit({ InspectLot: { owner: "player", auction: view.key, lot: lot.key } }))}
              />
            ))}
          </ul>
          {view.log.length > 0 && (
            <ol className="au-log" aria-label={t("au.log")}>
              {view.log.slice(-12).map((l, i) => (
                <li key={i}>{l.text}</li>
              ))}
            </ol>
          )}
        </section>
      )}
    </div>
  );
}
