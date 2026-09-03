"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const links = [
  { href: "/", label: "Dashboard", icon: "⌂" },
  { href: "/new-purchase", label: "Autonomous Purchase", icon: "✦" },
  { href: "/wallets", label: "Intent Wallets", icon: "◈" },
  { href: "/commerce", label: "Marketplace", icon: "⌕" },
  { href: "/security-lab", label: "Security Lab", icon: "⚠" },
  { href: "/evals", label: "Evaluations", icon: "▦" },
  { href: "/audit", label: "Audit Log", icon: "▤" },
];

export function Shell({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="appShell">
      <aside className="sidebar">
        <div className="brandBlock">
          <div className="brandMark">◆</div>

          <div className="brandText">
            <strong>IntentLock</strong>
            <span>AI Payments. Locked by Trust.</span>
          </div>
        </div>

        <nav className="sidebarNav">
          {links.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname === item.href ||
                  pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={
                  active
                    ? "sidebarLink sidebarLinkActive"
                    : "sidebarLink"
                }
              >
                <span className="sidebarIcon">
                  {item.icon}
                </span>

                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="profileCard">
          <div className="profileAvatar">SD</div>

          <div>
            <strong>Shriram Dixit</strong>
            <span>Builder Mode</span>
          </div>
        </div>
      </aside>

      <main className="content">
        {children}
      </main>
    </div>
  );
}
