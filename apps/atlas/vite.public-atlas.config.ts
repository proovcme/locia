import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/atlas/",
  publicDir: false,
  define: {
    "import.meta.env.VITE_PUBLIC_ATLAS": JSON.stringify("1"),
  },
  build: {
    outDir: "dist-public-atlas",
    assetsDir: "assets",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: fileURLToPath(new URL("./public-atlas.html", import.meta.url)),
    },
  },
});
