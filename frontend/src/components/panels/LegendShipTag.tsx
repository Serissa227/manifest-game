// 船名旁的“传说之船”小签（第九批 C11：ShipView.legend；来历见“秘闻 · 传说之船”）。
import { t } from "../../i18n";

export function LegendShipTag() {
  return (
    <span className="legend-ship-tag" title={t("legend.shipTagTitle")} data-testid="legend-ship-tag">
      {t("legend.shipTag")}
    </span>
  );
}
