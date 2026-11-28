const LABELS: Record<string, string> = {
  org_admin: "Quản trị tổ chức",
  maintainer: "Vận hành",
  viewer: "Chỉ xem",
  project_member: "Thành viên dự án",
};

/** Display label; unknown keys are shown as-is (React escapes them). */
export function roleLabel(key: string): string {
  return Object.prototype.hasOwnProperty.call(LABELS, key) ? LABELS[key]! : key;
}
