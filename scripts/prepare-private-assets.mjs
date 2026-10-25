import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
// Private preview reuses already-public media from technique.ink. Worker static
// assets have a per-file size cap, so do not upload a duplicate video library.
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.name.startsWith(".") || /\.(mp4|m4a|mp3|ogg|wav|webm)$/i.test(entry.name))
      await unlink(path);
  }
}
await walk("dist-test");
