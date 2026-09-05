import {Shell} from "../components/Shell";

const flow = [
  {
    n:"01",
    phase:"REQUEST",
    title:"Intent arrives",
    detail:"Web, API or a paired WhatsApp chat sends a natural-language shopping goal."
  },
  {
    n:"02",
    phase:"SESSION",
    title:"PurchaseSession is created",
    detail:"IntentLock gives the transaction a durable identity and records visible agent activity."
  },
  {
    n:"03",
    phase:"DISPATCH",
    title:"Queue separates ingress from execution",
    detail:"Cloudflare Queues keeps WhatsApp webhooks fast and gives commerce/payment execution an independent retry boundary."
  },
  {
    n:"04",
    phase:"COMMERCE",
    title:"Shopify returns live products",
    detail:"Structured product facts are treated as commerce data. Merchant-written descriptions remain untrusted."
  },
  {
    n:"05",
    phase:"AUTHORITY",
    title:"Intent Wallet policy executes",
    detail:"Budget, category, brand, quantity, features, autonomous threshold, hard ceiling and expiry are deterministic."
  },
  {
    n:"06",
    phase:"RISK",
    title:"Adaptive risk can tighten",
    detail:"Behavioral risk may escalate an ALLOW to STEP_UP. It can never convert BLOCK or STEP_UP into ALLOW."
  },
  {
    n:"07",
    phase:"BIND",
    title:"Quote is rebound",
    detail:"The selected live Shopify variant is refetched before payment and the exact transaction is hashed."
  },
  {
    n:"08",
    phase:"PAYMENT",
    title:"Razorpay is invoked once",
    detail:"Redis and database idempotency protect against duplicate checkout execution."
  },
  {
    n:"09",
    phase:"PROOF",
    title:"Verified outcome becomes proof",
    detail:"Only a verified Razorpay webhook can mark CAPTURED. Wallet spend, audit evidence and Proof Receipt follow."
  },
];

export default function HowItWorksPage(){
  return (
    <Shell>
      <div className="v1011Page">
        <header className="minimalPageHeader">
          <div>
            <span className="sectionKicker">SYSTEM DESIGN</span>
            <h1>The transaction firewall, end to end.</h1>
            <p>
              IntentLock treats the AI agent as an untrusted
              decision-maker. The model can propose an action, but
              authority comes from deterministic policy and
              transaction-bound proof.
            </p>
          </div>
        </header>

        <div className="flowOrientation">
          <div>
            <span className="flowOrientationDot"/>
            <strong>USER INTENT</strong>
          </div>
          <span className="flowOrientationArrow">→</span>
          <small>
            Each stage must complete before financial execution advances.
          </small>
          <span className="flowOrientationArrow">→</span>
          <div>
            <span className="flowOrientationDot flowOrientationDotFinal"/>
            <strong>VERIFIED PROOF</strong>
          </div>
        </div>

        <section className="architectureTimeline architectureTimelineFlow">
          {flow.map((item,index)=>(
            <article className="architectureTimelineRow flowTimelineRow" key={item.n}>
              <div className="flowRail">
                <span className="flowNode">{item.n}</span>
                {index < flow.length-1 && (
                  <span className="flowConnector" aria-hidden="true">
                    <span>↓</span>
                  </span>
                )}
              </div>

              <div className="flowStageCopy">
                <span className="flowPhase">{item.phase}</span>
                <h2>{item.title}</h2>
              </div>

              <p>{item.detail}</p>
            </article>
          ))}
        </section>

        <div className="flowComplete">
          <span>09 / 09</span>
          <strong>Money moves only after authority survives the complete path.</strong>
        </div>

        <section className="narrativeSection">
          <div className="sectionIntro">
            <span className="sectionKicker">SECURITY MODEL</span>
            <h2>Four rules the AI cannot negotiate away.</h2>
          </div>

          <div className="securityPrinciples">
            <article>
              <span>01</span>
              <h3>Policy is outside the model</h3>
              <p>
                Natural-language reasoning never becomes financial
                authority by itself.
              </p>
            </article>
            <article>
              <span>02</span>
              <h3>Merchant text is untrusted</h3>
              <p>
                Prompt injection may influence search context, but it
                cannot modify the Intent Wallet.
              </p>
            </article>
            <article>
              <span>03</span>
              <h3>Approval binds to an exact transaction</h3>
              <p>
                HMAC signatures and SHA-256 quote hashes prevent a
                one-time approval from silently changing amount or item.
              </p>
            </article>
            <article>
              <span>04</span>
              <h3>Risk only reduces autonomy</h3>
              <p>
                A high Trust Score cannot override a hard block. A high
                risk score may require more human involvement.
              </p>
            </article>
          </div>
        </section>

        <section className="narrativeSection">
          <div className="sectionIntro">
            <span className="sectionKicker">TECH STACK</span>
            <h2>Deliberately small pieces with clear jobs.</h2>
          </div>

          <div className="techTable">
            {[
              ["Interface","Next.js 15, React 19, TypeScript"],
              ["Agent runtime","Cloudflare Workers + Durable Objects"],
              ["Async execution","Cloudflare Queues"],
              ["Model layer","Workers AI for intent parsing"],
              ["State + audit","Neon PostgreSQL"],
              ["Idempotency","Upstash Redis"],
              ["Commerce","Shopify Storefront API"],
              ["Payments","Razorpay Test Mode + verified webhook"],
              ["WhatsApp","WAHA with GOWS engine"],
              ["Integrity","HMAC-SHA256 + SHA-256 canonical quote hashing"],
              ["Deployment","Vercel frontend + Cloudflare backend"],
            ].map(([layer,stack])=>(
              <div className="techTableRow" key={layer}>
                <strong>{layer}</strong>
                <span>{stack}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="narrativeSection">
          <div className="sectionIntro">
            <span className="sectionKicker">WHAT IS ALREADY BUILT</span>
            <h2>From policy prototype to real commerce execution.</h2>
          </div>

          <div className="versionGrid">
            {[
              ["V1–V4","Deterministic policy, AI parsing, prompt-injection demo, stale-price binding"],
              ["V5–V7","Neon audit, Redis idempotency, real Razorpay Test Mode payment + verified webhook"],
              ["V9","Unified frontend and 200 automated normal/adversarial/failure evaluations"],
              ["V10.1–10.4","Intent Wallets, Step-Up Approval, commerce connectors, PurchaseSession"],
              ["V10.5–10.8.5","WhatsApp/WAHA, payment proof, live Shopify, /v1/authorize SDK, async purchase queue"],
              ["V10.9","Adaptive Agent Trust & Risk Engine"],
              ["V10.11","Minimal judge-facing product UI and live WhatsApp entry experience"],
            ].map(([version,copy])=>(
              <article className="versionCard" key={version}>
                <span>{version}</span>
                <p>{copy}</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </Shell>
  );
}
