export class RequestBodyError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Enforce the byte cap while streaming, even without Content-Length. */
export async function readRequestBody(
  request: Request,
  maxBytes: number,
  timeoutMs = 30_000,
): Promise<ArrayBuffer> {
  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (!Number.isFinite(declared) || declared < 0 || declared > maxBytes)
    throw new RequestBodyError(413, "Запрос слишком большой.");
  if (!request.body) return new ArrayBuffer(0);
  const reader = request.body.getReader();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new RequestBodyError(408, "Загрузка заняла слишком много времени. Попробуй снова."));
      void reader.cancel().catch(() => {});
    }, timeoutMs);
  });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const part = await Promise.race([reader.read(), deadline]);
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new RequestBodyError(413, "Запрос слишком большой.");
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes.buffer;
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
}
