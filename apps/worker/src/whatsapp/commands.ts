export type WhatsappCommand =
  | {type:"HELP"} | {type:"WALLETS"} | {type:"WALLET"}
  | {type:"USE_WALLET";selector:string} | {type:"STATUS"} | {type:"RESET"}
  | {type:"ALLOW_ONCE"} | {type:"RAISE_LIMIT"} | {type:"REJECT"}
  | {type:"BUY";prompt:string};

export function parseWhatsappCommand(input:string):WhatsappCommand{
  const raw=input.trim();
  const upper=raw.toUpperCase();

  if(!raw || ["HELP","MENU","HI","HELLO","HEY"].includes(upper)) return {type:"HELP"};
  if(upper==="WALLETS") return {type:"WALLETS"};
  if(upper==="WALLET") return {type:"WALLET"};
  if(upper==="STATUS") return {type:"STATUS"};
  if(upper==="RESET") return {type:"RESET"};
  if(["ALLOW ONCE","ALLOW_ONCE","APPROVE ONCE"].includes(upper)) return {type:"ALLOW_ONCE"};
  if(["RAISE LIMIT","RAISE_LIMIT"].includes(upper)) return {type:"RAISE_LIMIT"};
  if(["REJECT","DENY"].includes(upper)) return {type:"REJECT"};

  const use=raw.match(/^use\s+(.+)$/i);
  if(use) return {type:"USE_WALLET",selector:use[1].trim()};

  const buy=raw.match(/^buy\s+(.+)$/is);
  if(buy) return {type:"BUY",prompt:buy[1].trim()};

  return {type:"BUY",prompt:raw};
}
