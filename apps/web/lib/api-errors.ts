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
  org_slug_taken: "Mã tổ chức đã tồn tại.",
  task_status_changed: "Task vừa được chuyển trạng thái ở nơi khác. Bảng đã được tải lại, vui lòng thử lại.",
  task_closed: "Task đã hoàn thành hoặc đã hủy, không sửa được.",
  task_blocked: "Task đang bị chặn bởi các task phụ thuộc chưa hoàn thành.",
  dependency_cycle: "Không thể thêm phụ thuộc: phát hiện vòng lặp giữa các task.",
  agent_slug_taken: "Mã agent đã tồn tại trong tổ chức.",
  agent_archived: "Agent đã lưu trữ, không sửa được.",
  agent_already_archived: "Agent đã được lưu trữ trước đó.",
  agent_reporting_cycle: "Không thể chọn cấp trên này: sẽ tạo vòng lặp trong sơ đồ tổ chức.",
  agent_has_reports: "Agent còn cấp dưới đang hoạt động. Chuyển cấp dưới sang người khác trước khi lưu trữ.",
  org_archived: "Tổ chức đã lưu trữ, không sửa được.",
  org_already_archived: "Tổ chức đã được lưu trữ trước đó.",
  org_not_archived: "Tổ chức đang hoạt động, không cần khôi phục.",
  worker_busy: "Worker đang bận thực hiện lượt chạy khác.",
  queue_full: "Hàng đợi đã đầy (tối đa 20 lượt chạy chờ). Vui lòng thử lại sau.",
  worker_not_dispatchable: "Worker không khả dụng hoặc không phải worker mock đang bật.",
  worker_project_mismatch: "Worker đã gắn với dự án khác, không tương thích với dự án của task.",
  agent_not_dispatchable: "Agent đã bị vô hiệu hóa hoặc đã lưu trữ, không thể nhận việc.",
  provider_account_not_licensed: "Tài khoản provider chưa được duyệt hoặc đã bị cấm/lưu trữ.",
  task_not_dispatchable: "Chỉ có thể chạy task ở trạng thái Cần làm hoặc Đang làm.",
  run_not_cancellable: "Chỉ có thể hủy lượt chạy đang ở hàng đợi hoặc đang chạy.",
  cannot_change_own_roles: "Không thể tự thay đổi vai trò của chính mình.",
  last_org_admin: "Không thể gỡ vai trò quản trị viên (org_admin) cuối cùng của tổ chức.",
};

const SPECIFIC_422: Record<string, string> = {
  user_not_allowlisted: "Người dùng chưa có trong danh sách được phép (allowlist).",
  user_disabled: "Tài khoản người dùng đã bị vô hiệu hóa.",
  role_not_found: "Vai trò không tồn tại trong tổ chức.",
  provider_account_not_licensed: "Tài khoản provider chưa được duyệt hoặc đã bị cấm/lưu trữ.",
};

export function apiErrorMessage(status: number, body: unknown): string {
  const b = (typeof body === "object" && body !== null ? body : {}) as { message?: unknown; issues?: Array<{ path?: unknown; message?: unknown; problem?: unknown }> };
  if (status === 422 && Array.isArray(b.issues) && b.issues.some((i) => i?.problem === "secret_like")) {
    return "Giá trị vừa nhập trông giống một secret thật. Không dán secret vào đây — đặt secret trên máy worker rồi nhập tham chiếu (env:AIDEV_SECRET_… hoặc file:/run/secrets/…).";
  }
  if (status === 422 && typeof b.message === "string" && Object.prototype.hasOwnProperty.call(SPECIFIC_422, b.message)) {
    return SPECIFIC_422[b.message]!;
  }
  if (status === 422 && Array.isArray(b.issues)) {
    const specific = b.issues.find((i) => typeof i?.message === "string" && Object.prototype.hasOwnProperty.call(SPECIFIC_422, i.message));
    if (specific && typeof specific.message === "string") return SPECIFIC_422[specific.message]!;
    return b.issues.map((i) => `${String(i.path ?? "")}: ${String(i.message ?? "")}`).join("; ");
  }
  if ((status === 409 || status === 429) && typeof b.message === "string" && Object.prototype.hasOwnProperty.call(CONFLICTS, b.message)) return CONFLICTS[b.message]!;
  if (status === 429) return "Hàng đợi đã đầy hoặc có quá nhiều yêu cầu. Vui lòng thử lại sau.";
  if (status === 403) return "Bạn không có quyền thực hiện thao tác này.";
  if (status === 401) return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
  if (status === 404) return "Không tìm thấy.";
  return "Có lỗi xảy ra. Vui lòng thử lại.";
}

export async function sendJson<T = unknown>(
  method: "POST" | "PATCH" | "DELETE",
  url: string,
  body?: unknown,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  if (res.ok) {
    const data = (await res.json().catch(() => null)) as T;
    return { ok: true, data };
  }
  return { ok: false, error: apiErrorMessage(res.status, await res.json().catch(() => null)) };
}
