import { useLayoutEffect, useRef } from "react";

type UseFitTextToHeightOptions = {
  /** Верхняя граница кегля, если текст помещается */
  maxPx?: number;
  /** Нижняя граница бинарного поиска; ниже уменьшаем только если не влезает */
  floorMinPx?: number;
};

/**
 * Подбирает font-size так, чтобы текст полностью помещался по высоте (без прокрутки).
 */
export function useFitTextToHeight(options: UseFitTextToHeightOptions = {}) {
  const { maxPx = 44, floorMinPx = 8 } = options;
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLPreElement>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const el = textRef.current;
    if (!container || !el) return;

    const fit = () => {
      const maxH = container.clientHeight;
      if (maxH <= 0) return;

      el.style.fontSize = `${floorMinPx}px`;
      void el.offsetHeight;

      if (el.scrollHeight <= maxH) {
        let lo = floorMinPx;
        let hi = maxPx;
        for (let i = 0; i < 28; i++) {
          const mid = (lo + hi) / 2;
          el.style.fontSize = `${mid}px`;
          void el.offsetHeight;
          if (el.scrollHeight <= maxH) {
            lo = mid;
          } else {
            hi = mid;
          }
        }
        el.style.fontSize = `${lo}px`;
        return;
      }

      let size = floorMinPx;
      while (el.scrollHeight > maxH && size > 2) {
        size *= 0.88;
        el.style.fontSize = `${size}px`;
        void el.offsetHeight;
      }
    };

    const scheduleFit = () => {
      requestAnimationFrame(fit);
    };

    const ro = new ResizeObserver(scheduleFit);
    ro.observe(container);
    scheduleFit();

    const fonts = document.fonts;
    let cancelled = false;
    const p = fonts?.ready?.then(() => {
      if (!cancelled) scheduleFit();
    });
    window.addEventListener("orientationchange", scheduleFit);

    return () => {
      cancelled = true;
      ro.disconnect();
      window.removeEventListener("orientationchange", scheduleFit);
      void p;
    };
  }, [maxPx, floorMinPx]);

  return { containerRef, textRef };
}
