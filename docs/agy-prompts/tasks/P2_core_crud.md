# P2-03 / P2-05 / P2-07 / P2-08 / P2-10 — CRUD Org, Agent, Provider account, Worker, Project

> Ánh xạ 1-1 giữa Task ID và entity **chưa xác minh** với Master Plan (SOURCE_MISSING). Làm **mỗi entity một PR**, dùng cùng card này, thay `{{ENTITY}}`.

```text
# TASK CARD: {{TASK_ID}} — CRUD {{ENTITY}} (Org | Agent | ProviderAccount | Worker | Project)
Branch: ai/{{TASK_ID}}-{{entity}}-crud
Nhãn: release-0.1, phase:2
Phụ thuộc: P1-04, P1-06 (RBAC), P1-07 (cho ProviderAccount/Worker)

## Phạm vi (làm)
- Contract Zod trong packages/contracts: Create/Update/Response schema. Response không có field nhạy cảm.
- API: list (phân trang, giới hạn page size), get, create, update, archive (soft delete — hỏi người
  nếu muốn hard delete; xóa dữ liệu là hành động không đảo ngược).
- Mọi query scope theo org_id từ session.
- Audit cho create/update/archive (không ghi giá trị secret_ref đầy đủ nếu RBAC_MATRIX yêu cầu).
- UI: trang list + form tạo/sửa, hiển thị lỗi validate; không render HTML từ input người dùng (XSS).
- Ràng buộc riêng:
  * ProviderAccount: chỉ secret_ref (P1-07). Không gọi provider thật để "test connection".
  * Worker: type chỉ cho phép "mock" ở Release 0.1. workspace_path phải unique trong org
    (khắc phục điểm 6.2-4 của router v0.1) — validate ở app và unique index ở DB.
  * Agent: liên kết provider account cùng org; cross-org → từ chối.
  * Project: tên unique trong org.

## Ngoài phạm vi
Org chart kéo thả (P2-06). Role editor (P2-04). Worker thật/AGY.

## Acceptance criteria
AC-1 CRUD hoạt động với role đúng quyền (integration test).
AC-2 Role thiếu quyền → 403 cho từng thao tác.
AC-3 Cross-org get/update/archive → 403/404, không lộ dữ liệu.
AC-4 Input không hợp lệ → 422 với thông báo không lộ chi tiết nội bộ.
AC-5 Mỗi thao tác ghi đúng 1 audit event.
AC-6 (Worker) Hai worker cùng workspace_path trong org → 409. type khác "mock" → 422.
AC-7 (ProviderAccount) Response/log không chứa giá trị secret.
AC-8 E2E: tạo → sửa → archive qua UI (Playwright hoặc công cụ theo ADR).
```
