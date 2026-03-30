#!/usr/bin/env node
/**
 * Выравнивает громкость аудиодорожек под уровень интро (`ui/intro.mp4`):
 * EBU R128 loudnorm → I=-12 LUFS, TP=-1.5 dBTP, LRA=11 (как у измеренного интро).
 *
 * Обрабатывает `public/content/video/quiz/*.mp4` и `public/content/video/ui/*.mp4`,
 * кроме `intro.mp4` (эталон не перекодируется).
 *
 * Требуется ffmpeg в PATH. Запуск: node scripts/normalize-quiz-ui-video-loudness.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = join(__dirname, "..");

const TARGET_I = -12;
const TARGET_TP = -1.5;
const TARGET_LRA = 11;

function ffmpegOk() {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function normalizeFile(absPath) {
  const base = basename(absPath);
  if (base === "intro.mp4") {
    console.log(`skip (reference): ${absPath}`);
    return;
  }
  const ext = extname(absPath).toLowerCase();
  if (ext !== ".mp4") return;

  const tmp = `${absPath}.loudnorm.tmp.mp4`;
  const af = `loudnorm=I=${TARGET_I}:TP=${TARGET_TP}:LRA=${TARGET_LRA}:linear=true`;

  try {
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-hide_banner",
        "-i",
        absPath,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0",
        "-af",
        af,
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-ar",
        "48000",
        "-movflags",
        "+faststart",
        tmp,
      ],
      { stdio: "inherit", cwd: root },
    );
    unlinkSync(absPath);
    renameSync(tmp, absPath);
    console.log(`ok: ${base}`);
  } catch (e) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    console.error(`fail: ${base}`, e?.message ?? e);
    process.exitCode = 1;
  }
}

function main() {
  if (!ffmpegOk()) {
    console.error("ffmpeg не найден в PATH.");
    process.exit(1);
  }

  const dirs = ["public/content/video/quiz", "public/content/video/ui"];
  for (const rel of dirs) {
    const dir = join(root, rel);
    if (!existsSync(dir)) continue;
    const names = readdirSync(dir).filter((n) => extname(n).toLowerCase() === ".mp4");
    names.sort();
    for (const n of names) {
      normalizeFile(join(dir, n));
    }
  }
}

main();
