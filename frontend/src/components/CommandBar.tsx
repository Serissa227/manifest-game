// 底部命令栏：左侧切换主舞台（港口街景 / 航海图），右侧是功能面板的大按钮（图标 + 文字）。
// 功能面板按钮组是 tablist“功能面板”；点击未打开的功能页打开对应窗口，再点一次当前页则关闭窗口。
// 按钮带悬停提示（全称）：英文界面的标签放不下时会省略。
// 有新东西的功能页（眼下是人物页的新见闻，I5b）在按钮右上角带一个小红点；收在“更多”里时“更多”也带。
//
// 网页自适应（hooks/useViewport.ts）：
// - 平板与桌面：一行放不下的功能页收进最右边的“更多”（按实际宽度量：排到第二行的按钮就是放不下的），命令栏不再折成两行；
// - 手机竖屏：底部导航——舞台切换一个键（写着要切过去的那一个）、三个常用功能页（港口、海战进行中时的海战、舰队、行情）与“更多”；
//   手机横屏同样的几个键竖着排在左侧。“更多”从底部滑出其余的功能页。
// 手机上功能窗口是整页的：切换舞台时顺手收起窗口，免得切了看不见。
import { useLayoutEffect, useRef, useState } from "react";
import { tk, t } from "../i18n";
import { useLayout, type Layout } from "../hooks/useViewport";
import { useGame, type Tab } from "../store/game";
import Sheet from "./shell/Sheet";
import { ShellIcon } from "./shell/ShellIcon";
import { TAB_ICONS, WINDOW_ID, canSeeTown, commandTabId, primaryTabs, showStage, tabAlert } from "./shell/shellState";

/** 某个功能页的新东西数（小红点；只在有无变化时重渲染）。 */
function useAlert(tab: Tab): number {
  return useGame((s) => tabAlert(s.overview, tab));
}

/** 按钮右上角的小红点（纯装饰；条数写在按钮的提示里）。 */
function AlertDot({ n }: { n: number }) {
  return n > 0 ? <span className="cmd-dot" aria-hidden="true" data-testid="cmd-dot" /> : null;
}

/** 有新东西时按钮的提示：“人物 · 3 条新见闻”。 */
function alertTitle(tab: Tab, n: number): string {
  return n > 0 ? t("pp.cmdUnread", { tab: tk(`tab.${tab}`), n }) : tk(`tab.${tab}`);
}

function StageSwitch() {
  const town = useGame((s) => canSeeTown(s.overview));
  const stage = useGame((s) => s.stage);
  const shown = town ? stage : "chart";
  return (
    <div className="cmd-stage" role="group" aria-label={t("shellStageGroup")}>
      <button
        type="button"
        className={shown === "town" ? "cmd active" : "cmd"}
        aria-pressed={shown === "town"}
        disabled={!town}
        title={town ? undefined : t("shellStageTownAtSea")}
        onClick={() => showStage("town")}
      >
        <ShellIcon name="port" />
        <span className="cmd-label">{t("shellStageTown")}</span>
      </button>
      <button
        type="button"
        className={shown === "chart" ? "cmd active" : "cmd"}
        aria-pressed={shown === "chart"}
        title={t("shellStageChart")}
        // 新界面：切到航海图时顺手收起功能窗口（shellState.ts 的 showStage）
        onClick={() => showStage("chart")}
      >
        <ShellIcon name="map" />
        <span className="cmd-label">{t("shellStageChart")}</span>
      </button>
    </div>
  );
}

