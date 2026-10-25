import { memo, useMemo } from "react";

type TimerProps = {
  seconds: number;
  remaining?: boolean;
  isActive: boolean;
  totalSeconds: number;
};

function timerAccentColor(seconds: number, totalSeconds: number): string {
  if (totalSeconds <= 0 || !isFinite(seconds)) {
    return "#5b8cff";
  }
  const stress = 1 - Math.min(1, Math.max(0, seconds / totalSeconds));
  const redBlend = stress > 0.72 ? (stress - 0.72) / 0.28 : 0;
  const r = Math.round(91 + (239 - 91) * redBlend);
  const g = Math.round(140 + (68 - 140) * redBlend);
  const b = Math.round(255 + (68 - 255) * redBlend);
  return `rgb(${r},${g},${b})`;
}

const CIRCUMFERENCE = 2 * Math.PI * 45;

export const Timer = memo(function Timer({ seconds, isActive, totalSeconds, remaining = false }: TimerProps) {
  const ratio = totalSeconds > 0 ? Math.min(1, Math.max(0, seconds / totalSeconds)) : 0;
  const progress = totalSeconds > 0 ? (remaining ? ratio : 1 - ratio) : 0;
  const strokeDashoffset = CIRCUMFERENCE * (1 - progress);
  const accent = useMemo(() => timerAccentColor(seconds, totalSeconds), [seconds, totalSeconds]);

  return (
    <div className={`timer-wrap ${isActive ? "timer-wrap-active" : ""}`} aria-label="Таймер">
      <div className="timer-mobile-bar" aria-hidden>
        <div className="timer-mobile-bar-track">
          <div
            className="timer-mobile-bar-fill"
            style={{
              width: `${Math.min(100, Math.max(0, progress * 100))}%`,
              backgroundColor: accent,
            }}
          />
        </div>
        <span className="timer-mobile-value" style={{ color: accent }}>
          {seconds}
        </span>
      </div>
      <div className="timer-desktop-ring">
        <div className={`timer-corner ${isActive ? "timer-corner-active" : ""}`}>
          <svg className="timer-ring" viewBox="0 0 100 100" aria-hidden>
            <circle className="timer-ring-bg" cx="50" cy="50" r="45" fill="none" strokeWidth="6" />
            <circle
              className="timer-ring-fill"
              cx="50"
              cy="50"
              r="45"
              fill="none"
              strokeWidth="6"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              transform="rotate(-90 50 50)"
              style={{ stroke: accent }}
            />
          </svg>
          <span className="timer-value" style={{ color: accent }}>
            {seconds}
          </span>
        </div>
      </div>
    </div>
  );
});
