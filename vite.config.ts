/// <reference types="vitest/config" />
import { networkInterfaces } from "node:os";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { editorDevPlugin } from "./vite/editorDevPlugin";
import { geniusDevPlugin } from "./vite/geniusDevPlugin";
import { photosManifestPlugin } from "./vite/photosManifestPlugin";

/** Кастомный домен на GitHub Pages — корень сайта; подпуть `/technique_quiz/` нужен только для `username.github.io/technique_quiz/` без своего домена. */
const network = networkInterfaces();
const lanAddress = [
  ...(network.en0 ?? []),
  ...(network.en1 ?? []),
  ...Object.values(network).flatMap((items) => items ?? []),
].find(
  (item) =>
    item.family === "IPv4" &&
    !item.internal &&
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(item.address),
)?.address;

export default defineConfig(({ command }) => ({
  define:
    command === "serve"
      ? {
          "import.meta.env.VITE_LOCAL_NETWORK_ORIGIN": JSON.stringify(
            lanAddress ? `http://${lanAddress}:18768` : "",
          ),
        }
      : {},
  base: "/",
  server: {
    /** Не 5173 — отдельный порт для technique_quiz (при занятости: `vite --port …`) */
    port: 18768,
    host: "0.0.0.0",
    proxy: {
      "/parties": { target: "http://127.0.0.1:1999", ws: true },
      "^/api/(catalog|setup|login|register|me|logout|invites|users|media|rounds)(/|$)": {
        target: "http://127.0.0.1:1999",
        headers: { Origin: "http://localhost:18768" },
      },
    },
    strictPort: true,
  },
  plugins: [react(), photosManifestPlugin(), geniusDevPlugin(), editorDevPlugin()],
  test: {
    environment: "node",
  },
}));
