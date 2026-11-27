# P6-06 (rút gọn) — Approval Center CHỈ ĐỌC

```text
TASK: P6-06 · Branch: ai/P6-06-approval-center · 1 PR
Nguồn: CLAUDE.md O-07, §5.5; bảng release_approvals (migration 0001, có cột environment uat/production)
Tham chiếu: workers.controller.ts (list/get), apps/web/app/workers/page.tsx, packages/db/src/schema.ts

LÀM
- GET /approvals, GET /approvals/:id (permission approval:read, lọc org_id session). KHÔNG có route ghi.
- Trả: environment, decision, target_sha, release_manifest_digest, pipeline_run_id, approver_github_user_id,
  decided_at, recorded_at, sourceCommentUrl (chỉ khi hợp lệ, xem dưới).
- Link hợp lệ: chỉ https://github.com/<APPROVAL_REPO>/pull/<số>#issuecomment-<số>, APPROVAL_REPO là env mới
  (mặc định CHƯA CẤU HÌNH → không hiện link). Validate bằng URL + regex; javascript:, domain khác → null.
- Trang /approvals: banner cố định "Chỉ hiển thị. Quyết định được thực hiện bằng comment /approve-* trên PR."
  Không có nút/form. Rỗng → "Chưa có bản ghi duyệt".
- Seed KHÔNG tạo approval. Test chèn bản ghi có pipeline_run_id bắt đầu "TEST-".

AC
AC-1 Test liệt kê route: module approvals chỉ có GET.
AC-2 E2E: trang không có button/form; hiện đủ cột environment.
AC-3 Link javascript:/domain lạ/repo khác → không render link (unit + integration).
AC-4 Cross-org → 404; không có role → 403.

CẤM: nút Approve/Reject, webhook, gọi GitHub API, bản ghi approval trông như thật.
```