/** 手机上的舞台切换：一个键，写着要切过去的舞台（在海上时港口街景不可用）；切换时收起整页的功能窗口。 */
function StageToggle() {
  const town = useGame((s) => canSeeTown(s.overview));
  const stage = useGame((s) => s.stage);
  const shown = town ? stage : "chart";
  const target = shown === "town" ? "chart" : "town";
  const name = target === "town" ? t("shellStageTown") : t("shellStageChart");
  const disabled = target === "town" && !town;
  return (
    <div className="cmd-stage" role="group" aria-label={t("shellStageGroup")}>
      <button
        type="button"
        className="cmd cmd-stage-toggle"
        data-stage-target={target}
        aria-label={t("layout.stageTo", { stage: name })}
        disabled={disabled}
        title={disabled ? t("shellStageTownAtSea") : t("layout.stageTo", { stage: name })}
        onClick={() => showStage(target)}
      >
        <ShellIcon name={target === "town" ? "port" : "map"} />
        <span className="cmd-label">{name}</span>
      </button>
    </div>
  );
}

/** 功能页按钮（命令栏里的 tab）。 */
function TabButton({ k, selected, hidden = false, onSelect }: { k: Tab; selected: boolean; hidden?: boolean; onSelect: (tab: Tab) => void }) {
  const alert = useAlert(k);
  return (
    <button
      id={commandTabId(k)}
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls={selected ? WINDOW_ID : undefined}
      className={[selected ? "cmd tab-cmd active" : "cmd tab-cmd", hidden ? "is-overflow" : "", alert > 0 ? "has-dot" : ""].filter(Boolean).join(" ")}
      data-tab={k}
      title={alertTitle(k, alert)}
      tabIndex={hidden ? -1 : undefined}
      aria-hidden={hidden || undefined}
      onClick={() => onSelect(k)}
    >
      <ShellIcon name={TAB_ICONS[k]} />
      <span className="cmd-label">{tk(`tab.${k}`)}</span>
      <AlertDot n={alert} />
    </button>
  );
}

/** “更多”键：三个像素小方块（CSS 画的，不另加图标）。当前打开的功能页在“更多”里时高亮。 */
function MoreButton({ expanded, activeTab, tabs, onClick }: { expanded: boolean; activeTab: Tab | null; tabs: readonly Tab[]; onClick: () => void }) {
  // 收在“更多”里的功能页有新东西时，“更多”上也带小红点
  const alert = useGame((s) => tabs.some((k) => tabAlert(s.overview, k) > 0));
  return (
    <button
      type="button"
      className={[activeTab ? "cmd cmd-more active" : "cmd cmd-more", alert ? "has-dot" : ""].filter(Boolean).join(" ")}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      aria-label={activeTab ? t("layout.moreActive", { tab: tk(`tab.${activeTab}`) }) : t("layout.more")}
      title={t("layout.moreTitle")}
      data-testid="cmd-more"
      onClick={onClick}
    >
      <span className="cmd-more-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="cmd-label">{t("layout.more")}</span>
      <AlertDot n={alert ? 1 : 0} />
    </button>
  );
}

/** “更多”抽屉里的一格。 */
function MoreTab({ k, current, onPick }: { k: Tab; current: boolean; onPick: () => void }) {
  const alert = useAlert(k);
  return (
    <button
      type="button"
      className={[current ? "cmd more-tab active" : "cmd more-tab", alert > 0 ? "has-dot" : ""].filter(Boolean).join(" ")}
      aria-current={current ? "page" : undefined}
      data-more-tab={k}
      title={alert > 0 ? alertTitle(k, alert) : undefined}
      onClick={onPick}
    >
      <ShellIcon name={TAB_ICONS[k]} />
      <span className="cmd-label">{tk(`tab.${k}`)}</span>
      <AlertDot n={alert} />
    </button>
  );
}

/** “更多”抽屉：收进去的功能页，一格一个大按钮。点了打开那一页（已经开着的就留着）。 */
function MoreSheet({
  tabs,
  active,
  open,
  onOpen,
  onClose,
  placement,
}: {
  tabs: Tab[];
  active: Tab;
  open: boolean;
  onOpen: (tab: Tab) => void;
  onClose: () => void;
  placement: "bottom" | "top-right" | "left";
}) {
  return (
    <Sheet title={t("layout.moreTitle")} placement={placement} onClose={onClose} className="more-sheet" testId="more-sheet">
      <div className="more-grid">
        {tabs.map((k) => (
          <MoreTab
            key={k}
            k={k}
            current={open && k === active}
            onPick={() => {
              onClose();
              onOpen(k);
            }}
          />
        ))}
      </div>
    </Sheet>
  );
}

