"use client";

import Link from "next/link";
import {Shell} from "./components/Shell";
import {WhatsAppDemoCard} from "./components/WhatsAppDemoCard";
import styles from "./home.module.css";

const journey=[
  {n:"01",title:"User delegates a goal",text:"A human defines what the agent may buy, how much it may spend, which brands or categories are allowed, and when that authority expires.",tag:"INTENT WALLET"},
  {n:"02",title:"Agent searches commerce",text:"The agent can search eBay, Shopify or another connector. Merchant text remains untrusted; only structured product facts enter authorization.",tag:"COMMERCE"},
  {n:"03",title:"IntentLock binds the exact payee + quote",text:"Seller identity, product, price, currency, FX quote and buyer context are fingerprinted before money can move.",tag:"PAYEELOCK + QUOTE"},
  {n:"04",title:"Policy decides — not the model",text:"IntentLock returns ALLOW, STEP-UP or BLOCK using deterministic authority. The LLM cannot widen the wallet's permission.",tag:"AUTHORIZATION"},
  {n:"05",title:"Payment executes behind another gate",text:"PayPal uses AUTHORIZE first. Product, payee, FX and authority are revalidated before capture is requested.",tag:"PAYMENT"},
  {n:"06",title:"Verified provider evidence becomes financial truth",text:"A browser redirect or API 2xx is not enough. A verified provider webhook drives wallet settlement exactly once.",tag:"SETTLEMENT"},
  {n:"07",title:"TrustOps proves and monitors what happened",text:"Ledger state, proof receipt and provider state are reconciled. If a dispute arrives, the same transaction becomes an evidence packet.",tag:"TRUSTOPS"},
];

const problems=[
  {kicker:"AUTHORITY",title:"Agent overreach",text:"The model may recommend something outside the user's budget or constraints. IntentLock keeps financial authority deterministic."},
  {kicker:"IDENTITY",title:"Payee substitution",text:"The amount can stay unchanged while the beneficiary changes. PayeeLock binds the seller identity to authorization."},
  {kicker:"STATE",title:"Payment-state drift",text:"Provider, session, ledger and proof can disagree after retries or webhook failures. TrustOps detects that mismatch."},
  {kicker:"DISPUTES",title:"Fragmented evidence",text:"When a payment is challenged, intent, authorization, capture and ledger evidence are normally spread across systems."},
];

