import { type RefObject, useLayoutEffect } from "react";

const H_PAD = 20;

/**
 * Масштабирует панель (.dock) целиком под ширину viewport, не меняя порядок кнопок (nowrap + scale).
 */
export function useDockFitScale(dockRef: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const compute = () => {
      const el = dockRef.current;
      if (!el) return;
      el.style.transform = "scale(1)";
      void el.offsetWidth;
      const w = el.getBoundingClientRect().width;
      if (w <= 0) return;
      const vp = window.visualViewport;
      const vw = vp?.width ?? window.innerWidth;
      const maxW = Math.max(120, vw - H_PAD);
      const s = Math.min(1, maxW / w);
      el.style.transform = `scale(${Number(s.toFixed(4))})`;
    };

    const vp = window.visualViewport;

    const ro = new ResizeObserver(() => {
      requestAnimationFrame(compute);
    });
    ro.observe(document.documentElement);
    vp?.addEventListener("resize", compute);
    vp?.addEventListener("scroll", compute);
    window.addEventListener("orientationchange", compute);
    requestAnimationFrame(compute);

    return () => {
      ro.disconnect();
      vp?.removeEventListener("resize", compute);
      vp?.removeEventListener("scroll", compute);
      window.removeEventListener("orientationchange", compute);
    };
  }, []);
}
