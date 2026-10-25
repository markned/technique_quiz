import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/plugins/regions";

type AudioWaveformTrimProps = {
  audioUrl: string | null;
  start: number;
  end: number;
  onRangeChange: (start: number, end: number) => void;
};

const TAIL_PREVIEW_SEC = 2.5;

/** Локальная волна + жёлтая область как триммер (ползунки по краям региона) */
export function AudioWaveformTrim({ audioUrl, start, end, onRangeChange }: AudioWaveformTrimProps) {
  const onRangeChangeRef = useRef(onRangeChange);
  useEffect(() => { onRangeChangeRef.current = onRangeChange; }, [onRangeChange]);
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionsPluginRef = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null);
  const regionIdRef = useRef("fragment");
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dur, setDur] = useState(0);
  const [playing, setPlaying] = useState(false);

  const playFragment = () => {
    const ws = wsRef.current;
    if (!ws || !ready) return;
    const d = dur || ws.getDuration();
    if (d <= 0) return;
    const s = Math.min(start, d - 0.1);
    const e = Math.min(Math.max(end, s + 0.25), d);
    void ws.play(s, e);
  };

  const playTail = () => {
    const ws = wsRef.current;
    if (!ws || !ready) return;
    const d = dur || ws.getDuration();
    if (d <= 0) return;
    const e = Math.min(Math.max(end, start + 0.25), d);
    const s = Math.max(0, e - TAIL_PREVIEW_SEC);
    void ws.play(s, e);
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !audioUrl) {
      return;
    }

    setLoadError(null);
    const regions = RegionsPlugin.create();
    regionsPluginRef.current = regions;

    const ws = WaveSurfer.create({
      container: el,
      height: 120,
      waveColor: "rgba(180, 190, 210, 0.45)",
      progressColor: "rgba(91, 140, 255, 0.45)",
      cursorColor: "#f8fbff",
      dragToSeek: true,
      plugins: [regions],
    });
    wsRef.current = ws;

    let cancelled = false;

    const onPlay = () => {
      if (!cancelled) setPlaying(true);
    };
    const onPause = () => {
      if (!cancelled) setPlaying(false);
    };
    ws.on("play", onPlay);
    ws.on("pause", onPause);
    ws.on("finish", onPause);

    void ws.load(audioUrl).then(() => {
      if (cancelled) return;
      const d = ws.getDuration();
      setDur(d);
      setReady(true);
      const s = Math.min(start, d - 0.1);
      const e = Math.min(Math.max(end, s + 0.25), d);
      regions.clearRegions();
      regions.addRegion({
        id: regionIdRef.current,
        start: s,
        end: e,
        color: "rgba(255, 220, 0, 0.38)",
        drag: true,
        resize: true,
      });
    }).catch(() => {
      if (!cancelled) setLoadError("Не удалось прочитать аудио. Проверь файл или загрузи другой трек.");
    });

    regions.on("region-updated", (region) => {
      if (region.id !== regionIdRef.current) return;
      onRangeChangeRef.current(region.start, region.end);
    });

    return () => {
      cancelled = true;
      setReady(false);
      setDur(0);
      setPlaying(false);
      ws.un("play", onPlay);
      ws.un("pause", onPause);
      ws.un("finish", onPause);
      regions.destroy();
      ws.destroy();
      wsRef.current = null;
      regionsPluginRef.current = null;
    };
  }, [audioUrl]);

  useEffect(() => {
    const regions = regionsPluginRef.current;
    if (!regions || !ready) return;
    const list = regions.getRegions();
    const r = list.find((x) => x.id === regionIdRef.current);
    if (!r) return;
    const d = dur || wsRef.current?.getDuration() || 0;
    if (d <= 0) return;
    const s = Math.min(start, d - 0.1);
    const e = Math.min(Math.max(end, s + 0.25), d);
    if (Math.abs(r.start - s) > 0.02 || Math.abs(r.end - e) > 0.02) {
      r.setOptions({ start: s, end: e });
    }
  }, [start, end, ready, dur]);

  if (!audioUrl) {
    return (
      <p className="editor-waveform-placeholder">
        Укажите имя файла в <code>public/content/audio/music/</code> или загрузите трек с диска — тогда появится волна и
        воспроизведение.
      </p>
    );
  }

  return (
    <div className="editor-waveform-wrap">
      {loadError ? <p role="alert">{loadError}</p> : null}
      <div className="editor-waveform-toolbar">
        <button
          type="button"
          className="editor-btn editor-btn--small"
          disabled={!ready}
          onClick={() => void wsRef.current?.playPause()}
        >
          {playing ? "Пауза" : "Play"}
        </button>
        <button type="button" className="editor-btn editor-btn--small" disabled={!ready} onClick={playFragment}>
          Фрагмент
        </button>
        <button type="button" className="editor-btn editor-btn--small" disabled={!ready} onClick={playTail} title="Последние ~2,5 с выбранного фрагмента">
          Хвост
        </button>
        <span className="editor-waveform-toolbar-hint">Клик по волне — перемотка (drag to seek)</span>
      </div>
      <div ref={containerRef} className="editor-waveform" />
      {ready && dur > 0 ? (
        <div className="editor-waveform-meta">
          Длительность файла: {dur.toFixed(2)} с · фрагмент: {start.toFixed(2)} — {end.toFixed(2)} с
        </div>
      ) : null}
    </div>
  );
}
