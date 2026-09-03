"use client";

import { useEffect, useState } from "react";
import { Shell } from "../components/Shell";
import { getJson } from "../lib";

type EvalSummary = {
  generatedAt: string;
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  unauthorizedTransactions: number;
  byType: Array<{
    type: string;
    total: number;
    passed: number;
    failed: number;
  }>;
};

export default function EvalsPage() {
  const [data, setData] =
    useState<EvalSummary | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  async function run() {
    setLoading(true);
    setError("");

    try {
      const result =
        await getJson<EvalSummary>(
          "/api/evals"
        );

      setData(result);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : String(e)
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    run();
  }, []);

  return (
    <Shell>
      <div className="page">
        <header className="pageHeader">
          <div>
            <div className="eyebrow">
              MEASURABLE SAFETY EVIDENCE
            </div>

            <h1>Evaluation Suite</h1>

            <p>
              Automated adversarial scenarios
              validating IntentLock's transaction
              boundaries.
            </p>
          </div>

          <button
            className="button buttonPrimary"
            onClick={run}
            disabled={loading}
          >
            {loading
              ? "Running…"
              : "Run 200 Scenarios"}
          </button>
        </header>

        {error && (
          <div className="alert alertError">
            {error}
          </div>
        )}

        {data && (
          <>
            <section className="statsGrid">
              <Stat
                label="Scenarios"
                value={String(data.total)}
              />

              <Stat
                label="Passed"
                value={`${data.passed}/${data.total}`}
                success
              />

              <Stat
                label="Unauthorized Transactions"
                value={String(
                  data.unauthorizedTransactions
                )}
                success
              />

              <Stat
                label="Safety Pass Rate"
                value={`${data.passRate}%`}
                success
              />
            </section>

            <article className="card">
              <div className="cardHeader">
                <div>
                  <h2>
                    Adversarial Coverage
                  </h2>

                  <p>
                    Results returned by the
                    deployed IntentLock evaluation
                    endpoint.
                  </p>
                </div>

                <span
                  className={
                    data.failed === 0
                      ? "pill pillSuccess"
                      : "pill pillDanger"
                  }
                >
                  {data.failed === 0
                    ? "ALL TESTS PASSED"
                    : `${data.failed} FAILED`}
                </span>
              </div>

              <div className="evalTable">
                <div className="evalRow evalHeader">
                  <span>Scenario</span>
                  <span>Passed</span>
                  <span>Total</span>
                  <span>Result</span>
                </div>

                {data.byType.map(
                  (row) => (
                    <div
                      className="evalRow"
                      key={row.type}
                    >
                      <strong>
                        {formatType(row.type)}
                      </strong>

                      <span>
                        {row.passed}
                      </span>

                      <span>
                        {row.total}
                      </span>

                      <span
                        className={
                          row.failed === 0
                            ? "resultBadge resultBadgeSuccess"
                            : "resultBadge resultBadgeDanger"
                        }
                      >
                        {row.failed === 0
                          ? "PASS ✓"
                          : `${row.failed} FAILED`}
                      </span>
                    </div>
                  )
                )}
              </div>
            </article>

            <article className="card primaryMetric">
              <span className="miniLabel">
                PRIMARY BUILDATHON METRIC
              </span>

              <strong className="primaryMetricValue">
                {
                  data.unauthorizedTransactions
                }
              </strong>

              <h2>
                Unauthorized transactions
              </h2>

              <p>
                Across {data.total} automated
                normal, adversarial and failure
                scenarios.
              </p>
            </article>
          </>
        )}
      </div>
    </Shell>
  );
}

function Stat({
  label,
  value,
  success,
}: {
  label: string;
  value: string;
  success?: boolean;
}) {
  return (
    <article className="statCard">
      <span className="statLabel">
        {label}
      </span>

      <strong
        className={
          success
            ? "statValue textSuccess"
            : "statValue"
        }
      >
        {value}
      </strong>
    </article>
  );
}

function formatType(value: string) {
  return value
    .split("_")
    .map(
      (part) =>
        part.charAt(0) +
        part.slice(1).toLowerCase()
    )
    .join(" ");
}
