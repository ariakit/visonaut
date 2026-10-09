import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import path from "node:path";
const root = fileURLToPath(new URL(".", import.meta.url));
const repo = process.env.VISONAUT_REPO || path.resolve(root, "../../..");
const dependencies = process.env.VISONAUT_DEPS || path.join(repo, "apps/web");
const require = createRequire(path.join(dependencies, "package.json"));
const { default: tailwind } = await import(require.resolve("@tailwindcss/vite"));
const { default: react } = await import(require.resolve("@vitejs/plugin-react"));
const { defineConfig } = await import(require.resolve("vite"));
export default defineConfig({
  root,
  base: "./",
  cacheDir: path.join(root, ".vite"),
  plugins: [react(), tailwind()],
  resolve: {
    dedupe: ["react", "react-dom", "@ariakit/react", "clava"],
    alias: [
      {
        find: "tailwindcss",
        replacement: path.join(dependencies, "node_modules/tailwindcss/index.css"),
      },
      { find: "@ariakit/tailwind", replacement: require.resolve("@ariakit/tailwind") },
      { find: "@ui", replacement: path.join(repo, "apps/web/src/components/ariakit") },
      {
        find: "lucide-react",
        replacement: path.join(dependencies, "node_modules/lucide-react/dist/esm/lucide-react.mjs"),
      },
      ...[
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "react-dom/client",
        "react-dom",
        "react",
        "@ariakit/react",
        "@ariakit/react-utils",
        "clava",
      ].map((name) => ({
        find: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
        replacement: ["clava", "@ariakit/react-utils"].includes(name)
          ? path.join(dependencies, `node_modules/${name}/dist/index.js`)
          : name === "@ariakit/react"
            ? path.join(dependencies, "node_modules/@ariakit/react/esm/index.js")
            : require.resolve(name),
      })),
    ],
  },
  server: {
    host: "127.0.0.1",
    fs: { allow: [root, repo, dependencies] },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
