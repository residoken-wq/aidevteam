# 01 — BA: Phân tích yêu cầu (bước B1)

> Dán sau `00_SYSTEM_CONTEXT` và nội dung task card. AGY **không viết code** ở bước này.

```text
# NHIỆM VỤ: PHÂN TÍCH YÊU CẦU CHO TASK {{TASK_ID}}
Chưa viết code. Chưa tạo file. Chỉ trả lời theo đúng cấu trúc dưới đây.

## 1. Tóm tắt yêu cầu (≤ 5 dòng, lời của bạn)

## 2. Người dùng & quyền
Bảng: Actor | Hành động | Role cần có | Bị từ chối khi nào
(Role lấy từ docs/governance/RBAC_MATRIX.md. Nếu file chưa có → ghi SOURCE_MISSING, không tự đặt role.)

## 3. Phân rã yêu cầu
- Functional: FR-1, FR-2... (mỗi dòng kiểm chứng được)
- Non-functional: bảo mật, audit, hiệu năng, logging
- Ngoài phạm vi: liệt kê rõ những gì KHÔNG làm trong task này

## 4. Acceptance criteria dạng Given/When/Then
Viết lại AC của task card thành kịch bản kiểm thử. Mỗi AC tối thiểu 1 kịch bản dương + 1 kịch bản âm.
Đánh số AC-1, AC-2... để truy vết sang test.

## 5. Dữ liệu
Entity/bảng bị ảnh hưởng, trường mới, ràng buộc (unique, FK, not null), trường nhạy cảm
(secret, email, token) và cách xử lý (secret_ref / redact / không lưu).

## 6. Edge case & lỗi
Ít nhất: input rỗng/quá dài, trùng lặp, không có quyền, khác org, đồng thời (race), dữ liệu cũ.

## 7. Phụ thuộc
Task/ADR/module phải có trước. Đánh dấu cái nào chưa có.

## 8. Giả định (tách bạch)
| # | Giả định | Nguồn/căn cứ | Rủi ro nếu sai |

## 9. Câu hỏi cho người
| # | Câu hỏi | Chặn (Y/N) | Phương án A | Phương án B | Khuyến nghị |

## 10. Kết luận
STATUS: READY_FOR_PLAN  hoặc  STATUS: BLOCKED (nếu có câu hỏi Chặn = Y)
```

## Ghi chú cho người vận hành

- Trả lời các câu hỏi "Chặn = Y" trước khi dán prompt `02`.
- Nếu AGY tự đặt role, tự đặt tên bảng khác ADR, hoặc mở rộng phạm vi → yêu cầu làm lại bước 01.
