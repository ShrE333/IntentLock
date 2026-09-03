"use client";

import { useState } from "react";
import { Shell } from "../components/Shell";
import {
  IntentContract,
  Proposal,
  postJson,
  saveIntent,
} from "../lib";

const DEFAULT_REQUEST =
  "Find me wireless headphones under 7000 rupees with ANC, avoid Boat, quantity 1, and ask me before buying.";

function demoProposal(): Proposal {
  return {
    productId: "sony_wh_demo",
    brand: "Sony",
    category: "headphones",
    quantity: 1,
    unitPrice: 5899,
    currency: "INR",
    features: ["wireless", "ANC"],
    inventoryAvailable: true,
    quoteExpiresAt: new Date(
      Date.now() + 25 * 60 * 1000
    ).toISOString(),
  };
}

type ParseResponse = {
  intent: IntentContract;
  source?: string;
  model?: string;
};

type ApprovalResponse = {
  approval: {
    token: string;
    payload: {
      approvalId: string;
      quoteHash: string;
      expiresAt: string;
      amount?: number;
      quantity?: number;
    };
  };
  approvalCard?: {
    amount?: number;
    quantity?: number;
    brand?: string;
    productId?: string;
    exactQuoteBound?: boolean;
  };
};

type PaymentResponse = {
  ok: boolean;
  duplicate?: boolean;
  paymentLink: {
    short_url: string;
    provider_link_id: string;
    status: string;
  };
};

