# Backup & restore — runbook (P1-11)

> Trạng thái: `IMPLEMENTATION_PENDING` — script có test tự động (CI + cục bộ, PostgreSQL 16.15); **chưa chạy trên staging/production**.
> Repo này **không** tự lên lịch backup trên server thật. Người vận hành tự đặt lịch (cron/systemd timer) sau khi Owner duyệt RPO/RTO.

## 1. Thông số

| Hạng mục | Giá trị |
|---|---|
| Công cụ | `deploy/backup.sh`, `deploy/restore.sh` (pg_dump/pg_restore, định dạng custom `-Fc`) |
| Phiên bản client | `pg_dump` cùng major hoặc mới hơn server; server production: `UNVERIFIED` |
| Nơi lưu mặc định | `BACKUP_DIR=/var/backups/aidevteam` (thư mục 700, file 600) |
| Số bản giữ lại | `BACKUP_KEEP=14` (mặc định) |
| Tần suất | `CHƯA CẤU HÌNH` |
| RPO / RTO | `CHƯA CẤU HÌNH` |
| Bản sao ngoài máy (off-site) | `CHƯA CẤU HÌNH` — bắt buộc trước production (mất VPS = mất backup) |
| Mã hóa backup khi chuyển off-site | `CHƯA CẤU HÌNH` |
| Quan hệ với backup DB "đã có" (D-OWN-13) | `UNVERIFIED` — script này bổ sung, không thay thế, cho tới khi Owner xác nhận |

## 2. Thông tin đăng nhập DB
- Dùng biến libpq: `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE`.
- Mật khẩu **chỉ** qua file `~/.pgpass` hoặc `PGPASSFILE` (quyền 600). Script **từ chối** `PGPASSWORD` và không bao giờ đặt mật khẩu trên dòng lệnh.
- Dùng tài khoản DB **chỉ đọc** cho backup nếu có thể (`CHƯA CẤU HÌNH`).

## 3. Backup (người vận hành)

```bash
sudo -u aidevteam-backup env PGHOST=<db-host> PGPORT=5432 PGUSER=<backup-user> PGDATABASE=aidevteam /opt/aidevteam/backup.sh
```

Kết quả: `aidevteam-<UTC>.dump` + `.sha256`. Script kiểm tra archive đọc được (`pg_restore --list`) trước khi công bố, rồi xóa bản cũ quá `BACKUP_KEEP` (chỉ xóa file đúng mẫu tên).

## 4. Restore

Luôn restore vào **database mới, rỗng** rồi kiểm tra, không restore đè.

```bash
createdb -h <db-host> -U <admin-user> aidevteam_restore
```

```bash
env PGHOST=<db-host> PGUSER=<admin-user> /opt/aidevteam/restore.sh --file /var/backups/aidevteam/aidevteam-<UTC>.dump --target-db aidevteam_restore --yes
```

`restore.sh` từ chối khi: checksum không khớp, target không rỗng, thiếu `--yes`, tên target không hợp lệ. Restore chạy trong một transaction, lỗi giữa chừng thì target vẫn rỗng.

**Chuyển ứng dụng sang DB đã restore** (khi DB chính hỏng): đổi `DATABASE_URL` trong `/etc/aidevteam/app.env` sang `aidevteam_restore`, khởi động lại stack, kiểm tra `/health/ready` = 200. Đây là thao tác production → cần Owner duyệt theo policy.

## 5. Diễn tập (đề xuất trước UAT 03/12)
1. Backup DB staging → restore vào `aidevteam_restore_drill` → so số dòng các bảng chính và `schema_migrations`.
2. Ghi thời gian thực hiện làm số đo RTO ban đầu.
3. Xóa DB diễn tập.

## 6. Bằng chứng test
`tests/backup/test_backup_restore.sh` (17 kiểm tra, chạy trong CI): seed dữ liệu giả → backup → restore vào DB rỗng → số dòng 11 bảng khớp, phiên bản schema khớp, trigger append-only của audit vẫn hoạt động sau restore; từ chối target không rỗng / archive bị sửa / thiếu `--yes` / tên target có ký tự lạ / `PGPASSWORD`; retention đúng.

## Owner cần kiểm tra
- [ ] Đặt RPO/RTO, tần suất, nơi lưu off-site và mã hóa.
- [ ] Xác nhận hệ thống backup DB "đã có" hiện tại là gì, và vai trò của script này.
