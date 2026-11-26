import { afterEach, describe, expect, it, vi } from "vitest";
import { RedactingLogger } from "../../src/logger";

const FAKE_TOKEN = "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";

function capture(): { out: () => string; restore: () => void } {
  let buf = "";
  const write = (chunk: unknown) => {
    buf += String(chunk);
    return true;
  };
  const a = vi.spyOn(process.stdout, "write").mockImplementation(write as never);
  const b = vi.spyOn(process.stderr, "write").mockImplementation(write as never);
  return { out: () => buf, restore: () => (a.mockRestore(), b.mockRestore()) };
}

describe("RedactingLogger", () => {
  let cap: ReturnType<typeof capture> | undefined;
  afterEach(() => cap?.restore());

  it("redacts tokens, emails, phones and CCCD in every level", () => {
    cap = capture();
    const logger = new RedactingLogger();
    logger.setLogLevels(["log", "error", "warn", "debug", "verbose", "fatal"]);
    const msg = `token ${FAKE_TOKEN} for test01@example.com phone 0912345678 cccd 001099012345`;
    logger.log(msg);
    logger.error(msg, `stack: Error: ${msg}`);
    logger.warn({ password: "hunter2", note: msg });
    logger.debug(msg);
    logger.verbose(msg);
    logger.fatal(msg);
    const out = cap.out();
    for (const leaked of [FAKE_TOKEN, "test01@example.com", "0912345678", "001099012345", "hunter2"]) expect(out).not.toContain(leaked);
    expect(out).toContain("[REDACTED]");
  });
});
