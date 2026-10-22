// Reference tokens for adopting Tailwind in additional UI sections.
// The current redesign uses the exact same CSS variables directly so existing
// pages keep working without introducing additional runtime dependencies.
export default {
 content:['./app/**/*.{js,ts,jsx,tsx,mdx}'],
 theme:{extend:{colors:{paper:'#F7F6F2',ink:'#0B1220',navy:'#0A2540',accent:'#1F5FE0',hairline:'#E3E1DA',allow:'#0F7B4F',allowBg:'#E3F4EC',stepUp:'#9A5B00',stepUpBg:'#FCEFD6',block:'#B42318',blockBg:'#FDE7E4'},borderRadius:{sm:'6px',md:'10px',lg:'16px'},fontFamily:{sans:['var(--font-geist)','sans-serif'],mono:['var(--font-geist-mono)','monospace']}}},
 plugins:[]
};
