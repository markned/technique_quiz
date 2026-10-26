import { readFileSync, readdirSync, existsSync } from "node:fs";
const root = ".agents/skills";
let count = 0;
for (const folder of readdirSync(root)) {
  const path = `${root}/${folder}/SKILL.md`;
  if (!existsSync(path)) throw new Error(`Missing ${path}`);
  const text = readFileSync(path, "utf8");
  if (
    !text.startsWith("---\n") ||
    !text.includes(`name: ${folder}\n`) ||
    !/^description: .+/m.test(text) ||
    /TODO|\[INSERT/.test(text)
  )
    throw new Error(`Invalid skill ${path}`);
  count++;
}
for (const required of [
  "multiplayer-qa",
  "game-code-review",
  "code-change-verification",
  "systematic-debugging",
  "docs-sync",
]) {
  if (!existsSync(`${root}/${required}/SKILL.md`)) throw new Error(`Missing required skill ${required}`);
}
console.log(JSON.stringify({ ok: true, skills: count }));
