"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Shell } from "./components/Shell";
import { API, getLastIntentId } from "./lib";

type Health = {
  service: string;
  status: string;
  version: string;
  databaseConfigured: boolean;
  redisConfigured: boolean;
  razorpayConfigured: boolean;
  webhookConfigured: boolean;
};

const guarantees = [
  [
    "Exact-quote approval",
    "Any cart, price or quantity change invalidates the authorization.",
  ],
  [
    "Prompt-injection containment",
    "Even a compromised agent cannot exceed the user's Intent Contract.",
  ],
  [
    "Duplicate checkout protection",
    "Redis and database idempotency prevent repeated money movement.",
  ],
  [
    "Tamper-evident evidence",
    "Audit events are chained so transaction history can be verified.",
  ],
];

export default function DashboardPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState("");
  const [lastIntentId, setLastIntentId] = useState("");

  useEffect(() => {
    setLastIntentId(getLastIntentId());

    fetch(`${API}/health`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const body = await response.json();

        if (!response.ok) {
          throw new Error(
            body?.message ?? body?.error ?? "Health check failed"
          );
        }

        setHealth(body);
      })
      .catch((e) => {
        setError(
          e instanceof Error
            ? e.message
            : String(e)
        );
      });
  }, []);

  const services = [
    ["Workers AI", true],
    ["Neon PostgreSQL", health?.databaseConfigured ?? false],
    ["Upstash Redis", health?.redisConfigured ?? false],
    ["Razorpay", health?.razorpayConfigured ?? false],
    ["Webhook verification", health?.webhookConfigured ?? false],
  ] as const;

  return (
    <Shell>
      <div className="page">
        <header className="pageHeader">
          <div>
            <div className="eyebrow">
              AGENTIC COMMERCE CONTROL PLANE
            </div>

            <h1>Dashboard</h1>

            <p>
              AI can propose a transaction. IntentLock
              decides whether money is allowed to move.
            </p>
          </div>

          <Link
            href="/new-purchase"
            className="button buttonPrimary"
          >
            + New Purchase
          </Link>
        </header>

        <section className="statsGrid">
          <StatCard
            label="Policy Engine"
            value="Deterministic"
            detail="Hard authorization boundary"
          />

          <StatCard
            label="Unauthorized Spend"
            value="₹0"
            detail="Across attack demos"
            success
          />

          <StatCard
            label="Duplicate Payments"
            value="0"
            detail="Redis + DB idempotency"
            success
          />

          <StatCard
            label="Backend"
            value={
              health?.version?.toUpperCase() ?? "…"
            }
            detail={
              health?.status === "ok"
                ? "Online"
                : "Checking"
            }
          />
        </section>

        <section className="twoColumn">
          <article className="card">
            <CardHeader
              title="Infrastructure"
              subtitle="Live status from the deployed worker."
              badge={
                health?.status === "ok"
                  ? "ALL SYSTEMS ONLINE"
                  : "CHECKING"
              }
              success={health?.status === "ok"}
            />

            <div className="serviceList">
              {services.map(([name, ready]) => (
                <div
                  className="serviceRow"
                  key={name}
                >
                  <div className="serviceLabel">
                    <span
                      className={
                        ready
                          ? "statusDot statusDotOnline"
                          : "statusDot"
                      }
                    />

                    <span>{name}</span>
                  </div>

                  <strong
                    className={
                      ready
                        ? "textSuccess"
                        : "textMuted"
                    }
                  >
                    {ready
                      ? "Ready"
                      : "Unavailable"}
                  </strong>
                </div>
              ))}
            </div>
          </article>

          <article className="card">
            <CardHeader
              title="Security Guarantees"
              subtitle="The invariants that do not depend on model behavior."
            />

            <div className="guaranteeList">
              {guarantees.map(([title, text]) => (
                <div
                  className="guaranteeRow"
                  key={title}
                >
                  <span className="checkBadge">
                    ✓
                  </span>

                  <div>
                    <strong>{title}</strong>
                    <p>{text}</p>
                  </div>
                </div>
              ))}
            </div>
          </article>
        </section>

        <article className="card">
          <CardHeader
            title="Demo Flow"
            subtitle="Recommended live sequence for the Buildathon demo."
          />

          <div className="flowGrid">
            {[
              [
                "01",
                "Natural-language intent",
                "Workers AI extracts bounded authorization.",
              ],
              [
                "02",
                "Policy validation",
                "Deterministic rules check the proposal.",
              ],
              [
                "03",
                "Exact approval",
                "The chosen quote is cryptographically bound.",
              ],
              [
                "04",
                "Razorpay execution",
                "One permitted checkout reaches the provider.",
              ],
              [
                "05",
                "Evidence",
                "Security and audit views prove the boundary.",
              ],
            ].map(([number, title, text]) => (
              <div
                className="flowCard"
                key={number}
              >
                <span>{number}</span>
                <strong>{title}</strong>
                <p>{text}</p>
              </div>
            ))}
          </div>

          {lastIntentId && (
            <div className="lastIntent">
              <span>Last Intent</span>
              <code>{lastIntentId}</code>

              <Link
                href={`/audit?intent=${encodeURIComponent(
                  lastIntentId
                )}`}
              >
                Verify audit →
              </Link>
            </div>
          )}
        </article>

        {error && (
          <div className="alert alertError">
            {error}
          </div>
        )}
      </div>
    </Shell>
  );
}

function StatCard({
  label,
  value,
  detail,
  success,
}: {
  label: string;
  value: string;
  detail: string;
  success?: boolean;
}) {
  return (
    <article className="statCard">
      <span className="statLabel">{label}</span>

      <strong
        className={
          success
            ? "statValue textSuccess"
            : "statValue"
        }
      >
        {value}
      </strong>

      <span className="statDetail">
        {detail}
      </span>
    </article>
  );
}

function CardHeader({
  title,
  subtitle,
  badge,
  success,
}: {
  title: string;
  subtitle: string;
  badge?: string;
  success?: boolean;
}) {
  return (
    <div className="cardHeader">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>

      {badge && (
        <span
          className={
            success
              ? "pill pillSuccess"
              : "pill"
          }
        >
          {badge}
        </span>
      )}
    </div>
  );
}
