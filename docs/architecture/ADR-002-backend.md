# ADR-002: Backend — NestJS + TypeScript, contract dùng chung bằng Zod

- **Trạng thái:** `ACCEPTED` (25/11/2026)
- **Người quyết định:** như ADR-001. **Owner `residoken-wq` cần xác nhận lại trên PR P1-01.**
- **Liên quan:** P1-01, ADR-001, ADR-003 (queue, PROPOSED), ADR-004 (ORM, PROPOSED)

## Quyết định
- Monorepo pnpm workspaces (pnpm 10.34.9, Node.js 24 LTS — `.nvmrc` 24.22.3).
- `apps/api`: NestJS 12.6 (`@nestjs/core` 12.6.0, `@nestjs/platform-express` 12.6.1), CommonJS, build bằng `tsc`.
- `packages/contracts`: Zod 4.6.7, schema dùng chung cho api và web. Contract-first: endpoint mới phải có schema ở đây trước.
- Test: Vitest 5.1.1 cho mọi package; api dùng `unplugin-swc` để có decorator metadata cho DI của NestJS.
- TypeScript 6.0.3 (không dùng 7.x vì `typescript-eslint` 8.74.0 yêu cầu `typescript <6.1.0`).

## Phương án đã cân nhắc
- **FastAPI (Python)**: không có lý do rõ ràng để tách ngôn ngữ (CLAUDE.md §7); mất lợi thế contract dùng chung. Không chọn.
- **Jest cho api**: là mặc định của NestJS nhưng tạo hai bộ test runner trong repo. Chọn Vitest + SWC.

## Hệ quả
- `pnpm deploy` ở pnpm v10 cần `--legacy` (hoặc `inject-workspace-packages=true`); Dockerfile api dùng `--legacy`. Xem https://pnpm.io/cli/deploy
- NestJS 12 là major mới; một số tài liệu/ví dụ cộng đồng có thể vẫn theo bản 11 — đối chiếu tài liệu chính thức khi dùng API mới.
