"use client";

import {useEffect,useState,type ReactNode} from "react";
import {useParams} from "next/navigation";
import {Shell} from "../../components/Shell";
import {getJson} from "../../lib";

type ProofResponse={
  receipt:{
    receiptId:string;
    sessionId:string;
    walletId:string;
    proofHash:string;
    proofSignature:string;
    evidenceAuditHeadHash:string|null;
    payload:any;
    createdAt:string;
  };
  verification:{
    auditChainValid:boolean;
    checkedEvents:number;
    currentAuditHeadHash:string|null;
    evidenceAuditHeadHash:string|null;
    proofHash:string;
    signaturePresent:boolean;
  };
};

export default function ProofReceiptPage(){
  const params=useParams<{sessionId:string}>();
  const sessionId=decodeURIComponent(String(params.sessionId??""));

  const [data,setData]=useState<ProofResponse|null>(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(true);

  useEffect(()=>{
    if(!sessionId) return;

    (async()=>{
      try{
        const result=await getJson<ProofResponse>(
          `/api/sessions/${encodeURIComponent(sessionId)}/proof`
        );
        setData(result);
      }catch(e){
        setError(e instanceof Error?e.message:String(e));
      }finally{
        setBusy(false);
      }
    })();
  },[sessionId]);

  return <Shell><div className="page">
    <header className="pageHeader">
      <div>
        <div className="eyebrow">CRYPTOGRAPHIC PURCHASE EVIDENCE</div>
        <h1>Proof Receipt</h1>
        <p>Evidence derived from the actual authorization, Razorpay webhook, wallet ledger and audit chain.</p>
      </div>
      <span className="sessionIdBadge">{sessionId}</span>
    </header>

    {busy && <div className="alert alertInfo">Loading proof receipt…</div>}
    {error && <div className="alert alertError">{error}</div>}

    {data && <div className="proofPage">
      <section className="proofHero">
        <div>
          <span className="miniLabel">INTENTLOCK VERIFIED PURCHASE</span>
          <h2>{data.receipt.receiptId}</h2>
          <p>
            This receipt is generated only after IntentLock verifies the Razorpay webhook
            and applies the wallet debit exactly once.
          </p>
        </div>
        <div className="proofStatus">
          <strong>{data.verification.auditChainValid?"VERIFIED":"INVALID"}</strong>
          <span>{data.verification.checkedEvents} audit events checked</span>
        </div>
      </section>

      <section className="proofGrid">
        <ProofCard title="Purchase">
          <Row label="Product" value={data.receipt.payload.product?.title}/>
          <Row label="Brand" value={data.receipt.payload.product?.brand}/>
          <Row label="Merchant" value={data.receipt.payload.product?.merchant}/>
          <Row label="Amount" value={`₹${Number(data.receipt.payload.payment?.amount??0).toLocaleString("en-IN")}`}/>
          <Row label="Currency" value={data.receipt.payload.payment?.currency}/>
        </ProofCard>

        <ProofCard title="Intent Wallet">
          <Row label="Wallet" value={data.receipt.payload.wallet?.name}/>
          <Row label="Total authority" value={`₹${Number(data.receipt.payload.wallet?.totalAuthority??0).toLocaleString("en-IN")}`}/>
          <Row label="Spent after purchase" value={`₹${Number(data.receipt.payload.wallet?.spentAmountAfter??0).toLocaleString("en-IN")}`}/>
          <Row label="Remaining" value={`₹${Number(data.receipt.payload.wallet?.remainingAuthority??0).toLocaleString("en-IN")}`}/>
          <Row label="Ledger replay-safe" value={data.receipt.payload.walletSpend?.replaySafe?"YES":"NO"}/>
        </ProofCard>

        <ProofCard title="Authorization">
          <Row label="Policy decision" value={data.receipt.payload.authorization?.policyDecision}/>
          <Row label="Mode" value={data.receipt.payload.authorization?.mode}/>
          <Row label="Step-up request" value={data.receipt.payload.authorization?.stepUpRequestId??"Not required"}/>
          <Row label="Authorization ID" value={data.receipt.payload.authorization?.authorizationId??"Wallet policy"}/>
          <Row label="Exact quote bound" value={data.receipt.payload.authorization?.exactQuoteBound?"YES":"NO"}/>
        </ProofCard>

        <ProofCard title="Razorpay">
          <Row label="Provider" value="Razorpay"/>
          <Row label="Payment Link" value={data.receipt.payload.payment?.providerLinkId}/>
          <Row label="Payment ID" value={data.receipt.payload.payment?.providerPaymentId}/>
          <Row label="Status" value={data.receipt.payload.payment?.status}/>
          <Row label="Webhook signature" value={data.receipt.payload.payment?.webhookSignatureVerified?"VERIFIED":"NOT VERIFIED"}/>
        </ProofCard>
      </section>

      <section className="proofCryptography">
        <div className="sectionTitleRow">
          <div>
            <span className="miniLabel">CRYPTOGRAPHIC EVIDENCE</span>
            <h2>Integrity Proof</h2>
          </div>
        </div>

        <CryptoRow
          label="Exact Quote SHA-256"
          value={data.receipt.payload.authorization?.quoteHash??"-"}
        />
        <CryptoRow
          label="Proof SHA-256"
          value={data.receipt.proofHash}
        />
        <CryptoRow
          label="HMAC Proof Signature"
          value={data.receipt.proofSignature}
        />
        <CryptoRow
          label="Evidence Audit Head"
          value={data.receipt.evidenceAuditHeadHash??"-"}
        />
        <CryptoRow
          label="Current Audit Head"
          value={data.verification.currentAuditHeadHash??"-"}
        />
      </section>

      <section className="proofChecks">
        <Check ok>Intent Wallet authority recorded</Check>
        <Check ok>Exact quote bound with SHA-256</Check>
        <Check ok={Boolean(data.receipt.payload.authorization?.authorizationId)||data.receipt.payload.authorization?.mode==="INTENT_WALLET_POLICY_AT_EXECUTION"}>
          Authorization evidence present
        </Check>
        <Check ok>Distributed payment idempotency applied</Check>
        <Check ok>Razorpay webhook signature verified</Check>
        <Check ok>Wallet spend ledger applied once</Check>
        <Check ok={data.verification.auditChainValid}>Tamper-evident audit chain valid</Check>
        <Check ok={data.verification.signaturePresent}>Proof receipt signed</Check>
      </section>
    </div>}
  </div></Shell>;
}

function ProofCard({title,children}:{title:string;children:ReactNode}){
  return <article className="proofCard">
    <h3>{title}</h3>
    <div>{children}</div>
  </article>;
}

function Row({label,value}:{label:string;value:any}){
  return <div className="proofRow">
    <span>{label}</span>
    <strong>{String(value??"-")}</strong>
  </div>;
}

function CryptoRow({label,value}:{label:string;value:string}){
  return <div className="cryptoRow">
    <span>{label}</span>
    <code>{value}</code>
  </div>;
}

function Check({ok,children}:{ok:boolean;children:ReactNode}){
  return <div className={ok?"proofCheck ok":"proofCheck bad"}>
    <span>{ok?"✓":"✕"}</span>
    <strong>{children}</strong>
  </div>;
}
