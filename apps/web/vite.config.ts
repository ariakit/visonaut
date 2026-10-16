import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    // Vite inlines a small font as a `data:` URL, and the policy of the
    // document (`font-src 'self'`) blocks it. A font stays a file.
    assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/u.test(file) ? false : undefined),
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tanstackStart(),
    react(),
    tailwindcss(),
  ],
});
