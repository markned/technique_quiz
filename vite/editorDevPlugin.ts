import { execFileSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, extname, join } from "node:path";
import type { Plugin } from "vite";
import { toSafeAudioFilename } from "../src/helpers/safeAudioFilename";

function sanitizeBgVideoBasename(name: string): string | null {
  const base = name.replace(/^.*[/\\]/, "").replace(/\.\./g, "");
  if (!base || base.length > 220) return null;
  if (!/^[a-zA-Z0-9._-]+\.(mp4|webm|mov)$/i.test(base)) return null;
  return base;
}

/** После сохранения: AAC 192 в .m4a (нужен ffmpeg в PATH). */
function tryTranscodeUploadToM4aAac192(inputPath: string): string | null {
  const ext = extname(inputPath).toLowerCase();
  if (ext === ".m4a") return null;
  const base = basename(inputPath, ext);
  const outPath = join(dirname(inputPath), `${base}.m4a`);
  try {
    execFileSync("ffmpeg", ["-y", "-i", inputPath, "-vn", "-c:a", "aac", "-b:a", "192k", outPath], {
      stdio: "ignore",
      timeout: 300_000,
    });
    if (existsSync(outPath)) {
      try {
        unlinkSync(inputPath);
      } catch {
        /* оставляем оба файла */
      }
      return `${base}.m4a`;
    }
  } catch {
    try {
      if (existsSync(outPath)) unlinkSync(outPath);
    } catch {
      /* ignore */
    }
  }
  return null;
}

function hasGitStagedDiff(cwd: string): boolean {
  try {
    execFileSync("git", ["diff", "--cached", "--quiet"], { cwd, stdio: "ignore" });
    return false;
  } catch (e: unknown) {
    return (e as { status?: number }).status === 1;
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  const raw = await new Promise<Buffer>((resolve, reject) => {
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
  return JSON.parse(raw.toString("utf8") || "{}");
}

/**
 * Только `npm run dev`: запись `rounds.ts`, загрузка/удаление треков в `public/content/audio/music/`.
 */
export function editorDevPlugin(): Plugin {
  return {
    name: "editor-dev-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        if (url.startsWith("/api/editor/")) {
          const address = req.socket.remoteAddress ?? "";
          if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address)) {
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({ error: "Локальный редактор доступен только на компьютере разработчика." }),
            );
            return;
          }
        }
        if (url === "/api/editor/save-rounds" && req.method === "POST") {
          try {
            const body = (await readJsonBody(req)) as { content?: string };
            if (typeof body.content !== "string") {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "content required" }));
              return;
            }
            const target = join(server.config.root, "src/content/rounds/rounds.ts");
            await writeFile(target, body.content, "utf8");
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
          }
          return;
        }
        if (url === "/api/editor/upload-audio" && req.method === "POST") {
          try {
            const body = (await readJsonBody(req)) as { filename?: string; dataBase64?: string };
            const name = toSafeAudioFilename(body.filename ?? "track.m4a", randomUUID());
            if (!body.dataBase64) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "dataBase64 required" }));
              return;
            }
            const dir = join(server.config.root, "public/content/audio/music");
            await mkdir(dir, { recursive: true });
            const buf = Buffer.from(body.dataBase64, "base64");
            const absIn = join(dir, name);
            await writeFile(absIn, buf);
            const converted = tryTranscodeUploadToM4aAac192(absIn);
            const finalName = converted ?? name;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true, filename: finalName }));
          } catch (e) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
          }
          return;
        }
        if (url === "/api/editor/delete-audio" && req.method === "POST") {
          try {
            const body = (await readJsonBody(req)) as { filename?: string };
            const name = (body.filename ?? "").replace(/^.*[/\\]/, "").replace(/\.\./g, "");
            const fp = join(server.config.root, "public/content/audio/music", name);
            await unlink(fp).catch(() => {});
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
          }
          return;
        }
        if (url === "/api/editor/upload-video-bg" && req.method === "POST") {
          try {
            const body = (await readJsonBody(req)) as { filename?: string; dataBase64?: string };
            const name = sanitizeBgVideoBasename(body.filename ?? "");
            if (!name || !body.dataBase64) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "filename (.mp4/.webm/.mov) and dataBase64 required" }));
              return;
            }
            const dir = join(server.config.root, "public/content/video/bg");
            await mkdir(dir, { recursive: true });
            const buf = Buffer.from(body.dataBase64, "base64");
            const abs = join(dir, name);
            await writeFile(abs, buf);
            const relativePath = `bg/${name}`;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true, relativePath }));
          } catch (e) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
          }
          return;
        }
        if (url === "/api/editor/git-push" && req.method === "POST") {
          try {
            const body = (await readJsonBody(req)) as { roundsCount?: number };
            const n =
              typeof body.roundsCount === "number" && Number.isFinite(body.roundsCount)
                ? Math.floor(body.roundsCount)
                : 0;
            const root = server.config.root;
            const msg = `База: ${n} треков (rounds.ts, music/, ui/, video/)`;
            const pushedAt = new Date().toISOString();
            execFileSync(
              "git",
              [
                "add",
                "src/content/rounds/rounds.ts",
                "public/content/audio/music",
                "public/content/audio/ui",
                "public/content/video",
              ],
              { cwd: root, stdio: "pipe" },
            );
            if (!hasGitStagedDiff(root)) {
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: true, noop: true, message: "Нет изменений для коммита" }));
              return;
            }
            execFileSync("git", ["commit", "-m", msg], { cwd: root, stdio: "pipe" });
            execFileSync("git", ["push"], { cwd: root, stdio: "pipe" });
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true, pushedAt }));
          } catch (e) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
          }
          return;
        }
        next();
      });
    },
  };
}
