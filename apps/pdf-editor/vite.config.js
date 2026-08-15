import { defineConfig } from "vite";

export default defineConfig({
  base: "/pdf-editor/",
  build: {
    sourcemap: false,
    target: "es2022",
  },
});
