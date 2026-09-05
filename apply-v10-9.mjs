import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const read=r=>fs.readFileSync(
  path.join(root,r),
  "utf8"
);
const write=(r,v)=>fs.writeFileSync(
  path.join(root,r),
  v,
  "utf8"
);

for(const required of [
  "apps/worker/src/index.ts",
  "apps/worker/src/wallets/stepup.ts",
  "apps/worker/src/queue/purchase-jobs.ts",
  "apps/worker/src/risk/routes.ts"
]){
  if(!fs.existsSync(path.join(root,required))){
    throw new Error(
      `Missing ${required}. Extract the V10.9 ZIP over D:\\IntentLock first.`
    );
  }
}

// ----------------------------------------------------
// 1. Wire risk HTTP routes into the main Worker.
// ----------------------------------------------------
let index=read(
  "apps/worker/src/index.ts"
);

const riskImport=
  'import { handleRiskRoutes } from "./risk/routes";';

if(!index.includes(riskImport)){
  index=`${riskImport}\n${index}`;
}

const riskMarker=
  "const riskRouteResponse = await handleRiskRoutes(request, env, url);";

if(!index.includes(riskMarker)){
  const needle=
    "const url = new URL(request.url);";

  if(!index.includes(needle)){
    throw new Error(
      "Could not find Worker URL initialization in index.ts."
    );
  }

  index=index.replace(
    needle,
`${needle}

    // V10.9 Adaptive Agent Trust & Risk Engine.
    const riskRouteResponse = await handleRiskRoutes(
      request,
      env,
      url
    );
    if (riskRouteResponse) return riskRouteResponse;`
  );
}

index=index.replace(
  /version:\s*["']v(?:\d+(?:\.\d+)*)["']/g,
  'version: "v10.9"'
);

write(
  "apps/worker/src/index.ts",
  index
);

// ----------------------------------------------------
// 2. Prevent a risk-only STEP_UP from changing limits.
// ----------------------------------------------------
let stepup=read(
  "apps/worker/src/wallets/stepup.ts"
);

const riskGuard=
  'RISK_STEP_UP_REQUIRES_ALLOW_ONCE_OR_REJECT';

if(!stepup.includes(riskGuard)){
  const needle=
    'if(action==="RAISE_LIMIT"){';

  if(!stepup.includes(needle)){
    throw new Error(
      "Could not locate RAISE_LIMIT branch in wallets/stepup.ts."
    );
  }

  stepup=stepup.replace(
    needle,
`if(action==="RAISE_LIMIT"){
    // V10.9: a risk-driven STEP_UP asks for human consent,
    // not more spending authority. It is represented by
    // additional_authority_required = 0.
    if(Number(row.additional_authority_required)===0){
      throw new Error(
        "RISK_STEP_UP_REQUIRES_ALLOW_ONCE_OR_REJECT"
      );
    }`
  );
}

write(
  "apps/worker/src/wallets/stepup.ts",
  stepup
);

console.log(
  "✓ IntentLock V10.9 Adaptive Agent Trust & Risk Engine applied"
);
console.log(
  "✓ Hard policy remains authoritative"
);
console.log(
  "✓ HIGH-risk ALLOW may escalate to explicit ALLOW ONCE"
);
console.log(
  "✓ Risk-only approval cannot raise wallet spending limits"
);
console.log(
  "Next: Neon migration → npm test → deploy Worker."
);
