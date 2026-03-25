import { useEffect, useState } from "react";

/** Телефоны / планшеты с касанием (не основной точный указатель). */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(pointer: coarse)").matches : false,
  );

  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const onChange = () => setCoarse(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return coarse;
}
