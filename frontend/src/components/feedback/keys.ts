// 键名：小键帽上显示的字与读屏念的名字。方向键显示箭头、念“上箭头”；回车、空格按语言写字；其余照原样（Esc、Shift、A……）。
import { t } from "../../i18n";

export interface KeyLabel {
  /** 键帽上显示的字 */
  text: string;
  /** 读屏念的名字（与显示的字相同时也给出） */
  name: string;
}

/** 按 KeyboardEvent.key 的写法（Enter、Escape、ArrowUp、" "……）或常见的简写（Esc、Space、↑）取键名。 */
export function keyLabel(key: string): KeyLabel {
  switch (key) {
    case "Enter":
    case "Return":
      return { text: t("v2.fb.key.enter"), name: t("v2.fb.key.enter") };
    case " ":
    case "Space":
    case "Spacebar":
      return { text: t("v2.fb.key.space"), name: t("v2.fb.key.space") };
    case "Escape":
    case "Esc":
      return { text: "Esc", name: "Esc" };
    case "ArrowUp":
    case "↑":
      return { text: "↑", name: t("v2.fb.key.up") };
    case "ArrowDown":
    case "↓":
      return { text: "↓", name: t("v2.fb.key.down") };
    case "ArrowLeft":
    case "←":
      return { text: "←", name: t("v2.fb.key.left") };
    case "ArrowRight":
    case "→":
      return { text: "→", name: t("v2.fb.key.right") };
    default:
      return { text: key, name: key };
  }
}
