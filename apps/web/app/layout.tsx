import type {Metadata} from 'next';
import type {ReactNode} from 'react';
import {Geist,Geist_Mono} from 'next/font/google';
import './globals.css';
const geist=Geist({subsets:['latin'],variable:'--font-geist',display:'swap'});
const geistMono=Geist_Mono({subsets:['latin'],variable:'--font-geist-mono',display:'swap'});
export const metadata:Metadata={
  metadataBase:new URL('https://intentlock-web.vercel.app'),
  title:{default:'IntentLock — Authorization firewall for AI commerce',template:'%s | IntentLock'},
  description:'AI can choose what to buy. It should not choose what it is allowed to spend. Deterministic Intent Wallets, PayPal sandbox authorization and signed proof of payment.',
  applicationName:'IntentLock',
  openGraph:{type:'website',siteName:'IntentLock',title:'IntentLock — Financial control for AI agents',description:'Reasoning is not authority. Recommendation is not permission. Checkout is not capture.',url:'https://intentlock-web.vercel.app'},
  robots:{index:true,follow:true},
};
export default function RootLayout({children}:{children:ReactNode}){
 return <html lang="en"><body className={`${geist.variable} ${geistMono.variable}`}>{children}</body></html>;
}
