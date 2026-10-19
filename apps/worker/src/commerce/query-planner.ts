const CONTROL_PHRASES=[
  /\bfind\s+me\b/gi,
  /\bsearch\s+for\b/gi,
  /\blook\s+for\b/gi,
  /\bshow\s+me\b/gi,
  /\bbuy\s+automatically\s+if\s+allowed\b/gi,
  /\bbuy\s+automatically\b/gi,
  /\bpurchase\s+automatically\b/gi,
  /\bif\s+allowed\b/gi,
  /\bfor\s+me\b/gi,
  /\bplease\b/gi,
  /\bI\s+(?:want|need|would\s+like)\b/gi
];

const CONTROL_WORDS=new Set([
  "find","search","look","show","buy","purchase","automatically","automatic",
  "allowed","allow","please","need","want","would","like","me","for","the","a","an"
]);

function cleanWhitespace(value:string){
  return value.replace(/\s+/g," ").trim();
}

/**
 * Converts a natural-language purchase instruction into a commerce discovery query.
 *
 * Important invariant: this function does NOT inject wallet policy (allowed brands,
 * categories, limits, etc.) into discovery. Search finds candidates; policy decides
 * whether those candidates are financially authorized afterwards.
 */
export function planCommerceSearchQuery(input:string){
  let value=String(input??"");
  for(const pattern of CONTROL_PHRASES) value=value.replace(pattern," ");

  // Remove common budget-control phrases that harm marketplace keyword search.
  // Product model numbers are preserved because only numbers immediately following
  // budget words are stripped.
  value=value.replace(
    /\b(?:under|below|up\s+to|less\s+than|max(?:imum)?|budget(?:\s+of)?)\s*(?:₹|\$|€|£|INR|USD|EUR|GBP)?\s*\d+(?:[.,]\d+)?(?:\s*(?:k|thousand))?\b/gi,
    " "
  );

  value=value
    .replace(/[₹$€£,.:;!?()[\]{}"']/g," ")
    .replace(/\b(?:or|and)\b/gi," ");

  const tokens=cleanWhitespace(value)
    .split(" ")
    .map(x=>x.trim())
    .filter(Boolean)
    .filter(x=>!CONTROL_WORDS.has(x.toLowerCase()));

  // Stable de-duplication without lower-casing product/model names.
  const seen=new Set<string>();
  const unique:string[]=[];
  for(const token of tokens){
    const key=token.toLowerCase();
    if(seen.has(key)) continue;
    seen.add(key);
    unique.push(token);
  }

  const query=cleanWhitespace(unique.join(" "));
  return query || cleanWhitespace(String(input??""));
}
