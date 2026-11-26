import { useState, type ReactNode } from "react";

// 双行名字（EXPANSION.md §12.3）：专名在中文界面显示“中文 + 小一行英文”，英文界面只显示英文
export { BiName } from "./BiName";

export function Section({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <section className="section" data-testid={testId}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export interface TabItem<K extends string> {
  key: K;
  label: string;
  /** 标签前的小图标（对辅助技术隐藏，不改变标签的可访问名称） */
  icon?: ReactNode;
}

export function TabBar<K extends string>({
  items,
  active,
  onSelect,
  label,
}: {
  items: TabItem<K>[];
  active: K;
  onSelect: (k: K) => void;
  label: string;
}) {
  return (
    <div className="tabbar" role="tablist" aria-label={label}>
      {items.map((it) => (
        <button
          key={it.key}
          role="tab"
          aria-selected={it.key === active}
          className={it.key === active ? "tab active" : "tab"}
          onClick={() => onSelect(it.key)}
        >
          {it.icon && (
            <span className="tab-icon" aria-hidden="true">
              {it.icon}
            </span>
          )}
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** 整数输入框。 */
export function NumInput({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        aria-label={label}
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={(e) => {
          const v = Math.trunc(Number(e.target.value));
          onChange(Number.isFinite(v) ? v : 0);
        }}
      />
    </label>
  );
}

export function Select<V extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: V;
  /** disabled：这一项选不了（灰着；R10-FIX8 起改装单用它）；title：悬停说明 */
  options: { value: V; label: string; disabled?: boolean; title?: string }[];
  onChange: (v: V) => void;
  disabled?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select
        aria-label={label}
        disabled={disabled}
        value={String(value)}
        onChange={(e) => {
          const found = options.find((o) => String(o.value) === e.target.value);
          if (found) onChange(found.value);
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)} disabled={o.disabled} title={o.title}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** 点击后等待异步操作完成，期间禁用。title 为悬停提示（按钮文字写得短时，把完整说明放在这里）。 */
export function ActionButton({
  children,
  onClick,
  disabled,
  kind,
  title,
  describedBy,
}: {
  children: ReactNode;
  onClick: () => Promise<unknown> | void;
  disabled?: boolean;
  kind?: "primary" | "danger";
  title?: string;
  /** 不可用的原因写在旁边时，指向那段说明的 id（aria-describedby；不传时没有这个属性） */
  describedBy?: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className={kind ? `btn ${kind}` : "btn"}
      disabled={disabled || busy}
      title={title}
      aria-describedby={describedBy}
      onClick={async () => {
        setBusy(true);
        try {
          await onClick();
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
    </button>
  );
}

export function Empty({ text }: { text: string }) {
  return <p className="empty">{text}</p>;
}
