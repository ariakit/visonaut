import { fileURLToPath } from "node:url";
import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL("../../../", import.meta.url)),
  cacheDir: "node_modules/.vite-review-tests",
  plugins: [react(), tailwind()],
  optimizeDeps: {
    entries: ["src/review/__tests__/*.html", "src/components/**/__tests__/*.html"],
    include: ["react", "react-dom/client", "@tanstack/react-router"],
  },
  server: { host: "127.0.0.1", port: 4179, strictPort: true },
});
