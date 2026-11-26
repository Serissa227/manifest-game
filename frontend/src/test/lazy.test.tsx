// 按需加载（性能商议 2026-10-07 第 1 条）：主界面、养成主界面与各功能面板拆成单独的代码块。
// 代码到之前显示占位（稍等才出现，快的时候不闪），到了之后直接渲染；加载过的再挂载不经过占位；下载失败可以重试。
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Suspense, type ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";
import { Delayed, LoadBoundary } from "../components/shell/LoadBoundary";
import { loadable } from "../components/shell/loadable";

function Panel() {
  return <p>面板</p>;
}

function Host({ view: View }: { view: ComponentType }) {
  return (
    <LoadBoundary>
      <Suspense
        fallback={
          <Delayed ms={50}>
            <p>载入中</p>
          </Delayed>
        }
      >
        <View />
      </Suspense>
    </LoadBoundary>
  );
}

describe("按需加载的界面", () => {
  it("代码到之前：先什么都不显示，稍等才出现“载入中”；到了显示面板；再挂载直接渲染，不经过占位", async () => {
    let done: (m: { default: typeof Panel }) => void = () => {};
    const load = vi.fn(() => new Promise<{ default: typeof Panel }>((r) => (done = r)));
    const L = loadable(load);
    const first = render(<Host view={L.Component} />);
    expect(screen.queryByText("载入中")).toBeNull();
    expect(await screen.findByText("载入中")).toBeInTheDocument();
    await act(async () => done({ default: Panel }));
    expect(await screen.findByText("面板")).toBeInTheDocument();
    first.unmount();
    // 已经加载过：同步渲染，第一帧就是面板
    render(<Host view={L.Component} />);
    expect(screen.getByText("面板")).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("预先加载过的：第一次挂载就直接渲染", async () => {
    const load = vi.fn(() => Promise.resolve({ default: Panel }));
    const L = loadable(load);
    await L.preload();
    render(<Host view={L.Component} />);
    expect(screen.getByText("面板")).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("下载失败：显示“没能载入”与“重试”，重试重新下载；其他渲染错误照样往外抛", async () => {
    const user = userEvent.setup();
    let attempt = 0;
    const load = vi.fn(() => {
      attempt++;
      return attempt === 1 ? Promise.reject(new TypeError("Failed to fetch dynamically imported module: /manifest/assets/FleetPanel.js")) : Promise.resolve({ default: Panel });
    });
    const L = loadable(load);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Host view={L.Component} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("这部分界面没能载入");
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("面板")).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
    // 不是下载失败的错误：不在这里接住
    const Broken: ComponentType = () => {
      throw new Error("画坏了");
    };
    expect(() => render(<Host view={Broken} />)).toThrow("画坏了");
    err.mockRestore();
  });
});
