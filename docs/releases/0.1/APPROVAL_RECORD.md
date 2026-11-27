# Release 0.1 — Approval record (MẪU, CHƯA CÓ BẢN GHI)

> **Trạng thái: `TEMPLATE — NO APPROVAL RECORDED`** · Soạn 27/11/2026.
> Người vận hành (con người) điền file này **sau khi** đối chiếu comment `/approve-uat <digest>` / `/approve-production <digest>` của Owner trên PR manifest (CLAUDE.md §5.5). Claude **không** điền, không giả lập approval (§2 quy tắc 2, 6).
> Teams/chat không phải nguồn approval (§2 quy tắc 7). Nguồn duy nhất: comment trên PR manifest.

## 1. Các trường (theo `policies/approval-policy.yaml` v1.0.1)

"Approval record (9 trường)" theo §5.5 = `approval_record.required_fields` của policy v1.0.1 (đưa vào repo 27/11/2026). Cột "DB" là cột tương ứng của bảng `release_approvals` (migration 0001).

| # | Trường (policy) | Giá trị hợp lệ | Cột DB | Khớp? |
|---|---|---|---|---|
| 1 | `approval_id` | ID duy nhất của bản ghi | `id` (uuid) | Có |
| 2 | `approver_id` | GitHub user ID **số** của người duyệt (không dùng username, CLAUDE.md §9) | `approver_github_user_id` | Có |
| 3 | `decision` | `APPROVE` / `REJECT` / `REQUEST_CHANGES` | `decision` (`approved` / `rejected`) | **Thiếu `REQUEST_CHANGES`** |
| 4 | `timestamp` | Thời điểm comment (ISO 8601, ghi rõ múi giờ) | `decided_at` | Có |
| 5 | `project_id` | Project của release | — | **Không có cột** |
| 6 | `environment` | `uat` / `production` (O-05) | `environment` | Có |
| 7 | `release_manifest_digest` | `sha256:<64 hex>`, khớp digest trong comment | `release_manifest_digest` | Có |
| 8 | `target_sha` | 40 ký tự hex, khớp manifest | `target_sha` | Có |
| 9 | `pipeline_run_id` | Run CI xanh của `target_sha` | `pipeline_run_id` | Có |

Thêm ngoài 9 trường (bằng chứng): `source_comment_url` (`https://github.com/<owner>/<repo>/pull/<n>#issuecomment-<n>`), `recorded_at`, người vận hành ghi. Hai chỗ lệch (`REQUEST_CHANGES`, `project_id`) sửa trong P6-05 bằng migration; với Release 0.1, `project_id` ghi tay là project Control Center.

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
| `approval_id` | | |
| `approver_id` (GitHub user ID số) | | |
| `decision` | | |
| `timestamp` | | |
| `project_id` | | |
| `environment` | `uat` | `production` |
| `release_manifest_digest` | | |
| `target_sha` | | |
| `pipeline_run_id` | | |
| `source_comment_url` | | |
| `recorded_at` | | |
| Người vận hành ghi (GitHub user ID số) | | |

Ghi chú: Release 0.1 chưa có approval service ghi vào bảng `release_approvals` (P6-05/P6-08, sau 0.1). Nếu muốn bản ghi hiện ở Approval Center, việc chèn vào DB là thao tác trên hệ thống thật → cần Owner duyệt riêng, không làm tự động.
