import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL(".", import.meta.url));
const output = path.join(root, "dist");
let html = await fs.readFile(path.join(output, "index.html"), "utf8");
for (const match of [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)]) {
  const href = match[0].match(/href="([^"]+)"/)?.[1];
  if (!href) continue;
  const css = await fs.readFile(path.join(output, href), "utf8");
  html = html.replace(match[0], () => `<style>${css.replace(/<\/style/gi, "<\\/style")}</style>`);
}
for (const match of [...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g)]) {
  const js = await fs.readFile(path.join(output, match[1]), "utf8");
  html = html.replace(
    match[0],
    () => `<script type="module">${js.replace(/<\/script/gi, "<\\/script")}</script>`,
  );
}
html = html.replace(/<link\b[^>]*rel="modulepreload"[^>]*>/g, "");
await fs.writeFile(path.join(output, "standalone.html"), html);
await fs.copyFile(path.join(root, "../audit-data.json"), path.join(output, "audit-data.json"));
console.log(`Portable document: ${path.join(output, "standalone.html")}`);
