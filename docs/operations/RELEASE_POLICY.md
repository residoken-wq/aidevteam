# AI Dev Team — Chính sách Release & Human Approval

**Policy ID:** `ai-dev-team-release-governance`  
**Phiên bản:** `1.0.1`  
**Ngày Owner xác nhận:** 25/11/2026  
**Múi giờ:** `Asia/Ho_Chi_Minh`  
**Trạng thái:** **ĐÃ PHÊ DUYỆT VỀ CHÍNH SÁCH — CHƯA ÁP DỤNG TRÊN HỆ THỐNG**

## Cập nhật cấu hình được Owner cung cấp ngày 25/11/2026

- **Tài khoản GitHub Owner reviewer:** `residoken-wq` (chưa kiểm chứng GitHub permissions/membership).
- **Ngày release dự kiến đầu tiên:** **05/12/2026** (thứ Bảy), múi giờ `Asia/Ho_Chi_Minh`. Đây là ngày khởi đầu dự kiến, không phải giờ chạy release train.
- **Giờ release train hằng ngày:** `null` — **chưa cấu hình**, không lên lịch chạy tự động.
- **Enforcement:** chưa kích hoạt; yêu cầu cấu hình protected environment, reviewers, CI và nghiệm thu trước production.

## 1. Quyết định chính thức của Owner

1. **Release train: mỗi ngày 01 lần.** Gom các thay đổi thông thường đã đạt điều kiện vào một release manifest theo từng project, trình Owner duyệt trước khi triển khai production.
2. **SEV1/SEV2: Hotfix riêng**, không chờ release train; **bắt buộc Owner duyệt riêng trước production**. Không dùng lại approval của release train.
3. AI có thể lập kế hoạch, code, review và chuẩn bị release; **AI không được tự duyệt production**.

> Owner xác nhận tần suất hằng ngày, **chưa xác nhận giờ phát hành cố định**. Trường `release_train.execution_time_local` để `null` cho đến khi cấu hình giờ tại deployment.

## 2. Ma trận release

| Loại | Nhịp release | Ai duyệt production? | Cần bằng chứng |
|---|---|---|---|
| SEV3/SEV4 | 01 lô/ngày/project | Owner, duyệt manifest của lô | CI, `claude-review`, staging, UAT, rollback |
| SEV1/SEV2 | Hotfix ngay khi đủ điều kiện | Owner duyệt **riêng từng hotfix** | Incident ID, severity, targeted QA, rollback, approval |
| Thay đổi rủi ro cao (auth, secrets, DB migration, dữ liệu, infra) | Theo phạm vi nhưng approval riêng | Owner | Impact assessment, kiểm soát bổ sung |

SEV1/2 không được phép tự deploy chỉ vì được phân loại khẩn cấp. Nếu Owner chưa duyệt, workflow dừng ở `AWAITING_OWNER_APPROVAL`.

## 3. Release train workflow

`READY_FOR_RELEASE → MANIFEST_BUILT → QUALITY_GATES_PASSED → AWAITING_OWNER_APPROVAL → APPROVED → PRODUCTION_DEPLOY → HEALTH_VERIFIED → RELEASED`

- Mỗi manifest liên kết danh sách PR, target commit SHA, artifact digest, test report, changelog, staging evidence, risk summary, rollback plan.
- Nếu Owner từ chối hoặc yêu cầu thay đổi, giữ trạng thái blocked; các item chưa duyệt chuyển sang lô sau.
- Thay đổi SHA, artifact hoặc manifest **làm approval trước đó hết hiệu lực**.

## 4. Hotfix SEV1/SEV2 workflow

`INCIDENT_CONFIRMED → HOTFIX_BRANCH → TARGETED_TESTS → SECURITY/QA_REVIEW → AWAITING_SEPARATE_OWNER_APPROVAL → PRODUCTION_DEPLOY → HEALTHCHECK → INCIDENT_POSTMORTEM`

- Có incident ID, mức ảnh hưởng được xác nhận, kế hoạch khôi phục/rollback.
- Owner phê duyệt riêng trên đúng artifact/commit được triển khai.
- Sau release phải chạy hồi quy bổ sung và lập incident report; không lấy việc triển khai khẩn cấp để miễn kiểm toán.

## 5. GitHub / n8n enforcement

- GitHub branch protection: required CI checks và required status check `claude-review`; cần cấu hình check producer có thẩm quyền.
- GitHub protected production environment: yêu cầu phê duyệt bởi **người được chỉ định là Owner**; không coi PR comment/approval của bot là approval production.
- n8n/orchestrator chỉ chuyển trạng thái nếu tồn tại approval record hợp lệ, khớp SHA + manifest digest + pipeline run; trạng thái mặc định **fail closed**.
- Lưu audit trail tối thiểu: `approval_id`, `approver_id`, `decision`, `timestamp`, `project_id`, `environment`, `release_manifest_digest`, `target_sha`, `pipeline_run_id`.
- Không cấp production secret cho coding worker. Không cho AI sửa hoặc bypass branch/environment rules.

## 6. Các tham số còn cần cấu hình, không tự suy diễn là Owner đã duyệt

- Giờ cố định thực thi release train mỗi ngày.
- Thời hạn hiệu lực của một approval, notification recipients và quy trình xử lý khi Owner vắng mặt.
- Username Owner reviewer đã cung cấp: `residoken-wq`; quyền review, repository/environment và pipeline workflow thực tế chưa được xác minh/cấu hình.
- Ngưỡng test tối thiểu theo từng sản phẩm và chính sách backup cụ thể.

## 7. Tiêu chí nghiệm thu triển khai policy

- [ ] Test: SEV3/4 được gom thành tối đa một release train/ngày/project.
- [ ] Test: mọi lô production bị chặn nếu thiếu Owner approval.
- [ ] Test: SEV1/2 tạo approval request **riêng**, không tái sử dụng approval của lô.
- [ ] Test: đổi SHA hoặc manifest sau khi duyệt khiến deployment bị chặn.
- [ ] Test: CI/QA thất bại hoặc approval bị từ chối thì không deploy.
- [ ] Test: nhật ký approval và triển khai truy xuất được qua release ID.

## 8. Phạm vi hiệu lực

Chính sách này áp dụng cho thiết kế AI Dev Team gồm Claude Engineering Manager, coding agents, documentation agent và orchestration. **File YAML là cấu hình tham chiếu, chưa phải bằng chứng rằng GitHub Actions/n8n đang enforce.** Cần nối enforcement với CI/CD và kiểm thử thực tế trước khi tuyên bố hệ thống tuân thủ.
