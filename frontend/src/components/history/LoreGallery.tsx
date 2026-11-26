// 传说之船的 CG 画廊（秘闻页的船卡片上“看 CG”）：一张大图 + 一排缩略图，← → 翻页，Esc 关闭。
// 各版的时段与天况写在图下（art/lore.ts 的版本清单）。
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { loreSrc, loreVariants } from "../../art/lore";
import { t, tk } from "../../i18n";

export default function LoreGallery({ art, name, onClose }: { art: string; name: string; onClose: () => void }) {
  const vs = loreVariants(art);
  const [i, setI] = useState(0);
  const uid = useId();
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => close.current?.focus(), []);
  if (vs.length === 0) return null;
  const v = vs[Math.min(i, vs.length - 1)];
  const go = (d: number) => setI((k) => (k + d + vs.length) % vs.length);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    } else if (e.key === "ArrowLeft") go(-1);
    else if (e.key === "ArrowRight") go(1);
  };
  const caption = (p: (typeof vs)[number]) => `${tk(`sc.phase.${p[1]}`)} · ${tk(`sky.${p[2]}`)}`;
  return createPortal(
    <div className="lg-backdrop" data-testid="lore-gallery" onClick={onClose}>
      <div className="lg-modal" role="dialog" aria-modal="true" aria-labelledby={`${uid}-t`} onKeyDown={onKey} onClick={(e) => e.stopPropagation()}>
        <header className="lg-head">
          <h3 id={`${uid}-t`}>{t("sc.galleryTitle", { name })}</h3>
          <button ref={close} type="button" className="btn" onClick={onClose} data-testid="lore-gallery-close">
            {t("sc.galleryClose")}
          </button>
        </header>
        <figure className="lg-main">
          <img src={loreSrc(v[0], "large") ?? ""} alt={caption(v)} decoding="async" draggable={false} data-testid="lore-gallery-image" data-variant={v[0]} />
          <figcaption>
            {caption(v)} <span className="lg-count">{t("sc.galleryCount", { n: i + 1, total: vs.length })}</span>
          </figcaption>
        </figure>
        <div className="lg-thumbs" role="group" aria-label={t("sc.galleryTitle", { name })}>
          {vs.map((p, k) => (
            <button key={p[0]} type="button" className="lg-thumb" aria-pressed={k === i} aria-label={caption(p)} onClick={() => setI(k)}>
              <img src={loreSrc(p[0], "medium") ?? ""} alt="" aria-hidden decoding="async" loading="lazy" draggable={false} />
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
