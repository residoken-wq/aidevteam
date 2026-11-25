# 03 — Coding protocol: test-first, bước nhỏ (bước B3–B4)

> Chỉ dán sau khi người đã trả lời `PLAN APPROVED`.

```text
# NHIỆM VỤ: TRIỂN KHAI {{TASK_ID}} THEO PLAN ĐÃ DUYỆT
Plan đã duyệt: (giữ nguyên trong ngữ cảnh). Thay đổi plan → dừng và hỏi.

## Vòng lặp cho mỗi bước trong plan
1. Viết test cho bước này (theo ma trận test).
2. Chạy test → dán output thật, xác nhận FAIL đúng lý do (không phải lỗi cú pháp/import).
3. Viết code tối thiểu để PASS.
4. Chạy lại test bước này + toàn bộ test liên quan → dán output thật.
5. Chạy lint + typecheck → dán output thật.
6. Commit: <type>(<scope>): <mô tả tiếng Anh> [{{TASK_ID}}]
7. Báo ngắn: "Bước X/Y xong — test: N pass / M fail — commit <sha ngắn>".

## Nguyên tắc code
- Hàm nhỏ, tên rõ nghĩa; không để TODO không có ticket.
- Validate input ở biên (controller) bằng schema trong packages/contracts.
- Truy vấn DB luôn có điều kiện tenant (org_id từ session). Viết helper/repository bắt buộc
  truyền tenant context, không để query "quên" scope.
- Lỗi trả về không lộ stack trace, SQL, đường dẫn file, secret.
- Thao tác thay đổi dữ liệu quan trọng → ghi audit event (actor_id, action, target, org_id, at, request_id).
- Cập nhật trạng thái có điều kiện (vd UPDATE ... WHERE status = 'RUNNING') để tránh race.
- Không console.log dữ liệu nhạy cảm; dùng logger có redact.
- Mọi lệnh bạn đề xuất chạy trong terminal phải hiển thị cho người trước. Không chạy lệnh
  cài đặt global, không sửa cấu hình git global, không chạy lệnh mạng ngoài package registry.

## Nếu gặp vấn đề
- Test không thể pass nếu không đổi AC/plan → DỪNG, STATUS: BLOCKED, nêu phương án.
- Thư viện không có API như bạn nghĩ → DỪNG, nêu link tài liệu cần kiểm tra. Không bịa.
- Phát hiện bug ngoài phạm vi → ghi vào mục "Phát hiện ngoài phạm vi" trong báo cáo, không sửa.

## Cấm
- Sửa/xóa/skip test để xanh. Hạ coverage threshold. Thêm eslint-disable không lý do.
- Hard-code secret, URL production, user id thật.
- Bỏ qua bước chạy test rồi báo PASS.
```
