const required = [
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_MIGRATIONS_API_TOKEN",
];
for (const name of required) {
  if (!process.env[name]) {
    throw new Error(`Required deployment credential is missing: ${name}`);
  }
}
if (process.env.CLOUDFLARE_API_TOKEN === process.env.CLOUDFLARE_MIGRATIONS_API_TOKEN) {
  throw new Error("Worker deployment and database migration credentials must be separate");
}
