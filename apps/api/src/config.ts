/** Parse PORT from the environment. Fails closed on invalid values instead of guessing. */
export function parsePort(raw: string | undefined, fallback = 3001): number {
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d{1,5}$/.test(raw)) throw new Error("PORT must be an integer between 1 and 65535");
  const port = Number(raw);
  if (port < 1 || port > 65535) throw new Error("PORT must be an integer between 1 and 65535");
  return port;
}
