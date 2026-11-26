// 可以拖动的画面（网页自适应）：画面比容器大时（手机上的港口街景），
// - 触屏：手指拖动就是浏览器原生的滚动；
// - 鼠标：按住拖动；只能左右移动时，滚轮也左右移动；拖动过的这一下不算点击（不会误开建筑）；
// - 换了画面（resetKey 变了）或容器、画面大小变了：回到初始位置——横向居中，纵向贴底（街面与海湾总在视野里）。
// 返回左右两边还有没有没看到的部分，界面据此显示边缘的提示。
import { useEffect, useState, type RefObject } from "react";

export interface PanEdges {
  left: boolean;
  right: boolean;
}

/** 拖动超过这么多像素才算拖动（否则是点击）。 */
const DRAG_PX = 5;

const NONE: PanEdges = { left: false, right: false };

/** 滚动容器此刻左右两边还有没有内容。 */
export function edgesOf(el: { scrollLeft: number; scrollWidth: number; clientWidth: number }): PanEdges {
  const max = el.scrollWidth - el.clientWidth;
  if (max <= 1) return NONE;
  return { left: el.scrollLeft > 1, right: el.scrollLeft < max - 1 };
}

/** 回到初始位置：横向居中、纵向贴底。 */
export function resetPan(el: HTMLElement): void {
  el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2);
  el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
}

/**
 * scroller：取滚动容器（例如港口街景里的 .pixel-stage）；resetKey：换画面时回到初始位置。
 */
export function usePanArea(scroller: RefObject<HTMLElement | null>, resetKey: unknown): PanEdges {
  const [edges, setEdges] = useState<PanEdges>(NONE);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () =>
      setEdges((prev) => {
        const next = edgesOf(el);
        return prev.left === next.left && prev.right === next.right ? prev : next;
      });
    resetPan(el);
    update();

    // 容器或画面大小变了：回到初始位置
    let lastSize = "";
    const onResize = () => {
      const size = `${el.clientWidth}x${el.clientHeight}/${el.scrollWidth}x${el.scrollHeight}`;
      if (size === lastSize) return;
      lastSize = size;
      resetPan(el);
      update();
    };
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);

    // 鼠标按住拖动（触屏交给浏览器原生滚动）
    let drag: { x: number; y: number; left: number; top: number; moved: boolean } | null = null;
    const swallowClick = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved && dx * dx + dy * dy < DRAG_PX * DRAG_PX) return;
      drag.moved = true;
      el.classList.add("is-dragging");
      el.scrollLeft = drag.left - dx;
      el.scrollTop = drag.top - dy;
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      el.classList.remove("is-dragging");
      if (drag?.moved) {
        // 拖动之后松开的这一下不算点击
        window.addEventListener("click", swallowClick, { capture: true, once: true });
        setTimeout(() => window.removeEventListener("click", swallowClick, { capture: true }), 0);
      }
      drag = null;
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      if (el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1) return;
      drag = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, moved: false };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    };
    // 左右放不下时，竖着滚的滚轮左右移动（上下多出来的只是一截天空，拖动或触控板照样能看）；
    // 触控板横着滑（deltaX 为主）交给浏览器
    const onWheel = (e: WheelEvent) => {
      const wide = el.scrollWidth > el.clientWidth + 1;
      if (!wide || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      ro?.disconnect();
      onUp();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("scroll", update);
    };
  }, [scroller, resetKey]);

  return edges;
}