export default function NewPurchasePage() {
  const [message, setMessage] =
    useState(DEFAULT_REQUEST);

  const [intent, setIntent] =
    useState<IntentContract | null>(null);

  const [proposal, setProposal] =
    useState<Proposal | null>(null);

  const [approval, setApproval] =
    useState<ApprovalResponse | null>(null);

  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function buildIntent() {
    setBusy("Interpreting the purchase request…");
    setError("");

    try {
      const result =
        await postJson<ParseResponse>(
          "/api/intents/parse",
          { message }
        );

      setIntent(result.intent);
      saveIntent(result.intent);
      setProposal(demoProposal());
      setApproval(null);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : String(e)
      );
    } finally {
      setBusy("");
    }
  }

  async function requestApproval() {
    if (!intent || !proposal) return;

    setBusy("Binding approval to the exact quote…");
    setError("");

    try {
      const result =
        await postJson<ApprovalResponse>(
          "/api/approvals/create",
          {
            intent,
            proposal,
            ttlSeconds: 1200,
          }
        );

      setApproval(result);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : String(e)
      );
    } finally {
      setBusy("");
    }
  }

  async function executePayment() {
    if (
      !intent ||
      !proposal ||
      !approval
    ) {
      return;
    }

    setBusy(
      "Checking policy and creating the Razorpay payment link…"
    );
    setError("");

    try {
      const result =
        await postJson<PaymentResponse>(
          "/api/payments/create-link",
          {
            intent,
            proposal,
            token:
              approval.approval.token,
          }
        );

      window.open(
        result.paymentLink.short_url,
        "_blank",
        "noopener,noreferrer"
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : String(e)
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <Shell>
      <div className="page">
        <header className="pageHeader">
          <div>
            <div className="eyebrow">
              NEW AGENT PURCHASE
            </div>

            <h1>
              Tell IntentLock what you want.
            </h1>

            <p>
              The model interprets the request.
              Deterministic software controls
              transaction authority.
            </p>
          </div>
        </header>

        <div className="purchaseGrid">
          <section className="card">
            <label className="fieldLabel">
              Purchase request
            </label>

            <textarea
              className="textarea"
              value={message}
              onChange={(e) =>
                setMessage(e.target.value)
              }
            />

            <div className="actionRow">
              <button
                className="button buttonPrimary"
                onClick={buildIntent}
                disabled={Boolean(busy)}
              >
                ✦ Build Intent Contract
              </button>
            </div>

            {intent && (
              <>
                <Divider />

                <SectionTitle
                  number="1"
                  title="Intent Contract"
                  badge="VALIDATED"
                />

                <div className="contractGrid">
                  <DataTile
                    label="Category"
                    value={intent.category}
                  />

                  <DataTile
                    label="Maximum amount"
                    value={`₹${intent.maxAmount.toLocaleString(
                      "en-IN"
                    )}`}
                  />

                  <DataTile
                    label="Maximum quantity"
                    value={String(
                      intent.maxQuantity
                    )}
                  />

                  <DataTile
                    label="Approval"
                    value={
                      intent.requiresApproval
                        ? "Required"
                        : "Not required"
                    }
                  />

                  <DataTile
                    label="Blocked brands"
                    value={
                      intent.blockedBrands.join(
                        ", "
                      ) || "None"
                    }
                  />

                  <DataTile
                    label="Required features"
                    value={
                      intent.requiredFeatures.join(
                        ", "
                      ) || "None"
                    }
                  />
                </div>
              </>
            )}

            {proposal && (
              <>
                <Divider />

                <SectionTitle
                  number="2"
                  title="Agent Recommendation"
                />

                <div className="productCard">
                  <div className="productVisual">
                    🎧
                  </div>

                  <div className="productCopy">
                    <span className="miniLabel">
                      POLICY-COMPATIBLE OPTION
                    </span>

                    <h3>
                      Sony Wireless ANC Headphones
                    </h3>

                    <p>
                      Wireless · ANC · In stock
                    </p>

                    <strong>₹5,899</strong>
                  </div>

                  <div className="productChecks">
                    <span>✓ Under ₹7,000</span>
                    <span>✓ Brand allowed</span>
                    <span>✓ Quantity = 1</span>
                    <span>✓ Wireless + ANC</span>
                  </div>
                </div>

                {!approval && (
                  <div className="actionRow">
                    <button
                      className="button buttonPrimary"
                      onClick={
                        requestApproval
                      }
                      disabled={Boolean(busy)}
                    >
                      Request Exact-Quote Approval
                    </button>
                  </div>
                )}
              </>
            )}

            {approval &&
              proposal && (
                <>
                  <Divider />

                  <SectionTitle
                    number="3"
                    title="Human Approval"
                    badge="TIME-BOXED"
                    warning
                  />

                  <div className="approvalCard">
                    <div className="approvalHeader">
                      <div>
                        <span className="miniLabel">
                          INTENTLOCK SECURE
                          APPROVAL
                        </span>

                        <h3>
                          Sony Wireless ANC
                          Headphones
                        </h3>
                      </div>

                      <div className="approvalMark">
                        ◆
                      </div>
                    </div>

                    <div className="amountRow">
                      <span>
                        Authorized total
                      </span>

                      <strong>
                        ₹5,899
                      </strong>
                    </div>

                    <div className="approvalChecks">
                      <span>
                        ✓ Budget satisfied
                      </span>
                      <span>
                        ✓ Brand allowed
                      </span>
                      <span>
                        ✓ Quantity satisfied
                      </span>
                      <span>
                        ✓ Inventory verified
                      </span>
                      <span>
                        ✓ Exact quote hashed
                      </span>
                      <span>
                        ✓ Time-boxed consent
                      </span>
                    </div>

                    <div className="hashPanel">
                      <span>
                        SHA-256 QUOTE HASH
                      </span>

                      <code>
                        {
                          approval.approval
                            .payload
                            .quoteHash
                        }
                      </code>
                    </div>

                    <button
                      className="button buttonPrimary buttonWide"
                      onClick={
                        executePayment
                      }
                      disabled={Boolean(busy)}
                    >
                      Approve ₹5,899 & Continue
                      to Razorpay
                    </button>
                  </div>
                </>
              )}

            {busy && (
              <div className="alert alertInfo">
                {busy}
              </div>
            )}

            {error && (
              <div className="alert alertError">
                {error}
              </div>
            )}
          </section>

          <aside className="card authorityCard">
            <div className="cardHeader">
              <div>
                <h2>
                  What has authority?
                </h2>

                <p>
                  The model never receives
                  unrestricted payment authority.
                </p>
              </div>
            </div>

            <Authority
              icon="AI"
              title="Workers AI"
              text="Understands the user's natural-language request."
            />

            <div className="authorityArrow">
              ↓
            </div>

            <Authority
              icon="✓"
              title="Policy Engine"
              text="Applies deterministic limits before payment execution."
              success
            />

            <div className="authorityArrow">
              ↓
            </div>

            <Authority
              icon="₹"
              title="Razorpay"
              text="Receives one approved transaction request."
            />
          </aside>
        </div>
      </div>
    </Shell>
  );
}

function Divider() {
  return <div className="divider" />;
}

function SectionTitle({
  number,
  title,
  badge,
  warning,
}: {
  number: string;
  title: string;
  badge?: string;
  warning?: boolean;
}) {
  return (
    <div className="sectionTitle">
      <div>
        <span className="stepNumber">
          {number}
        </span>

        <h2>{title}</h2>
      </div>

      {badge && (
        <span
          className={
            warning
              ? "pill pillWarning"
              : "pill pillSuccess"
          }
        >
          {badge}
        </span>
      )}
    </div>
  );
}

function DataTile({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="dataTile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Authority({
  icon,
  title,
  text,
  success,
}: {
  icon: string;
  title: string;
  text: string;
  success?: boolean;
}) {
  return (
    <div className="authorityRow">
      <span
        className={
          success
            ? "authorityIcon authorityIconSuccess"
            : "authorityIcon"
        }
      >
        {icon}
      </span>

      <div>
        <strong>{title}</strong>
        <p>{text}</p>
      </div>
    </div>
  );
}