export default function Page(){
  return <Shell><div className={styles.page}>
    <section className={styles.hero}>
      <div className={styles.heroCopy}>
        <div className={styles.heroMeta}>
          <span className={styles.kicker}>FINANCIAL CONTROL FOR AUTONOMOUS AGENTS</span>
          <span className={styles.version}>V11.3</span>
        </div>
        <h1>
          AI can choose what to buy.
          <br/>
          <span>It should not choose what it is allowed to spend.</span>
        </h1>
        <p className={styles.heroLead}>
          IntentLock sits between an AI agent and payment rails. Before money moves it checks the user's delegated authority,
          exact seller, exact quote and policy. After money moves it reconciles the provider, ledger and proof so every transaction
          has one explainable end-to-end story.
        </p>
        <div className={styles.heroActions}>
          <Link href="/new-purchase" className={styles.primaryAction}>Run one transaction <span>→</span></Link>
          <Link href="/trust-center" className={styles.secondaryAction}>Follow a completed transaction</Link>
        </div>
        <div className={styles.invariant}>
          <span>IN ONE LINE</span>
          <strong>The agent proposes. IntentLock authorizes. The payment rail executes. Verified evidence proves what actually happened.</strong>
        </div>
      </div>

      <div className={styles.controlVisual} aria-label="IntentLock end-to-end transaction flow">
        <div className={styles.visualTop}>
          <span className={styles.visualLabel}>ONE TRANSACTION · END TO END</span>
          <span className={styles.online}><i/> EXPLAINABLE</span>
        </div>
        <div className={styles.visualIntent}>
          <span>EXAMPLE USER REQUEST</span>
          <strong>“Find Sony ANC headphones under my delegated limit and buy only if every rule still holds.”</strong>
        </div>
        <div className={styles.visualFlow}>
          <FlowNode n="01" label="Search" detail="agent proposes" />
          <FlowNode n="02" label="Bind" detail="seller + quote" active />
          <FlowNode n="03" label="Authorize" detail="wallet policy" active />
          <FlowNode n="04" label="Settle" detail="verified capture" />
          <FlowNode n="05" label="Prove" detail="ledger + proof" success />
        </div>
        <div className={styles.visualDecision}>
          <div><span>MODEL CAN</span><strong>SEARCH + REASON</strong></div>
          <div><span>MODEL CANNOT</span><strong>GRANT AUTHORITY</strong></div>
          <div><span>CAPTURE TRUST</span><strong>WEBHOOK-GATED</strong></div>
        </div>
      </div>
    </section>

    <section className={styles.capabilityStrip}>
      <Capability title="BEFORE PAYMENT" text="Wallet + quote + payee + policy" />
      <Capability title="DURING PAYMENT" text="Authorize → revalidate → capture" />
      <Capability title="AFTER PAYMENT" text="Webhook → ledger → proof" />
      <Capability title="IF SOMETHING BREAKS" text="Reconcile + dispute evidence" />
    </section>

    <section className={`${styles.section} ${styles.storySection}`}>
      <div className={styles.sectionIntro}>
        <span className={styles.kicker}>START HERE</span>
        <h2>Follow one purchase and every feature makes sense.</h2>
        <p className={styles.sectionLead}>IntentLock is not a collection of dashboards. Every module exists because the same transaction passes through a new trust boundary.</p>
      </div>
      <div className={styles.storyTimeline}>
        {journey.map((step,index)=><article className={styles.storyStep} key={step.n}>
          <div className={styles.storyRail}>
            <span>{step.n}</span>
            {index<journey.length-1&&<i/>}
          </div>
          <div className={styles.storyCopy}>
            <small>{step.tag}</small>
            <h3>{step.title}</h3>
            <p>{step.text}</p>
          </div>
          <div className={styles.storyOutcome}>{outcomeFor(index)}</div>
        </article>)}
      </div>
      <div className={styles.storyActions}>
        <Link href="/new-purchase" className={styles.primaryAction}>Start at step 01 →</Link>
        <Link href="/how-it-works" className={styles.textLink}>See technical architecture</Link>
      </div>
    </section>

    <section className={styles.section}>
      <div className={styles.sectionIntro}>
        <span className={styles.kicker}>WHY THIS EXISTS</span>
        <h2>Four real failure modes. One transaction control plane.</h2>
      </div>
      <div className={styles.problemGrid}>
        {problems.map((p,i)=><article className={styles.problemCard} key={p.title}>
          <div className={styles.problemTop}><span>{String(i+1).padStart(2,"0")}</span><b>{p.kicker}</b></div>
          <h3>{p.title}</h3>
          <p>{p.text}</p>
        </article>)}
      </div>
    </section>

    <section className={styles.trustOpsSection}>
      <div className={styles.trustOpsLight}>
        <span className={styles.kicker}>BEFORE MONEY MOVES</span>
        <h2>Authority is bound to the transaction.</h2>
        <p>Product facts, seller identity, presentment currency, FX normalization and Intent Wallet rules are evaluated together. If anything changes later, authorization is no longer reusable.</p>
        <div className={styles.policyStack}>
          <Policy label="Who gets paid" value="Payee fingerprint"/>
          <Policy label="What is bought" value="Exact product + features"/>
          <Policy label="How much" value="Bound quote + FX"/>
          <Policy label="What agent may do" value="Intent Wallet policy"/>
        </div>
        <Link href="/wallets" className={styles.textLink}>See delegated authority →</Link>
      </div>
      <div className={styles.trustOpsDark}>
        <span className={styles.kickerLight}>AFTER MONEY MOVES</span>
        <h2>All financial state must converge.</h2>
        <p>TrustOps checks whether the provider, PurchaseSession, wallet ledger and proof receipt agree. A dispute uses that same transaction record instead of assembling evidence from scratch.</p>
        <div className={styles.truthRows}>
          <TruthRow label="Provider" value="COMPLETED" />
          <TruthRow label="Session" value="CAPTURED" />
          <TruthRow label="Ledger" value="DEBITED ONCE" />
          <TruthRow label="Proof" value="SIGNED" />
        </div>
        <Link href="/trust-center" className={styles.darkAction}>Follow a real session →</Link>
      </div>
    </section>

    <section className={styles.section}>
      <div className={styles.sectionIntro}>
        <span className={styles.kicker}>INTERACTION CHANNEL</span>
        <h2>The same control plane can be reached from the web or WhatsApp.</h2>
        <p className={styles.sectionLead}>WhatsApp is a channel into IntentLock — not a separate product. It creates the same PurchaseSession and hits the same policy, payment and proof pipeline.</p>
      </div>
      <div className={styles.whatsappWrap}><WhatsAppDemoCard /></div>
    </section>

    <section className={styles.stackSection}>
      <div className={styles.sectionIntro}>
        <span className={styles.kicker}>IMPLEMENTATION STATUS</span>
        <h2>What is live now, and what is adapter-ready.</h2>
      </div>
      <div className={styles.stackGrid}>
        {[
          ["PayPal Sandbox","Verified end-to-end"],["Cloudflare Queue","Settlement worker"],["Neon PostgreSQL","Session + ledger + proof"],
          ["Intent Wallet","Deterministic authority"],["PayeeLock","Binding active"],["TrustOps","Reconciliation + evidence"],
          ["Razorpay","Alternate rail preserved"],["eBay Browse","Adapter ready · API access pending"],["Shopify","Optional connector"],
          ["WhatsApp / WAHA","Channel integration"],["Upstash Redis","Replay + idempotency"],["SHA-256 + HMAC","Integrity + signed proof"],
        ].map(([name,role])=><div className={styles.stackItem} key={name}><strong>{name}</strong><span>{role}</span></div>)}
      </div>
    </section>

    <section className={styles.closing}>
      <div>
        <span className={styles.kickerLight}>THE PRODUCT</span>
        <h2>One transaction. One authority boundary. One provable financial history.</h2>
      </div>
      <div className={styles.closingActions}>
        <Link href="/new-purchase" className={styles.closingPrimary}>Run transaction →</Link>
        <Link href="/trust-center" className={styles.closingSecondary}>Inspect lifecycle</Link>
      </div>
    </section>
  </div></Shell>;
}

function outcomeFor(index:number){
  return ["GOAL + LIMITS","CANDIDATES","BOUND CONTEXT","ALLOW / STEP-UP / BLOCK","PROVIDER ORDER","CAPTURED + DEBITED","HEALTHY + DISPUTE-READY"][index];
}
function FlowNode({n,label,detail,active=false,success=false}:{n:string;label:string;detail:string;active?:boolean;success?:boolean}){
  return <div className={`${styles.flowNode} ${active?styles.flowNodeActive:""} ${success?styles.flowNodeSuccess:""}`}><span>{n}</span><strong>{label}</strong><small>{detail}</small></div>;
}
function Capability({title,text}:{title:string;text:string}){return <div className={styles.capability}><span/><div><strong>{title}</strong><small>{text}</small></div></div>;}
function TruthRow({label,value}:{label:string;value:string}){return <div className={styles.truthRow}><span>{label}</span><i/><strong>{value}</strong></div>;}
function Policy({label,value}:{label:string;value:string}){return <div className={styles.policy}><span>{label}</span><strong>{value}</strong></div>;}