interface BarProps {
  tabs: Tab[];
  active: Tab;
  /** 功能窗口是否打开 */
  open: boolean;
  onSelect: (tab: Tab) => void;
}

/** 手机上的底部导航（竖屏）或左侧竖栏（横屏）。 */
function CompactNav({ tabs, active, open, onSelect, layout }: BarProps & { layout: Layout }) {
  const [more, setMore] = useState(false);
  const primary = primaryTabs(tabs);
  const rest = tabs.filter((k) => !primary.includes(k));
  const inMore = open && rest.includes(active) ? active : null;
  return (
    <nav className="cmdbar cmdbar-compact" data-layout={layout} aria-label={t("shellCommandBar")}>
      <StageToggle />
      <div className="cmd-tabs" role="tablist" aria-label={t("sidePanels")}>
        {primary.map((k) => (
          <TabButton key={k} k={k} selected={open && k === active} onSelect={onSelect} />
        ))}
      </div>
      {rest.length > 0 && <MoreButton expanded={more} activeTab={inMore} tabs={rest} onClick={() => setMore(true)} />}
      {more && (
        <MoreSheet
          tabs={rest}
          active={active}
          open={open}
          placement={layout === "short" ? "left" : "bottom"}
          onClose={() => setMore(false)}
          onOpen={(k) => {
            if (!(open && k === active)) onSelect(k);
          }}
        />
      )}
    </nav>
  );
}

/**
 * 平板与桌面的命令栏。功能页一行放不下时（窄窗口、英文长标签）：排到第二行的按钮隐藏起来，收进最右边的“更多”。
 * 量法：按钮区只有一行高、超出的折到看不见的第二行，按各按钮的 offsetTop 判断；没有 ResizeObserver 的环境（jsdom）全部显示。
 */
function FullBar({ tabs, active, open, onSelect }: BarProps) {
  const strip = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState<Tab[]>([]);
  const [more, setMore] = useState(false);
  const sig = tabs.join(",");
  useLayoutEffect(() => {
    const el = strip.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const buttons = [...el.querySelectorAll<HTMLElement>("[data-tab]")];
      const top = buttons[0]?.offsetTop ?? 0;
      const over = buttons.filter((b) => b.offsetTop > top + 4).map((b) => b.dataset.tab as Tab);
      setHidden((prev) => (prev.join(",") === over.join(",") ? prev : over));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sig]);
  const inMore = open && hidden.includes(active) ? active : null;
  return (
    <nav className={hidden.length > 0 ? "cmdbar has-more" : "cmdbar"} aria-label={t("shellCommandBar")}>
      <StageSwitch />
      <div className="cmd-sep" aria-hidden="true" />
      <div className="cmd-tabs" role="tablist" aria-label={t("sidePanels")} ref={strip}>
        {tabs.map((k) => (
          <TabButton key={k} k={k} selected={open && k === active} hidden={hidden.includes(k)} onSelect={onSelect} />
        ))}
      </div>
      {hidden.length > 0 && <MoreButton expanded={more} activeTab={inMore} tabs={hidden} onClick={() => setMore(true)} />}
      {more && hidden.length > 0 && (
        <MoreSheet
          tabs={hidden}
          active={active}
          open={open}
          placement="top-right"
          onClose={() => setMore(false)}
          onOpen={(k) => {
            if (!(open && k === active)) onSelect(k);
          }}
        />
      )}
    </nav>
  );
}

export default function CommandBar(props: BarProps) {
  const layout = useLayout();
  if (layout === "phone" || layout === "short") return <CompactNav {...props} layout={layout} />;
  return <FullBar {...props} />;
}
