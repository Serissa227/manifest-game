// 分段控件（docs/UI-REDESIGN.md 第 4 节“标签页”：两三个选项的切换用分段控件，等宽几段、选中段白底浮起）。
// 新界面（v2）的设置里用它代替只有两三个选项的下拉框（昼夜光影、配乐风格）：一眼看到全部选项，一次点击换过去。
// 底下是原生的单选按钮（同一个 name），读屏念“单选按钮，2 之 1”，方向键在几段之间移动——与下拉框一样能用键盘操作。
// 只在 v2 下使用；v1 照旧用 common.tsx 的 Select（调用方用 useIsV2 判断）。
import { useId } from "react";

export interface SegmentedOption<V extends string> {
  value: V;
  label: string;
}

export function Segmented<V extends string>({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  /** 这一行的名字（左边的标签，也是整组的可访问名称） */
  label: string;
  value: V;
  options: readonly SegmentedOption<V>[];
  onChange: (v: V) => void;
  testId?: string;
}) {
  const id = useId();
  return (
    <div className="field v2-seg-field" data-testid={testId}>
      <span id={`${id}-label`}>{label}</span>
      <div className="v2-seg" role="radiogroup" aria-labelledby={`${id}-label`}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <label key={o.value} className={on ? "v2-seg-opt on" : "v2-seg-opt"}>
              <input type="radio" name={`${id}-seg`} value={o.value} checked={on} onChange={() => onChange(o.value)} />
              <span>{o.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
