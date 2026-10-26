import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

type TransitionOverlayProps = {
  visible: boolean;
  nextRoundTitle: string;
};

const TYPEWRITER_MS_PER_CHAR = 60;

export function TransitionOverlay({ visible, nextRoundTitle }: TransitionOverlayProps) {
  const reduced = useReducedMotion();
  const [displayedLength, setDisplayedLength] = useState(0);

  useEffect(() => {
    if (reduced || !visible || !nextRoundTitle) {
      setDisplayedLength(0);
      return;
    }
    setDisplayedLength(0);
    let n = 0;
    const id = setInterval(() => {
      n += 1;
      setDisplayedLength(n);
      if (n >= nextRoundTitle.length) {
        clearInterval(id);
      }
    }, TYPEWRITER_MS_PER_CHAR);
    return () => clearInterval(id);
  }, [visible, nextRoundTitle, reduced]);

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          className="transition-overlay"
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.35 }}
        >
          {nextRoundTitle ? (
            <div className="transition-overlay-bar genius-style">
              <span className="transition-overlay-text">
                {reduced ? nextRoundTitle : nextRoundTitle.slice(0, displayedLength)}
                {!reduced && displayedLength < nextRoundTitle.length && (
                  <span className="transition-overlay-caret" aria-hidden />
                )}
              </span>
            </div>
          ) : null}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
