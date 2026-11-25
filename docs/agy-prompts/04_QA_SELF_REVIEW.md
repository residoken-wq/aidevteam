# 04 — QA self-review (bước B5)

> Dán sau khi AGY báo code xong. AGY phải trả lời **từng dòng** với bằng chứng, không trả lời chung chung.

```text
# NHIỆM VỤ: TỰ KIỂM TRA {{TASK_ID}} TRƯỚC KHI BÀN GIAO
Với mỗi mục: trả lời PASS / FAIL / N/A + bằng chứng (file:dòng, tên test, hoặc output lệnh).
"PASS" không có bằng chứng = FAIL.

## A. Acceptance criteria
| AC | Test chứng minh | Kết quả lần chạy cuối | PASS/FAIL |

## B. Chất lượng
- [ ] Lint: dán lệnh + output
- [ ] Typecheck: dán lệnh + output
- [ ] Test: dán lệnh + output (số pass/fail/skip). skip > 0 → giải thích
- [ ] Migration up → down → up chạy được (nếu có migration): dán output
- [ ] Không có file ngoài danh sách plan bị sửa: dán `git diff --stat main...HEAD`

## C. Bảo mật
- [ ] Mọi endpoint mới có guard xác thực + RBAC (default deny). Liệt kê endpoint → guard.
- [ ] org_id/project_id lấy từ session. grep chứng minh không đọc từ body.
- [ ] Có test âm: 401, 403, cross-org. Liệt kê tên test.
- [ ] Không có SQL ghép chuỗi với input ngoài.
- [ ] Không có secret/token/connection string trong diff (đã quét: liệt kê pattern đã quét).
- [ ] Response/log không chứa secret/email/token chưa redact (test nào chứng minh?).
- [ ] Subprocess (nếu có): argv mảng, env allowlist, timeout, giới hạn output, kill process group.
- [ ] Cookie/session (nếu có): HttpOnly, Secure, SameSite, CSRF.
- [ ] Không có endpoint update/delete audit log.
- [ ] Không có nút/endpoint ghi quyết định approval.

## D. Dữ liệu & tuân thủ
- [ ] Seed/fixture chỉ dùng dữ liệu giả (@example.com, "Test User NN").
- [ ] Dependency mới: tên, version pin, license, lý do.
- [ ] Không gọi AGY/provider AI thật; worker là mock.

## E. Truy vết
- Commit list: sha ngắn + message (tất cả có [{{TASK_ID}}]).
- Phát hiện ngoài phạm vi (không sửa): ...
- Giả định còn mở: ...

## F. Kết luận
STATUS: READY_FOR_PR  hoặc  STATUS: NEEDS_FIX (liệt kê mục FAIL và kế hoạch sửa)
Không được ghi READY_FOR_PR nếu còn bất kỳ FAIL nào ở A, B, C.
```
