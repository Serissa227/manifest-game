// S02nF6（实测 M7）：读档 / 新开局 / 换世界以后，新一局的第一份概览到了，换局序号加一次（NavigationView 据此重取航行视图，
// 读回来的档与眼下签名相同时也不会空着）；之后的概览、重连与 1013 关闭都不再加（不多取成环）。不渲染界面。
import { describe, expect, it } from "vitest";
import { useNavStore } from "../hooks/useNavigation";
import { bumpRequestSeq } from "../ipc/sequence";
import { useGame } from "../store/game";
import { overview } from "./fixtures";

const nextOverview = () => useGame.setState({ overview: { ...overview } });

describe("换局序号", () => {
  it("读档、新开局、换世界：新一局的第一份概览到了各加一；之后的概览、重连、1013 不加", () => {
    useGame.setState({ overview });
    const start = useNavStore.getState().game;
    for (const [i, reason] of (["load", "new_game", "world"] as const).entries()) {
      bumpRequestSeq(reason);
      // 序号前进的当下不加（那时新一局的概览还没到）
      expect(useNavStore.getState().game).toBe(start + i);
      nextOverview();
      expect(useNavStore.getState().game).toBe(start + i + 1);
      nextOverview();
      expect(useNavStore.getState().game).toBe(start + i + 1);
    }
    bumpRequestSeq("reconnect");
    nextOverview();
    bumpRequestSeq("busy");
    nextOverview();
    expect(useNavStore.getState().game).toBe(start + 3);
  });
});
