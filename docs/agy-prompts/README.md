# Bộ prompt instruction cho Antigravity (AGY) — Release 0.1

> **Từ 27/11/2026 dùng [`AGY_RUNBOOK.md`](AGY_RUNBOOK.md) + [`tasks-v2/`](tasks-v2/)** (D-2026-11-27-01): QA đơn giản, tiết kiệm token, báo cáo tiến độ sau mỗi task bằng `node scripts/progress.mjs`.
> Các file `00_…06_*.md` và `tasks/` bên dưới là bản 25/11, **chỉ để tham khảo** — cổng G1/G2 đã đạt (Owner ký 26/11), nhiều task đã merge.

> **Phiên bản:** 0.1-draft · **Ngày:** 25/11/2026 · **Trạng thái:** `DRAFT – CHỜ OWNER DUYỆT`
> **Người soạn:** Claude (vai trò BA Manager + Planning Manager + QA) · **Nguồn:** `CLAUDE.md` v1.2
> Timezone: `Asia/Ho_Chi_Minh`

---

## 1. Mục đích

Bộ prompt này điều khiển **cách AGY tư duy trước khi viết code**: hiểu yêu cầu (BA) → lập kế hoạch (Planning) → viết test trước → code → tự kiểm (QA) → bàn giao PR cho người review.

AGY ở đây là **công cụ hỗ trợ lập trình do người vận hành dùng** (developer mở AGY, dán prompt, review kết quả). Đây **không** phải tích hợp AGY vào Control Center — việc đó bị cấm trong Release 0.1 (CLAUDE.md §2 quy tắc 8).

## 2. Điều kiện trước khi dùng (cổng chặn)

| # | Điều kiện | Trạng thái 25/11/2026 | Nếu chưa đạt |
|---|---|---|---|
| G1 | Owner ký baseline Phase 0 (CLAUDE.md §7: "Không viết code ứng dụng trước khi Owner ký baseline") | **CHƯA** | Không dùng task card nào trong `tasks/`. Chỉ được dùng prompt cho tài liệu Phase 0 |
| G2 | ADR-001..004 (frontend, backend, queue, ORM) ở trạng thái `ACCEPTED` | `PROPOSED` | Task card có placeholder `{{STACK}}`; AGY phải dừng nếu ADR chưa ACCEPTED |
| G3 | O-06: `internal_data_approval: APPROVED`, `provider_terms: UNVERIFIED` | UNVERIFIED | Chỉ đưa **code của repo này** vào AGY. Không đưa secret, dữ liệu khách hàng, dữ liệu học viên, tài liệu D4 |
| G4 | Repo có `docs/MASTER_IMPLEMENTATION_PLAN.md`, `RELEASE_POLICY.md`, `approval-policy.yaml` | **SOURCE_MISSING** (repo hiện chỉ có CLAUDE.md) | Acceptance criteria trong task card là **bản suy ra từ CLAUDE.md**, phải đối chiếu lại với Master Plan khi có |

## 3. Cấu trúc

| File | Dùng khi nào | Ai dùng |
|---|---|---|
| `00_SYSTEM_CONTEXT.md` | Dán **đầu mọi phiên** AGY (hoặc đặt làm rules/custom instructions của workspace) | Developer |
| `01_BA_REQUIREMENT_ANALYSIS.md` | Bước 1: AGY phân tích task, viết lại yêu cầu, liệt kê câu hỏi | Developer → AGY |
| `02_PLANNING_PROTOCOL.md` | Bước 2: AGY lập kế hoạch file/contract/test, chờ người duyệt | Developer → AGY |
| `03_CODING_PROTOCOL.md` | Bước 3: AGY code theo test-first, từng bước nhỏ | Developer → AGY |
| `04_QA_SELF_REVIEW.md` | Bước 4: AGY tự kiểm theo checklist bảo mật + AC | Developer → AGY |
| `05_HANDOFF_PR.md` | Bước 5: AGY soạn mô tả PR theo CLAUDE.md §8 | Developer → AGY |
| `06_QA_GATE_REVIEWER.md` | Người/Claude review PR do AGY tạo (không phải approval) | Reviewer |
| `tasks/*.md` | Task card cho từng hạng mục Release 0.1 (§5.2) | Developer |

## 4. Quy trình một task

```text
[00 System context] → [Task card] → [01 BA] ──(người trả lời câu hỏi)──▶ [02 Plan]
   ──(người duyệt plan)──▶ [03 Code + test] → [04 QA self-review] → [05 PR]
   ──▶ Reviewer dùng [06 QA gate] → người review approve → merge (không phải AGY)
```

Hai điểm **dừng bắt buộc chờ người**: sau bước 01 (câu hỏi mở) và sau bước 02 (plan). AGY không được tự đi tiếp.

## 5. Thứ tự task đề xuất (theo phụ thuộc, khớp lịch §5.4)

| Đợt | Task card | Phụ thuộc | Mục tiêu ngày (đề xuất) |
|---|---|---|---|
| W1 | `P1-01_P1-02_repo_skeleton_ci.md` | G1, G2 | 27–28/11 |
| W1 | `P1-04_P1-08_db_migration_audit.md` | W1 skeleton | 28/11 |
| W2 | `P1-05G_github_oauth.md` | DB, OAuth App do Owner đăng ký | 28–29/11 |
| W2 | `P1-06_rbac_default_deny.md` | DB, P1-05G | 29/11 |
| W2 | `P1-07_secret_reference.md` | DB | 29/11 |
| W2 | `P1-09_ci_sca_required_checks.md` | Skeleton | 29/11 |
| W3 | `P2_core_crud.md` | RBAC | 30/11–01/12 |
| W3 | `P3-02_P3-04_task_kanban.md` | P2 project | 01/12 |
| W3 | `P4_mock_dispatch.md` | P2 worker, P3 task | 01–02/12 |
| W3 | `P2-02_dashboard.md` | P2, P3, P4 | 02/12 |
| W3 | `P6-06_approval_center_readonly.md` | RBAC | 02/12 |
| W3 | `P1-10_P1-11_health_backup.md` | DB | 02/12 |
| — | **Feature freeze 02/12** | Thiếu → cắt phạm vi hoặc `NO_GO` | 02/12 |

Lịch trên là **đề xuất quản lý rủi ro**, không phải ước lượng năng suất. Chưa có dữ liệu năng suất thật của AGY trên dự án này.

## 6. Quy tắc cho người vận hành AGY

1. Mỗi task một branch `ai/<TASK-ID>-<slug>` và một worktree. Không cho AGY thao tác trên `main`.
2. Không để AGY chạy lệnh đọc `.env`, `~/.ssh`, keyring, file key/cert (PACE AI Policy mục 2). Nếu workspace AGY có chế độ tự chạy terminal, **tắt auto-approve** cho lệnh shell (tên cài đặt cụ thể: kiểm tra tài liệu AGY chính thức — **chưa xác minh**).
3. Không dán client secret OAuth, connection string, API key vào AGY. Dùng `.env.example` với giá trị giả.
4. Output AGY là **bản nháp**. Code do AI viết phải được người review trước khi merge (CLAUDE.md §2 quy tắc 5).
5. Kết quả "test pass" do AGY báo phải được **chạy lại** trên CI hoặc máy người vận hành trước khi ghi vào evidence.
