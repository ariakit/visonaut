import { readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { captureCounts, createImages, createModel } from "./fixtures.mjs";

const origin = `http://127.0.0.1:${process.env.REVIEW_SCALE_PORT || 4181}`;
const images = createImages();
const models = new Map(
  captureCounts.map((count) => [count, Buffer.from(JSON.stringify(createModel(count)))]),
);
const files = new Map([
  ["/", { type: "text/html", data: readFileSync(new URL("dist/index.html", import.meta.url)) }],
]);
for (const name of readdirSync(new URL("dist/assets/", import.meta.url))) {
  files.set(`/assets/${name}`, {
    type: name.endsWith(".js") ? "text/javascript" : "text/css",
    data: readFileSync(new URL(`dist/assets/${name}`, import.meta.url)),
  });
}

const server = createServer((request, response) => {
  const url = new URL(request.url || "/", origin);
  const modelCount = /^\/model\/(\d+)$/.exec(url.pathname)?.[1];
  const mediaRole = /^\/media\/capture-\d+\/(candidate|reference|diff|thumbnail)\.png$/.exec(
    url.pathname,
  )?.[1];
  const model = modelCount ? models.get(Number(modelCount)) : undefined;
  const media = mediaRole ? images.get(mediaRole) : undefined;
  const file = files.get(url.pathname);
  const data = model ?? media ?? file?.data;
  if (!data) {
    response.writeHead(404);
    response.end();
    return;
  }
  response.writeHead(200, {
    "Content-Type": model ? "application/json" : media ? "image/png" : file.type,
    "Content-Length": data.length,
    "Cache-Control": media ? "public, max-age=31536000, immutable" : "no-store",
  });
  response.end(data);
});

server.listen(Number(new URL(origin).port), "127.0.0.1", () => {
  console.log(
    JSON.stringify({
      origin,
      models: [...models].map(([count, data]) => ({ count, bytes: data.length })),
      imageBytes: Object.fromEntries([...images].map(([role, data]) => [role, data.length])),
    }),
  );
});
