// 启航一步的随机种子（开局向导与第九批的开局共用）：只收数字，可以留空。
// - 旧界面（v1）：放在底栏，与“开始新游戏”同一行（SeedField 原样，DOM 与以前相同）；
// - 新界面（v2）：放在启航一步的正文里（SeedBlock：种子 + 一句说明），底栏只留导航——手机上底栏不再折成两三行。
import { useId } from "react";
import { t } from "../../i18n";

/** 种子的输入框（v1 底栏里的原样）；describedBy 指向说明（v2）。 */
export function SeedField({ value, onChange, describedBy }: { value: string; onChange: (v: string) => void; describedBy?: string }) {
  return (
    <label className="ts-seed">
      <span className="ts-field-label">{t("startSeed")}</span>
      <input
        className="ts-input"
        aria-label={t("startSeed")}
        aria-describedby={describedBy}
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
      />
    </label>
  );
}

/** 新界面：正文里的种子，带一句说明（同一个数字开出同一个世界）。 */
export function SeedBlock({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const hint = useId();
  return (
    <div className="ts-seed-block">
      <SeedField value={value} onChange={onChange} describedBy={hint} />
      <p id={hint} className="ts-hint">
        {t("v2.start.seedHint")}
      </p>
    </div>
  );
}
