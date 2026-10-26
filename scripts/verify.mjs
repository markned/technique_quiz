import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
};
const mode = option("--mode", "quick");
if (!["quick", "multiplayer", "release"].includes(mode)) throw new Error("Unknown verification mode");
const git = (...a) => {
  const r = spawnSync("git", a, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout;
};
const base = option("--base", "HEAD");
git("rev-parse", "--verify", base + "^{commit}");
const changed = [
  ...new Set([
    ...git("diff", "--name-only", base).trim().split("\n"),
    ...git("ls-files", "--others", "--exclude-standard").trim().split("\n"),
  ]),
].filter(Boolean);
const checks = new Set();
const add = (...names) => names.forEach((n) => checks.add(n));
if (mode === "release")
  add(
    "format:check",
    "lint",
    "test",
    "typecheck:qa",
    "skills:check",
    "build",
    "server:check",
    "test:e2e",
    "test:load",
  );
else {
  if (changed.some((p) => /\.(tsx?|m?js|css|json)$/.test(p))) add("lint");
  if (changed.some((p) => /^(test\/|src\/helpers\/|server\/|party\/)|vitest|package/.test(p))) add("test");
  if (changed.some((p) => /\.(tsx?|json)$/.test(p))) add("build");
  if (changed.some((p) => /^(server\/|party\/)|wrangler/.test(p))) add("server:check");
  if (changed.some((p) => /^(\.agents\/skills\/)/.test(p))) add("skills:check");
  if (mode === "quick" && changed.some((p) => /^(src\/.*\.(css|tsx)|e2e\/)/.test(p))) add("test:responsive");
  if (changed.some((p) => /^(test\/|e2e\/|tsconfig\.qa)/.test(p))) add("typecheck:qa");
  if (mode === "multiplayer") add("test", "typecheck:qa", "test:e2e", "server:check");
}
const list = [...checks];
if (args.includes("--plan")) {
  console.log(JSON.stringify({ mode, base, changed, checks: list }));
  process.exit(0);
}
const hash = createHash("sha256").update(
  JSON.stringify({
    node: process.version,
    platform: process.platform,
    load: process.env.MULTIPLAYER_LOAD_URL,
    base: process.env.PLAYWRIGHT_BASE_URL,
    channel: process.env.PLAYWRIGHT_CHANNEL,
    ci: process.env.CI,
  }),
);
for (const file of git("ls-files", "--cached", "--others", "--exclude-standard", "-z")
  .split("\0")
  .filter(Boolean)
  .sort()) {
  if (file === "technique_quiz.code-workspace" || file.endsWith(".md") || !existsSync(file)) continue;
  const st = statSync(file);
  if (!st.isFile()) continue;
  hash.update(file);
  if (st.size < 2_000_000) hash.update(readFileSync(file));
  else hash.update(`${st.size}:${st.mtimeMs}`);
}
const fingerprint = hash.digest("hex");
const root = ".cache/qa";
mkdirSync(root, { recursive: true });
const receiptPath = join(root, "receipts.json");
let receipts = {};
try {
  receipts = JSON.parse(readFileSync(receiptPath, "utf8"));
} catch {
  /* first run */
}
const results = [];
for (const check of list) {
  let skillFingerprint = "";
  if (check === "skills:check") {
    const h = createHash("sha256");
    for (const path of git("ls-files", "--cached", "--others", "--exclude-standard", "-z")
      .split("\0")
      .filter((p) => p.startsWith(".agents/skills/") && p.endsWith(".md"))
      .sort())
      h.update(path).update(readFileSync(path));
    skillFingerprint = h.digest("hex");
  }
  const id = `${fingerprint}:${check}:${skillFingerprint}`;
  if (!args.includes("--fresh") && receipts[id]) {
    results.push({ check, status: "cached" });
    continue;
  }
  const log = join(root, `${check.replaceAll(":", "-")}.log`);
  const r = spawnSync("npm", ["run", check], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: process.env,
  });
  writeFileSync(log, (r.stdout ?? "") + (r.stderr ?? ""));
  const ok = r.status === 0 && !r.error;
  results.push({ check, status: ok ? "passed" : "failed", log });
  if (!ok) {
    console.error(
      (r.stdout ?? "")
        .split("\n")
        .filter((l) => /failed|Error|error|expected|Received|Expected|×|FAIL/.test(l))
        .slice(-16)
        .join("\n"),
    );
    console.log(JSON.stringify({ ok: false, mode, results }));
    process.exit(1);
  }
  receipts[id] = { at: new Date().toISOString() };
  if (check === "test:e2e") receipts[`${fingerprint}:test:responsive:`] = receipts[id];
  writeFileSync(receiptPath, JSON.stringify(receipts));
}
console.log(JSON.stringify({ ok: true, mode, results }));
