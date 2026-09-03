"use client";

import {
  useEffect,
  useState,
} from "react";
import { Shell } from "../components/Shell";
import {
  getJson,
  getLastIntentId,
} from "../lib";

type AuditEvent = {
  sequence?: number | string;
  event_type?: string;
  eventType?: string;
  occurred_at_text?: string;
  occurredAt?: string;
  event_hash?: string;
  eventHash?: string;
  payload?: unknown;
};

type AuditResponse = {
  streamId?: string;
  eventCount: number;
  chain: {
    valid: boolean;
    checkedEvents: number;
    headHash: string | null;
  };
  events: AuditEvent[];
};

export default function AuditPage() {
  const [intentId, setIntentId] =
    useState("");

  const [audit, setAudit] =
    useState<AuditResponse | null>(null);

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState("");

  useEffect(() => {
    const params =
      new URLSearchParams(
        window.location.search
      );

    setIntentId(
      params.get("intent") ??
      getLastIntentId()
    );
  }, []);

  async function verify() {
    if (!intentId.trim()) {
      setError(
        "Enter an Intent ID or create a purchase first."
      );
      return;
    }

    setLoading(true);
    setError("");
    setAudit(null);

    try {
      const result =
        await getJson<AuditResponse>(
          `/api/audit/${encodeURIComponent(
            intentId.trim()
          )}`
        );

      setAudit(result);
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

  return (
    <Shell>
      <div className="page">
        <header className="pageHeader">
          <div>
            <div className="eyebrow">
              TAMPER-EVIDENT EVIDENCE
            </div>

            <h1>Audit Log</h1>

            <p>
              Verify the full SHA-256 event chain
              for an Intent.
            </p>
          </div>
        </header>

        <article className="card auditSearchCard">
          <label className="fieldLabel">
            Intent ID
          </label>

          <div className="inputRow">
            <input
              className="textInput"
              value={intentId}
              onChange={(e) =>
                setIntentId(e.target.value)
              }
              placeholder="Paste an Intent ID"
            />

            <button
              className="button buttonPrimary"
              onClick={verify}
              disabled={loading}
            >
              {loading
                ? "Verifying…"
                : "Verify Audit Chain"}
            </button>
          </div>
        </article>

        {error && (
          <div className="alert alertError">
            {error}
          </div>
        )}

        {audit && (
          <>
            <section className="statsGrid auditStats">
              <Stat
                label="Chain"
                value={
                  audit.chain.valid
                    ? "VALID ✓"
                    : "BROKEN"
                }
                success={
                  audit.chain.valid
                }
              />

              <Stat
                label="Events Checked"
                value={String(
                  audit.chain.checkedEvents
                )}
              />

              <Stat
                label="Stream Events"
                value={String(
                  audit.eventCount
                )}
              />

              <Stat
                label="Head Hash"
                value={
                  audit.chain.headHash
                    ? `${audit.chain.headHash.slice(
                        0,
                        10
                      )}…`
                    : "—"
                }
              />
            </section>

            <article className="card">
              <div className="cardHeader">
                <div>
                  <h2>Event Timeline</h2>

                  <p>
                    Every event is chained to the
                    previous event.
                  </p>
                </div>

                <span
                  className={
                    audit.chain.valid
                      ? "pill pillSuccess"
                      : "pill pillDanger"
                  }
                >
                  {audit.chain.valid
                    ? "CHAIN VALID"
                    : "CHAIN INVALID"}
                </span>
              </div>

              <div className="auditTable">
                <div className="auditRow auditHeader">
                  <span>#</span>
                  <span>Event</span>
                  <span>Timestamp</span>
                  <span>Hash</span>
                </div>

                {audit.events.map(
                  (event, index) => {
                    const type =
                      event.event_type ??
                      event.eventType ??
                      "EVENT";

                    const timestamp =
                      event.occurred_at_text ??
                      event.occurredAt ??
                      "";

                    const hash =
                      event.event_hash ??
                      event.eventHash ??
                      "";

                    return (
                      <details
                        className="auditEvent"
                        key={`${index}-${hash}`}
                      >
                        <summary className="auditRow">
                          <span>
                            {event.sequence ??
                              index + 1}
                          </span>

                          <strong>
                            {type}
                          </strong>

                          <span>
                            {timestamp
                              ? new Date(
                                  timestamp
                                ).toLocaleString()
                              : "—"}
                          </span>

                          <code>
                            {hash
                              ? `${hash.slice(
                                  0,
                                  12
                                )}…`
                              : "—"}
                          </code>
                        </summary>

                        <pre className="codePanel auditPayload">
                          {JSON.stringify(
                            event.payload,
                            null,
                            2
                          )}
                        </pre>
                      </details>
                    );
                  }
                )}
              </div>
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
