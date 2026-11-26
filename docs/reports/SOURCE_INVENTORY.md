# P0-01 — Source Inventory

> Ngày kiểm kê: 26/11/2026 · Commit `main`: `bf9f7ac` · Người lập: Claude (chưa review)

## 1. Nguồn được CLAUDE.md nhắc tới

| Nguồn | Đường dẫn kỳ vọng | Có trong repo? | Trạng thái |
|---|---|---|---|
| Master Implementation Plan v1.0.0 | `docs/MASTER_IMPLEMENTATION_PLAN.md` | Không | `SOURCE_MISSING` |
| Release Policy v1.0.1 (đang hiệu lực) | `docs/operations/RELEASE_POLICY.md` | Không | `SOURCE_MISSING` |
| Approval policy v1.0.1 | `policies/approval-policy.yaml` | Không | `SOURCE_MISSING` |
| Release Policy v1.0.2 (đề xuất) | `docs/operations/proposals/RELEASE_POLICY_v1.0.2.md` | Không | `SOURCE_MISSING` |
| Approval policy v1.0.2 (đề xuất) | `policies/proposals/approval-policy-v1.0.2.yaml` | Không | `SOURCE_MISSING` |
| AI Dev Team Automation Proposal | `docs/source/AI_Dev_Team_Automation_Proposal.md` | Không | `SOURCE_MISSING` |
| AI Product Support → DevOps Extension | `docs/source/AI_Product_Support_to_DevOps_Extension.md` | Không | `SOURCE_MISSING` |
| AGY MCP Router v0.1 (zip + giải nén) | `docs/source/AGY_MCP_Router_MVP_v0.1/` | Không | `SOURCE_MISSING` |
| CLAUDE.md v1.2 | `CLAUDE.md` | Có | Đã đọc |

## 2. Router v0.1 — đối chiếu SHA-256 (CLAUDE.md §6.1)

Không tính lại được vì file **không có trong repo**. Giá trị dưới đây chỉ chép từ CLAUDE.md, **chưa được xác minh lại**.

| File | SHA-256 theo CLAUDE.md | Tính lại |
|---|---|---|
| `AGY_MCP_Router_MVP_v0_1.zip` | `f02e29bd0de79afb289746a011987766b302d9acb1246da41302afedadbce93a` | `SOURCE_MISSING` |
| `router.py` | `c4d9db4fdeef98f802677a568dbb1cadfe6dcdef4538759da1418f2483998c99` | `SOURCE_MISSING` |
| `README.md` | `64adf0d4e094513965cc6a1749eae259f071b0f365c43970510094061467e152` | `SOURCE_MISSING` |
| `requirements.txt` | `22e0a3eb206339a4112945bafe1fb77688534a98816c3a4dd1c7e6ebbceb4190` | `SOURCE_MISSING` |
| `tests/test_router_mock.py` | `5651e0547436210eed949aa6f106f007bc67f99a4acdc10d6b06a8dfef14590b` | `SOURCE_MISSING` |
| `tests/test_static.py` | `abbeef4debe677832a7fb5745fb065dc1bb0a4ad9139e57aae63c10a7ba7eb3f` | `SOURCE_MISSING` |

## 3. Hệ quả
- Acceptance criteria của mọi task đang **suy ra từ CLAUDE.md** (task card trong `docs/agy-prompts/tasks/`), chưa đối chiếu Master Plan.
- Approval record "9 trường" (CLAUDE.md §5.5) chưa biết tên trường → cột `release_approvals` cần đối chiếu khi có policy.
- Tên trạng thái release theo policy (O-04) chưa biết → `STATE_MACHINES.md` dùng tên đề xuất, đánh dấu `UNVERIFIED`.
- Rủi ro R-01..R-10 nằm trong Master Plan → `RISKS.md` chỉ có R-11 theo O-08 và các rủi ro phát hiện mới.

## Owner cần kiểm tra
- [ ] Đưa 8 nguồn `SOURCE_MISSING` vào repo (qua PR), đặc biệt Master Plan và Release Policy v1.0.1/v1.0.2.
