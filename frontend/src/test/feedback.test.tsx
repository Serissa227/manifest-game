// 共用的反馈组件（components/feedback/；docs/UI-REDESIGN.md 第 4、9 节）：
// 新界面（v2）下的结构、读屏语义与键盘（就地错误、空状态与“下一步”、快捷键小键帽、确认对话框与 useConfirm），
// 以及旧界面（v1）下维持原样：缺省不显示或画成原来的样子，DOM 里没有任何 v2 的类。
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Empty } from "../components/common";
import { ConfirmDialog, EmptyState, InlineError, Kbd, KeyHints, keyLabel, useConfirm, type ConfirmRunOptions } from "../components/feedback";
import { setLocale } from "../i18n/locale";
import { useGame } from "../store/game";
import { UiSwitch } from "../ui/UiSwitch";
import { applyUi, useIsV2, useUiVersion } from "../ui/uiMode";

function setUiFor(ui: "v1" | "v2") {
  applyUi(ui);
  useUiVersion.setState({ ui });
}

/** 页面里 v2 开头的类。 */
const v2Classes = () => [...document.querySelectorAll("[class]")].flatMap((el) => [...el.classList]).filter((c) => /^v2(-|$)/.test(c));

beforeEach(() => {
  setLocale("zh-CN");
  useGame.setState({ message: null, error: null });
});
afterEach(() => {
  // 先卸下组件再切回 v1（否则切换会让还挂着的组件在 act 之外更新）
  cleanup();
  setUiFor("v1");
  setLocale("zh-CN");
});

