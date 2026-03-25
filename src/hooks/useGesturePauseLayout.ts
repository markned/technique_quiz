import { useEffect, useState } from "react";
import { useCoarsePointer } from "./useCoarsePointer";

const NARROW_MQ = "(max-width: 900px)";

/** Скрыть угловую кнопку паузы: тач или узкий экран (как в @media для квиза). */
export function useGesturePauseLayout(): boolean {
  const coarse = useCoarsePointer();
  const [narrow, setNarrow] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(NARROW_MQ).matches : false,
  );

  useEffect(() => {
    const mq = window.matchMedia(NARROW_MQ);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return coarse || narrow;
}
