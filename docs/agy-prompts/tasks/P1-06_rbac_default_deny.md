# P1-06 — RBAC default deny

```text
# TASK CARD: P1-06 — RBAC default deny, tenant scope từ session
Branch: ai/P1-06-rbac
Nhãn: release-0.1, phase:1
Phụ thuộc: P1-04, P1-05G, docs/governance/RBAC_MATRIX.md (đã được Owner duyệt)

## Bối cảnh
RBAC_MATRIX.md là nguồn sự thật cho role/permission. Nếu file chưa có hoặc còn
REQUIRES_OWNER_APPROVAL → DỪNG, không tự đặt role.

## Phạm vi (làm)
- Guard/middleware toàn cục: mọi route mặc định yêu cầu đăng nhập + permission khai báo tường minh.
  Route không khai báo permission → bị từ chối (deny by default), có test chứng minh.
- Danh sách route công khai (allowlist) tối thiểu: login, callback, health. Mọi route khác bảo vệ.
- Permission dạng resource:action (vd project:read, task:write) ánh xạ từ RBAC_MATRIX.
- Tenant context (org_id, project_id) lấy từ session/role binding. Bỏ qua mọi org_id trong body/query.
- Repository/query helper bắt buộc nhận tenant context.
- Audit: rbac.denied (không ghi dữ liệu nhạy cảm).

## Ngoài phạm vi
Role editor UI (P2-04 — post-0.1). Thay đổi role qua UI.
Thay đổi role binding thật trên môi trường chạy = hành động đổi quyền → chỉ người làm.

## Acceptance criteria
AC-1 Route mới không gắn permission → 403 (test bằng route giả trong test).
AC-2 User chưa có role → 403 trên mọi route bảo vệ.
AC-3 User org A truy cập tài nguyên org B (đoán đúng id) → 403/404, body không lộ dữ liệu B.
AC-4 Gửi org_id của org B trong body → bị bỏ qua, thao tác áp dụng cho org A hoặc bị từ chối.
AC-5 Ma trận test sinh từ RBAC_MATRIX: mỗi role × mỗi permission có ít nhất 1 test allow/deny.
AC-6 Lần từ chối được ghi audit rbac.denied.

## Rủi ro
IDOR, privilege escalation, tenant leak.
```
