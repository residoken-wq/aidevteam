/** Fixed, non-reflective messages for /login?error=… (the query value is never rendered as-is). */
const MESSAGES: Record<string, string> = {
  state: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng thử lại.",
  denied: "Tài khoản GitHub này chưa được cấp quyền truy cập Control Center.",
  failed: "Không hoàn tất được đăng nhập với GitHub. Vui lòng thử lại.",
};

export function loginErrorMessage(code: string | string[] | undefined): string | null {
  if (typeof code !== "string") return null;
  return Object.prototype.hasOwnProperty.call(MESSAGES, code) ? MESSAGES[code]! : null;
}
