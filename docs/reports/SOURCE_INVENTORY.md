# P0-01 — Source Inventory

> Kiểm kê lần đầu: 26/11/2026 (commit `bf9f7ac`) · **Cập nhật 27/11/2026**: đưa nguồn vào repo từ thư mục Downloads trên máy điều phối, theo đồng ý của người dùng phiên. Người lập: Claude (chưa review).

## 1. Nguồn được CLAUDE.md nhắc tới

| Nguồn | Đường dẫn trong repo | File gốc (máy điều phối) | SHA-256 | Trạng thái |
|---|---|---|---|---|
| Master Implementation Plan v1.0.0 | `docs/MASTER_IMPLEMENTATION_PLAN.md` | `AI_Dev_Team_Control_Center_Master_Implementation_Plan.md` | `73cecf0596a0e1dfc8023b6cd823b6b4a6374002b58439b7a3ca4bc7b6aa11ab` | Có (27/11) |
| Release Policy v1.0.1 (đang hiệu lực) | `docs/operations/RELEASE_POLICY.md` | `RELEASE_POLICY_v1.0.1.md` | `2d70618aed3d1b7ee4180250dd6a01e58516cd096bd252ae70d164c4f1bf4759` | Có (27/11) |
| Approval policy v1.0.1 | `policies/approval-policy.yaml` | `approval-policy-v1.0.1.yaml` | `ea29b214c72b66419afccdbf4dd990eca85a77e9e3f1c6e0a9c43a7f4081e1df` | Có (27/11) |
| Release Policy v1.0.2 (đề xuất) | `docs/operations/proposals/RELEASE_POLICY_v1.0.2.md` | — không tìm thấy | — | `SOURCE_MISSING` |
| Approval policy v1.0.2 (đề xuất) | `policies/proposals/approval-policy-v1.0.2.yaml` | — không tìm thấy | — | `SOURCE_MISSING` |
| AI Dev Team Automation Proposal | `docs/source/AI_Dev_Team_Automation_Proposal.md` | cùng tên | `1813f00fd29f203c628b4df6958afcfc6c37861f499b36cc425c0858272dd708` | Có (27/11) |
| AI Product Support → DevOps Extension | `docs/source/AI_Product_Support_to_DevOps_Extension.md` | cùng tên | `83919029e174498c3b43f6d2c202aa8f8a955733626cbf5e18e5e30de06c73f9` | Có (27/11) |
| AGY MCP Router v0.1 (zip + giải nén) | `docs/source/AGY_MCP_Router_MVP_v0_1.zip`, `docs/source/AGY_MCP_Router_MVP_v0.1/agy-mcp-router/` | `AGY_MCP_Router_MVP_v0.1.zip` | xem §2 | Có (27/11), **khớp** |
| CLAUDE.md v1.2 | `CLAUDE.md` | — | — | Đã đọc |

Ghi chú:
- Trong Downloads còn `RELEASE_POLICY.md` (bản **1.0.0**, SHA-256 `0a8e4b34577fac8a9a4200234c74867678dc32c33323506faa3218e3502781c1`). Bản này đã bị v1.0.1 thay thế (khác ở số phiên bản, mục "Cập nhật cấu hình 25/11" và dòng reviewer) nên **không** đưa vào repo.
- Đã quét 5 file văn bản trước khi đưa vào repo: không thấy email, số điện thoại, token hay mật khẩu. Secret scan của CI (gitleaks) chạy lại trên PR.
- Router v0.1 là **tài liệu tham khảo** (O-13), không build/chạy trong repo này.

## 2. Router v0.1 — đối chiếu SHA-256 (CLAUDE.md §6.1)

Tính lại ngày 27/11/2026 bằng `sha256sum` (Git Bash, Windows 10) sau khi giải nén.

