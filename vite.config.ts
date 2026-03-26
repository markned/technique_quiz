import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { editorDevPlugin } from "./vite/editorDevPlugin";
import { geniusDevPlugin } from "./vite/geniusDevPlugin";
import { photosManifestPlugin } from "./vite/photosManifestPlugin";

export default defineConfig({
  base: process.env.NODE_ENV === "production" ? "/technique_quiz/" : "/",
  server: {
    /** Не 5173 — отдельный порт для technique_quiz (при занятости: `vite --port …`) */
    port: 18768,
    strictPort: true,
  },
  plugins: [react(), photosManifestPlugin(), geniusDevPlugin(), editorDevPlugin()],
});
