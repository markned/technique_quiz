import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { apiUrl } from "./api";
import { CommunityRoundSchema, type Author, type CommunityRoundInput, type RoundDraft } from "./schema";
import { AudioWaveformTrim } from "../editor/AudioWaveformTrim";
import { LyricsLineEditor } from "../editor/LyricsLineEditor";
import { navigateToQuizPreview, stashRoundForPreview } from "../editor/previewRoundStorage";

const SESSION_KEY = "technique_quiz_author_session";
const EDITING_KEY = "technique_quiz_community_editing";
const statusLabel = {
  draft: "Черновик",
  submitted: "На проверке",
  rejected: "Нужны исправления",
  approved: "Одобрен",
};
const blank = (): CommunityRoundInput => ({
  title: "",
  audioFile: "",
  start: 0,
  end: 10,
  lyrics: [
    { id: 1, text: "" },
    { id: 2, text: "" },
  ],
  hintLineIds: [1],
  revealLineIds: [2],
});
function readSession() {
  try {
    return sessionStorage.getItem(SESSION_KEY) ?? "";
  } catch {
    return "";
  }
}
function readEditing() {
  try {
    return JSON.parse(sessionStorage.getItem(EDITING_KEY) ?? "null") as {
      selected: number | null;
      revision?: number | null;
      content: CommunityRoundInput;
    } | null;
  } catch {
    return null;
  }
}

