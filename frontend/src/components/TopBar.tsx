// 顶部状态栏（HUD）：左侧主角头像、姓名与头衔（悬停或点头像显示船长卡，旧存档可从这里补建身世）；中间现金、净资产、总资产、本月 AI 预算、名声、殖民地数量
// （有未报告的发现时另有提示）与剧本目标进度；右侧纪年日期与季节、时间控制；最右是存档名与存档 / 读档 / 主菜单，以及音乐开关。
//
// 新界面（海图室）的桌面：顶栏也收成一行（与平板同一个 CompactHud，高约 56 px，
// 原来两三行、寰宇里折到 128 px）——头像与名字、现金、净资产、目标（百分比与细进度，全文在悬停提示里）、名声、殖民地、待报告的发现、
// 故事、日期（上）与时刻天气（下）、倍速、存档（一次点到）、菜单；总资产、AI 预算、目标全文、天气预报、换槽位与读档、主菜单、音乐收进“菜单”。
// 窗口窄时数字那一格从后面整项让位（不切半个数字）。旧界面（经典像素）的桌面顶栏照旧。
//
// 窗口自适应（hooks/useViewport.ts）：平板与手机上顶栏收成一行（CompactHud）——只留头像、现金（下面一条细细的目标进度）、
// 时刻与倍速，其余（净资产等数字、目标全文、天气预报、存读档、主菜单、音乐）收进右上角的“菜单”；
// 平板上宽度够时另外显示净资产、名声与殖民地。手机竖屏的倍速是“暂停 / 继续”一个键加当前倍速一个键（点开选档位）。
//
// 倍速只有慢 / 普通 / 快三档，键盘 1 / 2 / 3 切换（hooks/useSpeedKeys.ts）。
// 手动航行的世界里旗舰队在港时时间不走（Overview.port_hold）：倍速控件变灰，旁边一小块写“在港 · 去旅店”（悬停写明原因与出港后的一档），
// 点它打开旗舰队所在港口的旅店页。
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ATTRIBUTE_KEYS, attrKeys } from "./start/wizard";
import type { IconName } from "../art/icons";
import { captainAssetId } from "../art/portraitCast";
import { money, num, t, tk } from "../i18n";
import { tz } from "../i18n/zhOnly";
import { shortNum } from "../i18n/short";
import { locById } from "../ipc/byId";
import type { Overview, PortHoldView } from "../ipc/types";
import { flagship, useGame } from "../store/game";
import { nearestTier, nearestTierFor, tiersFor } from "../time/daylight";
import { tierKey, tierName, tierSecs } from "../time/speedText";
import { askLeave } from "./shell/leaveAsk";
import { useSpeedKeys } from "../hooks/useSpeedKeys";
import { goFacility } from "./panels/goFacility";
import HudClock from "./HudClock";
import ErrorBoundary from "./shell/ErrorBoundary";
import { ShellIcon } from "./shell/ShellIcon";
import { captainPx } from "./shell/shellArt";
import { openWindow } from "./shell/shellState";
import { loadFrom, saveTo } from "./shell/saveSlots";
import { PortraitArt } from "./portrait/PortraitArt";
import ProfileCard from "./start/CaptainCard";
import CaptainRetro from "./start/CaptainRetro";
import MusicToggle from "./shell/MusicToggle";
import Sheet from "./shell/Sheet";
import { useLayout, type Layout } from "../hooks/useViewport";
import { useIsV2 } from "../ui/uiMode";
import { StoryButton, StoryPanel } from "./story/StoryPanel";
import { pendingKey, useStoryUi } from "./story/storyKit";
import { questTitle } from "./people/questKit";

function Stat({
  icon,
  label,
  value,
  testId,
  title,
  className,
}: {
  icon: IconName;
  label: string;
  value: string;
  testId?: string;
  title?: string;
  className?: string;
}) {
  return (
    <div className={className ? `hud-stat ${className}` : "hud-stat"} title={title}>
      <span className="hud-stat-label">
        <ShellIcon name={icon} scale={1} />
        {label}
      </span>
      <strong className="hud-stat-value" data-testid={testId}>
        {value}
      </strong>
    </div>
  );
}

