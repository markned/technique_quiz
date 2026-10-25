import { DurableObject } from "cloudflare:workers";
import { readRequestBody, RequestBodyError } from "./requestBody";
import { FreeTierLimitError, readBudgetedMedia, writeBudgetedMedia } from "./freeTier";
import { z } from "zod";
import {
  CommunityRoundSchema,
  DraftRoundSchema,
  type Author,
  type RoundDraft,
} from "../src/community/schema";

export type CommunityEnv = {
  Media: R2Bucket;
  ADMIN_SETUP_SECRET?: string;
  APP_ORIGIN?: string;
};
type Account = Author & { salt: string; passwordHash: string };
type Session = { userId: string; expiresAt: number };
type MediaRecord = { ownerId: string; public: boolean; contentType: string };
const credentials = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_-]{3,32}$/),
  password: z.string().min(12).max(128),
});
const hex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
async function digest(text: string) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}
async function passwordHash(password: string, salt: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  return hex(
    await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 100_000 },
      key,
      256,
    ),
  );
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function requireThat(condition: unknown, status: number, message: string): asserts condition {
  if (!condition) throw new ApiError(status, message);
}
const publicAccount = ({ id, username, role, disabled }: Account): Author => ({
  id,
  username,
  role,
  disabled,
});

export class CommunityStore extends DurableObject<CommunityEnv> {
  private pending: Promise<unknown> = Promise.resolve();
  private uploadPending: Promise<unknown> = Promise.resolve();
  fetch(request: Request): Promise<Response> {
    const upload = new URL(request.url).pathname === "/api/media" && request.method === "POST";
    const run = () => this.prepareAndEnqueue(request, upload);
    if (!upload) return run();
    // Bound upload memory without making catalogue/auth reads wait on a slow browser.
    const result = this.uploadPending.then(run);
    this.uploadPending = result.then(() => undefined);
    return result;
  }
  private async prepareAndEnqueue(request: Request, upload: boolean): Promise<Response> {
    try {
      if (request.body) {
        if (upload) await this.account(request);
        const body = await readRequestBody(request, upload ? 25 * 1024 * 1024 : 64_000);
        request = new Request(request, { body });
      }
      const result = this.pending.then(() => this.handle(request));
      this.pending = result.catch(() => undefined);
      return await result;
    } catch (error) {
      if (
        error instanceof ApiError ||
        error instanceof RequestBodyError ||
        error instanceof FreeTierLimitError
      )
        return Response.json({ error: error.message }, { status: error.status });
      if (error instanceof z.ZodError)
        return Response.json({ error: error.issues[0]?.message ?? "Проверь данные." }, { status: 400 });
      console.error("Community request failed", error);
      return Response.json({ error: "Не удалось выполнить запрос. Попробуй ещё раз." }, { status: 500 });
    }
  }
  private async json(request: Request) {
    requireThat(Number(request.headers.get("content-length") ?? 0) <= 64_000, 413, "Запрос слишком большой.");
    const text = await request.text();
    requireThat(text.length <= 64_000, 413, "Запрос слишком большой.");
    try {
      return JSON.parse(text);
    } catch {
      throw new ApiError(400, "Неверные данные запроса.");
    }
  }
  private async account(request: Request): Promise<Account> {
    const token = request.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";
    requireThat(token.length >= 32 && token.length <= 100, 401, "Войди в аккаунт.");
    const session = await this.ctx.storage.get<Session>(`session:${await digest(token)}`);
    requireThat(session && session.expiresAt > Date.now(), 401, "Сессия истекла. Войди снова.");
    const user = await this.ctx.storage.get<Account>(`user:${session.userId}`);
    requireThat(user && !user.disabled, 403, "Доступ к редактору закрыт.");
    return user;
  }
  private async newSession(user: Account) {
    const token = crypto.randomUUID() + crypto.randomUUID();
    await this.ctx.storage.put(`session:${await digest(token)}`, {
      userId: user.id,
      expiresAt: Date.now() + 7 * 24 * 3600_000,
    });
    await this.ctx.storage.setAlarm(Date.now() + 24 * 3600_000);
    return Response.json({ token, user: publicAccount(user) });
  }
  alarm() {
    const result = this.pending.then(() => this.cleanExpired());
    this.pending = result.catch((error) => console.error("Community cleanup failed", error));
    return result;
  }
  private async cleanExpired() {
    for (const prefix of ["session:", "invite:", "limit:"]) {
      const records = await this.ctx.storage.list<{ expiresAt: number }>({ prefix });
      const expired = [...records].filter(([, item]) => item.expiresAt <= Date.now()).map(([key]) => key);
      for (let i = 0; i < expired.length; i += 128) await this.ctx.storage.delete(expired.slice(i, i + 128));
    }
    await this.ctx.storage.setAlarm(Date.now() + 24 * 3600_000);
  }
  private async limit(key: string, max: number, windowMs: number) {
    const storageKey = `limit:${key}`;
    const current = await this.ctx.storage.get<{ count: number; expiresAt: number }>(storageKey);
    const item =
      current && current.expiresAt > Date.now() ? current : { count: 0, expiresAt: Date.now() + windowMs };
    requireThat(item.count < max, 429, "Слишком много попыток. Попробуй позже.");
    item.count++;
    await this.ctx.storage.put(storageKey, item);
  }
  private async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (path === "/api/catalog" && method === "GET") {
      const drafts = await this.ctx.storage.list<RoundDraft>({ prefix: "round:" });
      return Response.json({
        rounds: [...drafts.values()].flatMap((draft) => (draft.published ? [draft.published] : [])),
      });
    }
    if (["/api/login", "/api/register", "/api/setup"].includes(path) && method === "POST") {
      const ip = request.headers.get("CF-Connecting-IP") ?? "local";
      await this.limit(`auth:${await digest(ip)}`, 15, 10 * 60_000);
      const body = await this.json(request);
      const { username, password } = credentials.parse(body);
      const existingId = await this.ctx.storage.get<string>(`username:${username}`);
      if (path === "/api/login") {
        const user = existingId ? await this.ctx.storage.get<Account>(`user:${existingId}`) : null;
        // Equal work for unknown users reduces username enumeration by timing.
        const calculated = await passwordHash(password, user?.salt ?? "unknown-user-salt");
        requireThat(
          user && !user.disabled && safeEqual(calculated, user.passwordHash),
          401,
          "Неверный логин или пароль.",
        );
        return this.newSession(user);
      }
      if (path === "/api/setup") {
        const secret = request.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";
        requireThat(
          this.env.ADMIN_SETUP_SECRET &&
            safeEqual(await digest(secret), await digest(this.env.ADMIN_SETUP_SECRET)),
          403,
          "Нет доступа.",
        );
        requireThat(!(await this.ctx.storage.get("moderator-created")), 409, "Модератор уже настроен.");
      } else {
        const invite = z.string().min(32).max(100).parse(body.invite);
        const entry = await this.ctx.storage.get<{ expiresAt: number }>(`invite:${await digest(invite)}`);
        requireThat(
          entry && entry.expiresAt > Date.now(),
          403,
          "Приглашение недействительно или уже использовано.",
        );
      }
      requireThat(!existingId, 409, "Этот логин уже занят.");
      const salt = crypto.randomUUID();
      const user: Account = {
        id: crypto.randomUUID(),
        username,
        salt,
        passwordHash: await passwordHash(password, salt),
        role: path === "/api/setup" ? "moderator" : "author",
        disabled: false,
      };
      await this.ctx.storage.transaction(async (tx) => {
        await tx.put(`user:${user.id}`, user);
        await tx.put(`username:${username}`, user.id);
        if (path === "/api/setup") await tx.put("moderator-created", true);
        else await tx.delete(`invite:${await digest(body.invite)}`);
      });
      return this.newSession(user);
    }
    const mediaMatch = path.match(/^\/api\/media\/([a-f0-9-]{36})$/);
    if (mediaMatch && method === "GET") {
      const record = await this.ctx.storage.get<MediaRecord>(`media:${mediaMatch[1]}`);
      requireThat(record, 404, "Трек не найден.");
      if (!record.public) {
        const user = await this.account(request);
        requireThat(user.id === record.ownerId || user.role === "moderator", 403, "Нет доступа к треку.");
      }
      const object = await readBudgetedMedia(this.ctx.storage, this.env.Media, mediaMatch[1]!, {
        range: request.headers,
      });
      requireThat(object, 404, "Трек не найден.");
      const headers = new Headers({
        "Content-Type": record.contentType,
        "Accept-Ranges": "bytes",
        "Cache-Control": record.public ? "public, max-age=86400, immutable" : "private, no-store",
        "X-Content-Type-Options": "nosniff",
      });
      headers.set("ETag", object.httpEtag);
      const range = object.range;
      const partial = range && "offset" in range && "length" in range;
      if (partial) {
        headers.set(
          "Content-Range",
          `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`,
        );
        headers.set("Content-Length", String(range.length));
      } else headers.set("Content-Length", String(object.size));
      return new Response(object.body, { status: partial ? 206 : 200, headers });
    }
    const user = await this.account(request);
    if (path === "/api/me" && method === "GET") return Response.json({ user: publicAccount(user) });
    if (path === "/api/logout" && method === "POST") {
      await this.ctx.storage.delete(
        `session:${await digest(request.headers.get("Authorization")!.slice(7))}`,
      );
      return Response.json({ ok: true });
    }
    if (path === "/api/invites" && method === "POST") {
      requireThat(user.role === "moderator", 403, "Нужен доступ модератора.");
      const token = crypto.randomUUID() + crypto.randomUUID();
      await this.ctx.storage.put(`invite:${await digest(token)}`, {
        expiresAt: Date.now() + 7 * 24 * 3600_000,
      });
      return Response.json({ invite: token });
    }
    if (path === "/api/users" && method === "GET") {
      requireThat(user.role === "moderator", 403, "Нужен доступ модератора.");
      const users = await this.ctx.storage.list<Account>({ prefix: "user:" });
      return Response.json({ users: [...users.values()].map(publicAccount) });
    }
    const userMatch = path.match(/^\/api\/users\/([a-f0-9-]{36})\/block$/);
    if (userMatch && method === "POST") {
      requireThat(user.role === "moderator", 403, "Нужен доступ модератора.");
      const target = await this.ctx.storage.get<Account>(`user:${userMatch[1]}`);
      requireThat(target && target.role !== "moderator", 404, "Автор не найден.");
      const { disabled } = z.object({ disabled: z.boolean() }).parse(await this.json(request));
      await this.ctx.storage.put(`user:${target.id}`, { ...target, disabled });
      return Response.json({ ok: true });
    }
    if (path === "/api/media" && method === "POST") {
      await this.limit(`upload:${user.id}`, 20, 24 * 3600_000);
      const max = 25 * 1024 * 1024;
      requireThat(
        Number(request.headers.get("content-length") ?? max + 1) <= max,
        413,
        "Максимальный размер трека — 25 МБ.",
      );
      const bytes = await request.arrayBuffer();
      requireThat(
        bytes.byteLength > 12 && bytes.byteLength <= max,
        413,
        "Максимальный размер трека — 25 МБ.",
      );
      const view = new Uint8Array(bytes);
      const signature = new TextDecoder().decode(view.slice(0, 12));
      const contentType =
        signature.startsWith("ID3") || (view[0] === 255 && (view[1]! & 224) === 224)
          ? "audio/mpeg"
          : signature.slice(4, 8) === "ftyp"
            ? "audio/mp4"
            : signature.startsWith("OggS")
              ? "audio/ogg"
              : signature.startsWith("RIFF") && signature.slice(8, 12) === "WAVE"
                ? "audio/wav"
                : null;
      requireThat(contentType, 400, "Загрузи аудио MP3, M4A, OGG или WAV.");
      const mediaId = crypto.randomUUID();
      await writeBudgetedMedia(this.ctx.storage, this.env.Media, mediaId, bytes, contentType);
      await this.ctx.storage.put(`media:${mediaId}`, {
        ownerId: user.id,
        public: false,
        contentType,
      } satisfies MediaRecord);
      return Response.json({ audioFile: `/api/media/${mediaId}` });
    }
    if (path === "/api/rounds" && method === "GET") {
      const rounds = await this.ctx.storage.list<RoundDraft>({ prefix: "round:" });
      return Response.json({
        rounds: [...rounds.values()]
          .filter((round) => user.role === "moderator" || round.authorId === user.id)
          .sort((a, b) => b.updatedAt - a.updatedAt),
      });
    }
    if (path === "/api/rounds" && method === "POST") {
      const mine = await this.ctx.storage.list<RoundDraft>({ prefix: "round:" });
      requireThat(
        [...mine.values()].filter((round) => round.authorId === user.id).length < 100,
        409,
        "Достигнут лимит: 100 раундов на автора.",
      );
      const content = DraftRoundSchema.parse(await this.json(request));
      if (content.audioFile) await this.checkMedia(content.audioFile, user);
      const id = ((await this.ctx.storage.get<number>("next-round-id")) ?? 1_000_000) + 1;
      const round: RoundDraft = {
        id,
        authorId: user.id,
        authorName: user.username,
        revision: 1,
        status: "draft",
        content,
        published: null,
        comment: "",
        updatedAt: Date.now(),
      };
      await this.ctx.storage.transaction(async (tx) => {
        await tx.put("next-round-id", id);
        await tx.put(`round:${id}`, round);
      });
      return Response.json({ round });
    }
    const match = path.match(/^\/api\/rounds\/(\d+)(?:\/(submit|withdraw|approve|reject|unpublish))?$/);
    if (match) {
      const draft = await this.ctx.storage.get<RoundDraft>(`round:${match[1]}`);
      requireThat(draft, 404, "Раунд не найден.");
      requireThat(user.id === draft.authorId || user.role === "moderator", 403, "Нет доступа к раунду.");
      const body = await this.json(request);
      requireThat(body.revision === draft.revision, 409, "Раунд уже изменён. Обнови список.");
      const action = match[2];
      if (method === "PUT" && !action) {
        requireThat(draft.authorId === user.id, 403, "Редактировать может только автор.");
        requireThat(draft.status !== "submitted", 409, "Сначала отзови раунд с проверки.");
        const content = DraftRoundSchema.parse(body.content);
        if (content.audioFile) await this.checkMedia(content.audioFile, user);
        draft.content = content;
        draft.status = "draft";
        draft.comment = "";
      } else if (method === "POST" && (action === "submit" || action === "withdraw")) {
        requireThat(draft.authorId === user.id, 403, "Действие доступно автору.");
        requireThat(
          action === "withdraw"
            ? draft.status === "submitted"
            : draft.status !== "submitted" && draft.status !== "approved",
          409,
          "Статус раунда уже изменён.",
        );
        if (action === "submit") {
          CommunityRoundSchema.parse(draft.content);
          await this.checkMedia(draft.content.audioFile, user);
        }
        draft.status = action === "submit" ? "submitted" : "draft";
      } else if (method === "POST" && ["approve", "reject", "unpublish"].includes(action ?? "")) {
        requireThat(user.role === "moderator", 403, "Нужен доступ модератора.");
        if (action !== "unpublish")
          requireThat(draft.status === "submitted", 409, "Раунд уже снят с проверки.");
        if (action === "approve") {
          draft.published = { ...draft.content, id: draft.id, revision: draft.revision };
          draft.status = "approved";
          draft.comment = "";
          const key = draft.content.audioFile.split("/").at(-1)!;
          const media = await this.ctx.storage.get<MediaRecord>(`media:${key}`);
          requireThat(media, 400, "Трек не найден.");
          await this.ctx.storage.put(`media:${key}`, { ...media, public: true });
        } else if (action === "reject") {
          draft.comment = z.string().trim().min(1).max(2000).parse(body.comment);
          draft.status = "rejected";
        } else {
          draft.published = null;
          // A pending revision stays in the moderation queue after unpublishing.
          if (draft.status === "approved") draft.status = "draft";
        }
      } else throw new ApiError(405, "Действие не поддерживается.");
      draft.revision++;
      draft.updatedAt = Date.now();
      await this.ctx.storage.put(`round:${draft.id}`, draft);
      return Response.json({ round: draft });
    }
    throw new ApiError(404, "Не найдено.");
  }
  private async checkMedia(audioFile: string, user: Account) {
    const media = await this.ctx.storage.get<MediaRecord>(`media:${audioFile.split("/").at(-1)}`);
    requireThat(media && media.ownerId === user.id, 400, "Загрузи свой трек для этого раунда.");
  }
}
