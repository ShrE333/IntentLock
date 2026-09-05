import fs from "node:fs";
import path from "node:path";

const workerDir=path.join(
  process.cwd(),
  "apps/worker"
);

const candidates=[
  "wrangler.toml",
  "wrangler.jsonc",
  "wrangler.json"
];

const found=candidates
  .map(name=>path.join(workerDir,name))
  .find(file=>fs.existsSync(file));

if(!found){
  throw new Error(
    "No wrangler.toml / wrangler.jsonc / wrangler.json found in apps/worker."
  );
}

let text=fs.readFileSync(
  found,
  "utf8"
);

if(
  text.includes("intentlock-purchase-jobs") ||
  text.includes("PURCHASE_QUEUE")
){
  console.log(
    "✓ Queue configuration already appears to be present:"
  );
  console.log(found);
  process.exit(0);
}

if(found.endsWith(".toml")){
  text=text.trimEnd()+`

[[queues.producers]]
binding = "PURCHASE_QUEUE"
queue = "intentlock-purchase-jobs"

[[queues.consumers]]
queue = "intentlock-purchase-jobs"
max_batch_size = 1
max_batch_timeout = 1
max_retries = 5
retry_delay = 3
`;

  fs.writeFileSync(
    found,
    text,
    "utf8"
  );

  console.log(
    "✓ Added Queue producer + single-message consumer to wrangler.toml"
  );
  console.log(found);
  process.exit(0);
}

if(found.endsWith(".json")){
  const config=JSON.parse(text);

  config.queues={
    ...(config.queues??{}),
    producers:[
      ...(config.queues?.producers??[]),
      {
        binding:"PURCHASE_QUEUE",
        queue:"intentlock-purchase-jobs"
      }
    ],
    consumers:[
      ...(config.queues?.consumers??[]),
      {
        queue:"intentlock-purchase-jobs",
        max_batch_size:1,
        max_batch_timeout:1,
        max_retries:5,
        retry_delay:3
      }
    ]
  };

  fs.writeFileSync(
    found,
    JSON.stringify(config,null,2)+"\n",
    "utf8"
  );

  console.log(
    "✓ Added Queue configuration to wrangler.json"
  );
  console.log(found);
  process.exit(0);
}

// JSONC: preserve comments and insert a root-level queues property.
// This handles the common Wrangler JSONC shape without rewriting comments.
const close=text.lastIndexOf("}");

if(close<0){
  throw new Error(
    "wrangler.jsonc does not contain a closing root object."
  );
}

const before=text.slice(0,close);
const after=text.slice(close);

const trimmed=before.trimEnd();
const separator=
  trimmed.endsWith("{") ||
  trimmed.endsWith(",")
    ?""
    :",";

const queueBlock=`
${separator}
  "queues": {
    "producers": [
      {
        "binding": "PURCHASE_QUEUE",
        "queue": "intentlock-purchase-jobs"
      }
    ],
    "consumers": [
      {
        "queue": "intentlock-purchase-jobs",
        "max_batch_size": 1,
        "max_batch_timeout": 1,
        "max_retries": 5,
        "retry_delay": 3
      }
    ]
  }
`;

text=
  before.trimEnd()+
  queueBlock+
  after;

fs.writeFileSync(
  found,
  text,
  "utf8"
);

console.log(
  "✓ Added Queue configuration to wrangler.jsonc"
);
console.log(found);
