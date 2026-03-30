/**
 * Сколько раундов играть за одну сессию (из пула не скрытых в `rounds.ts`).
 * Заглушка до UI выбора длины (например 10 / 25 / 50).
 */
export const DEFAULT_QUIZ_SESSION_LENGTH = 14;

/** Базовый URL статики (`import.meta.env.BASE_URL` из Vite). */
const BASE = `${(import.meta.env.BASE_URL ?? "/").replace(/\/?$/, "/")}`;

/** Путь к файлу с учётом base (работает на GitHub Pages) */
export const assetUrl = (path: string) =>
  BASE + (path.startsWith("/") ? path.slice(1) : path);

/** Путь к файлу в `public/content/video/` с подпапками (кодируется каждое имя сегмента). */
export const assetUrlVideoRelative = (relativePath: string) =>
  assetUrl(
    `/content/video/${relativePath
      .trim()
      .split(/[/\\]+/)
      .filter(Boolean)
      .map((s) => encodeURIComponent(s))
      .join("/")}`,
  );

/**
 * Тайминги викторины — правь здесь:
 * - getGuessSeconds(revealLineCount) — 1 строка ответа=30с, 2=45с, 3+=60с
 * - STOP_SAFETY_MARGIN_SEC — запас до `end` (сек). Не делай слишком маленьким: между кадрами rAF и на
 *   мобильных шаг `currentTime` легко «перепрыгивает» через порог; после паузы позиция всё равно
 *   жёстко выставляется в `end - margin` (см. `fragmentStopTimeSec`).
 * - TRANSITION_FADE_MS — затухание в конце раунда; нарастание за ту же длительность на отрезке ДО start (мс)
 * - INTRO_VIDEO_SECONDS — сколько секунд показывать стартовое видео
 *
 * Тайминги фрагментов трека (start / end секунд) — в `src/content/rounds/rounds.ts` у каждого раунда.
 */
export const getGuessSeconds = (revealLineCount: number): number =>
  revealLineCount <= 1 ? 30 : revealLineCount === 2 ? 45 : 60;

/** ~4–5 кадров при 60 Hz + запас под мобильный движок; сама пауза дополнительно «прибивает» seek. */
export const STOP_SAFETY_MARGIN_SEC = 0.07;

/** Время, на котором останавливаем фрагмент (до `end`). */
export function fragmentStopTimeSec(fragmentEndSec: number): number {
  return Math.max(0, fragmentEndSec - STOP_SAFETY_MARGIN_SEC);
}
export const TRANSITION_FADE_MS = 2000;
/** Плавная смена фото / YouTube-фона между раундами (мс) */
export const BACKGROUND_CROSSFADE_MS = 1400;
/** Задержка между видео/раундами и стартом следующего фрагмента (мс) */
export const ROUND_DELAY_MS = 2000;
/** Пауза после подсветки верного ответа в викторине, до продолжения трека (мс). */
export const QUIZ_FEEDBACK_DELAY_MS = 1800;
/** Пауза после неверного ответа (длиннее, чтобы успела проиграться озвучка). */
export const QUIZ_FEEDBACK_DELAY_WRONG_MS = 4000;
export const INTRO_VIDEO_SECONDS = 15;

/** UI: таймер, правила, SFX — `public/content/audio/ui/`, единый формат AAC `.m4a` 192 kbps */
export const TIMER_COUNT_SOUND = assetUrl("/content/audio/ui/timercount.m4a");
/** Фристайл: конец таймера — по очереди `timerend.m4a` и `timerend2.m4a`. */
export const TIMER_END_SOUND = assetUrl("/content/audio/ui/timerend.m4a");
export const TIMER_END_SOUND_ALT = assetUrl("/content/audio/ui/timerend2.m4a");
/** Конец таймера в режиме «Викторина» (озвучка «Давайте думать») */
export const QUIZ_TIMER_END_SOUND = assetUrl("/content/audio/ui/quizTimerEnd.m4a");
/** Звук при выборе ответа в викторине. */
export const QUIZ_ANSWER_RIGHT_SOUND = assetUrl("/content/audio/ui/rightanswerselect.m4a");
export const QUIZ_ANSWER_WRONG_SOUND = assetUrl("/content/audio/ui/wronganswerselect.m4a");
/** Задержка перед опциональной озвучкой правил (`RulesCard` с `playAudio` + `audioSrc`) */
export const RULES_AUDIO_DELAY_MS = 2000;
export const INTRO_VIDEO_PATH = assetUrl("/content/video/ui/intro.mp4");

/** Фон половин экрана выбора режима — `public/content/video/ui/` */
export const MODE_SELECT_FREESTYLE_VIDEO = assetUrl("/content/video/ui/freestyleMenu.mp4");
export const MODE_SELECT_QUIZ_VIDEO = assetUrl("/content/video/ui/quizMenu.mp4");
/** Greenscreen-ролик над панелью управления (хромакей в WebGL), `public/content/video/ui/dock-chroma.mp4` */
export const DOCK_UI_CHROMA_VIDEO = assetUrl("/content/video/ui/dock-chroma.mp4");
export const OUTRO_VIDEO_PATH = assetUrl("/content/video/ui/outro.mp4");

/** Финальные ролики викторины — `public/content/video/quiz/` */
export const OUTRO_QUIZ_VIDEOS = [
  assetUrl("/content/video/quiz/1.mp4"),
  assetUrl("/content/video/quiz/2.mp4"),
  assetUrl("/content/video/quiz/3.mp4"),
  assetUrl("/content/video/quiz/4.mp4"),
  assetUrl("/content/video/quiz/5.mp4"),
] as const;

/** Индекс ролика 0..4 для счёта правильных ответов в викторине → файлы 1…5.mp4. */
export function outroQuizVideoIndexForScore(score: number): number {
  if (score <= 2) return 0;
  if (score <= 5) return 1;
  if (score <= 9) return 2;
  if (score <= 12) return 3;
  return 4;
}
