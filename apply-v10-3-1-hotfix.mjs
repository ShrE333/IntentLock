import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const sourceCatalog = path.join(root, "apps/worker/src/commerce/demo-catalog.ts");
const sourceTest = path.join(root, "apps/worker/src/tests/commerce-connector.test.ts");

if (!fs.existsSync(sourceCatalog)) {
  throw new Error("V10.3 commerce files are missing. Apply V10.3 first.");
}

let catalog = fs.readFileSync(sourceCatalog, "utf8");

catalog = catalog.replace(
  'title: "Boat Nirvana 751 ANC",',
  'title: "Boat Nirvana 751 ANC Wireless Headphones",'
);

catalog = catalog.replace(
  'title: "Bose QuietComfort Demo Listing",',
  'title: "Bose QuietComfort Wireless ANC Headphones",'
);

catalog = catalog.replace(
  'title: "Sony Wireless ANC Special Offer",',
  'title: "Sony Wireless ANC Headphones Special Offer",'
);

catalog = catalog.replace(
  'title: "JBL Tune 770NC",',
  'title: "JBL Tune 770NC Wireless ANC Headphones",'
);

fs.writeFileSync(sourceCatalog, catalog, "utf8");

if (fs.existsSync(sourceTest)) {
  let test = fs.readFileSync(sourceTest, "utf8");
  test = test.replace(
    'const products=await connector.search({query:"headphones",limit:25});',
    'const products=await connector.search({query:"wireless ANC headphones",limit:25});'
  );
  fs.writeFileSync(sourceTest, test, "utf8");
}

console.log("✓ IntentLock V10.3.1 commerce test/search hotfix applied");
console.log("Now run: npm test");
