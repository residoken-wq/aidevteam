# ADR-001: Frontend — Next.js (App Router) + TypeScript

- **Trạng thái:** `ACCEPTED` (25/11/2026)
- **Người quyết định:** người dùng phiên Claude Code ngày 25/11/2026, xác nhận là có đồng ý của Owner. **Owner `residoken-wq` cần xác nhận lại trên PR P1-01** (xem DECISION_LOG D-2026-11-25-01).
- **Liên quan:** P1-01, ADR-002, CLAUDE.md §7 (định hướng ADR)

## Bối cảnh
Control Center cần giao diện quản trị (dashboard, CRUD, Kanban, Approval Center chỉ đọc), dùng chung contract với backend.

## Quyết định
- `apps/web`: Next.js 16.4.6, React 19.3.1, App Router, `output: "standalone"` để đóng gói Docker.
- Chỉ dùng web cho UI; nghiệp vụ và phân quyền nằm ở `apps/api` (ADR-002). Web không truy cập DB trực tiếp.
- Security headers mặc định ở `lib/security-headers.ts`; CSP đầy đủ bổ sung ở P1-05G.

## Phương án đã cân nhắc
- **Next.js full-stack (API routes)**: ít thành phần hơn, nhưng trộn UI với logic phân quyền, khó tách scale và khó dùng job/worker sau này. Không chọn.
- **SPA (Vite + React)**: nhẹ hơn nhưng cần server riêng cho SSR/auth cookie. Không chọn.

## Hệ quả
- Lint Next-specific (`@next/eslint-plugin-next`) chưa bật ở P1-01 — đề xuất bổ sung khi có UI thật.
- `next build` có thể ghi `next-env.d.ts` (đã gitignore).
