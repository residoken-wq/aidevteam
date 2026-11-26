# DECISION LOG

> Nguồn sự thật số 1 (CLAUDE.md §1). Mỗi mục: ID, ngày, quyết định, người quyết, bằng chứng, trạng thái.
> Khởi tạo đầy đủ từ CLAUDE.md §4 là việc của Phase 0 (P0-08/§7 mục 10) — **chưa làm**. File này hiện chỉ ghi các quyết định phát sinh trong phiên 25/11/2026.

| ID | Ngày | Quyết định | Người quyết | Bằng chứng | Trạng thái |
|---|---|---|---|---|---|
| D-2026-11-25-01 | 25/11/2026 | Cho phép bắt đầu P1-01 (repo skeleton) **trước khi** Owner ký baseline Phase 0 — ngoại lệ với CLAUDE.md §7 | Người dùng phiên Claude Code (tài khoản GitHub `kensuben`), xác nhận có đồng ý của Owner | Trả lời trong phiên Claude Code 25/11/2026 | CHỜ `residoken-wq` XÁC NHẬN TRÊN PR P1-01 |
| D-2026-11-25-02 | 25/11/2026 | ADR-001 (Next.js) và ADR-002 (NestJS + Zod, pnpm, Node 24 LTS) → `ACCEPTED` | Như trên | Như trên; merge qua residoken-wq/aidevteam#3 | CHỜ `residoken-wq` XÁC NHẬN |
| D-2026-11-25-03 | 25/11/2026 | Khi PR có CI xanh, Claude hỏi người dùng; người dùng đồng ý rõ ràng từng PR thì Claude thực hiện thao tác merge | Người dùng phiên | Trả lời trong phiên | ÁP DỤNG TRONG PHIÊN. Lưu ý: không thay thế yêu cầu "người review" ở CLAUDE.md §2 quy tắc 5 — câu trả lời đồng ý của người dùng được coi là quyết định review của họ |
| D-2026-11-25-04 | 25/11/2026 | CI/CD: GitHub build image lên ghcr.io; VPS `192.168.250.30` pull theo digest, chạy thủ công sau approval; web publish `:3301` cho NPM `192.168.250.10` | Người dùng phiên | PR residoken-wq/aidevteam#2 (đã merge) | ĐÃ MERGE |
| D-2026-11-25-05 | 25/11/2026 | ADR-004: Drizzle ORM + migration SQL up/down tự quản lý → `ACCEPTED` | Người dùng phiên | Trả lời trong phiên ("chọn Drizzle") | CHỜ `residoken-wq` XÁC NHẬN |
