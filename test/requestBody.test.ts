import { afterEach, describe, expect, it, vi } from "vitest";
import { readRequestBody } from "../server/requestBody";
const request = (body: ReadableStream<Uint8Array>) =>
  new Request("http://local/upload", { method: "POST", body, duplex: "half" } as RequestInit);
afterEach(() => vi.useRealTimers());
describe("bounded community request bodies", () => {
  it("reads chunked requests within the byte cap", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array([1, 2]));
        c.enqueue(new Uint8Array([3]));
        c.close();
      },
    });
    expect([...new Uint8Array(await readRequestBody(request(body), 3))]).toEqual([1, 2, 3]);
  });
  it("rejects chunked overflow without trusting Content-Length", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(4));
      },
    });
    await expect(readRequestBody(request(body), 3)).rejects.toMatchObject({ status: 413 });
  });
  it("times out and cancels a stalled stream", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const promise = readRequestBody(request(new ReadableStream({ cancel })), 100, 1000);
    const assertion = expect(promise).rejects.toMatchObject({ status: 408 });
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(cancel).toHaveBeenCalled();
  });
});