/** 船长卡（悬停或点头像时弹出）：主角档案；没有档案而数据有身世时，可以补建一次。 */
function ProfilePop({ o, onRetro }: { o: Overview; onRetro: () => void }) {
  const statics = useGame((s) => s.statics);
  const defs = statics?.captain ?? null;
  const p = o.profile ?? null;
  const look = o.captain?.portrait ?? 0;
  // 属性按世界的属性表排（经典世界即六项；第九批的世界按 key 对上，隐藏属性由船长卡自己略去）
  const keys = defs ? attrKeys(defs) : [...ATTRIBUTE_KEYS];
  const attrs = p ? keys.map((k) => p.attrs.find(([key]) => key === k)?.[1] ?? 0) : null;
  return (
    <div className="hud-card-pop" data-testid="hud-profile">
      <ProfileCard
        defs={defs}
        size={120}
        data={{
          name: o.captain?.name?.trim() || t("shellCaptainDefault"),
          look,
          asset: o.captain_asset,
          birthday: p ? { month: p.birthday.month, day: p.birthday.day, age: o.calendar_year - p.birthday.year } : null,
          // 档案里记的星座（旧存档的旧版星宫也照常显示名字）
          sign: p?.sign,
          answers: p?.answers,
          attrs,
          // 评价读数：档案给的（旧后端没有时按属性与权重算）
          ratings: p?.ratings ?? null,
          methods: p?.methods ?? [],
        }}
      />
      {!p && (
        <div className="cw-card hud-card-retro">
          <p className="cw-card-none">{t("cap.card.none")}</p>
          {defs && (
            <>
              <p className="ts-hint">{t("cap.hud.retroHint")}</p>
              <button type="button" className="ts-btn ts-btn-small" onClick={onRetro}>
                {t("cap.hud.retro")}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** 主角的名牌：头像、姓名、头衔（剧本名）与旗舰队的位置；头像悬停或点击显示船长卡。portrait：头像边长（紧凑顶栏里小一些）。 */
function CaptainPlate({ o, portrait = 64 }: { o: Overview; portrait?: number }) {
  const statics = useGame((s) => s.statics);
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [retro, setRetro] = useState(false);
  const captain = o.captain ?? null;
  const look = captain?.portrait ?? 0;
  const name = captain?.name?.trim() || t("shellCaptainDefault");
  const f = flagship(o);
  let where = t("shellCaptainNoFleet");
  if (f && f.docked !== null) where = t("shellCaptainDocked", { port: locById(statics, f.docked)?.name ?? "" });
  else if (f) where = t("shellCaptainAtSea", { days: f.days_at_sea });
  const open = (hover || pinned) && !retro;
  const px = portrait;
  return (
    <div
      className="hud-captain"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !pinned) return;
        // 收起船长卡就够了：告诉全局快捷键（shell/hotkeys.ts）这个 Esc 已经用掉，不再顺手关功能窗口
        e.preventDefault();
        setPinned(false);
      }}
    >
      <button
        type="button"
        className="hud-portrait-btn"
        aria-label={t("cap.hud.open")}
        aria-expanded={open}
        onClick={() => setPinned((v) => !v)}
      >
        <span className="hud-portrait">
          <ErrorBoundary resetKey={captain?.portrait ?? 0} fallback={() => null}>
            <PortraitArt asset={o.captain_asset ?? captainAssetId(look)} fallback={() => captainPx(look)} size={px} />
          </ErrorBoundary>
        </span>
      </button>
      {open && (
        <ProfilePop
          o={o}
          onRetro={() => {
            setPinned(false);
            setHover(false);
            setRetro(true);
          }}
        />
      )}
      {/* 补建身世的窗口挂到 body 上：不受顶栏的层叠与裁切影响 */}
      {retro && createPortal(<CaptainRetro onClose={() => setRetro(false)} />, document.body)}
      <div className="hud-id">
        <strong className="hud-name" data-testid="captain-name">
          {name}
        </strong>
        <span className="hud-rank">{o.scenario}</span>
        <span className="hud-where">{where}</span>
      </div>
    </div>
  );
}

/** 名声、殖民地数量（悬停列出各殖民地；有殖民地断粮时标红），以及未报告发现的提示（点击打开探险窗口）。 */
function Frontier({ o, discovery = true }: { o: Overview; discovery?: boolean }) {
  const colonies = o.colonies ?? [];
  const starving = colonies.some((c) => c.starving_days > 0);
  const lines = colonies.map((c) =>
    c.starving_days > 0
      ? t("hudColonyStarving", { name: c.name, days: c.starving_days })
      : t("hudColonyLine", { name: c.name, population: c.population, morale: c.morale }),
  );
  return (
    <>
      <Stat icon="fame" label={t("hudFame")} value={num(o.fame ?? 0)} testId="fame" className="hud-fame" />
      <Stat
        icon="colony"
        label={t("hudColonies")}
        value={t("hudColoniesValue", { n: colonies.length })}
        testId="colonies"
        title={lines.length > 0 ? lines.join("\n") : undefined}
        className={starving ? "hud-colonies hud-warn" : "hud-colonies"}
      />
      {discovery && <DiscoveryButton o={o} />}
    </>
  );
}

/** 有还没报告的发现时的提示键：点了打开探险窗口。没有时不画。 */
function DiscoveryButton({ o }: { o: Overview }) {
  const unreported = o.discoveries_unreported ?? 0;
  if (unreported <= 0) return null;
  return (
    <button
      type="button"
      className="hud-discovery"
      data-testid="discoveries-unreported"
      title={t("hudDiscoveriesHint")}
      onClick={() => openWindow("explore")}
    >
      <ShellIcon name="discovery" scale={1} />
      {t("hudDiscoveriesUnreported", { n: unreported })}
    </button>
  );
}

function goalText(g: NonNullable<Overview["goal"]>): string {
  switch (g.kind) {
    case "net_worth":
      return t("goalNetWorth", { current: num(g.current), target: num(g.target) });
    case "colonies":
      return t("goalColonies", { current: g.current, target: g.target, population: g.population ?? 0 });
    case "story":
      return t("goalStory", { current: g.current, target: g.target });
    default:
      return t("goalAllyPorts", { current: g.current, target: g.target });
  }
}

/**
 * 没有剧本目标时那一格写什么（R10-Q02）：有置顶任务就写它的名字（“眼下：去堺”），没有才写“自由经营”。
 * 寰宇的剧本目标是 story，拿不到进度（goal 为空），原来这里永远写“自由经营”。
 */
function sandboxText(o: Overview): string {
  return o.quest_pin ? tz("quest.menuPin", { title: questTitle(o.quest_pin) }) : t("shellSandbox");
}

/** 剧本目标的进度；children 放在这一栏的末尾（顶栏的“故事”按钮）。 */
function Goal({ o, children }: { o: Overview; children?: ReactNode }) {
  const g = o.goal;
  if (!g)
    return (
      <div className="hud-goal hud-goal-none">
        {sandboxText(o)}
        {children}
      </div>
    );
  const ratio = g.target > 0 ? Math.max(0, Math.min(1, g.current / g.target)) : 0;
  const pctValue = Math.floor(ratio * 100);
  // 限期是绝对天数，显示为纪年日期
  const text = goalText(g) + (g.deadline !== null ? t("goalDeadline", { day: g.deadline }) : "");
  return (
    <div className="hud-goal">
      <ShellIcon name="quest" scale={1} />
      <span className="hud-goal-text" data-testid="goal">
        {text}
      </span>
      <div
        className="hud-bar"
        role="progressbar"
        aria-label={t("shellGoalProgress")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pctValue}
      >
        <div className="hud-bar-fill" style={{ width: `${pctValue}%` }} />
      </div>
      <span className="hud-goal-pct" aria-hidden="true">
        {pctValue}%
      </span>
      {children}
    </div>
  );
}

/**
 * 一档倍速键的悬停提示：档名、一天的实时长度与快捷键。
 * 当前这一档用后端给的 day_ms（H10b）；别的档照后端的日长表算（海上四档、港内三档）。
 */
function tierTitle(n: number, sea: boolean, active: boolean, dayMs: number | undefined): string {
  const secs = active && dayMs && dayMs > 0 ? Math.round(dayMs / 100) / 10 : tierSecs(n, sea);
  return tz("time.tierHint", { name: tierName(n, sea), secs, key: tierKey(n, sea) });
}

/** 这一档是不是当前倍速（以后端回来的倍速为准；旧的倍速按最近的一档亮）。 */
function tierActive(speed: number, n: number, sea: boolean): boolean {
  return speed > 0 && nearestTierFor(speed, sea) === n;
}

/**
 * 在港暂停时倍速控件旁的一小块：“在港 · 去旅店”，悬停写明原因与出港后的一档，点它打开旗舰队所在港口的旅店页。
 * id 给倍速组的 aria-describedby：读屏软件读到变灰的倍速键时一并读出原因。
 */
function HeldNote({ hold, id, short = false }: { hold: PortHoldView; id: string; short?: boolean }) {
  const why = tz("time.heldTip", { name: tierName(hold.resume) });
  return (
    <button
      type="button"
      className="speed-held"
      data-testid="speed-held"
      title={why}
      aria-label={short ? `${tz("time.heldShort")} · ${tz("inn.tab")}` : tz("time.held")}
      onClick={() => goFacility(hold.loc, "inn")}
    >
      <ShellIcon name="anchor" scale={1} />
      <span className="speed-held-text">{short ? tz("time.heldShort") : tz("time.held")}</span>
      <span id={id} className="speed-held-why">
        {why}
      </span>
    </button>
  );
}

/**
 * 时间控制：暂停、慢 / 普通 / 快三档（港内一天 2 / 1 / 0.5 秒；海上四档多一个“极快”，一天 6 / 3 / 1 / 0.5 秒，H10b）与“下一天”。
 * 窄窗口时暂停与下一天只显示图标（名称仍在）。
 * 在港暂停（hold）时整组变灰、不能按（时间只在旅店休息时过），出港后的一档描一圈虚线，旁边是“在港 · 去旅店”。
 */
function SpeedControls({
  speed,
  hold,
  setSpeed,
  step,
  sea = false,
  dayMs,
}: {
  speed: number;
  hold: PortHoldView | null;
  setSpeed: (speed: number) => Promise<void>;
  step: (days: number) => Promise<void>;
  /** H10b：海上口径（Overview.sea_clock）时显示四档 */
  sea?: boolean;
  /** H10b：后端给的现在一天的毫秒数 */
  dayMs?: number;
}) {
  const reasonId = useId();
  const held = hold !== null;
  return (
    <div
      className={held ? "speed is-held" : "speed"}
      role="group"
      aria-label={t("speedGroup")}
      aria-describedby={held ? reasonId : undefined}
      data-testid="speed"
    >
      <button
        type="button"
        className={speed === 0 ? "speed-pause active" : "speed-pause"}
        aria-pressed={speed === 0}
        title={t("speedPause")}
        disabled={held}
        onClick={() => void setSpeed(0)}
      >
        <ShellIcon name="pause" scale={1} />
        <span className="speed-label">{t("speedPause")}</span>
      </button>
      {tiersFor(sea).map((n) => (
        <button
          type="button"
          key={n}
          className={["speed-n", tierActive(speed, n, sea) ? "active" : "", held && nearestTier(hold.resume) === n ? "is-next" : ""]
            .filter(Boolean)
            .join(" ")}
          aria-pressed={tierActive(speed, n, sea)}
          title={tierTitle(n, sea, tierActive(speed, n, sea), dayMs)}
          disabled={held}
          onClick={() => void setSpeed(n)}
        >
          {tierName(n, sea)}
        </button>
      ))}
      <button type="button" className="speed-step" title={t("stepDayHint")} disabled={held} onClick={() => void step(1)}>
        <ShellIcon name="step" scale={1} />
        <span className="speed-label">{t("stepDay")}</span>
      </button>
      {hold && <HeldNote hold={hold} id={reasonId} />}
    </div>
  );
}

/**
 * 手机竖屏的时间控制：“暂停”一个键（按下 = 已暂停；暂停时再点一下按上一次的倍速继续，缺省“普通”）
 * 加当前倍速一个键，点开是三档倍速与“下一天”的小面板（点外面或 Esc 收起）。
 * 在港暂停时“暂停”键变灰，当前倍速键换成“在港”（点它去旅店）。
 */
function SpeedPill({
  speed,
  hold,
  setSpeed,
  step,
  sea = false,
  dayMs,
}: {
  speed: number;
  hold: PortHoldView | null;
  setSpeed: (speed: number) => Promise<void>;
  step: (days: number) => Promise<void>;
  /** H10b：海上口径（Overview.sea_clock）时显示四档 */
  sea?: boolean;
  /** H10b：后端给的现在一天的毫秒数 */
  dayMs?: number;
}) {
  const [open, setOpen] = useState(false);
  const reasonId = useId();
  // 最近一次的倍速（store 记着）：暂停后“继续”按它走
  const runSpeed = useGame((s) => s.runSpeed);
  const last = nearestTierFor(runSpeed, sea);
  const root = useRef<HTMLDivElement>(null);
  const held = hold !== null;
  if (held && open) setOpen(false);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);
  const shown = speed > 0 ? speed : last;
  return (
    <div
      ref={root}
      className={held ? "speed speed-pill is-held" : "speed speed-pill"}
      role="group"
      aria-label={t("speedGroup")}
      aria-describedby={held ? reasonId : undefined}
      data-testid="speed"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className={speed === 0 ? "speed-pause active" : "speed-pause"}
        aria-pressed={speed === 0}
        aria-label={t("speedPause")}
        title={speed === 0 ? tz("time.resume", { name: tierName(last, sea) }) : t("speedPause")}
        disabled={held}
        onClick={() => void setSpeed(speed === 0 ? last : 0)}
      >
        <ShellIcon name={speed === 0 ? "play" : "pause"} scale={1} />
      </button>
      {hold ? (
        <HeldNote hold={hold} id={reasonId} short />
      ) : (
        <button
          type="button"
          className={speed === 0 ? "speed-now is-paused" : "speed-now"}
          aria-haspopup="true"
          aria-expanded={open}
          aria-label={speed === 0 ? t("layout.speedPaused") : tz("time.speedNow", { name: tierName(speed, sea) })}
          onClick={() => setOpen((v) => !v)}
        >
          {tierName(shown, sea)}
        </button>
      )}
      {open && (
        <div className="speed-menu" role="group" aria-label={t("layout.speedTitle")} data-testid="speed-menu">
          {tiersFor(sea).map((n) => (
            <button
              type="button"
              key={n}
              className={tierActive(speed, n, sea) ? "speed-n active" : "speed-n"}
              aria-pressed={tierActive(speed, n, sea)}
              title={tierTitle(n, sea, tierActive(speed, n, sea), dayMs)}
              onClick={() => {
                setOpen(false);
                void setSpeed(n);
              }}
            >
              {tierName(n, sea)}
            </button>
          ))}
          <button
            type="button"
            className="speed-step"
            title={t("stepDayHint")}
            onClick={() => {
              setOpen(false);
              void step(1);
            }}
          >
            <ShellIcon name="step" scale={1} />
            <span>{t("stepDay")}</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** 紧凑顶栏里现金下面的一条细进度：剧本目标完成了多少（全文在“菜单”里）。自由经营（没有目标）时不画。 */
function MiniGoal({ o }: { o: Overview }) {
  const g = o.goal;
  if (!g) return null;
  const ratio = g.target > 0 ? Math.max(0, Math.min(1, g.current / g.target)) : 0;
  const pctValue = Math.floor(ratio * 100);
  return (
    <div
      className="hud-goal hud-goal-mini"
      role="progressbar"
      aria-label={t("shellGoalProgress")}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pctValue}
      title={`${goalText(g)} · ${pctValue}%`}
    >
      <div className="hud-bar-fill" style={{ width: `${pctValue}%` }} />
    </div>
  );
}

/**
 * 桌面一行顶栏里的剧本目标：与旁边的数字同一个样子的一格——“目标”、完成的百分比、下面一条细进度，一眼看得到完成了多少；
 * 全文与限期在悬停提示里（“菜单”里也有）。自由经营（没有目标）时不画。
 * 窗口窄到这一格放不下时，样式里换回现金下面那条细进度（MiniGoal）。
 */
function GoalStat({ o }: { o: Overview }) {
  const g = o.goal;
  if (!g) return null;
  const ratio = g.target > 0 ? Math.max(0, Math.min(1, g.current / g.target)) : 0;
  const pctValue = Math.floor(ratio * 100);
  const text = goalText(g) + (g.deadline !== null ? t("goalDeadline", { day: g.deadline }) : "");
  return (
    <div className="hud-stat hud-goal-stat" title={text} data-testid="goal-stat">
      <span className="hud-stat-label">
        <ShellIcon name="quest" scale={1} />
        {tz("hud.goalStat")}
      </span>
      <strong className="hud-stat-value" aria-hidden="true">
        {pctValue}%
      </strong>
      <div
        className="hud-goal-stat-bar"
        role="progressbar"
        aria-label={t("shellGoalProgress")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pctValue}
        aria-valuetext={`${text} · ${pctValue}%`}
      >
        <div className="hud-bar-fill" style={{ width: `${pctValue}%` }} />
      </div>
    </div>
  );
}

/** 顶栏菜单里的一项数字（名称 + 值）。 */
function MenuStat({ icon, label, value, warn = false }: { icon: IconName; label: string; value: string; warn?: boolean }) {
  return (
    <div className={warn ? "hud-menu-stat is-warn" : "hud-menu-stat"}>
      <dt>
        <ShellIcon name={icon} scale={1} />
        {label}
      </dt>
      <dd>{value}</dd>
    </div>
  );
}

/**
 * 顶栏“菜单”（手机与平板）：资产与目标（全部数字、殖民地、待报告的发现、目标全文与进度）、时辰与天气（含预报）、
 * 存档（槽位、存档、读档）、系统（主菜单、音乐）。
 */
function HudMenu({
  o,
  slot,
  setSlot,
  onClose,
}: {
  o: Overview;
  slot: string;
  setSlot: (s: string) => void;
  onClose: () => void;
}) {
  const colonies = o.colonies ?? [];
  const unreported = o.discoveries_unreported ?? 0;
  const g = o.goal;
  const pctValue = g && g.target > 0 ? Math.floor(Math.max(0, Math.min(1, g.current / g.target)) * 100) : 0;
  const budget = o.budget ? t("topBudgetValue", { used: o.budget.calls_used, limit: o.budget.calls_limit }) : t("topBudgetOff");
  return (
    <div className="hud-menu" data-testid="hud-menu">
      <section className="hud-menu-section" aria-label={t("layout.menuAssets")}>
        <h3>{t("layout.menuAssets")}</h3>
        <dl className="hud-menu-stats">
          <MenuStat icon="coin" label={t("topCash")} value={money(o.cash)} />
          <MenuStat icon="bank" label={t("topNetWorth")} value={money(o.net_worth)} />
          <MenuStat icon="cargo" label={t("topAssets")} value={money(o.total_assets)} />
          <MenuStat icon="intel" label={t("topBudget")} value={budget} />
          <MenuStat icon="fame" label={t("hudFame")} value={num(o.fame ?? 0)} />
          <MenuStat
            icon="colony"
            label={t("hudColonies")}
            value={t("hudColoniesValue", { n: colonies.length })}
            warn={colonies.some((c) => c.starving_days > 0)}
          />
        </dl>
        {colonies.length > 0 && (
          <ul className="hud-menu-colonies">
            {colonies.map((c) => (
              <li key={c.id} className={c.starving_days > 0 ? "is-warn" : undefined}>
                {c.starving_days > 0
                  ? t("hudColonyStarving", { name: c.name, days: c.starving_days })
                  : t("hudColonyLine", { name: c.name, population: c.population, morale: c.morale })}
              </li>
            ))}
          </ul>
        )}
        {unreported > 0 && (
          <button
            type="button"
            className="hud-discovery"
            title={t("hudDiscoveriesHint")}
            onClick={() => {
              onClose();
              openWindow("explore");
            }}
          >
            <ShellIcon name="discovery" scale={1} />
            {t("hudDiscoveriesUnreported", { n: unreported })}
          </button>
        )}
        <div className="hud-menu-goal">
          <ShellIcon name="quest" scale={1} />
          <span className="hud-menu-goal-text">
            {g ? goalText(g) + (g.deadline !== null ? t("goalDeadline", { day: g.deadline }) : "") : sandboxText(o)}
          </span>
          {g && (
            <span className="hud-menu-goal-bar" aria-hidden="true">
              <span className="hud-bar">
                <span className="hud-bar-fill" style={{ width: `${pctValue}%` }} />
              </span>
              <span className="hud-goal-pct">{pctValue}%</span>
            </span>
          )}
        </div>
      </section>
      <section className="hud-menu-section hud-menu-time" aria-label={t("layout.menuWeather")}>
        <h3>{t("layout.menuWeather")}</h3>
        <HudClock o={o} stop={false} />
      </section>
      {o.story && (
        <section className="hud-menu-section" aria-label={t("story.panel.title")}>
          <h3>{t("story.panel.title")}</h3>
          <StoryPanel o={o} onClose={onClose} inline />
        </section>
      )}
      <section className="hud-menu-section" aria-label={t("layout.menuSaves")}>
        <h3>{t("layout.menuSaves")}</h3>
        <div className="hud-menu-saves saves">
          <input aria-label={t("saveSlot")} value={slot} onChange={(e) => setSlot(e.target.value)} size={10} />
          <button type="button" onClick={() => void saveTo(slot)}>
            <ShellIcon name="save" scale={1} />
            {t("save")}
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              void loadFrom(slot);
            }}
          >
            <ShellIcon name="load" scale={1} />
            {t("load")}
          </button>
        </div>
      </section>
      <section className="hud-menu-section" aria-label={t("layout.menuSystem")}>
        <h3>{t("layout.menuSystem")}</h3>
        <div className="hud-menu-system">
          <button type="button" onClick={askLeave}>
            <ShellIcon name="menu" scale={1} />
            {t("menu")}
          </button>
          <MusicToggle />
        </div>
      </section>
    </div>
  );
}

/**
 * 一行的顶栏（平板、手机，以及新界面的桌面）：头像（点开船长卡）、现金与目标细进度、（平板与桌面）净资产、名声与殖民地、时刻与倍速、菜单。
 * 桌面宽，另外写出名字与所在、目标（GoalStat）、名声与殖民地、待报告的发现、“故事”按钮与一次点到的“存档”（平板与手机上它们在“菜单”里）。
 * 数字那一格按“现金、净资产、目标、名声、殖民地”的先后排，放不下的从后面整项收掉。
 * 菜单按钮上的小红点：有待报告的发现或殖民地断粮。
 */
function CompactHud({ o, layout }: { o: Overview; layout: Layout }) {
  const storyDismissed = useStoryUi((s) => s.dismissed);
  const setSpeed = useGame((s) => s.setSpeed);
  const step = useGame((s) => s.step);
  const [slot, setSlot] = useState("save1");
  const [menu, setMenu] = useState(false);
  const phone = layout === "phone";
  const desktop = layout === "desktop";
  const colonies = o.colonies ?? [];
  const starving = colonies.some((c) => c.starving_days > 0);
  // 有“稍后再说”合上的剧情事件在等时菜单键也带小红点（紧凑顶栏的“故事”收在菜单里）
  const storyWaiting = !!o.story?.pending && pendingKey(o.story.pending) === storyDismissed;
  // 桌面上待报告的发现、故事都直接写在顶栏里（各自带提示），菜单键只为殖民地断粮亮
  const alert = desktop ? starving : (o.discoveries_unreported ?? 0) > 0 || starving || storyWaiting;
  const cashLabel = t("layout.cashLabel", { money: money(o.cash) });
  return (
    <header className="hud hud-compact" data-testid="hud" data-layout={layout}>
      <CaptainPlate o={o} portrait={phone ? 36 : 44} />
      <div className="hud-stats">
        <div className="hud-stat hud-cash" title={cashLabel}>
          <span className="hud-stat-label">
            <ShellIcon name="coin" scale={1} />
            <span className="hud-stat-name">{t("topCash")}</span>
          </span>
          <strong className="hud-stat-value" data-testid="cash" aria-label={cashLabel}>
            {phone ? shortNum(o.cash) : money(o.cash)}
          </strong>
          <MiniGoal o={o} />
        </div>
        {!phone && <Stat icon="bank" label={t("topNetWorth")} value={money(o.net_worth)} className="hud-net" />}
        {/* 桌面：剧本目标紧跟在净资产后面（排在前面的后让位） */}
        {desktop && <GoalStat o={o} />}
        {layout === "tablet" && (
          <>
            <Stat icon="fame" label={t("hudFame")} value={num(o.fame ?? 0)} testId="fame" className="hud-fame" />
            <Stat
              icon="colony"
              label={t("hudColonies")}
              value={t("hudColoniesValue", { n: colonies.length })}
              testId="colonies"
              className={starving ? "hud-colonies hud-warn" : "hud-colonies"}
            />
          </>
        )}
        {/* 桌面：名声、殖民地（悬停列出各殖民地），同原来的桌面顶栏。这一格放不下的整项收掉（样式里折行裁掉，不切半个数字） */}
        {desktop && <Frontier o={o} discovery={false} />}
      </div>
      {/* 待报告的发现是要人去点的提醒，放在会被收掉的那一格外面 */}
      {desktop && <DiscoveryButton o={o} />}
      {desktop && <StoryButton o={o} />}
      <div className="hud-time">
        <HudClock o={o} variant={phone ? "mini" : "compact"} />
        {phone ? (
          <SpeedPill speed={o.speed} hold={o.port_hold ?? null} setSpeed={setSpeed} step={step} sea={o.sea_clock === true} dayMs={o.day_ms} />
        ) : (
          <SpeedControls speed={o.speed} hold={o.port_hold ?? null} setSpeed={setSpeed} step={step} sea={o.sea_clock === true} dayMs={o.day_ms} />
        )}
      </div>
      {/* 桌面：存档一次点到（存到“菜单”里写的那个槽位，缺省 save1）；读档、换槽位仍在“菜单”里 */}
      {desktop && (
        <button
          type="button"
          className="hud-save-btn"
          aria-label={tz("hud.quickSave", { slot })}
          title={tz("hud.quickSave", { slot })}
          data-testid="hud-quick-save"
          onClick={() => void saveTo(slot)}
        >
          <ShellIcon name="save" scale={1} />
          <span className="hud-save-label">{t("save")}</span>
        </button>
      )}
      <button
        type="button"
        className={alert ? "hud-menu-btn has-alert" : "hud-menu-btn"}
        aria-haspopup="dialog"
        aria-expanded={menu}
        aria-label={t("layout.menu")}
        title={t("layout.menu")}
        data-testid="hud-menu-button"
        onClick={() => setMenu(true)}
      >
        <ShellIcon name="menu" scale={phone ? 2 : 1} />
        {!phone && <span className="hud-menu-label">{t("layout.menu")}</span>}
      </button>
      {menu && (
        <Sheet
          title={t("layout.menuTitle")}
          icon="report"
          placement={phone ? "bottom" : "top-right"}
          onClose={() => setMenu(false)}
          className="hud-sheet"
          testId="hud-sheet"
        >
          <HudMenu o={o} slot={slot} setSlot={setSlot} onClose={() => setMenu(false)} />
        </Sheet>
      )}
    </header>
  );
}

export default function TopBar() {
  const o = useGame((s) => s.overview);
  const setSpeed = useGame((s) => s.setSpeed);
  const step = useGame((s) => s.step);
  const layout = useLayout();
  const v2 = useIsV2();
  const [slot, setSlot] = useState("save1");
  // 键盘 1 / 2 / 3：慢 / 普通 / 快，海上 4：极快（顶栏在主界面里一直挂着）
  useSpeedKeys(!!o);
  if (!o) return null;
  // 平板与手机：一行的紧凑顶栏，次要信息收进“菜单”；新界面的桌面也用这一行（地图多看到一截），旧界面的桌面照旧
  if (layout !== "desktop" || v2) return <CompactHud o={o} layout={layout} />;
  const budget = o.budget
    ? t("topBudgetValue", { used: o.budget.calls_used, limit: o.budget.calls_limit })
    : t("topBudgetOff");
  return (
    <header className="hud" data-testid="hud">
      <CaptainPlate o={o} />
      <div className="hud-stats">
        <Stat icon="coin" label={t("topCash")} value={money(o.cash)} testId="cash" className="hud-cash" />
        <Stat icon="bank" label={t("topNetWorth")} value={money(o.net_worth)} />
        <Stat icon="cargo" label={t("topAssets")} value={money(o.total_assets)} />
        <Stat icon="intel" label={t("topBudget")} value={budget} testId="budget" title={tk(`aiMode.${o.ai_mode}`)} />
        <Frontier o={o} />
      </div>
      <Goal o={o}>
        <StoryButton o={o} />
      </Goal>
      <div className="hud-time">
        <HudClock o={o} />
        <SpeedControls speed={o.speed} hold={o.port_hold ?? null} setSpeed={setSpeed} step={step} sea={o.sea_clock === true} dayMs={o.day_ms} />
      </div>
      <div className="saves">
        <input aria-label={t("saveSlot")} value={slot} onChange={(e) => setSlot(e.target.value)} size={10} />
        <div className="saves-buttons">
          <button type="button" onClick={() => void saveTo(slot)}>
            <ShellIcon name="save" scale={1} />
            {t("save")}
          </button>
          <button type="button" onClick={() => void loadFrom(slot)}>
            <ShellIcon name="load" scale={1} />
            {t("load")}
          </button>
          <button type="button" onClick={askLeave}>
            <ShellIcon name="menu" scale={1} />
            {t("menu")}
          </button>
          <MusicToggle />
        </div>
      </div>
    </header>
  );
}
