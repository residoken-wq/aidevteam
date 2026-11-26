import { loginErrorMessage } from "../../lib/login-errors";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const error = loginErrorMessage(params.error);
  return (
    <main>
      <h1>AI Dev Team Control Center</h1>
      {error ? <p role="alert">{error}</p> : null}
      <p>
        <a href="/auth/github/login">Đăng nhập bằng GitHub</a>
      </p>
      <p>Chỉ tài khoản có trong danh sách cho phép mới đăng nhập được. Đăng nhập không tự cấp quyền thao tác.</p>
    </main>
  );
}
