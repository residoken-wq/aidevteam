# P6-06 (rút gọn) — Approval Center CHỈ ĐỌC

```text
# TASK CARD: P6-06 — Approval Center read-only, deep-link tới PR (O-07)
Branch: ai/P6-06-approval-center-readonly
Nhãn: release-0.1, phase:6
Phụ thuộc: P1-04 (release_approvals), P1-06

## Bối cảnh
Kênh duyệt giai đoạn 1 là comment `/approve-uat <digest>`, `/approve-production <digest>` trên PR manifest.
Nguồn quyết định là comment được backend xác minh (P6-05/P6-08 — POST-0.1, KHÔNG làm ở đây).
Release 0.1: approval record ghi thủ công trong docs/releases/0.1/APPROVAL_RECORD.md bởi người vận hành.

## Phạm vi (làm)
- Trang danh sách release/approval đọc từ release_approvals: environment (uat/production), target_sha,
  release_manifest_digest, trạng thái, người duyệt (GitHub user ID số), thời điểm, link PR.
- Link PR: chỉ cho phép URL github.com của repo đã cấu hình (validate, chống open redirect/javascript:).
- Banner cố định: "Chỉ hiển thị. Quyết định được thực hiện bằng comment trên PR."
- Endpoint chỉ GET.

## Ngoài phạm vi (CẤM)
Nút Approve/Reject. Endpoint POST/PUT/PATCH/DELETE cho approval. Webhook nhận comment. Gọi GitHub API ghi.
Tạo bản ghi approval giả trong seed với trạng thái APPROVED trông như thật (seed phải ghi rõ "TEST").

## Acceptance criteria
AC-1 Không tồn tại route ghi cho approval (test liệt kê route của module, chỉ có GET).
AC-2 UI không có nút/form thay đổi approval (E2E kiểm tra).
AC-3 Link PR không hợp lệ (javascript:, domain lạ) bị chặn khi hiển thị.
AC-4 Phân quyền đọc theo RBAC; cross-org → 403/404.
AC-5 Có cột environment phân biệt uat/production.
```
