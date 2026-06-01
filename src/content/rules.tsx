import { DEFAULT_QUIZ_SESSION_LENGTH, FREESTYLE_SESSION_LENGTH } from "../helpers/quizConfig";
import type { GameMode } from "../types";

type GameRulesCommonProps = {
  scope?: GameMode | "common";
};

/** Общие правила: до выбора режима и в паузе (кнопка «Правила») */
export function GameRulesCommon({ scope = "common" }: GameRulesCommonProps) {
  const showFreestyle = scope === "common" || scope === "freestyle";
  const showQuiz = scope === "common" || scope === "quiz";
  const sessionSummary =
    scope === "freestyle"
      ? `\n\nВо фристайле — ${FREESTYLE_SESSION_LENGTH} раундов. Удачи!`
      : scope === "quiz"
        ? `\n\nВ викторине — ${DEFAULT_QUIZ_SESSION_LENGTH} раундов. Удачи!`
        : `\n\nВ викторине — ${DEFAULT_QUIZ_SESSION_LENGTH} раундов, во фристайле — ${FREESTYLE_SESSION_LENGTH}. Удачи!`;

  return (
    <>
      {`Ваша задача: продолжить текст Паши Техника из группы Kunteynir.

Сначала звучит отрывок песни, на экране появляются строки, которые вы слышите.

`}
      {showFreestyle ? (
        <>
          {`• Фристайл — ${FREESTYLE_SESSION_LENGTH} раундов только с ответом в одну строку. Продолжите текст вслух после окончания таймера — тот, чей вариант ближе всех к оригиналу, получает баллы за раунд.

Креативные и угарные ответы, даже если они неправильные также вознаграждаются баллами.

`}
          <span className="rules-screen-text-hint">
            Данный режим больше подходит для игры в компании у большого экрана.
          </span>
        </>
      ) : null}
      {showQuiz ? (
        <>
          {`

• Викторина — все раунды с ответом из одной или нескольких строк. 

Выберите правильный ответ до окончания таймера из 4 вариантов или расставьте строки в правильном порядке.

`}
          <span className="rules-screen-text-hint">
            Данный режим больше подходит для игры с мобильного устройства.
          </span>
        </>
      ) : null}
      {sessionSummary}
    </>
  );
}
