import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
const check = (value: string) =>
  spawnSync(process.execPath, ["scripts/check-deploy-env.mjs"], {
    env: { ...process.env, DEPLOY_CHECK_HEALTH: "0", VITE_MULTIPLAYER_SERVER_URL: value },
  });
describe("Pages deploy configuration", () => {
  it("rejects a missing backend and nonproduction origins", () => {
    for (const value of [
      "",
      "http://localhost:1999",
      "https://backend.example/api",
      "https://name:secret@backend.example",
      "https://127.0.0.1",
    ])
      expect(check(value).status).not.toBe(0);
  });
  it("accepts an HTTPS backend origin", () => expect(check("https://backend.example").status).toBe(0));
});
