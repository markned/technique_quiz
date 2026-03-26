import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LyricLine, Round } from "../types";
import { rounds as seedRounds } from "../content/rounds";
import { audioMusicUrl } from "../helpers/audioPaths";
import { AudioWaveformTrim } from "./AudioWaveformTrim";
import { LyricsLineEditor } from "./LyricsLineEditor";
import {
  deleteAudioFromMusicFolder,
  pushDatabaseGit,
  saveRoundsTsToWorkspace,
  uploadAudioToMusicFolder,
} from "./editorApi";
import {
  buildGeniusSearchQuery,
  pickRoundTitleFromTagsAndFilename,
  readArtistTitleFromAudioFile,
} from "./audioMetadata";
import {
  clampHintsAndReveal,
  clone,
  defaultAudioFileForTitle,
  editorLinesToLyrics,
  normalizeRoundHints,
  pruneRoundLyricsToHintsAndReveal,
} from "./editorUtils";
import { downloadTextFile, exportRoundsTsFile } from "./exportRoundsTs";
import {
  consumeEditorSnapshotForInitialState,
  gameHref,
  navigateToQuizPreview,
  stashEditorSnapshotBeforePreview,
  stashRoundForPreview,
} from "./previewRoundStorage";

export function RoundEditorApp() {
  const editorSnapshot = consumeEditorSnapshotForInitialState();
  const [rounds, setRounds] = useState<Round[]>(() =>
    editorSnapshot ? editorSnapshot.rounds.map(normalizeRoundHints) : clone(seedRounds),
  );
  const [selectedIndex, setSelectedIndex] = useState(() => editorSnapshot?.selectedIndex ?? 0);
  const [audioBlobs, setAudioBlobs] = useState<Record<number, string>>({});
  const [geniusUrl, setGeniusUrl] = useState("");
  const [geniusStatus, setGeniusStatus] = useState<string | null>(null);
  const importJsonInputRef = useRef<HTMLInputElement>(null);
  const importExportDetailsRef = useRef<HTMLDetailsElement>(null);

  const round = rounds[selectedIndex];

  const previewAudioUrl = useMemo(() => {
    if (!round) return null;
    const blob = audioBlobs[round.id];
    if (blob) return blob;
    const name = round.audioFile?.trim();
    if (!name) return null;
    return audioMusicUrl(name);
  }, [round, audioBlobs]);

  const updateRound = useCallback((patch: Partial<Round>) => {
    setRounds((prev) => {
      const next = [...prev];
      const i = selectedIndex;
      if (!next[i]) return prev;
      let merged: Round = { ...next[i], ...patch } as Round;
      if (Object.prototype.hasOwnProperty.call(patch, "backgroundYoutube") && patch.backgroundYoutube === undefined) {
        const { backgroundYoutube: _, ...rest } = merged;
        merged = rest as Round;
      }
      next[i] = merged;
      return next;
    });
  }, [selectedIndex]);

  const onAudioFile = useCallback(
    (file: File | null) => {
      if (!round) return;
      if (!file) {
        setAudioBlobs((b) => {
          const n = { ...b };
          delete n[round.id];
          return n;
        });
        return;
      }

      void (async () => {
        try {
          const savedName = await uploadAudioToMusicFolder(file);
          const url = URL.createObjectURL(file);
          setAudioBlobs((b) => {
            const prev = b[round.id];
            if (prev) URL.revokeObjectURL(prev);
            return { ...b, [round.id]: url };
          });
          updateRound({ audioFile: savedName });

          const base = file.name.replace(/\.[^.]+$/, "");
          const tags = await readArtistTitleFromAudioFile(file);
          const built = buildGeniusSearchQuery(tags, base);
          if (!built) {
            setGeniusStatus(
              "Файл скопирован в public/content/audio/music/. Нет исполнителя/названия в тегах и в имени файла — текст с Genius не подгружается.",
            );
            return;
          }
          const src =
            built.source === "metadata"
              ? "метаданные (исполнитель / трек)"
              : "имя файла";
          setGeniusStatus(`Ищем на Genius по ${src}: ${built.query}…`);
          try {
            const res = await fetch(
              `/api/genius-lyrics?search=${encodeURIComponent(built.query)}&_=${Date.now()}`,
              { cache: "no-store" },
            );
            const data = (await res.json()) as { title?: string; lyrics?: string; url?: string; error?: string };
            if (!res.ok) {
              throw new Error(data.error || res.statusText);
            }
            if (!data.lyrics?.trim()) {
              throw new Error("empty");
            }
            const lines = editorLinesToLyrics(data.lyrics ?? "");
            const fixed = clampHintsAndReveal(lines.length, [], 1);
            const roundTitle = pickRoundTitleFromTagsAndFilename(tags, base);
            updateRound({
              ...(roundTitle ? { title: roundTitle } : {}),
              lyrics: lines,
              hintLineIds: fixed.hintLineIds,
              revealLineIds: fixed.revealLineIds,
            });
            if (data.url) setGeniusUrl(data.url);
            setGeniusStatus(
              `Текст подставлен с Genius (${data.title ?? roundTitle ?? built.query}). Ссылка: ${data.url ?? "—"}`,
            );
          } catch {
            setGeniusStatus(
              "Текст на Genius не найден — вставьте ссылку на страницу вручную и нажмите «Загрузить текст».",
            );
          }
        } catch (e) {
          setGeniusStatus(`Ошибка загрузки файла: ${e instanceof Error ? e.message : String(e)}`);
        }
      })();
    },
    [round, updateRound],
  );

  const fetchGenius = useCallback(async () => {
    if (!geniusUrl.trim()) {
      setGeniusStatus("Вставьте ссылку");
      return;
    }
    if (!round) return;
    if (
      !confirm(
        "Текущий текст раунда и подсказки будут полностью заменены текстом со страницы Genius. Продолжить?",
      )
    ) {
      return;
    }
    setGeniusStatus("Загрузка…");
    try {
      const res = await fetch(
        `/api/genius-lyrics?url=${encodeURIComponent(geniusUrl.trim())}&_=${Date.now()}`,
        { cache: "no-store" },
      );
      const data = (await res.json()) as { title?: string; lyrics?: string; error?: string; url?: string };
      if (!res.ok) {
        throw new Error(data.error || res.statusText);
      }
      if (!data.lyrics?.trim()) {
        throw new Error(data.error || "Пустой текст");
      }
      const lines = editorLinesToLyrics(data.lyrics ?? "");
      const ac = Math.max(1, round.revealLineIds.length ?? 1);
      const fixed = clampHintsAndReveal(lines.length, [], ac);
      const merged: Round = {
        ...round,
        lyrics: lines,
        hintLineIds: fixed.hintLineIds,
        revealLineIds: fixed.revealLineIds,
      };
      updateRound(normalizeRoundHints(merged));
      setGeniusStatus(`Ок: ${lines.length} строк (текст заново разобран; название трека не меняли — при необходимости вручную)`);
    } catch (e) {
      setGeniusStatus(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [geniusUrl, updateRound, round]);

  const exportTs = useCallback(() => {
    downloadTextFile("rounds.ts", exportRoundsTsFile(rounds));
  }, [rounds]);

  const exportJson = useCallback(() => {
    downloadTextFile("rounds-editor.json", JSON.stringify({ rounds }, null, 2));
  }, [rounds]);

  const importJson = useCallback((file: File) => {
    const r = new FileReader();
    r.onload = () => {
      try {
        const j = JSON.parse(String(r.result)) as { rounds?: Round[] };
        if (!j.rounds) {
          setGeniusStatus("В JSON нет поля rounds");
          return;
        }
        setRounds(j.rounds.map(normalizeRoundHints));
        setSelectedIndex(0);
        setGeniusStatus("JSON импортирован");
      } catch {
        setGeniusStatus("Неверный JSON");
      }
    };
    r.readAsText(file);
  }, []);

  const fetchLyricsFromMetadata = useCallback(async () => {
    if (!round) return;
    const name = round.audioFile?.trim();
    if (!name) {
      setGeniusStatus("Укажите имя файла в music/ или загрузите трек с диска.");
      return;
    }
    if (
      !confirm(
        "Текущий текст раунда и подсказки будут полностью заменены результатом с Genius. Продолжить?",
      )
    ) {
      return;
    }
    setGeniusStatus("Читаем метаданные и запрашиваем Genius…");
    try {
      let file: File;
      const blobUrl = audioBlobs[round.id];
      if (blobUrl) {
        const resBlob = await fetch(blobUrl);
        const blob = await resBlob.blob();
        file = new File([blob], name, { type: blob.type || "audio/mpeg" });
      } else {
        const resBlob = await fetch(audioMusicUrl(name), { cache: "no-store" });
        if (!resBlob.ok) {
          throw new Error(`Файл не найден по пути public/content/audio/music/${name}`);
        }
        const blob = await resBlob.blob();
        file = new File([blob], name, { type: blob.type || "audio/mpeg" });
      }
      const tags = await readArtistTitleFromAudioFile(file);
      const base = name.replace(/\.[^.]+$/, "");
      const built = buildGeniusSearchQuery(tags, base);
      if (!built) {
        setGeniusStatus(
          "Не удалось составить запрос: нет исполнителя/названия в тегах и имя файла не по маске «Исполнитель - Название».",
        );
        return;
      }
      const res = await fetch(
        `/api/genius-lyrics?search=${encodeURIComponent(built.query)}&_=${Date.now()}`,
        { cache: "no-store" },
      );
      const data = (await res.json()) as { title?: string; lyrics?: string; url?: string; error?: string };
      if (!res.ok) {
        throw new Error(data.error || res.statusText);
      }
      if (!data.lyrics?.trim()) {
        throw new Error("empty");
      }
      const lines = editorLinesToLyrics(data.lyrics ?? "");
      const fixed = clampHintsAndReveal(lines.length, [], 1);
      const roundTitle = pickRoundTitleFromTagsAndFilename(tags, base);
      const merged: Round = normalizeRoundHints({
        ...round,
        ...(roundTitle ? { title: roundTitle } : {}),
        lyrics: lines,
        hintLineIds: fixed.hintLineIds,
        revealLineIds: fixed.revealLineIds,
      });
      updateRound(merged);
      if (data.url) setGeniusUrl(data.url);
      setGeniusStatus(
        `Текст подставлен с Genius (${data.title ?? roundTitle ?? built.query}). Ссылка: ${data.url ?? "—"}`,
      );
    } catch (e) {
      setGeniusStatus(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [round, audioBlobs, updateRound]);

  /** Одна кнопка: URL в поле → загрузка со страницы; пустое поле → по метаданным файла в music/. */
  const loadGeniusLyrics = useCallback(async () => {
    if (geniusUrl.trim()) {
      await fetchGenius();
    } else {
      await fetchLyricsFromMetadata();
    }
  }, [geniusUrl, fetchGenius, fetchLyricsFromMetadata]);

  const saveRoundToWorkspace = useCallback(async () => {
    if (!round) return;
    const pruned = pruneRoundLyricsToHintsAndReveal(round);
    const next = [...rounds];
    next[selectedIndex] = pruned;
    setRounds(next);
    try {
      await saveRoundsTsToWorkspace(exportRoundsTsFile(next));
      setGeniusStatus("Раунд сохранён: обновлён src/content/rounds/rounds.ts");
    } catch (e) {
      setGeniusStatus(`Ошибка сохранения: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [round, rounds, selectedIndex]);

  const titleDefaultAudio = useMemo(() => defaultAudioFileForTitle(round?.title ?? ""), [round?.title]);

  useEffect(() => {
    setRounds((prev) => {
      const r = prev[selectedIndex];
      if (!r) return prev;
      const n = r.lyrics.length;
      const ac = Math.max(1, r.revealLineIds.length);
      const fixed = clampHintsAndReveal(n, r.hintLineIds, ac);
      if (
        fixed.hintLineIds.join(",") === r.hintLineIds.join(",") &&
        fixed.revealLineIds.join(",") === r.revealLineIds.join(",")
      ) {
        return prev;
      }
      const out = [...prev];
      out[selectedIndex] = { ...r, ...fixed };
      return out;
    });
  }, [selectedIndex]);

  const onLyricsBlockChange = useCallback(
    (patch: { lyrics: LyricLine[]; hintLineIds: number[]; revealLineIds: number[] }) => {
      updateRound(patch);
    },
    [updateRound],
  );

  const deleteRound = useCallback(() => {
    if (!round) return;
    if (!confirm("Удалить этот раунд?")) return;
    const audioName = round.audioFile?.trim();
    setRounds((prev) => {
      const next = prev.filter((_, i) => i !== selectedIndex);
      if (audioName && !next.some((x) => x.audioFile?.trim() === audioName)) {
        void deleteAudioFromMusicFolder(audioName).catch(() => {});
      }
      return next;
    });
    setSelectedIndex((i) => Math.max(0, i - 1));
  }, [round, selectedIndex]);

  const duplicateRound = useCallback(() => {
    if (!round) return;
    const newId = Math.max(0, ...rounds.map((r) => r.id)) + 1;
    const copy: Round = normalizeRoundHints({
      ...round,
      lyrics: clone(round.lyrics),
      id: newId,
      title: `${round.title} (копия)`,
    });
    setRounds((prev) => {
      const next = [...prev];
      next.splice(selectedIndex + 1, 0, copy);
      return next;
    });
    setSelectedIndex((i) => i + 1);
  }, [round, rounds, selectedIndex]);

  if (!round) {
    return <div className="editor-root">Нет раундов</div>;
  }

  return (
    <div className="editor-root">
      <header className="editor-header">
        <h1 className="editor-title">Редактор раундов (только локально, npm run dev)</h1>
        <p className="editor-hint">
          Сохранение в репозиторий работает при <code>npm run dev</code> (запись в <code>src/content/rounds/rounds.ts</code> и{" "}
          <code>public/content/audio/music/</code>).
        </p>
        <div className="editor-toolbar">
          <div className="editor-toolbar-cluster editor-toolbar-cluster--left">
            <button
              type="button"
              className="editor-btn editor-btn--primary"
              onClick={() => {
                window.location.href = gameHref();
              }}
            >
              Запустить игру
            </button>
            <button
              type="button"
              className="editor-btn editor-btn--accent"
              onClick={() => {
                void (async () => {
                  if (!(await stashRoundForPreview(round))) {
                    window.alert(
                      "Не удалось сохранить раунд для предпросмотра (переполнено хранилище браузера). Попробуйте сократить текст раунда или закрыть лишние вкладки с этим сайтом.",
                    );
                    return;
                  }
                  stashEditorSnapshotBeforePreview({ rounds, selectedIndex });
                  navigateToQuizPreview();
                })();
              }}
            >
              Тест раунда
            </button>
          </div>
          <div className="editor-toolbar-cluster editor-toolbar-cluster--right">
            <details ref={importExportDetailsRef} className="editor-dropdown">
              <summary className="editor-btn editor-dropdown__summary">Импорт / Экспорт</summary>
              <div className="editor-dropdown__menu" role="menu">
                <button
                  type="button"
                  className="editor-dropdown__item"
                  role="menuitem"
                  onClick={() => {
                    exportTs();
                    importExportDetailsRef.current?.removeAttribute("open");
                  }}
                >
                  Скачать rounds.ts
                </button>
                <button
                  type="button"
                  className="editor-dropdown__item"
                  role="menuitem"
                  onClick={() => {
                    exportJson();
                    importExportDetailsRef.current?.removeAttribute("open");
                  }}
                >
                  Скачать JSON
                </button>
                <button
                  type="button"
                  className="editor-dropdown__item"
                  role="menuitem"
                  onClick={() => {
                    importJsonInputRef.current?.click();
                  }}
                >
                  Импорт JSON…
                </button>
              </div>
            </details>
            <input
              ref={importJsonInputRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importJson(f);
                e.target.value = "";
                importExportDetailsRef.current?.removeAttribute("open");
              }}
            />
            <button type="button" className="editor-btn editor-btn--primary" onClick={() => void saveRoundToWorkspace()}>
              Сохранить
            </button>
            {import.meta.env.DEV ? (
              <button
                type="button"
                className="editor-btn"
                onClick={() => {
                  if (!confirm("Выполнить git add, commit и push для rounds.ts и public/content/audio/music/?")) return;
                  void (async () => {
                    setGeniusStatus("Git: выполняется…");
                    const result = await pushDatabaseGit(rounds.length);
                    if (!result.ok) {
                      setGeniusStatus(`Git: ошибка — ${result.error}`);
                      return;
                    }
                    if (result.noop) {
                      setGeniusStatus(`Git: ${result.message ?? "без изменений"}`);
                      return;
                    }
                    setGeniusStatus("Git: push выполнен");
                  })();
                }}
              >
                Commit + push базы
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="editor-layout">
        <aside className="editor-sidebar">
          <div className="editor-sidebar-head">
            <span>Раунды ({rounds.length})</span>
          </div>
          <ul className="editor-round-list">
            {rounds.map((r, i) => (
              <li key={r.id} className="editor-round-row">
                <button
                  type="button"
                  className={`editor-round-item ${i === selectedIndex ? "is-active" : ""} ${r.hidden ? "is-hidden" : ""}`}
                  onClick={() => setSelectedIndex(i)}
                >
                  <span className="editor-round-id">{r.id}</span>
                  <span className="editor-round-title">{r.title}</span>
                </button>
                <label className="editor-round-hidden">
                  <input
                    type="checkbox"
                    checked={!!r.hidden}
                    onChange={(e) => {
                      const hidden = e.target.checked;
                      setRounds((prev) => {
                        const next = [...prev];
                        const cur = next[i];
                        if (!cur) return prev;
                        if (hidden) {
                          next[i] = { ...cur, hidden: true };
                        } else {
                          const { hidden: _, ...rest } = cur;
                          next[i] = rest as Round;
                        }
                        return next;
                      });
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span>скрыт</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="editor-sidebar-foot">
            <button
              type="button"
              className="editor-btn editor-btn--small editor-btn--block"
              onClick={() => {
                setRounds((prev) => {
                  const id = Math.max(0, ...prev.map((r) => r.id)) + 1;
                  const title = "Новый трек";
                  const nr: Round = {
                    id,
                    title,
                    audioFile: defaultAudioFileForTitle(title),
                    start: 0,
                    end: 10,
                    lyrics: editorLinesToLyrics(
                      "Подсказка (строки с номерами слева)\nОтвет — строки сразу после последней подсказки",
                    ),
                    hintLineIds: [1],
                    revealLineIds: [2],
                  };
                  const next = [...prev, nr];
                  setSelectedIndex(next.length - 1);
                  return next;
                });
              }}
            >
              + раунд
            </button>
          </div>
        </aside>

        <main className="editor-main">
          <section className="editor-section">
            <div className="editor-section-head">
              <h2>Раунд #{round.id}</h2>
              <div className="editor-section-actions">
                <button type="button" className="editor-btn editor-btn--small" onClick={duplicateRound}>
                  Дублировать
                </button>
              </div>
            </div>
            <label className="editor-field">
              <span>Название трека (title)</span>
              <input
                type="text"
                value={round.title}
                onChange={(e) => {
                  const t = e.target.value;
                  updateRound({ title: t });
                }}
              />
            </label>
            <p className="editor-muted">
              Файл аудио по умолчанию для такого названия: <code>{titleDefaultAudio}</code> — поменяйте поле ниже при необходимости.
            </p>
            <div className="editor-row">
              <label className="editor-field">
                <span>start (сек)</span>
                <input
                  type="number"
                  step="0.01"
                  value={round.start}
                  onChange={(e) => updateRound({ start: parseFloat(e.target.value) || 0 })}
                />
              </label>
              <label className="editor-field">
                <span>end (сек)</span>
                <input
                  type="number"
                  step="0.01"
                  value={round.end}
                  onChange={(e) => updateRound({ end: parseFloat(e.target.value) || 0 })}
                />
              </label>
            </div>
          </section>

          <section className="editor-section">
            <h2>Аудио фрагмент</h2>
            <label className="editor-field">
              <span>Файл в public/content/audio/music/</span>
              <input
                type="text"
                value={round.audioFile}
                onChange={(e) => updateRound({ audioFile: e.target.value })}
              />
            </label>
            <p className="editor-muted">
              При загрузке с диска файл копируется в <code>public/content/audio/music/</code>. Волна и Play / «Фрагмент» — из этого файла или из локального превью до перезагрузки страницы.
            </p>
            <label className="editor-btn editor-btn--file">
              Загрузить аудио (копия в music/)
              <input
                type="file"
                accept="audio/*"
                hidden
                onChange={(e) => onAudioFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <p className="editor-muted">
              После загрузки текст ищется на Genius по тегам или по имени <code>Исполнитель - Название</code>.
            </p>
            <AudioWaveformTrim
              key={`${round.id}-${previewAudioUrl ?? "none"}`}
              audioUrl={previewAudioUrl}
              start={round.start}
              end={round.end}
              onRangeChange={(start, end) => updateRound({ start, end })}
            />
          </section>

          <section className="editor-section">
            <h2>Текст с Genius</h2>
            <p className="editor-muted">
              Вставьте ссылку на страницу трека и нажмите «Загрузить текст» — текст возьмётся с Genius. Оставьте поле
              пустым — поиск по метаданным и имени файла в <code>music/</code> (или по локально загруженному треку).
            </p>
            <div className="editor-row editor-genius-row">
              <input
                className="editor-input-grow"
                type="url"
                placeholder="https://genius.com/... (необязательно, см. текст выше)"
                value={geniusUrl}
                onChange={(e) => setGeniusUrl(e.target.value)}
              />
              <button type="button" className="editor-btn editor-btn--primary editor-genius-load-btn" onClick={() => void loadGeniusLyrics()}>
                Загрузить текст
              </button>
            </div>
            {geniusStatus ? <p className="editor-status">{geniusStatus}</p> : null}
            <h3 className="editor-subsection-title">Текст раунда</h3>
            <LyricsLineEditor
              lyrics={round.lyrics}
              hintLineIds={round.hintLineIds}
              revealLineIds={round.revealLineIds}
              onLyricsChange={onLyricsBlockChange}
            />
          </section>

          <section className="editor-section">
            <h2>Фон YouTube (опционально)</h2>
            <p className="editor-muted">Только для этого раунда; оставьте URL пустым, чтобы использовать обычное фото.</p>
            <label className="editor-field">
              <span>URL ролика</span>
              <input
                type="url"
                placeholder="https://www.youtube.com/watch?v=..."
                value={round.backgroundYoutube?.url ?? ""}
                onChange={(e) => {
                  const url = e.target.value.trim();
                  if (!url) {
                    updateRound({ backgroundYoutube: undefined });
                    return;
                  }
                  updateRound({
                    backgroundYoutube: {
                      url,
                      start: round.backgroundYoutube?.start ?? 0,
                    },
                  });
                }}
              />
            </label>
            <label className="editor-field">
              <span>Старт фона (сек)</span>
              <input
                type="number"
                step="1"
                value={round.backgroundYoutube?.start ?? 0}
                disabled={!round.backgroundYoutube?.url}
                onChange={(e) => {
                  const start = parseFloat(e.target.value) || 0;
                  if (!round.backgroundYoutube?.url) return;
                  updateRound({
                    backgroundYoutube: { ...round.backgroundYoutube, start },
                  });
                }}
              />
            </label>
          </section>

          <section className="editor-section editor-actions">
            <button type="button" className="editor-btn editor-btn--danger" onClick={deleteRound}>
              Удалить раунд
            </button>
          </section>
        </main>
      </div>
    </div>
  );
}
