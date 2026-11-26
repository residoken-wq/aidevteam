# Secret reference & redaction (P1-07)

> **Trạng thái:** `IMPLEMENTATION_PENDING` — đã có code và test; định dạng `secret_ref` là **đề xuất** (DECISION_LOG D-2026-11-26-04), chờ Owner xác nhận.

## 1. Nguyên tắc
- Control Center **chỉ lưu `secret_ref`** — con trỏ tới secret — không bao giờ lưu, trả về hay ghi log giá trị secret (CLAUDE.md §9).
- Release 0.1 **không resolve** secret (worker là mock). Control Center chưa giữ production secrets của sản phẩm khác (§5.2).

## 2. Định dạng `secret_ref` (`packages/contracts/src/secret-ref.ts`)

| Dạng | Ví dụ | Ý nghĩa |
|---|---|---|
| `env:AIDEV_SECRET_<NAME>` | `env:AIDEV_SECRET_CLAUDE_KEY` | Biến môi trường trên máy worker. `<NAME>`: `A-Z0-9_`, tối đa 64 ký tự |
| `file:/run/secrets/<name>` | `file:/run/secrets/claude-api-key` | File secret của Docker/compose. `<name>`: `a-z0-9._-`, không có `..` |

**Vì sao bắt buộc tiền tố `AIDEV_SECRET_`:** một ref không thể trỏ tới biến của chính Control Center (`DATABASE_URL`, `GITHUB_OAUTH_CLIENT_SECRET`…). Khi worker thật được làm (sau 0.1), worker chỉ chuyển cho tiến trình con **đúng** các biến được tham chiếu — allowlist, khắc phục điểm yếu router v0.1 §6.2-1 (`env=os.environ.copy()`).

**Input trông như secret thật** (token GitHub/Anthropic/AWS/Google/Slack, JWT, chuỗi dài nhiều loại ký tự…) bị từ chối với mã `secret_like`; thông báo lỗi là chuỗi cố định, **không lặp lại giá trị đã nhập**.

## 3. Redaction (`packages/contracts/src/redact.ts`)
Áp dụng tại:
- **Logger của api** (`RedactingLogger`) — mọi mức log, kể cả stack trace Nest in ra khi lỗi 500.
- **Metadata audit** (`writeAudit`) — che lại lần nữa trước khi lưu.
- Thông báo lỗi khi api không khởi động được.

| Loại | Cách nhận diện (heuristic) |
|---|---|
| Private key PEM | `-----BEGIN … PRIVATE KEY-----` … `-----END …-----` |
| Mật khẩu trong URL | `scheme://user:<password>@host` (giữ scheme/user/host) |
| Bearer / token | `Bearer <…>`, `token <…>` |
| JWT | `eyJ….….…` |
| Token có tiền tố đã biết | `ghp_/gho_/ghu_/ghs_/ghr_`, `github_pat_`, `sk-ant-`, `sk-`, `xox?-`, `AKIA/ASIA…`, `AIza…` (35 ký tự) |
| Cặp khóa nhạy cảm | `password=`, `secret:`, `client_secret=`, `api_key=`, `access_token=`… |
| Email | `local@domain.tld` |
| Số điện thoại VN | `0…`, `+84…`, `84…` với 9–10 chữ số, cho phép dấu cách/chấm/gạch |
| CCCD | đúng 12 chữ số, không nằm trong chuỗi chữ-số khác (UUID không bị che) |
| Khóa object nhạy cảm | `password`, `token`, `authorization`, `cookie`, `client_secret`, `code_verifier`… → thay toàn bộ giá trị |

**Giới hạn:** đây là heuristic, không đảm bảo bắt được mọi secret/PII. Ưu tiên che thừa hơn lọt. Quy tắc vẫn là **không đưa secret vào log ngay từ đầu**.

## 4. Việc để task sau
- API provider account/worker dùng `SecretRefSchema` — P2-07, P2-08.
- Resolve secret cho worker thật, rotation hooks — sau Release 0.1.
