import { memo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { LyricLine } from "../types";

type LyricsPanelProps = {
  hintLines: LyricLine[];
  visibleCount: number;
};

export const LyricsPanel = memo(function LyricsPanel({ hintLines, visibleCount }: LyricsPanelProps) {
  const reduced = useReducedMotion();
  const visibleLines = hintLines.slice(0, visibleCount);

  return (
    <section className="lyrics-panel genius-style">
      <div className="lyrics-list">
        {visibleLines.map((line) => (
          <motion.p
            key={line.id}
            className="lyric-line genius-bar"
            initial={reduced ? false : { opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: reduced ? 0 : 0.25 }}
          >
            {line.text || "•••"}
          </motion.p>
        ))}
      </div>
    </section>
  );
});
