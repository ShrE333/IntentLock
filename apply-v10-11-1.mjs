import fs from "node:fs";
import path from "node:path";

const root=process.cwd();

const globalCss=path.join(
  root,
  "apps/web/app/globals.css"
);

const patchCss=path.join(
  root,
  "v10_11_1_forms_flow.css"
);

const flowPage=path.join(
  root,
  "apps/web/app/how-it-works/page.tsx"
);

if(!fs.existsSync(globalCss)){
  throw new Error(
    "apps/web/app/globals.css not found. Run from D:\\IntentLock."
  );
}

if(!fs.existsSync(patchCss)){
  throw new Error(
    "v10_11_1_forms_flow.css not found. Extract the patch over D:\\IntentLock first."
  );
}

if(!fs.existsSync(flowPage)){
  throw new Error(
    "Updated how-it-works page was not extracted."
  );
}

let css=fs.readFileSync(globalCss,"utf8");
const patch=fs.readFileSync(patchCss,"utf8");

const start="/* === V10.11.1 PATCH START === */";
const end="/* === V10.11.1 PATCH END === */";

const block=`${start}\n${patch}\n${end}`;

if(css.includes(start)){
  const a=css.indexOf(start);
  const b=css.indexOf(end,a);

  if(b<0){
    throw new Error(
      "Existing V10.11.1 CSS marker is incomplete."
    );
  }

  css=
    css.slice(0,a)+
    block+
    css.slice(b+end.length);
}else{
  css=`${css.trimEnd()}\n\n${block}\n`;
}

fs.writeFileSync(
  globalCss,
  css,
  "utf8"
);

console.log("✓ V10.11.1 form polish applied");
console.log("✓ New Purchase inputs/selects/textarea styled");
console.log("✓ Intent Wallet form + wallet cards styled");
console.log("✓ How-it-works flow rail installed");
console.log("");
console.log("Next:");
console.log("npm --workspace apps/web run build");
console.log("npm --workspace apps/web run dev");
