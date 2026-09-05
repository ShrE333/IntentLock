"use client";

import {useState} from "react";
import {Shell} from "../components/Shell";
import {WhatsAppDemoCard} from "../components/WhatsAppDemoCard";

const commands = [
  {
    command:"HELP",
    title:"Show the command guide",
    text:"Use this immediately after pairing."
  },
  {
    command:"WALLETS",
    title:"List available Intent Wallets",
    text:"Shows the authority envelopes available to this demo chat."
  },
  {
    command:"USE 1",
    title:"Select a wallet",
    text:"Use the number shown by WALLETS. Keep the space between USE and 1."
  },
  {
    command:"WALLET",
    title:"Inspect current authority",
    text:"Shows remaining authority, autonomous threshold, hard ceiling, brands and required features."
  },
  {
    command:"Find Sony or Bose wireless ANC headphones under 7000 buy automatically if allowed",
    title:"Run the complete agent flow",
    text:"Live Shopify → policy → adaptive risk → Razorpay."
  },
  {
    command:"ALLOW ONCE",
    title:"Approve a STEP_UP",
    text:"Issues exact one-time authority for the selected transaction."
  },
  {
    command:"REJECT",
    title:"Reject a STEP_UP",
    text:"Stops the pending purchase without moving money."
  },
  {
    command:"STATUS",
    title:"Check current session",
    text:"Returns the state of the active WhatsApp purchase."
  },
  {
    command:"RESET",
    title:"Clear chat purchase state",
    text:"Start another demo flow using the same paired chat."
  },
  {
    command:"INTENTLOCK STOP",
    title:"Revoke this chat",
    text:"Removes IntentLock access for the paired WhatsApp conversation."
  },
];

export default function DemoPage(){
  return (
    <Shell>
      <div className="v1011Page">
        <header className="minimalPageHeader">
          <div>
            <span className="sectionKicker">LIVE WHATSAPP DEMO</span>
            <h1>Scan. Send. Shop through policy.</h1>
            <p>
              This is the fastest way to understand IntentLock. The QR
              opens WhatsApp with the pairing message already filled in.
            </p>
          </div>

          <div className="headerAvailability">
            <span className="v1011LiveDot"/>
            Demo planned live until 05 Oct 2026
          </div>
        </header>

        <WhatsAppDemoCard />

        <section className="narrativeSection">
          <div className="sectionIntro">
            <span className="sectionKicker">WHATSAPP PLAYBOOK</span>
            <h2>Everything you can send during the demo.</h2>
            <p>
              You do not need to memorize these. Each command can be
              copied below, while natural-language purchase requests
              can be phrased normally.
            </p>
          </div>

          <div className="commandList">
            {commands.map((item,i)=>(
              <CommandRow
                key={item.command}
                number={String(i+1).padStart(2,"0")}
                {...item}
              />
            ))}
          </div>
        </section>

        <section className="narrativeSection">
          <div className="sectionIntro">
            <span className="sectionKicker">EXPECTED DEMO STORY</span>
            <h2>What a judge should see in under two minutes.</h2>
          </div>

          <div className="demoStory">
            {[
              ["Pair","Scan QR and send the pre-filled IntentLock pairing message."],
              ["Inspect","Send WALLET to see bounded financial authority."],
              ["Ask","Request Sony or Bose ANC headphones under ₹7,000."],
              ["Compare","IntentLock evaluates live Shopify candidates."],
              ["Authorize","₹5,899 Sony can ALLOW; ₹6,499 can STEP_UP; Boat and over-ceiling products BLOCK."],
              ["Risk","Adaptive Trust shows a deterministic score and risk signals."],
              ["Pay","Only the authorized exact quote gets a Razorpay checkout link."],
              ["Prove","Verified webhook, wallet spend ledger, audit chain and Proof Receipt close the loop."],
            ].map(([title,text],i)=>(
              <div className="demoStoryRow" key={title}>
                <span>{String(i+1).padStart(2,"0")}</span>
                <strong>{title}</strong>
                <p>{text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="demoSecurityNote">
          <div>
            <span className="sectionKicker">DEMO SAFETY</span>
            <h2>The public QR is temporary by design.</h2>
          </div>
          <p>
            Keep the pairing code dedicated to the demo environment,
            keep Razorpay in Test Mode, rate-limit abuse, and rotate or
            disable the pairing code after 05 Oct 2026. The QR does not
            represent production authentication.
          </p>
        </section>
      </div>
    </Shell>
  );
}

function CommandRow({
  number,command,title,text
}:{
  number:string;
  command:string;
  title:string;
  text:string;
}) {
  const [copied,setCopied]=useState(false);

  async function copy(){
    try{
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(()=>setCopied(false),1200);
    }catch{}
  }

  return (
    <article className="commandRow">
      <span className="commandNumber">{number}</span>
      <div className="commandCopy">
        <strong>{title}</strong>
        <p>{text}</p>
      </div>
      <code>{command}</code>
      <button
        type="button"
        className="textButton"
        onClick={copy}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </article>
  );
}
