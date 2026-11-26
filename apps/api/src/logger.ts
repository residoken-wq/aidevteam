import { ConsoleLogger } from "@nestjs/common";
import { redact, redactDeep } from "@aidevteam/contracts";

const clean = (v: unknown): unknown => (typeof v === "string" ? redact(v) : redactDeep(v));

/**
 * Nest logger that redacts tokens, credentials, emails, VN phone numbers and CCCD before anything is written
 * (CLAUDE.md §9). Covers framework logs too, e.g. the stack trace Nest prints for an unhandled 500.
 */
export class RedactingLogger extends ConsoleLogger {
  override log(message: unknown, ...rest: unknown[]): void {
    super.log(clean(message), ...rest.map(clean));
  }
  override error(message: unknown, ...rest: unknown[]): void {
    super.error(clean(message), ...rest.map(clean));
  }
  override warn(message: unknown, ...rest: unknown[]): void {
    super.warn(clean(message), ...rest.map(clean));
  }
  override debug(message: unknown, ...rest: unknown[]): void {
    super.debug(clean(message), ...rest.map(clean));
  }
  override verbose(message: unknown, ...rest: unknown[]): void {
    super.verbose(clean(message), ...rest.map(clean));
  }
  override fatal(message: unknown, ...rest: unknown[]): void {
    super.fatal(clean(message), ...rest.map(clean));
  }
}
