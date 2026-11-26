// 行情窗口（docs/ECONOMY.md 第 4 节）：选港口与商品；分页“推算”“对照旧账试算”“预测簿”（复盘在预测簿里）。
// 推算用的数学全在前端（src/forecast/）；记下的预测由后端的预测簿逐日追踪。
// 新界面（v2）：还没有收盘价时，空状态多一个“下一天”（EmptyState；旧界面照旧只有一句话）。
// FE1（T04）：港口下拉里远方的港写着是几天前的消息；选好以后一行写这里的行情是哪天的、现价、常价、比常价高低多少。
import { useEffect } from "react";
import { money, t, tk } from "../../i18n";
import { tz } from "../../i18n/zhOnly";
import { bpPct, seenLabel } from "./marketInfo";
import { api } from "../../ipc/api";
import { locById } from "../../ipc/byId";
import type { BookView } from "../../ipc/types";
import { useView } from "../../hooks/useView";
import { useForecast } from "../../store/forecast";
import { useGame } from "../../store/game";
import { methodName } from "../../forecast/labels";
import { BacktestView, BookList, Review } from "../analysis/Ledger";
import Workbench from "../analysis/Workbench";
import { NoCloseYet } from "../analysis/NoCloseYet";
import { Select, TabBar } from "../common";
import { Loading } from "../feedback";

/** 选中的港口与货：这里的行情是哪天的、现价、常价、比常价高低多少（T04；旧后端没有常价时只写时效）。 */
function PlaceLine({ place, good }: { place: BookView["places"][number]; good: number }) {
  const i = place.goods.indexOf(good);
  const price = i >= 0 ? place.prices?.[i] : undefined;
  const normal = i >= 0 ? place.normal?.[i] : undefined;
  const bp = i >= 0 ? place.vs_normal_bp?.[i] : undefined;
  const when = place.seen ? seenLabel(place.seen) : tz("an.live");
  const pct = typeof bp === "number" ? bpPct(bp) : null;
  const vs = pct === null ? null : pct > 0 ? tz("an.vs.up", { pct }) : pct < 0 ? tz("an.vs.down", { pct: -pct }) : tz("an.vs.even");
  return (
    <p className={place.seen ? "hint fc-place is-stale" : "hint fc-place"} data-testid="fc-place">
      {typeof price === "number" && typeof normal === "number" && vs
        ? tz("an.placeLine", { when, price: money(price), normal: money(normal), vs })
        : tz("an.placeWhen", { when })}
    </p>
  );
}

export default function AnalysisPanel() {
  const statics = useGame((s) => s.statics);
  // 按字段选取（P14a）：只看旗舰队停在哪个港口
  const here = useGame((s) => s.overview?.fleets[0]?.docked ?? null);
  const { loc, good, view, reviewId, select, setView } = useForecast();
  const bookView = useView<BookView>("forecast-book", () => api.forecastBook());
  const book = bookView.data;
  // 默认选旗舰所在的港口与那里的第一种商品；复盘时切到条目的市场
  const review = book?.entries.find((e) => e.id === reviewId) ?? null;
  const places = book?.places ?? [];
  const place = places.find((p) => p.loc === (review?.loc ?? loc)) ?? places.find((p) => p.loc === here) ?? places[0];
  const chosenLoc = place?.loc ?? null;
  const chosenGood = review?.good ?? (place && good !== null && place.goods.includes(good) ? good : (place?.goods[0] ?? null));
  useEffect(() => {
    if (chosenLoc !== null && chosenGood !== null && !review) select(chosenLoc, chosenGood);
  }, [chosenLoc, chosenGood, review, select]);
  const seriesKey = chosenLoc !== null && chosenGood !== null ? `mkseries:${chosenLoc}:${chosenGood}` : null;
  const { data: series } = useView(seriesKey, () => api.marketSeries(chosenLoc as number, chosenGood as number));
  if (!statics) return null;
  if (!book) return <Loading />;
  if (!place || chosenLoc === null || chosenGood === null) return <NoCloseYet />;

  const geniusText =
    book.geniuses.length === 0
      ? t("fc.geniusNone")
      : t("fc.geniuses", {
          list: book.geniuses
            .map((g) => t("fc.geniusLine", { name: g.name, methods: g.methods.map(methodName).join(t("listSep")) }))
            .join(t("listSep")),
        });
  return (
    <div className="pn pn-analysis" data-testid="analysis-panel">
      <div className="row fc-pick">
        <Select
          label={t("fc.port")}
          value={chosenLoc}
          options={places.map((p) => {
            const name = locById(statics, p.loc)?.name ?? String(p.loc);
            return { value: p.loc, label: p.seen && p.seen.age > 0 ? tz("an.portAge", { name, age: p.seen.age }) : name };
          })}
          onChange={(l) => {
            const p = places.find((x) => x.loc === l);
            if (p) select(l, p.goods.includes(chosenGood) ? chosenGood : p.goods[0]);
          }}
        />
        <Select
          label={t("fc.good")}
          value={chosenGood}
          options={place.goods.map((g) => ({ value: g, label: statics.goods[g]?.name ?? String(g) }))}
          onChange={(g) => select(chosenLoc, g)}
        />
      </div>
      <PlaceLine place={place} good={chosenGood} />
      <p className="hint fc-geniuses" data-testid="fc-geniuses">
        {geniusText}
      </p>
      <TabBar
        label={t("fc.title")}
        items={(["work", "backtest", "book"] as const).map((k) => ({ key: k, label: tk(`fc.tab.${k}`) }))}
        active={view}
        onSelect={setView}
      />
      {view === "work" && (series ? <Workbench series={series} book={book} onPinned={() => bookView.reload()} /> : <Loading />)}
      {view === "backtest" && (series ? <BacktestView series={series} /> : <Loading />)}
      {view === "book" &&
        (review ? <Review entry={review} series={series && series.loc === review.loc && series.good === review.good ? series : null} book={book} /> : <BookList book={book} onChange={() => bookView.reload()} />)}
    </div>
  );
}
