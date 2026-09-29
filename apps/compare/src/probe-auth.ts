export async function authorizeProbe(request: Request, expected: string) {
  if (!expected) return false;
  const encoder = new TextEncoder();
  const actual = request.headers.get("Authorization") ?? "";
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
    crypto.subtle.digest("SHA-256", encoder.encode(`Bearer ${expected}`)),
  ]);
  const candidate = new Uint8Array(left);
  const reference = new Uint8Array(right);
  let difference = 0;
  for (let i = 0; i < candidate.length; i += 1) {
    difference |= (candidate[i] ?? 0) ^ (reference[i] ?? 0);
  }
  return difference === 0;
}