export function CommunityApp() {
  const [token, setToken] = useState(readSession);
  const [user, setUser] = useState<Author | null>(null);
  const [rounds, setRounds] = useState<RoundDraft[]>([]);
  const [selected, setSelected] = useState<number | null>(() => readEditing()?.selected ?? null);
  const [revision, setRevision] = useState<number | null>(() => readEditing()?.revision ?? null);
  const [content, setContent] = useState<CommunityRoundInput>(() => readEditing()?.content ?? blank());
  const [users, setUsers] = useState<Author[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [invite, setInvite] = useState("");
  const [reviewComment, setReviewComment] = useState("");
  const draft = rounds.find((round) => round.id === selected);
  const isAuthor = !draft || draft.authorId === user?.id;
  const editable = isAuthor && draft?.status !== "submitted";
  const stale = !!draft && revision !== null && revision !== draft.revision;
  const dirty = isAuthor && (!draft || JSON.stringify(content) !== JSON.stringify(draft.content));
  const hasChanges =
    dirty && !!(content.title || content.audioFile || content.lyrics.some((line) => line.text));
  const leaving = useRef(false);
  const [leaveAction, setLeaveAction] = useState<(() => void) | null>(null);
  const requestLeave = (action: () => void) => {
    if (hasChanges) setLeaveAction(() => action);
    else action();
  };
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (hasChanges && !leaving.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [hasChanges]);

  const request = useCallback(
    async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
      const headers = new Headers(options.headers);
      if (token) headers.set("Authorization", `Bearer ${token}`);
      if (typeof options.body === "string") headers.set("Content-Type", "application/json");
      const response = await fetch(apiUrl(path), { ...options, headers });
      const data = (await response.json()) as T & { error?: string };
      if (!response.ok) {
        if (response.status === 401 && path !== "/api/login") {
          sessionStorage.removeItem(SESSION_KEY);
          setToken("");
          setUser(null);
        }
        throw new Error(data.error ?? "Не удалось выполнить запрос.");
      }
      return data;
    },
    [token],
  );
  const refresh = useCallback(async () => {
    const data = await request<{ rounds: RoundDraft[] }>("/api/rounds");
    setRounds(data.rounds);
  }, [request]);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void request<{ user: Author }>("/api/me")
      .then(async (data) => {
        if (cancelled) return;
        setUser(data.user);
        await refresh();
        if (data.user.role === "moderator") {
          const result = await request<{ users: Author[] }>("/api/users");
          if (!cancelled) setUsers(result.users);
        }
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message);
      });
    return () => {
      cancelled = true;
    };
  }, [token, request, refresh]);
  useEffect(() => {
    if (!user) return;
    sessionStorage.setItem(EDITING_KEY, JSON.stringify({ selected, revision, content }));
  }, [selected, revision, content, user]);
  useEffect(() => {
    if (!content.audioFile || !token) {
      setAudioUrl(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setAudioUrl(null);
    void fetch(apiUrl(content.audioFile), { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить трек.");
        const blob = await response.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setAudioUrl(objectUrl);
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [content.audioFile, token]);

  const save = async () => {
    if (stale) throw new Error("Раунд изменён. Открой его из списка заново.");
    const data = await request<{ round: RoundDraft }>(draft ? `/api/rounds/${draft.id}` : "/api/rounds", {
      method: draft ? "PUT" : "POST",
      body: JSON.stringify(draft ? { revision: revision ?? draft.revision, content } : content),
    });
    setSelected(data.round.id);
    setRevision(data.round.revision);
    setContent(data.round.content);
    await refresh();
    setNotice("Черновик сохранён.");
    return data.round;
  };
  const action = (name: string) =>
    run(async () => {
      if (!draft) return;
      if (stale) throw new Error("Раунд изменён. Открой его из списка заново.");
      const result = await request<{ round: RoundDraft }>(`/api/rounds/${draft.id}/${name}`, {
        method: "POST",
        body: JSON.stringify({ revision: revision ?? draft.revision, comment: reviewComment }),
      });
      setContent(result.round.content);
      setRevision(result.round.revision);
      await refresh();
      setReviewComment("");
      setNotice("Готово.");
    });
  const onRangeChange = useCallback(
    (start: number, end: number) => setContent((current) => ({ ...current, start, end })),
    [],
  );
  const preview = () =>
    run(async () => {
      CommunityRoundSchema.parse(content);
      const saved = isAuthor && dirty ? await save() : draft;
      if (!saved || !audioUrl) throw new Error("Дождись загрузки трека.");
      const blob = await (await fetch(audioUrl)).blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const ok = await stashRoundForPreview({ ...content, id: saved.id, audioFile: dataUrl });
      if (!ok) throw new Error("Недостаточно места для предпросмотра.");
      sessionStorage.setItem("technique_quiz_preview_return", "/community");
      navigateToQuizPreview("quiz");
    });

  if (!user)
    return (
      <main className="editor-app">
        <section className="editor-panel">
          <h1>Редактор сообщества</h1>
          <p>Вход для приглашённых авторов и модератора.</p>
          <AuthForm
            busy={busy}
            onSubmit={(path, body) =>
              run(async () => {
                const data = await request<{ token: string; user: Author }>(path, {
                  method: "POST",
                  body: JSON.stringify(body),
                });
                sessionStorage.setItem(SESSION_KEY, data.token);
                setToken(data.token);
                setUser(data.user);
              })
            }
          />
          {error ? <p role="alert">{error}</p> : null}
          <a
            href="/#menu"
            onClick={(e) => {
              e.preventDefault();
              requestLeave(() => {
                leaving.current = true;
                window.location.href = "/#menu";
              });
            }}
          >
            В игру
          </a>
        </section>
      </main>
    );

  return (
    <main className="editor-app">
      {leaveAction ? (
        <div
          className="confirm-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Несохранённые изменения"
        >
          <section className="confirm-dialog">
            <h2>Сохранить изменения?</h2>
            <p>В черновике есть несохранённые изменения.</p>
            <div className="confirm-actions">
              <button
                className="btn"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await save();
                    leaving.current = true;
                    const action = leaveAction;
                    setLeaveAction(null);
                    action();
                  })
                }
              >
                Сохранить и выйти
              </button>
              <button
                className="btn"
                disabled={busy}
                onClick={() => {
                  leaving.current = true;
                  const action = leaveAction;
                  setLeaveAction(null);
                  action();
                }}
              >
                Выйти без сохранения
              </button>
              <button className="btn" onClick={() => setLeaveAction(null)}>
                Остаться
              </button>
            </div>
          </section>
        </div>
      ) : null}
      <header className="editor-header">
        <h1>Редактор сообщества</h1>
        <span>
          {user.username} · {user.role === "moderator" ? "Модератор" : "Автор"}
        </span>
        <a
          href="/#menu"
          onClick={(e) => {
            e.preventDefault();
            requestLeave(() => {
              leaving.current = true;
              window.location.href = "/#menu";
            });
          }}
        >
          В игру
        </a>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            requestLeave(
              () =>
                void run(async () => {
                  await request("/api/logout", { method: "POST" });
                  sessionStorage.removeItem(SESSION_KEY);
                  sessionStorage.removeItem(EDITING_KEY);
                  setToken("");
                  setUser(null);
                  setRounds([]);
                  setSelected(null);
                  setRevision(null);
                  setContent(blank());
                }),
            )
          }
        >
          Выйти
        </button>
      </header>
      {error ? (
        <p className="editor-panel" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="editor-panel" role="status">
          {notice}
        </p>
      ) : null}
      <div className="editor-community-layout">
        <aside className="editor-panel">
          <h2>{user.role === "moderator" ? "Раунды и проверка" : "Мои раунды"}</h2>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (
                dirty &&
                (content.title || content.audioFile) &&
                !confirm("Несохранённые изменения будут потеряны. Продолжить?")
              )
                return;
              setSelected(null);
              setRevision(null);
              setContent(blank());
              setReviewComment("");
            }}
          >
            Новый раунд
          </button>
          <button type="button" disabled={busy} onClick={() => void run(refresh)}>
            Обновить список
          </button>
          <ul>
            {rounds.map((round) => (
              <li key={round.id}>
                <button
                  type="button"
                  disabled={busy}
                  aria-pressed={round.id === selected}
                  onClick={() => {
                    if (
                      dirty &&
                      (content.title || content.audioFile) &&
                      !confirm("Несохранённые изменения будут потеряны. Продолжить?")
                    )
                      return;
                    setSelected(round.id);
                    setRevision(round.revision);
                    setContent(round.content);
                    setReviewComment("");
                    setError(null);
                  }}
                >
                  {round.content.title || "Без названия"} · {statusLabel[round.status]}
                  {round.published ? " · В игре" : ""}
                  {user.role === "moderator" ? ` · ${round.authorName}` : ""}
                </button>
              </li>
            ))}
          </ul>
          {user.role === "moderator" ? (
            <>
              <h2>Приглашения</h2>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const data = await request<{ invite: string }>("/api/invites", { method: "POST" });
                    setInvite(data.invite);
                  })
                }
              >
                Создать приглашение
              </button>
              {invite ? (
                <p>
                  Одноразовый код, действует 7 дней:
                  <br />
                  <code style={{ overflowWrap: "anywhere" }}>{invite}</code>
                </p>
              ) : null}
              <h2>Авторы</h2>
              {users
                .filter((item) => item.role === "author")
                .map((item) => (
                  <p key={item.id}>
                    {item.username}{" "}
                    <button
                      disabled={busy}
                      type="button"
                      onClick={() =>
                        void run(async () => {
                          await request(`/api/users/${item.id}/block`, {
                            method: "POST",
                            body: JSON.stringify({ disabled: !item.disabled }),
                          });
                          const data = await request<{ users: Author[] }>("/api/users");
                          setUsers(data.users);
                        })
                      }
                    >
                      {item.disabled ? "Вернуть доступ" : "Закрыть доступ"}
                    </button>
                  </p>
                ))}
            </>
          ) : null}
        </aside>
        <section className="editor-panel">
          <h2>{draft ? `Раунд #${draft.id}` : "Новый раунд"}</h2>
          {draft?.comment ? <p role="status">Комментарий модератора: {draft.comment}</p> : null}
          {draft ? (
            <p>
              {statusLabel[draft.status]} · Версия {draft.revision}
              {draft.published ? " · Одобренная версия участвует в игре" : ""}
            </p>
          ) : null}
          <fieldset disabled={busy || !editable}>
            <label>
              Название
              <input
                value={content.title}
                maxLength={160}
                onChange={(event) => setContent({ ...content, title: event.target.value })}
              />
            </label>
            <label>
              Новый трек (MP3, M4A, OGG, WAV, до 25 МБ)
              <input
                type="file"
                accept="audio/mpeg,audio/mp4,audio/ogg,audio/wav,.mp3,.m4a,.ogg,.wav"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  void run(async () => {
                    if (file.size > 25 * 1024 * 1024) throw new Error("Максимальный размер трека — 25 МБ.");
                    const data = await request<{ audioFile: string }>("/api/media", {
                      method: "POST",
                      body: file,
                    });
                    setContent((current) => ({ ...current, audioFile: data.audioFile }));
                    setNotice("Трек загружен на сервер. Сохрани черновик.");
                  });
                }}
              />
            </label>
            <label>
              Начало, сек.
              <input
                type="number"
                min={0}
                max={1200}
                step="0.01"
                value={content.start}
                onChange={(event) => setContent({ ...content, start: Number(event.target.value) })}
              />
            </label>
            <label>
              Конец, сек.
              <input
                type="number"
                min={0}
                max={1200}
                step="0.01"
                value={content.end}
                onChange={(event) => setContent({ ...content, end: Number(event.target.value) })}
              />
            </label>
          </fieldset>
          {audioUrl ? (
            <AudioWaveformTrim
              audioUrl={audioUrl}
              start={content.start}
              end={content.end}
              onRangeChange={editable && !busy ? onRangeChange : () => {}}
            />
          ) : null}
          <fieldset disabled={busy || !editable}>
            <LyricsLineEditor
              lyrics={content.lyrics}
              hintLineIds={content.hintLineIds}
              revealLineIds={content.revealLineIds}
              onLyricsChange={(next) => setContent({ ...content, ...next })}
            />
          </fieldset>
          <div className="editor-actions">
            {editable ? (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await save();
                  })
                }
              >
                Сохранить черновик
              </button>
            ) : null}
            <button type="button" disabled={busy || !audioUrl} onClick={preview}>
              Тест раунда
            </button>
            {isAuthor && draft && draft.status !== "submitted" && draft.status !== "approved" ? (
              <button type="button" disabled={busy || dirty} onClick={() => action("submit")}>
                Отправить на проверку
              </button>
            ) : null}
            {isAuthor && draft?.status === "submitted" ? (
              <button type="button" disabled={busy} onClick={() => action("withdraw")}>
                Отозвать с проверки
              </button>
            ) : null}
          </div>
          {stale ? (
            <p role="alert">Раунд изменён. Открой его из списка заново перед сохранением или проверкой.</p>
          ) : null}
          {dirty ? <p>Есть несохранённые изменения.</p> : null}
          {user.role === "moderator" && draft ? (
            <section>
              <h2>Модерация</h2>
              {draft.status === "submitted" ? (
                <>
                  <label>
                    Комментарий
                    <textarea
                      value={reviewComment}
                      onChange={(event) => setReviewComment(event.target.value)}
                      maxLength={2000}
                    />
                  </label>
                  <button type="button" disabled={busy} onClick={() => action("approve")}>
                    Одобрить
                  </button>
                  <button
                    type="button"
                    disabled={busy || !reviewComment.trim()}
                    onClick={() => action("reject")}
                  >
                    Вернуть с комментарием
                  </button>
                </>
              ) : null}
              {draft.published ? (
                <button type="button" disabled={busy} onClick={() => action("unpublish")}>
                  Снять с публикации
                </button>
              ) : null}
            </section>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function AuthForm({ busy, onSubmit }: { busy: boolean; onSubmit: (path: string, body: unknown) => void }) {
  const [register, setRegister] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [invite, setInvite] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(register ? "/api/register" : "/api/login", { username, password, invite });
  };
  return (
    <form onSubmit={submit}>
      <fieldset disabled={busy}>
        <label>
          Логин
          <input
            value={username}
            autoComplete="username"
            pattern="[a-z0-9_-]{3,32}"
            required
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>
        <label>
          Пароль (от 12 символов)
          <input
            type="password"
            value={password}
            minLength={12}
            maxLength={128}
            autoComplete={register ? "new-password" : "current-password"}
            required
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {register ? (
          <label>
            Код приглашения
            <input value={invite} required onChange={(event) => setInvite(event.target.value)} />
          </label>
        ) : null}
        <button type="submit">{register ? "Создать аккаунт" : "Войти"}</button>
        <button type="button" onClick={() => setRegister(!register)}>
          {register ? "Уже есть аккаунт" : "У меня есть приглашение"}
        </button>
      </fieldset>
    </form>
  );
}
