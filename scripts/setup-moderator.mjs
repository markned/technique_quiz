import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
const backend = process.argv[2];
if (!backend || !/^https?:\/\//.test(backend))
  throw new Error("Usage: npm run community:setup -- https://your-worker.workers.dev");
if (new URL(backend).protocol !== "https:" && !["localhost", "127.0.0.1"].includes(new URL(backend).hostname))
  throw new Error("Use HTTPS for a remote server.");
async function hidden(prompt) {
  if (!stdin.isTTY) throw new Error("Run in an interactive terminal.");
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error) => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      for (const char of chunk.toString()) {
        if (char === "\u0003") return finish(new Error("Cancelled"));
        if (char === "\r" || char === "\n") return finish();
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else value += char;
      }
    };
    stdin.on("data", onData);
  });
}
const rl = createInterface({ input: stdin, output: stdout });
const username = await rl.question("Moderator username (a-z, 0-9, _ or -): ");
rl.close();
const password = await hidden("Password (12+ characters, hidden): ");
const secret = await hidden("ADMIN_SETUP_SECRET (hidden): ");
const response = await fetch(new URL("/api/setup", backend), {
  method: "POST",
  headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
  body: JSON.stringify({ username, password }),
});
const result = await response.json();
if (!response.ok) throw new Error(result.error ?? "Setup failed");
console.log("Moderator created. Sign in at /community.");