describe("版本开关", () => {
  it("useIsV2 与 UiSwitch 跟着设置切换；UiSwitch 不给 v1 时旧界面什么都不显示", () => {
    function Probe() {
      return <span data-testid="probe">{useIsV2() ? "新" : "旧"}</span>;
    }
    setUiFor("v1");
    const { rerender } = render(
      <>
        <Probe />
        <UiSwitch v1={<b>旧的</b>} v2={<b>新的</b>} />
        <UiSwitch v2={<i>只在新界面</i>} />
      </>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("旧");
    expect(screen.getByText("旧的")).toBeInTheDocument();
    expect(screen.queryByText("只在新界面")).toBeNull();
    act(() => setUiFor("v2"));
    rerender(
      <>
        <Probe />
        <UiSwitch v1={<b>旧的</b>} v2={<b>新的</b>} />
        <UiSwitch v2={<i>只在新界面</i>} />
      </>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("新");
    expect(screen.getByText("新的")).toBeInTheDocument();
    expect(screen.getByText("只在新界面")).toBeInTheDocument();
  });
});

describe("就地错误", () => {
  it("v2：写出为什么、怎么办与补救按钮；出错立即播报（role=alert），做不了的原因不打断（可被 aria-describedby 指到）", async () => {
    const user = userEvent.setup();
    setUiFor("v2");
    const onClick = vi.fn();
    render(
      <>
        <InlineError reason="现金不够：还差 1,200 金币。" fix="先卖掉一些货。" action={{ label: "去卖货", onClick }} />
        <InlineError tone="blocked" id="why" reason="船还在修理。" />
        <button type="button" disabled aria-describedby="why">
          出港
        </button>
      </>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("现金不够：还差 1,200 金币。");
    expect(alert).toHaveTextContent("先卖掉一些货。");
    expect(alert).toHaveClass("v2-inline-error", "is-error");
    await user.click(within(alert).getByRole("button", { name: "去卖货" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    // 做不了的原因：没有 role，按钮的说明念它
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "出港" })).toHaveAccessibleDescription("船还在修理。");
    expect(document.getElementById("why")).toHaveClass("is-blocked");
  });

  it("深色底与紧凑的变体只是类名不同", () => {
    setUiFor("v2");
    render(<InlineError on="night" compact reason="装不下了。" />);
    expect(screen.getByRole("alert")).toHaveClass("on-night", "is-compact");
  });

  it("v1：缺省什么都不显示（维持原样）；给了 v1 就照样显示，没有 v2 的类", () => {
    setUiFor("v1");
    const { container, rerender } = render(<InlineError reason="现金不够。" />);
    expect(container).toBeEmptyDOMElement();
    rerender(<InlineError reason="现金不够。" v1={<span className="mk-c-why">现金不够</span>} />);
    expect(container.innerHTML).toBe('<span class="mk-c-why">现金不够</span>');
    expect(v2Classes()).toEqual([]);
  });
});

describe("空状态", () => {
  it("v2：一句话、补充说明、一个“下一步”主按钮（带快捷键的小键帽）", async () => {
    const user = userEvent.setup();
    setUiFor("v2");
    const next = vi.fn();
    render(<EmptyState text="这里还没有收盘价，至少要过一天。" hint="过一天再来看。" action={{ label: "下一天", onClick: next, shortcut: "Space" }} />);
    const box = screen.getByTestId("empty-state");
    expect(box).toHaveClass("v2-empty");
    expect(box).toHaveTextContent("这里还没有收盘价，至少要过一天。");
    expect(box).toHaveTextContent("过一天再来看。");
    const btn = within(box).getByRole("button", { name: "下一天 空格" });
    expect(btn).toHaveClass("btn", "primary");
    await user.click(btn);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("v1：缺省与原来的 Empty（<p class=\"empty\">）一模一样，不带按钮；可以传原来的写法，或者 null 不显示", () => {
    setUiFor("v1");
    const { container: a } = render(<EmptyState text="货舱空空如也。" action={{ label: "去交易所", onClick: () => {} }} />);
    const { container: b } = render(<Empty text="货舱空空如也。" />);
    expect(a.innerHTML).toBe(b.innerHTML);
    expect(screen.queryByRole("button")).toBeNull();
    const { container: c } = render(<EmptyState text="没有存档" v1={<p className="ts-empty">没有存档</p>} />);
    expect(c.innerHTML).toBe('<p class="ts-empty">没有存档</p>');
    const { container: d } = render(<EmptyState text="x" v1={null} />);
    expect(d).toBeEmptyDOMElement();
    expect(v2Classes()).toEqual([]);
  });
});

describe("快捷键", () => {
  it("键名：方向键显示箭头、念“上箭头”；回车、空格随语言；Esc 等照原样", () => {
    expect(keyLabel("ArrowUp")).toEqual({ text: "↑", name: "上箭头" });
    expect(keyLabel("Enter")).toEqual({ text: "回车", name: "回车" });
    expect(keyLabel(" ")).toEqual({ text: "空格", name: "空格" });
    expect(keyLabel("Escape")).toEqual({ text: "Esc", name: "Esc" });
    expect(keyLabel("Shift")).toEqual({ text: "Shift", name: "Shift" });
    setLocale("en");
    expect(keyLabel("ArrowLeft")).toEqual({ text: "←", name: "Left arrow" });
    expect(keyLabel("Enter")).toEqual({ text: "Enter", name: "Enter" });
  });

  it("v2：一组提示是带名字的列表，每条是小键帽 + 做什么；键帽的读屏名字完整", () => {
    setUiFor("v2");
    render(
      <KeyHints
        items={[
          { keys: ["ArrowUp", "ArrowDown"], label: "选货" },
          { keys: ["Enter"], label: "成交" },
        ]}
      />,
    );
    const list = screen.getByRole("list", { name: "快捷键" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("↑上箭头↓下箭头选货");
    expect(items[0].querySelectorAll("kbd.v2-kbd")).toHaveLength(2);
    expect(items[1]).toHaveTextContent("回车成交");
  });

  it("v1：小键帽与提示都不显示（给了 v1 就显示 v1）", () => {
    setUiFor("v1");
    const { container } = render(
      <>
        <Kbd k="Enter" />
        <KeyHints items={[{ keys: ["Enter"], label: "成交" }]} />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
    const { container: c } = render(<KeyHints items={[]} v1={<p className="mk-keys">↑↓ 选货</p>} />);
    expect(c.innerHTML).toBe('<p class="mk-keys">↑↓ 选货</p>');
  });
});

describe("确认对话框", () => {
  it("v2：alertdialog，标题与后果是它的名字与说明；危险操作焦点先在“取消”；Esc 取消；按键不传给下面的界面", async () => {
    const user = userEvent.setup();
    setUiFor("v2");
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const below = vi.fn();
    render(
      <div onKeyDown={below} onClick={below}>
        <ConfirmDialog open title="解雇这 3 名船员？" body="想再雇要重新招募。" confirmLabel="解雇 3 名船员" onConfirm={onConfirm} onCancel={onCancel} />
      </div>,
    );
    const dlg = screen.getByRole("alertdialog", { name: "解雇这 3 名船员？" });
    expect(dlg).toHaveAccessibleDescription("想再雇要重新招募。");
    expect(dlg).toHaveClass("modal-body", "v2-confirm");
    const cancel = within(dlg).getByRole("button", { name: "取消" });
    const ok = within(dlg).getByRole("button", { name: "解雇 3 名船员" });
    expect(ok).toHaveClass("btn", "danger");
    await waitFor(() => expect(cancel).toHaveFocus());
    // Tab 只在对话框里转
    await user.tab();
    expect(ok).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
    await user.tab({ shift: true });
    expect(ok).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
    await user.click(ok);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(below).not.toHaveBeenCalled();
  });

  it("普通确认（primary）焦点在主按钮上；关掉后焦点回到打开它的按钮", async () => {
    const user = userEvent.setup();
    setUiFor("v2");
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            卖船
          </button>
          <ConfirmDialog open={open} tone="primary" title="卖掉这艘船？" confirmLabel="卖掉" onConfirm={() => setOpen(false)} onCancel={() => setOpen(false)} />
        </>
      );
    }
    render(<Host />);
    const opener = screen.getByRole("button", { name: "卖船" });
    await user.click(opener);
    const ok = screen.getByRole("button", { name: "卖掉" });
    expect(ok).toHaveClass("btn", "primary");
    await waitFor(() => expect(ok).toHaveFocus());
    await user.click(ok);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("办事中按钮不可用、写“正在办……”，Esc 不取消；出错就地写在对话框里", async () => {
    const user = userEvent.setup();
    setUiFor("v2");
    const onCancel = vi.fn();
    const { rerender } = render(<ConfirmDialog open busy title="删掉存档？" confirmLabel="删掉" onConfirm={() => {}} onCancel={onCancel} />);
    expect(screen.getByRole("button", { name: "正在办……" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(onCancel).not.toHaveBeenCalled();
    rerender(<ConfirmDialog open error="存档被占用了。" title="删掉存档？" confirmLabel="删掉" onConfirm={() => {}} onCancel={onCancel} />);
    expect(within(screen.getByRole("alertdialog")).getByRole("alert")).toHaveTextContent("存档被占用了。");
  });

  it("v1：同样的结构，用原来的对话框外观（.modal / .modal-body），没有任何 v2 的类", () => {
    setUiFor("v1");
    render(<ConfirmDialog open title="解雇这 3 名船员？" confirmLabel="解雇 3 名船员" error="出错了" onConfirm={() => {}} onCancel={() => {}} />);
    const dlg = screen.getByRole("alertdialog", { name: "解雇这 3 名船员？" });
    expect(dlg.className).toBe("modal-body");
    expect(dlg.parentElement?.className).toBe("modal");
    expect(within(dlg).getByRole("alert")).toHaveTextContent("出错了");
    expect(v2Classes()).toEqual([]);
  });

  it("关着的时候什么都不画", () => {
    setUiFor("v2");
    render(<ConfirmDialog open={false} title="x" confirmLabel="y" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("useConfirm", () => {
  function Host({ opts, action, onResult }: { opts: ConfirmRunOptions; action?: () => unknown; onResult: (ok: boolean) => void }) {
    const confirm = useConfirm();
    return (
      <>
        <button type="button" onClick={() => void (action ? confirm.run(opts, action) : confirm.ask(opts)).then(onResult)}>
          动手
        </button>
        {confirm.dialog}
      </>
    );
  }
  const opts: ConfirmRunOptions = { title: "解雇这 3 名船员？", confirmLabel: "解雇 3 名船员", done: "已解雇 3 名船员" };

  it("ask：点主按钮回答 true，取消回答 false", async () => {
    const user = userEvent.setup();
    setUiFor("v2");
    const onResult = vi.fn();
    render(<Host opts={opts} onResult={onResult} />);
    await user.click(screen.getByRole("button", { name: "动手" }));
    await user.click(screen.getByRole("button", { name: "解雇 3 名船员" }));
    await waitFor(() => expect(onResult).toHaveBeenLastCalledWith(true));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "动手" }));
    await user.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(onResult).toHaveBeenLastCalledWith(false));
  });

  it("run：确认后才办；办成关掉对话框并在提示条里回一句；取消时不办", async () => {
    const user = userEvent.setup();
    setUiFor("v2");
    const action = vi.fn(async () => ({ outcome: "Done" }));
    const onResult = vi.fn();
    render(<Host opts={opts} action={action} onResult={onResult} />);
    await user.click(screen.getByRole("button", { name: "动手" }));
    await user.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(onResult).toHaveBeenLastCalledWith(false));
    expect(action).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "动手" }));
    await user.click(screen.getByRole("button", { name: "解雇 3 名船员" }));
    await waitFor(() => expect(onResult).toHaveBeenLastCalledWith(true));
    expect(action).toHaveBeenCalledTimes(1);
    expect(useGame.getState().message).toBe("已解雇 3 名船员");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("run：办的时候抛错，对话框不关、错误就地写出、可以再试；返回 null（store.submit 失败）就关掉、不回音", async () => {
    const user = userEvent.setup();
    setUiFor("v2");
    let fail = true;
    const action = vi.fn(async () => {
      if (fail) throw new Error("港口不让卖");
      return null;
    });
    const onResult = vi.fn();
    render(<Host opts={opts} action={action} onResult={onResult} />);
    await user.click(screen.getByRole("button", { name: "动手" }));
    await user.click(screen.getByRole("button", { name: "解雇 3 名船员" }));
    const dlg = await screen.findByRole("alertdialog");
    expect(await within(dlg).findByRole("alert")).toHaveTextContent("港口不让卖");
    expect(onResult).not.toHaveBeenCalled();
    fail = false;
    await user.click(within(dlg).getByRole("button", { name: "解雇 3 名船员" }));
    await waitFor(() => expect(onResult).toHaveBeenLastCalledWith(false));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(useGame.getState().message).toBeNull();
  });
});
