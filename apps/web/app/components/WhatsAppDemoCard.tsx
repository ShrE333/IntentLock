"use client";

import {useMemo,useState} from "react";
import {QRCodeSVG} from "qrcode.react";

function digitsOnly(value:string){return value.replace(/\D/g,"");}
function readableDate(value:string){
  const date=new Date(`${value}T23:59:59`);
  if(Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB",{day:"2-digit",month:"short",year:"numeric"}).format(date);
}

export function WhatsAppDemoCard({compact=false}:{compact?:boolean}){
  const number=digitsOnly(process.env.NEXT_PUBLIC_INTENTLOCK_WHATSAPP_NUMBER??"");
  const code=process.env.NEXT_PUBLIC_INTENTLOCK_PAIRING_CODE??"";
  const configuredEndDate=process.env.NEXT_PUBLIC_INTENTLOCK_DEMO_END_DATE??"";
  const endDate=configuredEndDate?new Date(`${configuredEndDate}T23:59:59`):null;
  const futureDate=Boolean(endDate&&!Number.isNaN(endDate.getTime())&&endDate.getTime()>Date.now());
  const [copied,setCopied]=useState(false);
  const pairingMessage=code?`INTENTLOCK ${code}`:"INTENTLOCK <PAIR_CODE>";
  const href=useMemo(()=>number&&code?`https://wa.me/${number}?text=${encodeURIComponent(pairingMessage)}`:"",[number,code,pairingMessage]);

  async function copyPairing(){try{await navigator.clipboard.writeText(pairingMessage);setCopied(true);setTimeout(()=>setCopied(false),1500);}catch{}}

  return <section className={compact?"waEntryCard waEntryCardCompact":"waEntryCard"}>
    <div className="waEntryTop">
      <div><span className="sectionKicker">OPTIONAL CHANNEL · SAME PIPELINE</span><h2>Start the same purchase flow on WhatsApp.</h2><p>WhatsApp is only the entry channel. After pairing, the message creates the same PurchaseSession and goes through the same commerce, Intent Wallet, payment, ledger and proof pipeline as the web UI.</p></div>
      <div className="waAvailability"><span className="v1011LiveDot"/>{futureDate?`Available through ${readableDate(configuredEndDate)}`:href?"Channel configured":"Demo channel not configured"}</div>
    </div>

    <div className="waEntryGrid">
      <div className="waQrSurface">
        {href?<a href={href} target="_blank" rel="noreferrer" className="waQrLink" aria-label="Open IntentLock WhatsApp demo"><QRCodeSVG value={href} size={compact?190:238} level="M" bgColor="#ffffff" fgColor="#151715" marginSize={2}/></a>:<div className="waQrMissing"><strong>QR configuration required</strong><span>Add the WhatsApp number and pairing code to apps/web/.env.local.</span></div>}
        <span className="waScanLabel">SCAN WITH YOUR PHONE</span>
      </div>
      <div className="waSteps">
        <Step number="1" title="Pair the chat" copy="Scan the QR and send the pre-filled IntentLock pairing message."/>
        <Step number="2" title="Send a purchase goal" copy="Use natural language just like the web purchase page."/>
        <Step number="3" title="IntentLock creates a PurchaseSession" copy="The channel changes; authorization logic does not."/>
        <Step number="4" title="Follow the result in Transaction Control" copy="The same session can be inspected from intent through proof."/>
        <div className="waPairingPreview"><span>Pre-filled first message</span><code>{pairingMessage}</code><button type="button" onClick={copyPairing} className="textButton">{copied?"Copied":"Copy message"}</button></div>
      </div>
    </div>
    <p className="waFootnote">Pairing authorizes only that WhatsApp chat. Send <code>INTENTLOCK STOP</code> to revoke it.</p>
  </section>;
}

function Step({number,title,copy}:{number:string;title:string;copy:string}){return <div className="waStep"><span className="waStepNumber">{number}</span><div><strong>{title}</strong><p>{copy}</p></div></div>;}
