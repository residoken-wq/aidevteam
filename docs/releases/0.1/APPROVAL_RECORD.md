# Release 0.1 — Approval record (MẪU, CHƯA CÓ BẢN GHI)

> **Trạng thái: `TEMPLATE — NO APPROVAL RECORDED`** · Soạn 27/11/2026.
> Người vận hành (con người) điền file này **sau khi** đối chiếu comment `/approve-uat <digest>` / `/approve-production <digest>` của Owner trên PR manifest (CLAUDE.md §5.5). Claude **không** điền, không giả lập approval (§2 quy tắc 2, 6).
> Teams/chat không phải nguồn approval (§2 quy tắc 7). Nguồn duy nhất: comment trên PR manifest.

## 1. Các trường (đề xuất — cần đối chiếu Release Policy)

"Approval record (9 trường)" theo §5.5. Release Policy v1.0.1/v1.0.2 đang **`SOURCE_MISSING`** trong repo (SOURCE_INVENTORY), nên tên trường dưới đây lấy theo cột bảng `release_approvals` (migration 0001, cũng 9 trường dữ liệu) — **UNVERIFIED**, đối chiếu lại khi có file policy.

| # | Trường | Ràng buộc (theo DB) |
|---|---|---|
| 1 | `environment` | `uat` hoặc `production` |
| 2 | `decision` | `approved` hoặc `rejected` |
| 3 | `target_sha` | 40 ký tự hex, khớp manifest |
| 4 | `release_manifest_digest` | `sha256:<64 hex>`, khớp digest trong comment |
| 5 | `pipeline_run_id` | 1–64 ký tự (run CI của `target_sha`) |
| 6 | `approver_github_user_id` | GitHub user ID **số** của người duyệt (không dùng username) |
| 7 | `source_comment_url` | `https://github.com/<owner>/<repo>/pull/<n>#issuecomment-<n>` |
| 8 | `decided_at` | Thời điểm comment (ISO 8601, ghi rõ múi giờ) |
| 9 | `recorded_at` | Thời điểm người vận hành ghi bản ghi |

## 2. Đối chiếu trước khi ghi (người vận hành)

- [ ] Comment do đúng tài khoản Owner viết: so **GitHub user ID số** (không chỉ username).
- [ ] Digest trong comment = digest manifest tính lại từ commit PR manifest (lệnh ở `RELEASE_MANIFEST.md` §8).
- [ ] `target_sha` + digest image trong manifest = thứ sắp deploy (`deploy.sh --dry-run`).
- [ ] `pipeline_run_id` là run xanh của đúng `target_sha`.
- [ ] Comment còn trong hạn `ttl_minutes` — **hiện `null` → chặn deploy** (D-OWN-10). Owner phải đặt giá trị trước.
- [ ] Release Policy áp dụng đã có trong repo, hoặc Owner đã ký ngoại lệ bằng văn bản cho 0.1 (§5.5).

## 3. Bản ghi

| Trường | UAT | Production |
|---|---|---|
| `environment` | `uat` | `production` |
| `decision` | | |
| `target_sha` | | |
| `release_manifest_digest` | | |
| `pipeline_run_id` | | |
| `approver_github_user_id` | | |
| `source_comment_url` | | |
| `decided_at` | | |
| `recorded_at` | | |
| Người vận hành ghi (GitHub user ID số) | | |

Ghi chú: Release 0.1 chưa có approval service ghi vào bảng `release_approvals` (P6-05/P6-08, sau 0.1). Nếu muốn bản ghi hiện ở Approval Center, việc chèn vào DB là thao tác trên hệ thống thật → cần Owner duyệt riêng, không làm tự động.
