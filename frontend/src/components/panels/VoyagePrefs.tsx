// H08 设置里与航海有关的三项开关（旧后端没有这些字段时不显示）：远处的天气团与商船只降到 1×（H03）、
// 到港时显示航程总结、新系统第一次出现时的一句话提示。写在新文件里，设置面板只加一行。
import { tz } from "../../i18n/zhOnly";
import type { AppSettings } from "../../ipc/types";

const KEYS = ["navigation_slow", "voyage_summary", "voyage_hints"] as const;

export default function VoyagePrefs({ draft, setDraft }: { draft: AppSettings; setDraft: (s: AppSettings) => void }) {
  return (
    <>
      {KEYS.filter((k) => draft[k] !== undefined).map((k) => (
        <label className="field" key={k}>
          <input type="checkbox" aria-label={tz(`settings.${k}`)} checked={draft[k] !== false} onChange={(e) => setDraft({ ...draft, [k]: e.target.checked })} />
          <span>{tz(`settings.${k}`)}</span>
        </label>
      ))}
    </>
  );
}
