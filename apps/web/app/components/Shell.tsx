"use client";

import Link from "next/link";
import {usePathname} from "next/navigation";
import type {ReactNode} from "react";
import styles from "./Shell.module.css";

const primary = [
  {href:"/", label:"Overview", index:"01"},
  {href:"/new-purchase", label:"Run Purchase", index:"02"},
  {href:"/wallets", label:"Intent Wallets", index:"03"},
  {href:"/commerce", label:"Commerce Search", index:"04"},
  {href:"/trust-center", label:"Transaction Control", index:"05"},
  {href:"/post-purchase", label:"Post-Purchase", index:"06"},
];

const secondary = [
  {href:"/demo", label:"WhatsApp Demo"},
  {href:"/trust", label:"Trust & Risk"},
  {href:"/security-lab", label:"Security Lab"},
  {href:"/evals", label:"Evaluation Suite"},
  {href:"/audit", label:"Audit Log"},
  {href:"/how-it-works", label:"How it works"},
];

const titleFor=(pathname:string)=>{
  const all=[...primary,...secondary];
  const match=all.find(item=>item.href==="/"?pathname==="/":pathname===item.href||pathname.startsWith(`${item.href}/`));
  return match?.label??"IntentLock";
};

export function Shell({children}:{children:ReactNode}) {
  const pathname = usePathname();

  const active = (href:string) =>
    href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <Link href="/" className={styles.brand} aria-label="IntentLock home">
          <span className={styles.brandMark}>
            <span/>
            <span/>
          </span>
          <span className={styles.brandCopy}>
            <strong>IntentLock</strong>
            <small>Financial control plane</small>
          </span>
        </Link>

        <div className={styles.versionPill}>
          <span className={styles.liveDot}/>
          <span>V11.4.1 · Reliability hardening</span>
        </div>

        <nav className={styles.nav} aria-label="Primary navigation">
          <span className={styles.navLabel}>Product</span>
          {primary.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={active(item.href)?`${styles.navItem} ${styles.navItemActive}`:styles.navItem}
            >
              <span className={styles.navIndex}>{item.index}</span>
              <span>{item.label}</span>
              <span className={styles.navArrow}>↗</span>
            </Link>
          ))}

          <span className={`${styles.navLabel} ${styles.secondaryLabel}`}>Inspect</span>
          {secondary.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={active(item.href)?`${styles.navItem} ${styles.navItemActive}`:styles.navItem}
            >
              <span className={styles.navIndex}>—</span>
              <span>{item.label}</span>
              <span className={styles.navArrow}>↗</span>
            </Link>
          ))}
        </nav>

        <div className={styles.sidebarFooter}>
          <div className={styles.footerCard}>
            <span className={styles.footerKicker}>FINANCIAL STATE</span>
            <strong>Settlement verified</strong>
            <p>Webhook → queue → ledger → proof</p>
            <div className={styles.footerTrack}><span/></div>
          </div>
          <span className={styles.footerMeta}>Recommendation ≠ permission</span>
        </div>
      </aside>

      <div className={styles.workspace}>
        <header className={styles.topbar}>
          <div>
            <span className={styles.topbarEyebrow}>INTENTLOCK</span>
            <strong>{titleFor(pathname)}</strong>
          </div>
          <div className={styles.topbarStatus}>
            <span className={styles.liveDot}/>
            <span>Control plane online</span>
            <span className={styles.topbarDivider}/>
            <span className={styles.topbarVersion}>V11.4.1</span>
          </div>
        </header>
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
