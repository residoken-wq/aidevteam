# Task card — mẫu

> Mọi task card có cùng cấu trúc. AC được **suy ra từ CLAUDE.md v1.2** vì `docs/MASTER_IMPLEMENTATION_PLAN.md` hiện `SOURCE_MISSING`. Khi Master Plan có trong repo, BA phải đối chiếu và cập nhật card.

```text
# TASK CARD: {{TASK_ID}} — {{TÊN}}
Branch: ai/{{TASK_ID}}-{{slug}}
Nhãn: release-0.1, phase:{{N}}
Phụ thuộc: ...
ADR cần ACCEPTED: ...

## Bối cảnh
## Phạm vi (làm)
## Ngoài phạm vi (không làm)
## Acceptance criteria
AC-1 ...
## Test bắt buộc
## Rủi ro bảo mật cần chú ý
## Điểm dừng hỏi người
## Definition of Done
- Tất cả AC PASS có test tự động; lint/typecheck/test xanh trên CI
- Bước 04 (QA self-review) READY_FOR_PR
- PR theo mẫu 05; người review approve (AGY không merge)
```
