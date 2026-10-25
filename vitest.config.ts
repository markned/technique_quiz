import { defineConfig } from "vitest/config";
import { photosManifestPlugin } from "./vite/photosManifestPlugin";

export default defineConfig({
  plugins: [photosManifestPlugin()],
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
