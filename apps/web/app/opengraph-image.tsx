import {ImageResponse} from 'next/og';
export const size={width:1200,height:630};
export const contentType='image/png';
export default function Image(){return new ImageResponse(
 <div style={{width:'100%',height:'100%',background:'#F7F6F2',padding:75,display:'flex',flexDirection:'column',justifyContent:'space-between',color:'#0B1220',fontFamily:'sans-serif'}}>
  <div style={{display:'flex',alignItems:'center',gap:16,fontSize:36,fontWeight:700}}><span style={{width:35,height:35,background:'#1F5FE0',borderRadius:9}}/>IntentLock</div>
  <div style={{display:'flex',flexDirection:'column',fontSize:60,lineHeight:1.06,letterSpacing:-1.8,fontWeight:700,maxWidth:1040}}>
   <span>AI can choose what to buy.</span>
   <span>It should not choose what</span>
   <span>it is allowed to spend.</span>
  </div>
  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:19,color:'#0A2540'}}><span>AUTHORIZATION FIREWALL FOR AGENTIC COMMERCE</span><span>PAYPAL SANDBOX · VERIFIED CONTROL</span></div>
 </div>,size);
}
