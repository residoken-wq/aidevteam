# P1-09 — CI: SCA + định nghĩa required checks

```text
# TASK CARD: P1-09 — Bổ sung SCA vào CI, định nghĩa required checks (KHÔNG tự cấu hình GitHub)
Branch: ai/P1-09-ci-sca
Nhãn: release-0.1, phase:1
Phụ thuộc: P1-01

## Phạm vi (làm)
- Bước SCA trong job `ci` (vd `pnpm audit` với ngưỡng mức độ — kiểm tra cú pháp flag trong tài
  liệu pnpm chính thức, ghi link; không đoán flag).
- Bước secret scan trên diff (công cụ do người chọn; đề xuất 1–2 phương án kèm license).
- Tài liệu docs/operations/BRANCH_PROTECTION.md: required checks `ci`, `claude-review`, không force push,
  áp dụng cả admin, cho `main` và `integration`.
  Trạng thái ghi: "DEFINED – NOT ENFORCED (plan: free)" cho tới khi Owner nâng GitHub Pro
  và tự cấu hình (O-02).

## Ngoài phạm vi (CẤM)
Gọi GitHub API để bật branch protection/ruleset. Đổi cấu hình repo. Đó là việc của Owner.

## Acceptance criteria
AC-1 Thêm dependency có lỗ hổng đã biết (trong branch thử, không merge) → job ci FAIL.
AC-2 Thêm chuỗi giống secret giả vào file thử → secret scan FAIL.
AC-3 BRANCH_PROTECTION.md ghi đúng trạng thái DEFINED – NOT ENFORCED.
AC-4 Workflow permissions tối thiểu; không dùng secret của Owner (quy tắc cứng 4).
```
