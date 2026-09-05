"use client";

import {useMemo, useState} from "react";
import {QRCodeSVG} from "qrcode.react";

const fallbackDate = "2026-10-05";

function digitsOnly(value:string){
  return value.replace(/\D/g,"");
}

function readableDate(value:string){
  const date = new Date(`${value}T23:59:59`);
  if(Number.isNaN(date.getTime())) return "05 Oct 2026";
  return new Intl.DateTimeFormat("en-GB",{
    day:"2-digit",
    month:"short",
    year:"numeric"
  }).format(date);
}

export function WhatsAppDemoCard({
  compact=false
}:{compact?:boolean}) {
  const number = digitsOnly(
    process.env.NEXT_PUBLIC_INTENTLOCK_WHATSAPP_NUMBER ?? ""
  );

  const code =
    process.env.NEXT_PUBLIC_INTENTLOCK_PAIRING_CODE ?? "";

  const endDate =
    process.env.NEXT_PUBLIC_INTENTLOCK_DEMO_END_DATE ??
    fallbackDate;

  const [copied,setCopied] = useState(false);

  const pairingMessage = code
    ? `INTENTLOCK ${code}`
    : "INTENTLOCK <PAIR_CODE>";

  const href = useMemo(() => {
    if(!number || !code) return "";
    return `https://wa.me/${number}?text=${encodeURIComponent(pairingMessage)}`;
  },[number,code,pairingMessage]);

  async function copyPairing(){
    try{
      await navigator.clipboard.writeText(pairingMessage);
      setCopied(true);
      setTimeout(()=>setCopied(false),1500);
    }catch{}
  }

  return (
    <section className={
      compact
        ? "waEntryCard waEntryCardCompact"
        : "waEntryCard"
    }>
      <div className="waEntryTop">
        <div>
          <span className="sectionKicker">LIVE DEMO</span>
          <h2>Start on WhatsApp.</h2>
          <p>
            Scan once. WhatsApp opens with the IntentLock pairing
            message already filled in. Tap send and the demo chat is
            authorized.
          </p>
        </div>

        <div className="waAvailability">
          <span className="v1011LiveDot" />
          Available through {readableDate(endDate)}
        </div>
      </div>

      <div className="waEntryGrid">
        <div className="waQrSurface">
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="waQrLink"
              aria-label="Open IntentLock WhatsApp demo"
            >
              <QRCodeSVG
                value={href}
                size={compact ? 190 : 238}
                level="M"
                bgColor="#ffffff"
                fgColor="#151715"
                marginSize={2}
              />
            </a>
          ) : (
            <div className="waQrMissing">
              <strong>QR configuration required</strong>
              <span>
                Add the WhatsApp number and demo pairing code to
                apps/web/.env.local.
              </span>
            </div>
          )}

          <span className="waScanLabel">SCAN WITH YOUR PHONE</span>
        </div>

        <div className="waSteps">
          <Step
            number="1"
            title="Scan the QR"
            copy="It opens your IntentLock WhatsApp chat."
          />
          <Step
            number="2"
            title="Tap Send"
            copy="The pairing message is already written for the visitor."
          />
          <Step
            number="3"
            title="Type HELP"
            copy="IntentLock returns the demo command guide."
          />
          <Step
            number="4"
            title="Try a purchase"
            copy="Use natural language. Policy decides if money may move."
          />

          <div className="waPairingPreview">
            <span>Pre-filled first message</span>
            <code>{pairingMessage}</code>
            <button
              type="button"
              onClick={copyPairing}
              className="textButton"
            >
              {copied ? "Copied" : "Copy message"}
            </button>
          </div>
        </div>
      </div>

      <p className="waFootnote">
        Demo access is intentionally temporary. Pairing authorizes only
        that WhatsApp chat. Send <code>INTENTLOCK STOP</code> to revoke it.
      </p>
    </section>
  );
}

function Step({
  number,title,copy
}:{number:string;title:string;copy:string}) {
  return (
    <div className="waStep">
      <span className="waStepNumber">{number}</span>
      <div>
        <strong>{title}</strong>
        <p>{copy}</p>
      </div>
    </div>
  );
}
