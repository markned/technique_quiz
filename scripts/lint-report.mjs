import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const paths = ["src", "server", "party", "scripts", "test", "e2e", "vite", "*.ts", "*.js"];
const run = spawnSync(
  process.execPath,
  ["node_modules/eslint/bin/eslint.js", ...paths, "--format", "json", "--no-warn-ignored"],
  { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
);
mkdirSync(".cache/qa", { recursive: true });
writeFileSync(".cache/qa/eslint-details.json", run.stdout ?? "");
try {
  const files = JSON.parse(run.stdout);
  const errors = files.reduce((n, f) => n + f.errorCount, 0);
  const warnings = files.reduce((n, f) => n + f.warningCount, 0);
  if (errors)
    for (const file of files)
      for (const message of file.messages.filter((m) => m.severity === 2))
        console.error(`${file.filePath}:${message.line ?? 0}:${message.column ?? 0} ${message.message}`);
  console.log(
    JSON.stringify({ ok: run.status === 0, errors, warnings, artifact: ".cache/qa/eslint-details.json" }),
  );
  process.exitCode = run.status ?? 1;
} catch {
  console.error(run.stderr || run.error?.message || "ESLint did not return a report");
  process.exitCode = 1;
}
