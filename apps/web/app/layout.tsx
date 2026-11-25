import type { ReactNode } from "react";

export const metadata = {
  title: "AI Dev Team Control Center",
  description: "Release 0.1",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
