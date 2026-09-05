"use client";

import {useEffect,useState} from "react";
import {Shell} from "../components/Shell";
import {API} from "../lib";

type RiskStatus = {
  engine?:string;
  version?:string;
  scoreRange?:number[];
  thresholds?:Record<string,string>;
  invariant?:string;
};

export default function TrustPage(){
  const [status,setStatus]=useState<RiskStatus|null>(null);
  const [sessionId,setSessionId]=useState("");
  const [result,setResult]=useState<any>(null);
  const [error,setError]=useState("");

  useEffect(()=>{
    fetch(`${API}/api/risk/status`)
      .then(r=>r.json())
      .then(setStatus)
      .catch(()=>setStatus(null));
  },[]);

  async function inspect(){
    if(!sessionId.trim()) return;
    setError("");
    setResult(null);

    try{
      const r=await fetch(
        `${API}/api/risk/session/${encodeURIComponent(sessionId.trim())}`
      );
      const data=await r.json();
      if(!r.ok) throw new Error(data.error??"Assessment not found");
      setResult(data.assessment);
    }catch(e:any){
      setError(e.message??"Could not load risk assessment");
    }
  }

  return (
    <Shell>
      <div className="v1011Page">
        <header className="minimalPageHeader">
          <div>
            <span className="sectionKicker">V10.9</span>
            <h1>Adaptive Agent Trust & Risk.</h1>
            <p>
              Behavioral risk sits after hard wallet policy. It can
              reduce autonomy, never increase financial authority.
            </p>
          </div>

          <div className="riskInvariant">
            <span>Invariant</span>
            <strong>
              Risk cannot expand wallet authority.
            </strong>
          </div>
        </header>

        <section className="riskHeroGrid">
          <article className="riskScaleCard">
            <span className="sectionKicker">TRUST SCALE</span>
            <div className="riskScoreExample">82</div>
            <strong>LOW RISK</strong>
            <p>
              A normal authorized purchase can remain autonomous.
            </p>
          </article>

          <article className="riskRuleCard">
            <div>
              <span>Policy</span>
              <strong>ALLOW</strong>
            </div>
            <span className="riskArrow">→</span>
            <div>
              <span>Risk</span>
              <strong>HIGH</strong>
            </div>
            <span className="riskArrow">→</span>
            <div>
              <span>Final</span>
              <strong>STEP_UP</strong>
            </div>
          </article>
        </section>

        <section className="narrativeSection">
          <div className="sectionIntro">
            <span className="sectionKicker">SIGNALS</span>
            <h2>Deterministic evidence, not an AI vibe score.</h2>
          </div>

          <div className="signalGrid">
            {[
              "Prompt-injection exposure",
              "Selected malicious merchant text",
              "Near hard spending ceiling",
              "Amount anomaly",
              "Rapid purchase frequency",
              "Recent policy blocks",
              "Failed / rejected purchases",
              "Live quote changes",
              "Replay / duplicate attempts",
              "Known vs new merchant",
              "Established purchase history",
              "Frequent human STEP_UPs",
            ].map((signal,i)=>(
              <div className="signalItem" key={signal}>
                <span>{String(i+1).padStart(2,"0")}</span>
                <strong>{signal}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="riskInspector">
          <div>
            <span className="sectionKicker">SESSION INSPECTOR</span>
            <h2>Look up a real PurchaseSession assessment.</h2>
            <p>
              Paste the <code>ps_...</code> session ID returned in
              WhatsApp.
            </p>
          </div>

          <div className="riskInspectorForm">
            <input
              value={sessionId}
              onChange={e=>setSessionId(e.target.value)}
              placeholder="ps_..."
            />
            <button
              type="button"
              onClick={inspect}
              className="minimalPrimary"
            >
              Inspect
            </button>
          </div>

          {error && <div className="minimalError">{error}</div>}

          {result && (
            <div className="riskResult">
              <div className="riskResultScore">
                <span>Trust score</span>
                <strong>{result.trustScore}/100</strong>
                <small>{result.riskLevel} RISK</small>
              </div>

              <div className="riskResultMeta">
                <div>
                  <span>Policy</span>
                  <strong>{result.policyDecision}</strong>
                </div>
                <div>
                  <span>Risk action</span>
                  <strong>{result.riskAction}</strong>
                </div>
                <div>
                  <span>Merchant</span>
                  <strong>{result.merchant??"—"}</strong>
                </div>
                <div>
                  <span>Amount</span>
                  <strong>
                    ₹{Number(result.amount??0).toLocaleString("en-IN")}
                  </strong>
                </div>
              </div>

              <div className="riskSignalList">
                {(result.signals??[]).map((signal:any)=>(
                  <div key={`${signal.code}-${signal.delta}`}>
                    <strong>{signal.code}</strong>
                    <span>{signal.detail}</span>
                    <small>{signal.delta}</small>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <p className="backendStatusLine">
          {status
            ? `${status.engine} · ${status.version}`
            : "Risk engine status unavailable"}
        </p>
      </div>
    </Shell>
  );
}
