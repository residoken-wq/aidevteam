# P0-04 — Provider Compliance

> Ngày: 26/11/2026 · Tài liệu này **ghi nhận trạng thái**, **không** đưa ra kết luận pháp lý. Mọi đánh giá điều khoản cần người có thẩm quyền của PACE xác nhận.

| Provider | Dùng cho | `internal_data_approval` | `provider_terms` | Ghi chú |
|---|---|---|---|---|
| **Anthropic (Claude)** | Claude Code (người dùng); automation qua API key Claude Platform (O-10) | `UNVERIFIED` — chưa có văn bản duyệt nội bộ trong repo | `UNVERIFIED` | O-10: không đăng nhập tài khoản subscription cá nhân trên server. Release 0.1 không gọi API Claude từ sản phẩm |
| **Google Antigravity (AGY)** | Công cụ hỗ trợ lập trình cho người vận hành (bộ prompt `docs/agy-prompts/`) | **APPROVED** (PACE duyệt nội bộ việc đưa code vào Antigravity — O-06) | **UNVERIFIED** (điều khoản headless/thương mại chưa xác minh — O-06) | Release 0.1 **không tích hợp AGY** vào sản phẩm (§2 quy tắc 8). Chỉ đưa code repo này vào AGY; không đưa secret, dữ liệu khách hàng, dữ liệu học viên, tài liệu D4 |
| **GitHub** | Repo, Actions, ghcr.io, OAuth App (đăng nhập) | `UNVERIFIED` | `UNVERIFIED` | Gói Free→Pro (O-02); protected environment reviewer không có trên gói (O-01). OAuth chỉ đọc định danh công khai (không scope) |

## Dữ liệu đi ra ngoài trong Release 0.1

| Luồng | Dữ liệu | Ghi chú |
|---|---|---|
| Trình duyệt ↔ GitHub OAuth | Mã code, định danh GitHub công khai (id, login) | Access token bị bỏ ngay, không lưu |
| CI → ghcr.io | Image ứng dụng (không chứa secret — `.dockerignore`) | Package private |
| Người vận hành → AGY / Claude Code | Mã nguồn repo này | Theo O-06 / chính sách AI của PACE |

## Owner cần kiểm tra
- [ ] Ai ở PACE xác nhận `provider_terms` cho Anthropic, Google Antigravity, GitHub; hạn chót?
- [ ] Văn bản duyệt nội bộ cho Anthropic (`internal_data_approval`) — có hay chưa?
