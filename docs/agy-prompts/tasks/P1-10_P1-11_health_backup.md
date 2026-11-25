# P1-10 + P1-11 — Health probe, backup/restore cơ bản

```text
# TASK CARD: P1-10/P1-11 — /health (liveness, readiness) + script backup/restore đã test
Branch: ai/P1-10-health-backup
Nhãn: release-0.1, phase:1
Phụ thuộc: P1-04

## Phạm vi (làm)
- GET /health/live: 200 nếu process sống. Không truy vấn DB.
- GET /health/ready: kiểm tra DB kết nối được. Response KHÔNG lộ version chi tiết, host, connection string,
  thông báo lỗi DB thô.
- Script backup/restore (vd pg_dump/pg_restore — kiểm tra flag trong tài liệu PostgreSQL chính thức):
  đọc cấu hình từ biến môi trường, không nhận mật khẩu qua argv.
- Runbook docs/operations/BACKUP_RESTORE.md: các bước, nơi lưu, RPO/RTO = CHƯA CẤU HÌNH.
- Test: backup DB test có seed giả → restore vào DB rỗng → so khớp số bản ghi.

## Ngoài phạm vi (CẤM)
Chạy backup/restore trên staging/production. Lên lịch backup trên server thật. DR drill đầy đủ.

## Acceptance criteria
AC-1 /health/live 200 khi DB tắt; /health/ready trả ≠ 200 khi DB tắt.
AC-2 Response health không chứa host, user, password, stack trace.
AC-3 Backup → restore trên DB test khớp dữ liệu (test tự động hoặc script có output đính kèm).
AC-4 Runbook có mục rollback và ghi rõ giá trị CHƯA CẤU HÌNH.
```
