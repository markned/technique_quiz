#!/usr/bin/env node
/**
 * Пакетная нормализация медиа (нужен `ffmpeg` в PATH):
 * - `public/content/audio/music/*` и `public/content/audio/ui/*` (кроме .m4a) → `.m4a` AAC 192
 * - фоны раундов: исходники с «Kunteynir» / «андеграунд» → `public/content/video/bg/bg_round_8.mp4`, `bg_round_9.mp4`
 * - прочие `webm`/`mov`/… в `public/content/video/` (в т.ч. `bg/`, `ui/`, `quiz/`) → `.mp4` H.264 + AAC
 *
 * Запуск: `node scripts/transcode-media.mjs`
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = join(__dirname, "..");

function ffmpegOk() {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function ff(args) {
  execFileSync("ffmpeg", args, { stdio: "inherit", cwd: root });
}

const AUDIO_EXTS = new Set([".mp3", ".wav", ".flac", ".ogg", ".aac"]);

function transcodeAudioDir(relDir, label) {
  const dir = join(root, relDir);
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const ext = extname(name).toLowerCase();
    if (ext === ".m4a") continue;
    if (!AUDIO_EXTS.has(ext)) continue;
    const inp = join(dir, name);
    const base = basename(name, ext);
    const outPath = join(dir, `${base}.m4a`);
    try {
      ff(["-y", "-i", inp, "-vn", "-c:a", "aac", "-b:a", "192k", outPath]);
      if (existsSync(outPath)) {
        unlinkSync(inp);
        console.log(`${label}: ${name} → ${base}.m4a`);
      }
    } catch (e) {
      console.warn(`${label} skip ${name}:`, e?.message ?? e);
    }
  }
}

const VIDEO_EXTS = new Set([".mp4", ".webm", ".mov", ".mkv", ".avi"]);

function transcodeBgAliases(bgDir) {
  const map = [
    { out: "bg_round_8.mp4", includes: "Kunteynir" },
    { out: "bg_round_9.mp4", includes: "андеграунд" },
  ];
  if (!existsSync(bgDir)) return;
  const all = readdirSync(bgDir);
  for (const { out, includes } of map) {
    const src = all.find((n) => n.includes(includes) && VIDEO_EXTS.has(extname(n).toLowerCase()));
    if (!src) {
      console.warn(`bg: не найден исходник для ${out} (фильтр «${includes}»)`);
      continue;
    }
    const inp = join(bgDir, src);
    const outp = join(bgDir, out);
    try {
      ff([
        "-y",
        "-i",
        inp,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-crf",
        "23",
        "-preset",
        "medium",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        outp,
      ]);
      console.log(`video bg: ${src} → ${out}`);
    } catch (e) {
      console.warn(`bg skip ${out}:`, e?.message ?? e);
    }
  }
}

function transcodeNonMp4VideosInDir(videoDir) {
  if (!existsSync(videoDir)) return;
  for (const name of readdirSync(videoDir)) {
    const ext = extname(name).toLowerCase();
    if (ext === ".mp4" || ext === "") continue;
    if (!VIDEO_EXTS.has(ext)) continue;
    const inp = join(videoDir, name);
    const base = basename(name, ext);
    const finalOut = join(videoDir, `${base}.mp4`);
    if (finalOut === inp) continue;
    try {
      ff([
        "-y",
        "-i",
        inp,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-crf",
        "23",
        "-preset",
        "medium",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        finalOut,
      ]);
      if (existsSync(finalOut)) {
        unlinkSync(inp);
        console.log(`video: ${name} → ${base}.mp4`);
      }
    } catch (e) {
      console.warn(`video skip ${name}:`, e?.message ?? e);
    }
  }
}

function main() {
  if (!ffmpegOk()) {
    console.error("ffmpeg не найден в PATH. Установите ffmpeg и повторите.");
    process.exit(1);
  }
  console.log("— Аудио (music + ui) → AAC 192 .m4a —");
  transcodeAudioDir("public/content/audio/music", "music");
  transcodeAudioDir("public/content/audio/ui", "ui");
  const videoDir = join(root, "public/content/video");
  const bgDir = join(videoDir, "bg");
  console.log("— Фоны раундов —");
  transcodeBgAliases(bgDir);
  console.log("— WebM/MOV/… → mp4 —");
  transcodeNonMp4VideosInDir(videoDir);
  transcodeNonMp4VideosInDir(bgDir);
  transcodeNonMp4VideosInDir(join(videoDir, "ui"));
  transcodeNonMp4VideosInDir(join(videoDir, "quiz"));
  console.log("Готово.");
}

main();
