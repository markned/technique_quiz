import { useLayoutEffect, useRef } from "react";

const MIN_SCALE = 0.22;

/**
 * Масштабирует блок с вопросами/подсказками/вариантами (CSS zoom), чтобы всё помещалось по высоте без скролла.
 * `measureKey` — при смене контента (варианты, строки порядка и т.д.) пересчитываем масштаб.
 */
export function useQuizContentFit(measureKey: unknown) {
  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const outer = containerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    const fit = () => {
      const st = inner.style as unknown as { zoom?: string; transform?: string };
      st.zoom = "";
      st.transform = "";
      void inner.offsetHeight;

      const avail = outer.clientHeight;
      if (avail <= 0) return;

      const naturalH = inner.scrollHeight;
      if (naturalH <= 0) return;

      const s = Math.max(MIN_SCALE, Math.min(1, avail / naturalH));
      st.zoom = String(s);
    };

    const schedule = () => requestAnimationFrame(fit);
    const ro = new ResizeObserver(schedule);
    ro.observe(outer);
    ro.observe(inner);

    void document.fonts?.ready?.then(schedule);
    schedule();
    window.addEventListener("orientationchange", schedule);

    return () => {
      ro.disconnect();
      window.removeEventListener("orientationchange", schedule);
    };
  }, [measureKey]);

  return { containerRef, innerRef };
}
