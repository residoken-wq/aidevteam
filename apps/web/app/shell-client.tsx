"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import type { NavItem } from "../lib/nav";
import { roleLabel } from "../lib/roles";
import type { Me } from "../lib/server-api";
import { NavLink } from "./nav-link";

export function ShellClient({
  me,
  main,
  platform,
  children,
}: {
  me: Me;
  main: NavItem[];
  platform: NavItem[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  if (pathname === "/login") {
    return <>{children}</>;
  }

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Bỏ qua tới nội dung chính
      </a>
      <header className="app-header">
        <div className="app-header-left">
          <Link href="/" className="app-brand">
            AI Dev Team Control Center
          </Link>
          {me.activeOrg ? (
            <span className="app-org-info">
              {me.activeOrg.slug} ({me.activeOrg.roles.map(roleLabel).join(", ")})
            </span>
          ) : null}
        </div>
        <div className="app-header-right">
          <Link href="/profile" className="app-user-info">
            {me.githubLogin ?? `GitHub #${me.githubUserId}`}
          </Link>
          <form method="post" action="/auth/logout" className="logout-form">
            <button type="submit" className="logout-button">
              Đăng xuất
            </button>
          </form>
        </div>
      </header>
      <div className="app-body">
        <aside className="app-sidebar">
          {main.length > 0 ? (
            <nav aria-label="Điều hướng chính" className="nav-main">
              <ul className="nav-list">
                {main.map((item) => (
                  <li key={item.href} className="nav-item">
                    <NavLink href={item.href}>{item.label}</NavLink>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
          {platform.length > 0 ? (
            <nav aria-label="Quản trị nền tảng" className="nav-platform">
              <div className="nav-section-title">Quản trị nền tảng</div>
              <ul className="nav-list">
                {platform.map((item) => (
                  <li key={item.href} className="nav-item">
                    <NavLink href={item.href}>{item.label}</NavLink>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
        </aside>
        <main id="main-content" className="app-main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
