"use client";

import Link from "next/link";
import {usePathname} from "next/navigation";
import type {ReactNode} from "react";

const primary = [
  {href:"/", label:"Overview", index:"01"},
  {href:"/demo", label:"WhatsApp Demo", index:"02"},
  {href:"/new-purchase", label:"New Purchase", index:"03"},
  {href:"/wallets", label:"Intent Wallets", index:"04"},
  {href:"/trust", label:"Trust & Risk", index:"05"},
];

const secondary = [
  {href:"/security-lab", label:"Security Lab"},
  {href:"/evals", label:"Evaluation Suite"},
  {href:"/audit", label:"Audit Log"},
  {href:"/how-it-works", label:"How it works"},
];

export function Shell({children}:{children:ReactNode}) {
  const pathname = usePathname();

  const active = (href:string) =>
    href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="appShell v1011Shell">
      <aside className="sidebar v1011Sidebar">
        <div className="v1011Brand">
          <Link href="/" className="v1011BrandLock" aria-label="IntentLock home">
            <span className="v1011BrandMark">IL</span>
            <span>
              <strong>IntentLock</strong>
              <small>Transaction firewall for AI agents</small>
            </span>
          </Link>
        </div>

        <nav className="v1011Nav" aria-label="Primary navigation">
          <span className="v1011NavLabel">Product</span>
          {primary.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={
                active(item.href)
                  ? "v1011NavItem v1011NavItemActive"
                  : "v1011NavItem"
              }
            >
              <span className="v1011NavIndex">{item.index}</span>
              <span>{item.label}</span>
            </Link>
          ))}

          <span className="v1011NavLabel v1011NavLabelSecondary">
            Inspect
          </span>

          {secondary.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={
                active(item.href)
                  ? "v1011NavItem v1011NavItemActive"
                  : "v1011NavItem"
              }
            >
              <span className="v1011NavIndex">—</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="v1011SidebarFooter">
          <div className="v1011LiveLine">
            <span className="v1011LiveDot" />
            WhatsApp demo live
          </div>
          <p>Planned availability through 05 Oct 2026.</p>
        </div>
      </aside>

      <main className="content v1011Content">
        {children}
      </main>
    </div>
  );
}
