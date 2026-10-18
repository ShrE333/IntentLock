import {readFile} from "node:fs/promises";
import {neon} from "@neondatabase/serverless";

// Run with Node 22+: node --env-file=.dev.vars scripts/paypal-settlement.mjs <command>
// Credentials stay in memory and are never included in output.
const [command,eventId,webhookId]=process.argv.slice(2);
const required=name=>{
  if(!process.env[name]) throw new Error(name+" is not configured");
  return process.env[name];
};

try{
  if(command==="apply-fix"){
    const sql=neon(required("DATABASE_URL"));
    const migration=await readFile(new URL("../db/v11_0_2_capture_retry.sql",import.meta.url),"utf8");
    await sql.query(migration);
    console.log("Applied v11_0_2_capture_retry.sql: settlement function repaired; no transaction data changed.");
  }else if(command==="resend"){
    if(!eventId?.startsWith("WH-") || !webhookId) throw new Error("Usage: resend <existing event ID> <webhook ID>");
    if(process.env.PAYPAL_WEBHOOK_ID && webhookId!==process.env.PAYPAL_WEBHOOK_ID)
      throw new Error("Requested webhook ID differs from PAYPAL_WEBHOOK_ID; check the selected environment.");
    const base=String(process.env.PAYPAL_ENV??"sandbox").toLowerCase()==="live"
      ?"https://api-m.paypal.com":"https://api-m.sandbox.paypal.com";
    const tokenResponse=await fetch(base+"/v1/oauth2/token",{
      method:"POST",headers:{
        authorization:"Basic "+Buffer.from(required("PAYPAL_CLIENT_ID")+":"+required("PAYPAL_CLIENT_SECRET")).toString("base64"),
        "content-type":"application/x-www-form-urlencoded"
      },body:"grant_type=client_credentials",signal:AbortSignal.timeout(30000)
    });
    if(!tokenResponse.ok) throw new Error("PayPal OAuth returned HTTP "+tokenResponse.status);
    const token=await tokenResponse.json();
    if(!token.access_token) throw new Error("PayPal OAuth returned no access token");
    const response=await fetch(base+"/v1/notifications/webhooks-events/"+encodeURIComponent(eventId)+"/resend",{
      method:"POST",headers:{authorization:"Bearer "+token.access_token,"content-type":"application/json"},
      body:JSON.stringify({webhook_ids:[webhookId]}),signal:AbortSignal.timeout(30000)
    });
    if(!response.ok) throw new Error("PayPal resend returned HTTP "+response.status);
    console.log(JSON.stringify({resendAccepted:true,status:response.status,eventId,webhookId}));
  }else{
    throw new Error("Usage: node --env-file=.dev.vars scripts/paypal-settlement.mjs apply-fix | resend <event ID> <webhook ID>");
  }
}catch(error){
  // Do not echo raw network/database errors, which can contain credential-bearing URLs.
  const message=error instanceof Error?error.message:String(error);
  const safe=/^(Usage:|Requested webhook ID|PayPal |[A-Z_]+ is not configured)/.test(message);
  console.error(safe?message:"Operation failed; check connectivity and the selected environment. No credentials are printed.");
  process.exitCode=1;
}
