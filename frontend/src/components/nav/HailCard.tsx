// H06 喊话的小卡片：在航行视图上点一条 1.5 格以内的船（商船或海盗），罗经盘旁边出一张小卡——
// 商船：换消息、买补给（应急价）、结伴；海盗：买路、虚张声势（写着成算）、开战。结果一律走内核命令（Command::Hail）。
// 这一块写在新文件里：航行视图只加一行 <HailCard />，海图只在点击时问一句 pickHail。
import { refreshNav } from "../../hooks/useNavigation";
import { tz } from "../../i18n/zhOnly";
import type { Command, HailActionKey, NavShip, NavView } from "../../ipc/types";
import { useGame } from "../../store/game";
import { useHailStore } from "./hailStore";

/** 选项在命令里的写法。 */
function actionOf(o: NonNullable<NavShip["hail"]>["options"][number]): HailActionKey {
  return o.action;
}

function label(o: NonNullable<NavShip["hail"]>["options"][number]): string {
  const a = o.action;
  if (typeof a === "object") return tz("hail.supplies", { n: a.supplies, cost: o.cost ?? 0 });
  if (a === "bribe") return tz("hail.bribe", { cost: o.cost ?? 0 });
  if (a === "bluff") return tz("hail.bluff", { p: o.chance ?? 0 });
  if (a === "convoy") return o.active ? tz("hail.convoyOn") : tz("hail.convoy", { n: o.days ?? 0 });
  return tz(`hail.${a}`);
}

function resultText(ship: NavShip): string | null {
  const last = ship.hail?.last;
  if (!last) return null;
  const a = last.action;
  if (typeof a === "object") return tz("hail.done.supplies", { cost: last.cost });
  if (a === "bluff") return last.ok ? tz("hail.done.bluffOk") : tz("hail.done.bluffFail");
  return tz(`hail.done.${a}`, { cost: last.cost });
}

export default function HailCard({ nav }: { nav: NavView }) {
  const target = useHailStore((s) => s.target);
  const busy = useHailStore((s) => s.busy);
  const ship = target ? nav.ships?.find((s) => s.id === target && s.hail) : undefined;
  if (!ship?.hail) return null;
  const close = () => useHailStore.setState({ target: null });
  const send = async (o: NonNullable<NavShip["hail"]>["options"][number]) => {
    const cmd: Command = { Hail: { owner: "player", fleet: nav.fleet, target: ship.hail!.target, action: actionOf(o) } };
    useHailStore.setState({ busy: true });
    try {
      await useGame.getState().submit(cmd);
    } finally {
      useHailStore.setState({ busy: false });
      void refreshNav();
    }
  };
  const result = resultText(ship);
  return (
    <section className="nav-sighting nav-hail" role="dialog" aria-label={tz("hail.title")} data-testid="nav-hail-card" data-kind={ship.kind}>
      <h4>{ship.kind === "pirate" ? tz("hail.pirate") : tz("hail.merchant")}</h4>
      <p>{ship.kind === "pirate" ? tz("hail.pirateText") : tz("hail.merchantText")}</p>
      {result && <p className={ship.hail.last && !ship.hail.last.ok ? "nav-sighting-result harm" : "nav-sighting-result"}>{result}</p>}
      <div className="nav-sighting-actions">
        {ship.hail.options.map((o, i) => (
          <button key={i} type="button" className="chart-btn" disabled={busy || o.used} data-testid={`nav-hail-${i}`} onClick={() => void send(o)}>
            {label(o)}
          </button>
        ))}
        <button type="button" className="chart-btn" onClick={close} data-testid="nav-hail-close">
          {tz("hail.close")}
        </button>
      </div>
    </section>
  );
}
