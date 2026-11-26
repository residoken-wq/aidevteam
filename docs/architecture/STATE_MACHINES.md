# State machines (O-04)

> Ngày: 26/11/2026 · Trạng thái: **`PROPOSED` — tên trạng thái chưa đối chiếu policy**.
> O-04 yêu cầu tên trạng thái release lấy theo policy, nhưng `RELEASE_POLICY.md` v1.0.1 và v1.0.2 đang `SOURCE_MISSING`. Mọi tên dưới đây là đề xuất; cột "Tên theo policy" để trống cho tới khi có file policy.
> Code chỉ được dùng các máy trạng thái này sau khi Owner duyệt; mọi chuyển trạng thái đi qua endpoint riêng, cập nhật có điều kiện `WHERE status = :from` và ghi audit.

## 1. Task (P3-02/P3-04 — Release 0.1)

```text
BACKLOG ─▶ TODO ─▶ IN_PROGRESS ─▶ IN_REVIEW ─▶ DONE
   │         │          │   ▲          │
   └────┬────┴──────────┘   └──────────┘ (changes requested)
        ▼
    CANCELLED
```

| Từ | Sang | Ai được làm (RBAC) | Điều kiện |
|---|---|---|---|
| BACKLOG | TODO | `task:write` | — |
| TODO | IN_PROGRESS | `task:write` | — |
| IN_PROGRESS | IN_REVIEW | `task:write` | — |
| IN_REVIEW | IN_PROGRESS | `task:write` | Có yêu cầu sửa |
| IN_REVIEW | DONE | `task:write` | CLAUDE.md §2 quy tắc 11: chỉ DONE khi đạt AC, có test, đã review — 0.1 ghi nhận bằng xác nhận của người, **không tự động** |
| BACKLOG/TODO/IN_PROGRESS | CANCELLED | `task:write` | Ghi lý do |

## 2. Agent run (P4 — mock worker)

```text
QUEUED ─▶ RUNNING ─▶ SUCCEEDED
   │         ├──────▶ FAILED        (exit ≠ 0, output không hợp lệ, timeout → fail closed)
   │         ├──────▶ CANCELLED     (chỉ khi WHERE status = 'RUNNING')
   │         └──────▶ INTERRUPTED   (tiến trình khởi động lại)
   └──────────────────▶ CANCELLED
```
Thành công chỉ khi exit 0 **và** output hợp lệ có `status = SUCCESS` (router §6.2).

## 3. Release train (sau 0.1; 0.1 làm thủ công theo §5.5)

| Trạng thái đề xuất | Master Plan §6.1 | Tên theo policy |
|---|---|---|
| PLANNED | — | `SOURCE_MISSING` |
| MANIFEST_BUILT | `BUILD_MANIFEST` | `SOURCE_MISSING` |
| UAT_PENDING | — | `SOURCE_MISSING` |
| UAT_APPROVED | — | `SOURCE_MISSING` |
| PRODUCTION_PENDING | — | `SOURCE_MISSING` |
| PRODUCTION_APPROVED | — | `SOURCE_MISSING` |
| DEPLOYED | — | `SOURCE_MISSING` |
| ROLLED_BACK | — | `SOURCE_MISSING` |
| CLOSED | `CLOSED` | `SOURCE_MISSING` |
| CANCELLED / EXPIRED (`ttl_minutes`) | — | `SOURCE_MISSING` |

Ràng buộc: approval khớp `target_sha` + `release_manifest_digest` + `pipeline_run_id` **tại thời điểm deploy** (§9); `ttl_minutes = null` → chặn deploy.

## 4. Hotfix (SEV1/SEV2 — sau 0.1)
`OPENED → FIX_IN_PROGRESS → OWNER_APPROVAL_PENDING → APPROVED → DEPLOYED → POSTMORTEM → CLOSED`. Owner duyệt riêng từng lần (D-OWN-08). Tên theo policy: `SOURCE_MISSING`.

## 5. Support ticket (Phase 8 — ngoài 0.1)
`NEW → TRIAGED → IN_PROGRESS → WAITING_CUSTOMER → RESOLVED → CLOSED`. Tên theo policy: `SOURCE_MISSING`.

## Owner cần kiểm tra
- [ ] Duyệt máy trạng thái Task và Agent run (cần cho P3, P4 trong 0.1).
- [ ] Bổ sung file policy để ánh xạ tên Release/Hotfix.
