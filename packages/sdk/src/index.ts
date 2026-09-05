export type IntentLockTransaction = {
  productName?:string;
  category:string;
  brand:string;
  amount:number;
  currency:string;
  quantity:number;
  features:string[];
};

export type IntentLockAuthorizeInput = {
  idempotencyKey:string;
  agentId:string;
  walletId:string;
  merchant:string;
  transaction:IntentLockTransaction;
  quoteHash?:string;
};

export type IntentLockAuthorizeResult = {
  requestId:string;
  idempotent:boolean;
  decision:"ALLOW"|"STEP_UP"|"BLOCK";
  walletId:string;
  agentId:string;
  merchant:string;
  quoteHash:string;
  violations:string[];
  reasons:string[];
  remainingAuthority:number;
  additionalAuthorityRequired:number;
  stepUpRequestId:string|null;
  authorization:{
    authorizationId:string;
    token:string;
    expiresAt:string;
  }|null;
};

export class IntentLockClient{
  constructor(
    private readonly options:{
      baseUrl:string;
      apiKey:string;
      fetcher?:typeof fetch;
    }
  ){}

  private async request<T>(
    path:string,
    init:RequestInit
  ):Promise<T>{
    const fetcher=this.options.fetcher??globalThis.fetch.bind(globalThis);

    const response=await fetcher(
      `${this.options.baseUrl.replace(/\/+$/,"")}${path}`,
      {
        ...init,
        headers:{
          "content-type":"application/json",
          "authorization":`Bearer ${this.options.apiKey}`,
          ...(init.headers??{})
        }
      }
    );

    const body:any=await response.json();

    if(!response.ok){
      throw new Error(
        body?.message ??
        body?.error ??
        `IntentLock HTTP ${response.status}`
      );
    }

    return body as T;
  }

  authorize(input:IntentLockAuthorizeInput){
    return this.request<IntentLockAuthorizeResult>(
      "/v1/authorize",
      {
        method:"POST",
        body:JSON.stringify(input)
      }
    );
  }

  verify(token:string){
    return this.request<{
      valid:boolean;
      reason?:string;
      payload?:Record<string,unknown>;
    }>(
      "/v1/verify",
      {
        method:"POST",
        body:JSON.stringify({token})
      }
    );
  }
}
