/** Иконка повтора с треугольником play по центру (для кнопки «Повторить фрагмент»). */
export function ReplayWithPlayIcon() {
  return (
    <span className="dock-replay-with-play" aria-hidden>
      <svg className="dock-replay-with-play__replay" viewBox="0 0 24 24" width="24" height="24" focusable="false">
        <path
          fill="currentColor"
          d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"
          opacity="0.5"
        />
      </svg>
      <svg className="dock-replay-with-play__play" viewBox="0 0 24 24" width="24" height="24" focusable="false">
        <path fill="currentColor" d="M10 8.5v7l6-3.5l-6-3.5z" />
      </svg>
    </span>
  );
}
