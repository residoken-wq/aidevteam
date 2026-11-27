# P1-09 — SCA + secret scan trong CI, định nghĩa required checks

```text
TASK: P1-09 · Branch: ai/P1-09-sca · 1 PR
Tham chiếu: .github/workflows/ci.yml (action pin theo SHA, permissions tối thiểu), docs/operations/CICD.md

LÀM
- Bước SCA trong job ci: pnpm audit với ngưỡng high trở lên. Đối chiếu cú pháp flag tại https://pnpm.io/cli/audit
  (ghi link + ngày kiểm tra). Lỗ hổng đã biết chưa sửa được → ghi ngoại lệ có lý do + hạn, không tắt bước.
- Bước secret scan (đề xuất gitleaks, license MIT): chạy binary/container pin theo version + checksum/digest.
  Kiểm tra điều kiện license của gitleaks-action cho repo cá nhân trước khi dùng action — chưa chắc thì dùng binary.
  Ghi rõ "UNVERIFIED" cho mọi điểm chưa đối chiếu.
- docs/operations/BRANCH_PROTECTION.md: main + integration; required checks ci, claude-review; cấm force push;
  áp dụng cả admin. Trạng thái: "DEFINED – NOT ENFORCED (plan: free)" (O-02). Không gọi API cấu hình GitHub.

AC
AC-1 Branch thử (không merge) thêm dependency có lỗ hổng đã biết → ci FAIL (dán link run vào PR).
AC-2 Branch thử thêm chuỗi giống secret giả → secret scan FAIL.
AC-3 BRANCH_PROTECTION.md ghi đúng trạng thái DEFINED – NOT ENFORCED.
AC-4 permissions workflow tối thiểu; không dùng secret/token của Owner.
```
