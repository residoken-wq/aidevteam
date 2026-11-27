import { headers } from "next/headers";
import type { ReactNode } from "react";
import { navSections } from "../lib/nav";
import { currentUser } from "../lib/server-api";
import { ShellClient } from "./shell-client";

export async function AppShell({ children }: { children: ReactNode }) {
  const me = await currentUser();
  if (!me) {
    return <>{children}</>;
  }

  const headerList = await headers();
  const pathname = headerList.get("x-pathname");
  if (pathname === "/login") {
    return <>{children}</>;
  }

  const { main, platform } = navSections(me);

  return (
    <ShellClient me={me} main={main} platform={platform}>
      {children}
    </ShellClient>
  );
}
