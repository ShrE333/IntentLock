import {Agent,callable} from "agents";
import {searchCatalog} from "../catalog/mock";
import {evaluatePurchase} from "../policy/engine";
import {IntentContractSchema,PurchaseProposalSchema,type IntentContract} from "../types/contracts";
type AgentState={intent?:IntentContract;lastDecision?:string};
export class PurchaseAgent extends Agent<Env,AgentState>{
 initialState:AgentState={};
 @callable() setIntent(rawIntent:unknown){const intent=IntentContractSchema.parse(rawIntent);this.setState({...this.state,intent});return intent;}
 @callable() searchProducts(category:string){return searchCatalog(category);}
 @callable() evaluate(rawProposal:unknown,approved=false){if(!this.state.intent)throw new Error("No Intent Contract has been created.");const proposal=PurchaseProposalSchema.parse(rawProposal);const result=evaluatePurchase(this.state.intent,proposal,approved);this.setState({...this.state,lastDecision:result.code});return result;}
}
