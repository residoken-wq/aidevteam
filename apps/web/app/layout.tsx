import type { ReactNode } from "react";
import { AppShell } from "./app-shell";
import "./globals.css";

export const metadata = {
  title: "AI Dev Team Control Center",
  description: "Release 0.1",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
