# Phiếu ký baseline Phase 0 — checkpoint 27/11/2026

> **Người ký:** Owner `residoken-wq` (CLAUDE.md §4). Chữ ký chỉ hợp lệ khi được thực hiện **trên GitHub bằng tài khoản `residoken-wq`** — không qua chat, Teams hay email (CLAUDE.md §2 quy tắc 7).
> Hồ sơ cần đọc: `docs/reports/PHASE_0_REPORT.md` (đặc biệt §4–§6), `docs/governance/RISKS.md`.

## Cách ký (3 bước)

1. Đăng nhập GitHub bằng tài khoản **`residoken-wq`** (khuyến nghị bật 2FA trước — rủi ro R-11).
2. Mở PR chứa file này → tab **Files changed** → **Review changes** → chọn **Approve**, dán vào ô nhận xét đúng mẫu dưới đây (sửa `APPROVE` thành `REJECT` hoặc `CHANGE: <ghi chú>` ở mục không đồng ý) → **Submit review**.
3. Báo cho người vận hành/Claude. Khi đó:
   - Claude kiểm tra qua GitHub API rằng review do **đúng tài khoản `residoken-wq`** gửi (đối chiếu GitHub user ID số), trạng thái `APPROVED`;
   - ghi từng quyết định vào `DECISION_LOG.md` mục C kèm link review làm bằng chứng;
   - mục `REJECT`/`CHANGE` được xử lý trước khi đi tiếp.

Nếu không đồng ý toàn bộ, chọn **Request changes** thay cho Approve và ghi lý do.

## Mẫu nhận xét (copy nguyên khối)

```text
/signoff-phase0
1 Baseline Phase 0 (artefact PHASE_0_REPORT §2): APPROVE
2 Ngoại lệ code trước baseline (D-2026-11-25-01): APPROVE
3 ADR-001 Next.js, ADR-002 NestJS/Zod/pnpm/Node 24, ADR-004 Drizzle: APPROVE
4 ADR-003 job table PostgreSQL cho 0.1: APPROVE
5 RBAC 3 role theo RBAC_MATRIX.md (D-2026-11-26-03): APPROVE
6 Session 8 giờ; giới hạn đăng nhập 5 lần/15 phút/IP (D-2026-11-26-01, -02): APPROVE
7 Máy trạng thái Task và Agent run (STATE_MACHINES §1-2): APPROVE
8 Xác nhận policy v1.0.2 trước 04/12 hoặc ký ngoại lệ (D-OWN-15): APPROVE
9 Phạm vi 0.1 + thứ tự cắt giảm nếu trễ (PHASE_0_REPORT §4): APPROVE
```

## Lưu ý
- Approve phiếu này **không** phải approval UAT hay production; hai việc đó làm bằng `/approve-uat <digest>` và `/approve-production <digest>` trên PR manifest (CLAUDE.md §5.5).
- Mục 8 chỉ là cam kết thời hạn; việc xác nhận v1.0.2 vẫn cần file policy được đưa vào repo.
- Phiếu này không tự gỡ các blocker hạ tầng (domain, DB, OAuth App — `PHASE_0_REPORT.md` §5).
