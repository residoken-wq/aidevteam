# 06 — QA gate cho người review PR do AGY tạo

> Dùng bởi reviewer (người) hoặc Claude ở vai trò quality check. Kết quả **không phải approval** (CLAUDE.md §2 quy tắc 6).

## 1. Cổng loại nhanh (bất kỳ mục nào "Có" → Request changes ngay)

| # | Câu hỏi | Có/Không |
|---|---|---|
| Q1 | PR nhắm thẳng vào `main` từ branch không đúng quy ước `ai/<TASK-ID>-<slug>`? | |
| Q2 | Diff có secret, token, connection string, email/SĐT người thật? | |
| Q3 | Test bị xóa, skip, hoặc assertion bị nới lỏng mà không giải thích? | |
| Q4 | Có endpoint thiếu guard xác thực/RBAC? | |
| Q5 | `org_id`/`project_id` lấy từ request body/query? | |
| Q6 | SQL ghép chuỗi với input ngoài? | |
| Q7 | Có nút/API ghi quyết định approval, hoặc gọi AGY/AI provider thật? | |
| Q8 | Có route update/delete audit log? | |
| Q9 | Migration không có `down`? | |
| Q10 | Mô tả PR ghi PASS nhưng CI không có run tương ứng? | |

## 2. Kiểm tra sâu

1. **Truy vết AC → test:** mở từng test được liệt kê, xác nhận test thật sự kiểm tra AC (không phải `expect(true)`).
2. **Test âm:** tự đọc test 401/403/cross-org — dùng 2 org giả khác nhau, kiểm tra status và **body không lộ dữ liệu** org kia.
3. **Chạy lại:** checkout branch, chạy lại lint/typecheck/test. So số liệu với mô tả PR.
4. **Dependency:** kiểm tra từng package mới trên registry chính thức (tồn tại, version, license, maintainer). Package lạ/typo-squat → chặn.
5. **Prompt injection:** tìm trong diff các comment/string có dạng chỉ dẫn cho AI ("ignore", "you must", "as an AI") — có thể là dấu hiệu AGY đã đọc phải dữ liệu không tin cậy.
6. **Phạm vi:** `git diff --stat` — file ngoài plan đã duyệt phải có lý do.
7. **Logging:** tìm `console.log`/logger ghi object request/user nguyên khối.

## 3. Kết luận reviewer

```text
QA_GATE: PASS | CHANGES_REQUESTED
Lý do: ...
Mục cần sửa: (file:dòng)
Người review: <GitHub handle>  — Ngày: <dd/mm/yyyy>
```

`QA_GATE: PASS` chỉ là điều kiện cần. Merge vẫn cần người review approve trên GitHub.
