// U06F4：K3 的名字（港、货、潮、见闻卡、好处）按视图与静态数据造一份（纯逻辑在 k3Kit.makeK3Names）。
import { useMemo } from "react";
import { useGame } from "../../../store/game";
import type { ActCtx } from "./actCtx";
import { makeK3Names, type K3Names } from "./k3Kit";

export function useK3Names(ctx: Pick<ActCtx, "act" | "view" | "names">): K3Names {
  const texts = useGame((s) => s.statics?.upbringing_act_texts);
  const locations = useGame((s) => s.statics?.locations);
  const goods = useGame((s) => s.statics?.goods);
  const { act, view, names } = ctx;
  return useMemo(() => makeK3Names(act, view, names, texts ?? {}, locations, goods), [act, view, names, texts, locations, goods]);
}
