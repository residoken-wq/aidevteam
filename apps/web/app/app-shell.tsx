import type { ReactNode } from "react";
import { navSections } from "../lib/nav";
import { currentUser, type Me } from "../lib/server-api";
import { ShellClient } from "./shell-client";

/**
 * Header + sidebar around every page for a signed-in user. Not signed in → page only (each page still guards
 * itself: apiGet 401 → /login). /login is excluded in ShellClient via usePathname. A failing /auth/me must not
 * take down every page (including /login), so errors render the page without the shell.
 */
export async function AppShell({ children }: { children: ReactNode }) {
  const me: Me | null = await currentUser().catch(() => null);
  if (!me) return <>{children}</>;

  const { main, platform } = navSections(me);
  return (
    <ShellClient me={me} main={main} platform={platform}>
      {children}
    </ShellClient>
  );
}
