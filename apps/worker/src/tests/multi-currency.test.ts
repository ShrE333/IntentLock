import {describe,it,expect} from "vitest";
import {createFxQuote} from "../payments/fx";
import {authorizeProductContext} from "../payments/authorization-context";
import {canonicalWalletTransaction,sha256Hex} from "../wallets/crypto";
import {evaluateWalletTransaction} from "../wallets/policy";
import {evaluatePaymentCapability,selectPaymentProvider} from "../session-payments/providers/capabilities";
import type {IntentWallet} from "../wallets/types";
import type {CommerceProduct} from "../commerce/types";

const wallet:IntentWallet={
  walletId:"iw_in",name:"India authority",countryCode:"IN",currency:"INR",
  totalAuthority:10000,spentAmount:0,autoBuyLimit:6000,maxSingleTransaction:7500,
  allowedCategories:["electronics"],allowedBrands:["Sony","Bose"],blockedBrands:["Boat"],
  requiredFeatures:["wireless","ANC"],validUntil:"2099-01-01T00:00:00.000Z",status:"ACTIVE"
};
const product:CommerceProduct={
  id:"sony_us",title:"Sony Wireless ANC",brand:"Sony",category:"electronics",
  merchant:"US Merchant",merchantCountry:"US",price:49,currency:"USD",quantityAvailable:2,
  features:["wireless","ANC"]
};

describe("V11.0.1 multi-currency authorization",()=>{
  it("binds a USD merchant quote into INR wallet authority before policy evaluation",async()=>{
    const normalized=await authorizeProductContext({FX_PROVIDER:"static"},wallet,product);
    expect(normalized.context.presentmentCurrency).toBe("USD");
    expect(normalized.context.walletCurrency).toBe("INR");
    expect(normalized.context.buyerCountry).toBe("IN");
    expect(normalized.context.merchantCountry).toBe("US");
    expect(normalized.context.fxQuote?.source).toBe("DEMO_STATIC");
    expect(normalized.transaction.currency).toBe("INR");
    expect(normalized.transaction.amount).toBe(4091.5);
    expect(evaluateWalletTransaction(wallet,normalized.transaction).decision).toBe("ALLOW");
  });

  it("does not create an FX quote for same-currency authority",async()=>{
    expect(await createFxQuote({FX_PROVIDER:"static"},"INR","INR",5000)).toBeNull();
  });

  it("makes the authorization hash sensitive to FX identity and rate",async()=>{
    const a=await authorizeProductContext({FX_PROVIDER:"static"},wallet,product);
    const hashA=await sha256Hex(canonicalWalletTransaction(a.transaction));
    const changed={...a.transaction,fxQuoteId:"fx_other",fxRate:Number(a.transaction.fxRate)+0.1};
    const hashB=await sha256Hex(canonicalWalletTransaction(changed));
    expect(hashA).not.toBe(hashB);
  });

  it("selects PayPal for EUR even when the wallet itself is INR",()=>{
    const env={
      PAYMENT_PROVIDER:"auto",PAYMENT_PROVIDER_ORDER:"paypal,razorpay",
      PAYPAL_CLIENT_ID:"id",PAYPAL_CLIENT_SECRET:"secret",PAYPAL_ACCEPTED_CURRENCIES:"USD,EUR,GBP",
      RAZORPAY_KEY_ID:"rzp",RAZORPAY_KEY_SECRET:"secret",RAZORPAY_ACCEPTED_CURRENCIES:"INR"
    };
    const selected=selectPaymentProvider(env,{
      amount:59,currency:"EUR",walletCurrency:"INR",buyerCountry:"IN",merchantCountry:"DE"
    });
    expect(selected.provider).toBe("paypal");
  });

  it("routes INR presentment away from PayPal when Razorpay supports it",()=>{
    const env={
      PAYMENT_PROVIDER:"auto",PAYPAL_CLIENT_ID:"id",PAYPAL_CLIENT_SECRET:"secret",
      RAZORPAY_KEY_ID:"rzp",RAZORPAY_KEY_SECRET:"secret",RAZORPAY_ACCEPTED_CURRENCIES:"INR"
    };
    const paypal=evaluatePaymentCapability("paypal",env,{
      amount:1000,currency:"INR",walletCurrency:"INR",buyerCountry:"IN",merchantCountry:"IN"
    });
    expect(paypal.supported).toBe(false);
    expect(selectPaymentProvider(env,{
      amount:1000,currency:"INR",walletCurrency:"INR",buyerCountry:"IN",merchantCountry:"IN"
    }).provider).toBe("razorpay");
  });

  it("falls back when the PayPal seller account has not enabled the presentment currency",()=>{
    const env={
      PAYMENT_PROVIDER:"auto",PAYMENT_PROVIDER_ORDER:"paypal,razorpay",
      PAYPAL_CLIENT_ID:"id",PAYPAL_CLIENT_SECRET:"secret",PAYPAL_ACCEPTED_CURRENCIES:"EUR",
      RAZORPAY_KEY_ID:"rzp",RAZORPAY_KEY_SECRET:"secret",RAZORPAY_ACCEPTED_CURRENCIES:"USD"
    };
    const selected=selectPaymentProvider(env,{
      amount:49,currency:"USD",walletCurrency:"INR",buyerCountry:"IN",merchantCountry:"US"
    });
    expect(selected.provider).toBe("razorpay");
    expect(selected.evaluated[0].reasons).toContain("PAYPAL_ACCOUNT_CURRENCY_NOT_ENABLED:USD");
  });

  it("can enforce buyer and merchant country allowlists independently of currency",()=>{
    const cap=evaluatePaymentCapability("paypal",{
      PAYPAL_CLIENT_ID:"id",PAYPAL_CLIENT_SECRET:"secret",PAYPAL_ACCEPTED_CURRENCIES:"USD",
      PAYPAL_ALLOWED_BUYER_COUNTRIES:"IN,US",PAYPAL_ALLOWED_MERCHANT_COUNTRIES:"US"
    },{amount:49,currency:"USD",walletCurrency:"INR",buyerCountry:"DE",merchantCountry:"US"});
    expect(cap.supported).toBe(false);
    expect(cap.reasons.some(x=>x.startsWith("PAYPAL_COUNTRY_POLICY_BLOCK"))).toBe(true);
  });
});
