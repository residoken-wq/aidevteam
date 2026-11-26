/** Turn an api error body into a short Vietnamese message. Never renders HTML; values are not echoed by the api. */
const CONFLICTS: Record<string, string> = {
  project_slug_or_name_taken: "Mã hoặc tên dự án đã tồn tại trong tổ chức.",
  project_archived: "Dự án đã lưu trữ, không sửa được.",
  project_already_archived: "Dự án đã được lưu trữ trước đó.",
  provider_account_slug_taken: "Mã tài khoản provider đã tồn tại trong tổ chức.",
  provider_account_archived: "Tài khoản provider đã lưu trữ, không sửa được.",
  provider_account_already_archived: "Tài khoản provider đã được lưu trữ trước đó.",
  worker_slug_or_path_taken: "Mã worker hoặc thư mục làm việc đã tồn tại trong tổ chức.",
  workspace_path_in_use: "Thư mục làm việc trùng, nằm trong hoặc chứa thư mục của một worker đang hoạt động.",
  worker_archived: "Worker đã lưu trữ, không sửa được.",
  worker_already_archived: "Worker đã được lưu trữ trước đó.",
};

export function apiErrorMessage(status: number, body: unknown): string {
  const b = (typeof body === "object" && body !== null ? body : {}) as { message?: unknown; issues?: Array<{ path?: unknown; message?: unknown; problem?: unknown }> };
  if (status === 422 && Array.isArray(b.issues) && b.issues.some((i) => i?.problem === "secret_like")) {
    return "Giá trị vừa nhập trông giống một secret thật. Không dán secret vào đây — đặt secret trên máy worker rồi nhập tham chiếu (env:AIDEV_SECRET_… hoặc file:/run/secrets/…).";
  }
  if (status === 422 && Array.isArray(b.issues)) {
    return b.issues.map((i) => `${String(i.path ?? "")}: ${String(i.message ?? "")}`).join("; ");
  }
  if (status === 409 && typeof b.message === "string" && Object.prototype.hasOwnProperty.call(CONFLICTS, b.message)) return CONFLICTS[b.message]!;
  if (status === 403) return "Bạn không có quyền thực hiện thao tác này.";
  if (status === 401) return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
  if (status === 404) return "Không tìm thấy.";
  return "Có lỗi xảy ra. Vui lòng thử lại.";
}

export async function sendJson(method: "POST" | "PATCH", url: string, body?: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  if (res.ok) return { ok: true };
  return { ok: false, error: apiErrorMessage(res.status, await res.json().catch(() => null)) };
}
