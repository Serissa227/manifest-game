// 第九批 P03 前端配套：本地请求序号与迟到的回复。
// - 新开局、读档、换世界（成败都算）序号加一；序号变了之后才回来的视图、迷雾回复不采用，按新序号重问。
// 全部用模拟的 Tauri IPC，不访问任何服务。
import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../ipc/api";
import { bumpRequestSeq, onRequestSeq, requestSeq, type SeqReason } from "../ipc/sequence";
import type { FogDelta } from "../ipc/types";
import { FogBits } from "../map/fogBits";
import { refreshFogDelta, resetChartFog, useChartFog } from "../map/fogStore";
import { useGame } from "../store/game";
import { attachView, resetViews, viewStats, type ViewSnapshot } from "../store/views";
import { installIpc, overview, startedGame } from "./fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resetChartFog();
});

describe("本地请求序号：新开局、读档、换世界", () => {
  beforeEach(() => {
    installIpc({
      select_world: () => ({ data_hash: "w" }),
      new_world_game: () => overview,
      load_game: (args) => {
        if (args.slot === "坏档") throw "存档损坏";
        return overview;
      },
    });
  });

  it("新开局、读档、换世界、世界开局都让序号加一；失败（超时的调用服务端可能已经换了世界）也加", async () => {
    const reasons: SeqReason[] = [];
    const off = onRequestSeq((_s, r) => reasons.push(r));
    const start = requestSeq();
    await api.newGame("新晋船主", 1);
    await api.loadGame("auto");
    await api.selectWorld("terra16");
    await api.newWorldGame({ world: "terra16" } as never);
    await expect(api.loadGame("坏档")).rejects.toBeTruthy();
    expect(reasons).toEqual(["new_game", "load", "world", "new_game", "load"]);
    expect(requestSeq()).toBe(start + 5);
    // 一般的查询不动序号
    await api.overview();
    expect(requestSeq()).toBe(start + 5);
    off();
  });
});

/** 让已经就绪的微任务都跑完。 */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe("迟到的回复：视图", () => {
  beforeEach(() => {
    installIpc({ load_game: () => overview, new_game: () => overview });
    startedGame();
    resetViews();
  });

  it("读档时还在路上的视图查询：回来的不交付，按新序号重问；已交付的在序号前进后也重问", async () => {
    const waiting: ((v: { world: string }) => void)[] = [];
    const fetch = vi.fn(() => new Promise<{ world: string }>((resolve) => waiting.push(resolve)));
    const seen: ViewSnapshot<{ world: string }>[] = [];
    const off = attachView<{ world: string }>("probe:1", { follow: true, quiet: true, fetch, notify: (s) => seen.push(s) });
    expect(fetch).toHaveBeenCalledTimes(1);

    await api.loadGame("auto");
    // 上一局发出的请求现在才回来：不是这一局的数据，哪怕需求没变
    waiting[0]({ world: "旧" });
    await flush();
    expect(seen).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);

    waiting[1]({ world: "新" });
    await flush();
    expect(seen).toEqual([{ data: { world: "新" }, status: "ok", error: null }]);

    // 已经交付的结果也是上一个序号的：重连（序号前进）后重问
    bumpRequestSeq("reconnect");
    expect(fetch).toHaveBeenCalledTimes(3);
    waiting[2]({ world: "重连后" });
    await flush();
    expect(seen[seen.length - 1]).toEqual({ data: { world: "重连后" }, status: "ok", error: null });
    off();
  });

  it("上一局发出的请求失败了也不报错（错误同样不是这一局的）", async () => {
    const rejects: ((e: unknown) => void)[] = [];
    const fetch = vi.fn(() => new Promise<string>((_resolve, reject) => rejects.push(reject)));
    const notify = vi.fn();
    const off = attachView<string>("probe:2", { follow: true, quiet: false, fetch, notify });
    await api.newGame("新晋船主");
    useGame.setState({ error: null });
    rejects[0]("旧局的错误");
    await flush();
    expect(notify).not.toHaveBeenCalled();
    expect(useGame.getState().error).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
    off();
  });

  it("没有人要的视图不因序号前进而查询", () => {
    const before = viewStats().started;
    bumpRequestSeq("reconnect");
    expect(viewStats().started).toBe(before);
  });
});

describe("迟到的回复：迷雾", () => {
  const MAP = "test:earth:h2";
  const W = 8;
  const H = 4;
  const bits = (runs: [number, number, number][]) => {
    const b = new FogBits(W, H);
    b.applyRuns(runs);
    return b;
  };

  it("新开局时还在路上的迷雾增量：回来的不采用，游标不变再问一次（后端按 epoch 给新一局的全量）", async () => {
    resetChartFog();
    const waiting: { args: Record<string, unknown>; resolve: (d: FogDelta) => void }[] = [];
    installIpc({
      new_game: () => overview,
      fog_delta: (args) => new Promise<FogDelta>((resolve) => waiting.push({ args, resolve })),
    });
    // 上一局的迷雾已经有了
    const first = refreshFogDelta(MAP, W, H);
    await waitFor(() => expect(waiting).toHaveLength(1));
    waiting[0].resolve({ epoch: "旧局", rev: 50, full: bits([[0, 0, 1]]).toBase64(), runs: [] });
    await first;
    expect(useChartFog.getState().state?.epoch).toBe("旧局");

    // 再要一次增量，在路上时开了新局
    const second = refreshFogDelta(MAP, W, H);
    await waitFor(() => expect(waiting).toHaveLength(2));
    expect(waiting[1].args).toEqual({ since: 50, epoch: "旧局" });
    await api.newGame("新晋船主");
    waiting[1].resolve({ epoch: "旧局", rev: 60, full: null, runs: [[3, 0, 7]] });
    // 旧局的增量不采用：再问一次，游标还是手上的（后端按 epoch 判断是不是同一局）
    await waitFor(() => expect(waiting).toHaveLength(3));
    expect(waiting[2].args).toEqual({ since: 50, epoch: "旧局" });
    expect(useChartFog.getState().state?.rev).toBe(50);
    expect(useChartFog.getState().state?.bits.get(0, 3)).toBe(false);

    const fresh = bits([[2, 0, 2]]);
    waiting[2].resolve({ epoch: "新局", rev: 3, full: fresh.toBase64(), runs: [] });
    await expect(second).resolves.toBe(true);
    const now = useChartFog.getState();
    expect(now.state?.epoch).toBe("新局");
    expect(now.state?.rev).toBe(3);
    expect(now.state?.bits.equals(fresh)).toBe(true);
    expect(now.changed).toBe("all");
  });

  it("序号一直在变时最多再问两次，不无限追下去；下一次刷新照常取", async () => {
    resetChartFog();
    const waiting: ((d: FogDelta) => void)[] = [];
    installIpc({ fog_delta: () => new Promise<FogDelta>((resolve) => waiting.push(resolve)) });
    const p = refreshFogDelta(MAP, W, H);
    for (let i = 0; i < 3; i++) {
      await waitFor(() => expect(waiting).toHaveLength(i + 1));
      bumpRequestSeq("reconnect");
      waiting[i]({ epoch: "e", rev: i, full: bits([]).toBase64(), runs: [] });
    }
    await expect(p).resolves.toBe(false);
    expect(waiting).toHaveLength(3);
    expect(useChartFog.getState().state).toBeNull();
  });
});
