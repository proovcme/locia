import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/pircalc/",
  plugins: [react()],
  clearScreen: false,
  build: {
    outDir: "dist-public",
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL("./public-pir.html", import.meta.url)),
    },
  },
});
