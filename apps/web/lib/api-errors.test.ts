import { describe, expect, it } from "vitest";
import { apiErrorMessage } from "./api-errors";

describe("apiErrorMessage", () => {
  it("lists validation issues by field", () => {
    expect(apiErrorMessage(422, { issues: [{ path: "slug", message: "bad" }, { path: "name", message: "required" }] })).toBe("slug: bad; name: required");
  });

  it("maps known conflicts and hides unknown ones", () => {
    expect(apiErrorMessage(409, { message: "project_slug_or_name_taken" })).toMatch(/đã tồn tại/);
    expect(apiErrorMessage(409, { message: "__proto__" })).toMatch(/Có lỗi/);
  });

  it("has fixed messages for auth errors and garbage bodies", () => {
    expect(apiErrorMessage(403, null)).toMatch(/không có quyền/);
    expect(apiErrorMessage(500, "<script>")).toBe("Có lỗi xảy ra. Vui lòng thử lại.");
  });
});

describe("secret-like input", () => {
  it("explains what to do instead of echoing anything", () => {
    const msg = apiErrorMessage(422, { issues: [{ path: "secretRef", message: "This looks like a secret value…", problem: "secret_like" }] });
    expect(msg).toMatch(/không dán secret/i);
  });
});
