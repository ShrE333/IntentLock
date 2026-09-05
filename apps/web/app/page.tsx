"use client";

import Link from "next/link";
import {useEffect,useState} from "react";
import {Shell} from "./components/Shell";
import {WhatsAppDemoCard} from "./components/WhatsAppDemoCard";
import {API} from "./lib";

type Health = {
  version?:string;
  status?:string;
  databaseConfigured?:boolean;
  redisConfigured?:boolean;
  razorpayConfigured?:boolean;
  webhookConfigured?:boolean;
};

export default function Page(){
  const [health,setHealth] = useState<Health|null>(null);

  useEffect(()=>{
    fetch(`${API}/health`)
      .then(r=>r.json())
      .then(setHealth)
      .catch(()=>setHealth(null));
  },[]);

  return (
    <Shell>
      <div className="v1011Page">
        <section className="overviewHero">
          <div className="overviewHeroCopy">
            <div className="heroMeta">
              <span className="sectionKicker">
                POLICY-GATED AGENTIC COMMERCE
              </span>
              <span className="heroVersion">
                {health?.version?.toUpperCase() ?? "V10.9+"}
              </span>
            </div>

            <h1>
              Give an AI a goal.
              <br/>
              <span>Not your wallet.</span>
            </h1>

            <p className="heroLead">
              IntentLock sits between autonomous AI agents and payment
              rails. The agent can search, reason and propose. A
              deterministic authorization layer decides whether money
              is actually allowed to move.
            </p>

            <div className="heroActions">
              <Link href="/demo" className="minimalPrimary">
                Open live demo
              </Link>
              <Link href="/how-it-works" className="minimalSecondary">
                See the architecture
              </Link>
            </div>

            <div className="heroPrinciple">
              <span>Core principle</span>
              <strong>
                The model proposes. The policy engine disposes.
              </strong>
            </div>
          </div>

          <div className="heroObjectWrap" aria-hidden="true">
            <div className="heroObject">
              <div className="heroPlane heroPlaneBack">
                <span>AGENT</span>
                <strong>PROPOSE</strong>
              </div>
              <div className="heroPlane heroPlaneMiddle">
                <span>INTENT WALLET</span>
                <strong>AUTHORIZE</strong>
              </div>
              <div className="heroPlane heroPlaneFront">
                <span>PAYMENT</span>
                <strong>EXECUTE</strong>
              </div>
            </div>
          </div>
        </section>

        <WhatsAppDemoCard />

        <section className="narrativeSection">
          <div className="sectionIntro">
            <span className="sectionKicker">THE PROBLEM</span>
            <h2>
              Autonomous commerce has a missing layer:
              financial authority.
            </h2>
            <p>
              AI agents can find products and make decisions, but
              merchant text can manipulate them, prices can change,
              retries can duplicate payments, and old permissions can
              become unsafe. IntentLock makes authorization independent
              from the model.
            </p>
          </div>

          <div className="problemGrid">
            <Problem
              label="01"
              title="Prompt injection"
              text="Merchant-controlled text is treated as untrusted data, never authority."
            />
            <Problem
              label="02"
              title="Overspending"
              text="Intent Wallets encode total authority, autonomous limits, hard ceilings and expiry."
            />
            <Problem
              label="03"
              title="Stale commerce facts"
              text="The exact Shopify quote is revalidated before Razorpay execution."
            />
            <Problem
              label="04"
              title="Retries and replay"
              text="Redis idempotency and one-time authorization consumption stop duplicate execution."
            />
          </div>
        </section>

        <section className="narrativeSection">
          <div className="sectionIntro sectionIntroRow">
            <div>
              <span className="sectionKicker">THE SYSTEM</span>
              <h2>One purchase. Nine explicit trust boundaries.</h2>
            </div>
            <Link href="/how-it-works" className="textLink">
              Full technical flow →
            </Link>
          </div>

          <div className="architectureStrip">
            {[
              ["01","WhatsApp / Web","User intent"],
              ["02","WAHA","Messaging bridge"],
              ["03","Cloudflare Queue","Durable execution"],
              ["04","Shopify","Live commerce"],
              ["05","Intent Wallet","Hard policy"],
              ["06","Trust Engine","Adaptive risk"],
              ["07","Razorpay","Payment rail"],
              ["08","Webhook","Verified outcome"],
              ["09","Proof Receipt","Audit evidence"],
            ].map(([n,t,s])=>(
              <div className="architectureCell" key={n}>
                <span>{n}</span>
                <strong>{t}</strong>
                <small>{s}</small>
              </div>
            ))}
          </div>
        </section>

        <section className="narrativeSection twoStoryColumns">
          <div className="storyPanel storyPanelDark">
            <span className="sectionKicker sectionKickerLight">
              WHAT IS AN INTENT WALLET?
            </span>
            <h2>Bounded authority, not stored money.</h2>
            <p>
              Funds remain on payment rails. The wallet describes what
              an agent may do: budget, brands, categories, quantity,
              autonomous threshold, hard ceiling and expiry.
            </p>
            <Link href="/wallets">Inspect Intent Wallets →</Link>
          </div>

          <div className="storyPanel">
            <span className="sectionKicker">ADAPTIVE TRUST</span>
            <h2>Risk can restrict. It can never grant authority.</h2>
            <p>
              V10.9 adds behavioral risk signals such as prompt
              injection exposure, transaction anomalies, replay
              attempts and purchase history. A high-risk ALLOW can be
              escalated to human approval. A BLOCK never becomes ALLOW.
            </p>
            <Link href="/trust">Inspect Trust & Risk →</Link>
          </div>
        </section>

        <section className="narrativeSection">
          <div className="sectionIntro">
            <span className="sectionKicker">BUILT, NOT MOCKED</span>
            <h2>The demo crosses real external systems.</h2>
          </div>

          <div className="stackGrid">
            {[
              ["Next.js","Interface"],
              ["TypeScript","Application layer"],
              ["Cloudflare Workers","API runtime"],
              ["Cloudflare Queues","Async commerce"],
              ["Workers AI","Intent parsing"],
              ["Durable Objects","Agent execution"],
              ["Neon PostgreSQL","Audit + state"],
              ["Upstash Redis","Idempotency"],
              ["Shopify Storefront","Live products"],
              ["Razorpay Test Mode","Payment execution"],
              ["WAHA / GOWS","WhatsApp bridge"],
              ["HMAC + SHA-256","Authorization integrity"],
            ].map(([name,role])=>(
              <div className="stackItem" key={name}>
                <strong>{name}</strong>
                <span>{role}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="closingStatement">
          <span className="sectionKicker">INTENTLOCK</span>
          <blockquote>
            “AI decides what the user probably wants.
            IntentLock decides whether money is allowed to move.”
          </blockquote>
          <div>
            <Link href="/demo" className="minimalPrimary">
              Try it on WhatsApp
            </Link>
            <span className="closingStatus">
              Live demo planned through 05 Oct 2026
            </span>
          </div>
        </section>
      </div>
    </Shell>
  );
}

function Problem({
  label,title,text
}:{label:string;title:string;text:string}) {
  return (
    <article className="problemCard">
      <span>{label}</span>
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  );
}
