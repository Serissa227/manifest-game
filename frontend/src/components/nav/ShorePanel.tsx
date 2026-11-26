// H05 岸与锚地的小面板（航行视图里“岸上”按钮打开）：此地能做的差事与预计所得（做不了的灰掉并写原因），
// 勾选后一次派出；差事期间显示进度与“召回”。下网开关、避风提示也在这里。读数与命令在 shoreKit.ts。
import { useState } from "react";
import { tz } from "../../i18n/zhOnly";
import type { NavView, ShoreTask } from "../../ipc/types";
import { useGame } from "../../store/game";
import { biomeNames, blockText, gainText, sendNets, sendRecall, sendShore, taskText } from "./shoreKit";

export function ShoreMenu({ nav, onClose, id, onSent }: { nav: NavView; onClose: () => void; id?: string; onSent?: () => void }) {
  const shore = nav.shore;
  const [picked, setPicked] = useState<ShoreTask[]>([]);
  if (!shore) return null;
  const done = (ok: boolean, text: string) => {
    if (!ok) return;
    useGame.getState().notify(text);
    onSent?.();
  };
  const chosen = shore.options.filter((o) => picked.includes(o.task) && o.block === null);
  const hands = chosen.reduce((s, o) => s + o.hands, 0);
  const days = chosen.reduce((m, o) => Math.max(m, o.days), 0);
  const names = biomeNames(shore.biomes);
  return (
    <div className="nav-pop shore-pop" id={id} role="dialog" aria-label={tz("shore.title")} data-testid="shore-menu">
      <h4>{tz("shore.title")}</h4>
      {shore.camp ? (
        <>
          <p className="nav-note" data-testid="shore-camp">
            {tz("shore.camp", { d: shore.camp.elapsed, n: shore.camp.days })}
          </p>
          <ul className="shore-jobs">
            {shore.camp.jobs.map((j) => (
              <li key={j.task}>{tz("shore.campJob", { task: taskText(j.task), hands: j.hands, days: j.days })}</li>
            ))}
          </ul>
          <button
            type="button"
            className="nav-pop-item"
            data-testid="shore-recall"
            title={tz("shore.recallHint")}
            onClick={() => {
              onClose();
              void sendRecall(nav.fleet).then((ok) => done(ok, tz("shore.recalled")));
            }}
          >
            {tz("shore.recall")}
          </button>
        </>
      ) : shore.coast ? (
        <>
          <p className="nav-note">{tz("shore.hint")}</p>
          <p className="shore-site" data-testid="shore-site">
            {names ? tz("shore.site", { biomes: names }) : tz("shore.siteNone")}
            {shore.river && <span className="shore-tag">{tz("shore.river")}</span>}
          </p>
          <ul className="shore-tasks">
            {shore.options.map((o) => {
              const on = picked.includes(o.task);
              const why = o.block ? blockText(o.block) : null;
              return (
                <li key={o.task} className={why ? "shore-task off" : "shore-task"} data-testid={`shore-task-${o.task}`}>
                  <label>
                    <input
                      type="checkbox"
                      checked={on && !why}
                      disabled={!!why}
                      onChange={() => setPicked(on ? picked.filter((t) => t !== o.task) : [...picked, o.task])}
                    />
                    <span className="shore-task-name">{taskText(o.task)}</span>
                    <small>{tz("shore.cost", { hands: o.hands, days: o.days })}</small>
                  </label>
                  <small className="shore-task-gain">{why ?? gainText(o.task, o.gain)}</small>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            className="nav-pop-item primary"
            data-testid="shore-send"
            disabled={chosen.length === 0}
            onClick={() => {
              const tasks = chosen.map((o) => o.task);
              onClose();
              void sendShore(nav.fleet, tasks).then((ok) => done(ok, tz("shore.sent", { days })));
            }}
          >
            {chosen.length > 0 ? tz("shore.send", { hands, days }) : tz("shore.sendNone")}
          </button>
        </>
      ) : (
        <p className="nav-note">{tz("shore.farHint")}</p>
      )}
      {shore.coast && (
        <p className="nav-note shore-lee" data-testid="shore-lee">
          {shore.lee ? tz("shore.lee", { pct: shore.shelter_keep }) : tz("shore.leeOff")}
        </p>
      )}
      <div className="shore-nets">
        <button
          type="button"
          className="nav-pop-item"
          aria-pressed={shore.nets}
          data-testid="shore-nets"
          onClick={() => void sendNets(nav.fleet, !shore.nets).then((ok) => (ok ? onSent?.() : undefined))}
        >
          {shore.nets ? tz("shore.netsOn") : tz("shore.nets")}
        </button>
        <small>{shore.nets && !shore.nets_working ? tz("shore.netsIdle") : tz("shore.netsHint", { pct: shore.fish })}</small>
      </div>
      <button type="button" className="nav-pop-close" onClick={onClose}>
        {tz("shore.close")}
      </button>
    </div>
  );
}
