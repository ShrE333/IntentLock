import type {Metadata} from 'next';
import type {ReactNode} from 'react';
import {Geist,Geist_Mono} from 'next/font/google';
import './globals.css';
import './intentlock-design.css';
import './experience.css';
const geist=Geist({subsets:['latin'],variable:'--font-geist',display:'swap'});
const geistMono=Geist_Mono({subsets:['latin'],variable:'--font-geist-mono',display:'swap'});
export const metadata:Metadata={
 metadataBase:new URL('https://intentlock-web.vercel.app'),
 title:{default:'IntentLock — Financial boundaries for AI agents',template:'%s | IntentLock'},
 description:'An AI can find the deal. It cannot make the rules. Deterministic Intent Wallets, merchant binding, PayPal Sandbox authorization and verified payment evidence.',
 applicationName:'IntentLock',
 openGraph:{type:'website',siteName:'IntentLock',title:'IntentLock — Let AI find the deal. Keep the keys.',description:'The authorization layer between agents and money. Reasoning is not authority.',url:'https://intentlock-web.vercel.app'},
 robots:{index:true,follow:true},
};
export default function RootLayout({children}:{children:ReactNode}){
 return <html lang="en"><body className={`${geist.variable} ${geistMono.variable}`}>{children}</body></html>;
}
