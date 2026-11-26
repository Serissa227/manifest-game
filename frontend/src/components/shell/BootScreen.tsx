// 开机画面（静态数据载入前）：深海底纹上的罗盘舵轮徽记与像素标题。
import type { ReactNode } from "react";
import { memo } from "../../art/render";
import { Sprite } from "../../art/Sprite";
import { drawEmblem, drawTitle } from "../../art/ui";
import { t } from "../../i18n";

export default function BootScreen({ children }: { children?: ReactNode }) {
  return (
    <main className="app boot">
      <div className="boot-inner">
        <Sprite px={memo("shell-emblem", drawEmblem)} scale={3} className="boot-emblem" />
        <Sprite px={memo("shell-title", () => drawTitle("Manifest"))} scale={4} className="boot-title" />
        <h1>{t("appTitle")}</h1>
        <p className="boot-tagline">{t("shellTagline")}</p>
        <p className="boot-loading">{t("loading")}</p>
      </div>
      {children}
    </main>
  );
}
