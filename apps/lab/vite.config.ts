import { resolve } from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import type { Plugin } from "vite";

// The style sheet is a link (see src/routes/__root.tsx), so the development
// server keeps its CSS in a cache. Tailwind drops that cache only when a file
// that it scanned before changes. A new variant file is not one of those, and
// its classes would have no CSS until a restart. This plugin drops the cache
// when a source file is added or changed.
function freshStyles(): Plugin {
  const styles = resolve(import.meta.dirname, "src/styles.css");
  const sources = `${resolve(import.meta.dirname, "src")}/`;
  return {
    name: "lab:fresh-styles",
    apply: "serve",
    configureServer(server) {
      const invalidate = (file: string) => {
        if (!file.startsWith(sources)) return;
        for (const environment of Object.values(server.environments)) {
          const modules = environment.moduleGraph.getModulesByFile(styles);
          if (!modules) continue;
          for (const module of modules) {
            environment.moduleGraph.invalidateModule(module);
          }
        }
      };
      server.watcher.on("add", invalidate);
      server.watcher.on("change", invalidate);
    },
  };
}

// The same plugin stack as apps/web. The lab has no bindings and no backend.
export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tanstackStart(),
    react(),
    tailwindcss(),
    freshStyles(),
  ],
});
