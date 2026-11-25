# P1-07 — Secret reference

```text
# TASK CARD: P1-07 — Lưu secret_ref, không lưu plaintext
Branch: ai/P1-07-secret-ref
Nhãn: release-0.1, phase:1
Phụ thuộc: P1-04, P1-06

## Bối cảnh
Control Center Release 0.1 KHÔNG giữ production secrets của sản phẩm khác (HULA, TDCX...).
Provider account / worker chỉ lưu tham chiếu tới secret nằm trong secret manager của server.

## Phạm vi (làm)
- Kiểu dữ liệu secret_ref (vd "env:NAME" hoặc "vault:path" — định dạng theo ADR; hỏi người nếu chưa có).
- Validate định dạng secret_ref; từ chối input trông giống secret thật (heuristic: độ dài/entropy,
  tiền tố token phổ biến) với thông báo lỗi không lặp lại giá trị đã nhập.
- API/UI chỉ hiển thị secret_ref, không bao giờ resolve giá trị ra response.
- Logger redact: token, chuỗi giống key, email, số điện thoại, CCCD (12 chữ số) — có unit test.

## Ngoài phạm vi
Rotation hooks. Resolve secret thật lúc runtime cho worker thật.

## Acceptance criteria
AC-1 Tạo provider account với secret_ref hợp lệ → lưu đúng ref.
AC-2 Gửi giá trị giống token thật vào trường secret_ref → 422, giá trị không xuất hiện trong log/response.
AC-3 Test quét response API + log capture: không có chuỗi secret giả dùng trong test.
AC-4 Redactor che được các mẫu: token giả, email giả, SĐT giả, CCCD giả (dữ liệu test rõ ràng là giả).
```