| File | SHA-256 theo CLAUDE.md | Tính lại | Kết quả |
|---|---|---|---|
| `AGY_MCP_Router_MVP_v0_1.zip` | `f02e29bd0de79afb289746a011987766b302d9acb1246da41302afedadbce93a` | `f02e29bd0de79afb289746a011987766b302d9acb1246da41302afedadbce93a` | Khớp |
| `router.py` | `c4d9db4fdeef98f802677a568dbb1cadfe6dcdef4538759da1418f2483998c99` | `c4d9db4fdeef98f802677a568dbb1cadfe6dcdef4538759da1418f2483998c99` | Khớp |
| `README.md` | `64adf0d4e094513965cc6a1749eae259f071b0f365c43970510094061467e152` | `64adf0d4e094513965cc6a1749eae259f071b0f365c43970510094061467e152` | Khớp |
| `requirements.txt` | `22e0a3eb206339a4112945bafe1fb77688534a98816c3a4dd1c7e6ebbceb4190` | `22e0a3eb206339a4112945bafe1fb77688534a98816c3a4dd1c7e6ebbceb4190` | Khớp |
| `tests/test_router_mock.py` | `5651e0547436210eed949aa6f106f007bc67f99a4acdc10d6b06a8dfef14590b` | `5651e0547436210eed949aa6f106f007bc67f99a4acdc10d6b06a8dfef14590b` | Khớp |
| `tests/test_static.py` | `abbeef4debe677832a7fb5745fb065dc1bb0a4ad9139e57aae63c10a7ba7eb3f` | `abbeef4debe677832a7fb5745fb065dc1bb0a4ad9139e57aae63c10a7ba7eb3f` | Khớp |

Zip còn có file không liệt kê trong §6.1 (`.gitignore`, `config/*.example.json`, `scripts/install-*.{sh,ps1}`): chỉ là ví dụ đường dẫn cục bộ, không chứa secret.

## 3. Phát hiện sau khi có nguồn (cần xử lý tiếp)

1. **Backlog thiếu task.** `docs/backlog/issues-import.json` (35 task) được lập khi Master Plan còn `SOURCE_MISSING`, chỉ suy từ CLAUDE.md. Master Plan có **112 dòng task** (Phase 0–10, ví dụ P6-09 invalidation, P6-11 postmortem, P6-12 acceptance 8 gate). Tiến độ "33/35" chỉ đúng với backlog hiện tại, **không** phải tiến độ của Master Plan. Cần lập lại backlog (task riêng, đề xuất `P0-08r`).
2. **Approval record lệch giữa policy và DB.** `approval_record.required_fields` của v1.0.1 là `approval_id, approver_id, decision, timestamp, project_id, environment, release_manifest_digest, target_sha, pipeline_run_id`; `valid_decisions` là `APPROVE / REJECT / REQUEST_CHANGES`. Bảng `release_approvals` (migration 0001) **không có `project_id`** và chỉ cho `approved / rejected`. Ánh xạ và phần còn thiếu ghi ở `docs/releases/0.1/APPROVAL_RECORD.md` §1; sửa DB thuộc P6-05.
3. **v1.0.1 không có kênh duyệt bằng comment.** v1.0.1 §5 yêu cầu GitHub protected production environment (`require_protected_production_environment: true`) — không có trên gói hiện tại (O-01). Kênh `/approve-*` chỉ có ở v1.0.2 (chưa có file). Vì vậy evaluator áp dụng v1.0.1 phải **fail closed** cho production cho tới khi v1.0.2 được xác nhận hoặc Owner ký ngoại lệ bằng văn bản (CLAUDE.md §5.5).
4. **Tên trạng thái release (O-04).** v1.0.1 §3–4 có tên trạng thái chính thức (`READY_FOR_RELEASE → MANIFEST_BUILT → … → RELEASED`; hotfix `INCIDENT_CONFIRMED → … → INCIDENT_POSTMORTEM`). `docs/architecture/STATE_MACHINES.md` đang dùng tên đề xuất `UNVERIFIED` → cần đối chiếu lại.
5. **R-01..R-10** có trong Master Plan §14 → bổ sung vào `RISKS.md` (việc còn mở).

## Owner cần kiểm tra
- [ ] Xác nhận các file trong repo đúng là bản Owner đã duyệt (đối chiếu SHA-256 ở §1).
- [ ] Đưa Release Policy v1.0.2 + `approval-policy-v1.0.2.yaml` vào repo (vẫn `SOURCE_MISSING`), hoặc quyết định thay thế bằng văn bản trước 04/12.
- [ ] Đồng ý lập lại backlog theo Master Plan (phát hiện 1).
