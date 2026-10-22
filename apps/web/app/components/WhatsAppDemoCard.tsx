'use client';
import Link from 'next/link';
import {useMemo,useState} from 'react';
import {QRCodeSVG} from 'qrcode.react';
function digitsOnly(s:string){return s.replace(/\D/g,'')}
export function WhatsAppDemoCard({compact=false}:{compact?:boolean}){
 const number=digitsOnly(process.env.NEXT_PUBLIC_INTENTLOCK_WHATSAPP_NUMBER??'');
 const code=process.env.NEXT_PUBLIC_INTENTLOCK_PAIRING_CODE??'';
 const cutoff=process.env.NEXT_PUBLIC_INTENTLOCK_DEMO_END_DATE??'2026-10-05';
 const parsed=cutoff?new Date(`${cutoff}T23:59:59`):null;
 // A configured demo expiration disables both the QR and its external link.
 const expired=Boolean(parsed&&!Number.isNaN(parsed.getTime())&&Date.now()>parsed.getTime());
 const [copied,setCopied]=useState(false);
 const pairingMessage=`INTENTLOCK ${code}`;
 const href=useMemo(()=>!expired&&number&&code?`https://wa.me/${number}?text=${encodeURIComponent(pairingMessage)}`:'',[expired,number,code,pairingMessage]);
 async function copyPairing(){if(!href)return;try{await navigator.clipboard.writeText(pairingMessage);setCopied(true);setTimeout(()=>setCopied(false),1500)}catch{}}
 return <section className={compact?'waEntryCard waEntryCardCompact':'waEntryCard'}>
  <div className="waEntryTop"><div><span className="sectionKicker">OPTIONAL CHANNEL · SAME POLICY</span><h2>Web and WhatsApp enter the same authorization pipeline.</h2><p>WhatsApp can send a purchase goal, but it cannot grant financial authority. All purchases require the same wallet policy and verified payment evidence.</p></div><div className="waAvailability"><span className="v1011LiveDot"/>{expired?'Demo channel ended':href?'Channel configured':'Channel unavailable'}</div></div>
  {expired||!href?<div className="il-wa-static"><div><strong>{expired?'The WhatsApp demo window has ended.':'The WhatsApp demo is not configured here.'}</strong><p>No expired pairing QR is shown. Use the functioning web transaction flow instead.</p></div><Link href="/new-purchase" className="il-button il-button--blue">Run purchase on the web</Link></div>:
  <div className="waEntryGrid"><div className="waQrSurface"><a href={href} target="_blank" rel="noreferrer" className="waQrLink" aria-label="Open IntentLock WhatsApp pairing"><QRCodeSVG value={href} size={compact?190:238} level="M" bgColor="#ffffff" fgColor="#151715" marginSize={2}/></a><span className="waScanLabel">SCAN WITH YOUR PHONE</span></div><div className="waSteps"><div className="waStep"><span className="waStepNumber">1</span><div><strong>Pair the chat</strong><p>Open WhatsApp from the QR.</p></div></div><div className="waStep"><span className="waStepNumber">2</span><div><strong>Set the purchase goal</strong><p>Write a natural-language product request.</p></div></div><div className="waStep"><span className="waStepNumber">3</span><div><strong>Follow the control path</strong><p>Intent Wallet policy, payment and proof are shared with the web.</p></div></div><div className="waPairingPreview"><span>Pairing message</span><code>INTENTLOCK [pairing code]</code><button type="button" onClick={copyPairing} className="textButton">{copied?'Copied':'Copy pairing message'}</button></div></div></div>}
 </section>;
}
