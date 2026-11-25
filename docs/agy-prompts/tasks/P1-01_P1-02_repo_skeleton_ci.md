# P1-01 + P1-02 — Repo skeleton + CI cơ bản

```text
# TASK CARD: P1-01/P1-02 — Monorepo skeleton + CI (lint, typecheck, test)
Branch: ai/P1-01-repo-skeleton
Nhãn: release-0.1, phase:1
Phụ thuộc: Owner ký baseline Phase 0
ADR cần ACCEPTED: ADR-001 (frontend), ADR-002 (backend), ADR-004 (ORM). Monorepo: pnpm workspaces.

## Bối cảnh
Repo hiện chỉ có tài liệu. Cần khung monorepo chạy được để mọi task sau dựa vào.

## Phạm vi (làm)
- Cấu trúc đề xuất (điều chỉnh theo ADR):
  apps/web, apps/api, packages/contracts, packages/config (eslint/tsconfig dùng chung)
- Pin phiên bản Node và pnpm (engines + packageManager). Version lấy từ `node --version`,
  `pnpm --version` thật trên máy, ghi vào báo cáo. Không đoán.
- Script gốc: lint, typecheck, test, build — chạy được trên toàn workspace.
- 1 test mẫu mỗi package (thật sự chạy, không rỗng).
- .env.example với GIÁ TRỊ GIẢ; .gitignore chặn .env, *.pem, *.key.
- GitHub Actions workflow tên job `ci`: install (frozen lockfile) → lint → typecheck → test.
  Permissions tối thiểu (contents: read). Không dùng secret trong workflow ở task này.
  Action bên thứ ba pin theo commit SHA hoặc tag chính thức (ghi UNVERIFIED nếu chưa kiểm).
- Cập nhật CLAUDE.md §11 "Lệnh dự án" bằng các lệnh ĐÃ CHẠY THÀNH CÔNG (đề xuất diff, người duyệt).

## Ngoài phạm vi
SCA (P1-09), DB (P1-04), auth, Docker production.

## Acceptance criteria
AC-1 Clone sạch + `pnpm install --frozen-lockfile` thành công.
AC-2 `pnpm lint`, `pnpm typecheck`, `pnpm test` exit 0 ở root.
AC-3 Cố tình thêm lỗi type → typecheck exit ≠ 0 (chứng minh gate có tác dụng; revert sau).
AC-4 Workflow `ci` chạy trên pull_request và báo trạng thái.
AC-5 Không có file .env thật trong repo; .env.example không chứa giá trị thật.

## Điểm dừng hỏi người
- ADR-001/002/004 chưa ACCEPTED.
- Cần chọn version Node LTS (đưa phương án, người chọn).
```
