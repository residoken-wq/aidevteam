# Test evidence — tới 26/11/2026

> Chỉ ghi kết quả đã thực sự chạy. "Cục bộ" = môi trường làm việc của Claude (Node 24.22.3, pnpm 10.34.9, PostgreSQL 16.15). "CI" = GitHub Actions trên PR.

## 1. Kết quả theo PR

| PR | Task | Cục bộ (lần cuối trước khi push) | CI trên PR |
|---|---|---|---|
| residoken-wq/aidevteam#2 | P1-09 (CI/CD) | `test_deploy.sh` 17/17; `docker compose config` hợp lệ | `ci` ✅ (build bỏ qua — chưa có Dockerfile) |
| residoken-wq/aidevteam#3 | P1-01 | lint/typecheck/build ✅; unit 21/21 | `ci` ✅, `build (api)` ✅, `build (web)` ✅ |
| residoken-wq/aidevteam#4 | P1-04, P1-08 | unit 35/35; integration DB 29/29 | 4/4 ✅ |
| residoken-wq/aidevteam#5 | P1-05G | unit 70/70; integration db 32/32, api 18/18 | 4/4 ✅ |
| residoken-wq/aidevteam#6 | P1-06 (+ rate limit) | unit 82/82; integration db 37/37, api 38/38 | 4/4 ✅ |
| residoken-wq/aidevteam#7 | P1-07 | unit 127/127; integration db 37/37, api 40/40 | 4/4 ✅ |

## 2. Kiểm tra ngược (mutation check) — chứng minh test bắt được lỗi

| Gỡ/làm hỏng | Test bị fail | PR |
|---|---|---|
| Trigger append-only audit; FK role cùng org | 3 test `constraints.test.ts` | #4 |
| Kiểm tra allowlist | `rejects a valid GitHub user who is not in the allowlist` | #5 |
| So khớp `state` với cookie | Ban đầu **không** test nào fail → bổ sung test login CSRF → fail đúng | #5 |
| Default deny cho route không khai báo | `a route without an access rule is forbidden…` | #6 |
| Lọc `org_id` trong truy vấn audit | 2 test cô lập tenant | #6 |
| Redaction trong logger / audit | `logger.test.ts`, 2 test `redaction.test.ts` | #7 |
| Kiểm tra trùng/lồng `workspace_path` của worker | 2 test AC-4 `workers.test.ts` | P2-08 |
| Advisory lock cấp org khi tạo worker | Ban đầu test race song song **không** fail → thêm test giữ lock từ DB (tất định) → fail đúng | P2-08 |
| Lọc `org_id` khi gắn `projectSlug` | `another org's project cannot be attached` | P2-08 |
| Kiểm tra platform admin trong guard (P2-03) | 2 test AC-2 `platform-orgs.test.ts` | P2-03 |
| Bỏ lọc org đã lưu trữ khỏi membership | 2 test "archived org" `platform-orgs.test.ts` | P2-03 |
| Kiểm tra vòng lặp báo cáo của agent | 2 test AC-4 `agents.test.ts` | P2-05 |
| Advisory lock cấp org khi đổi cấp trên | `concurrent manager changes cannot create a cycle` | P2-05 |
| Lọc `org_id` khi gắn provider account / cấp trên | `another org's provider account or manager…` | P2-05 |
| Chặn lưu trữ agent còn cấp dưới | `an agent with active reports cannot be archived…` | P2-05 |
| Chặn sửa worker đã lưu trữ | `duplicate slug → 409; archived worker cannot be edited…` | P2-08 |

## 3. Chạy thử end-to-end cục bộ (không phải staging)
- #5: web standalone + api + PostgreSQL qua proxy `/auth/*`: redirect GitHub có PKCE, không scope; session; logout CSRF.
- #6: cấp role bằng CLI; chọn org bằng form; lần đăng nhập thứ 6 cùng IP → 429; IP khác → 302.
- Kiểm chứng header: Next.js rewrite proxy chuyển nguyên `X-Forwarded-For`, không thêm IP của nó.

## 4. Chưa có bằng chứng (UNVERIFIED)
- Chạy trên VPS/staging; OAuth App thật; NPM đặt `X-Forwarded-For`; rule `DOCKER-USER`; `deploy.sh` với Docker daemon thật; rollback image thật; image pull từ ghcr.io bằng tài khoản máy.
- E2E trình duyệt (Playwright) cho các luồng UI.
