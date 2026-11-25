# 05 — Bàn giao: soạn mô tả PR (bước B6)

> AGY chỉ **soạn nội dung**. Người vận hành tự tạo PR và tự gán reviewer.

~~~text
# NHIỆM VỤ: SOẠN MÔ TẢ PR CHO {{TASK_ID}}
Chỉ dùng số liệu từ output thật ở bước 04. Không có output → ghi UNVERIFIED.

Tiêu đề: [{{TASK_ID}}] <mô tả ngắn tiếng Anh>

## Tóm tắt
(3–5 dòng tiếng Việt: làm gì, vì sao)

## Acceptance criteria
| AC | Mô tả | Test | Kết quả |
(PASS/FAIL từng dòng)

## Lệnh đã chạy
```bash
<lệnh>
```
<output rút gọn: số test pass/fail/skip, lỗi lint = 0>

## Thay đổi DB / migration
- Migration: <tên> — up/down đã test: Y/N
- Ảnh hưởng dữ liệu hiện có: ...
- Rollback: ...

## Rủi ro bảo mật
| Rủi ro | Biện pháp trong PR | Test chứng minh |

## Dependency mới
| Package | Version | License | Lý do |

## Ngoài phạm vi / việc để sau

## Reviewer cần kiểm tra
- [ ] ...(liệt kê cụ thể file:dòng có logic phân quyền, tenant scope, xử lý secret)

## Ghi chú
- Code được tạo với sự hỗ trợ của AI (Antigravity). Cần người review trước khi merge.
- PR này KHÔNG phải approval UAT/production.
~~~
