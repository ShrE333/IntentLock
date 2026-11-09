'use client';
// Loaded client-only (dynamic import, ssr:false) because AG Studio touches window/document.
import {useMemo} from 'react';
import {AgStudio,AgStudioProvider} from 'ag-studio-react';
import {studioTheme} from 'ag-studio';
import {REPORT_STATE,toStudioData,type Dataset} from './studio-report';

// Licence is read from the environment at build time; never hardcoded. Without a key
// AG Studio still renders and shows its own unlicensed/trial watermark.
const LICENSE_KEY=process.env.NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY||undefined;

const FONT='var(--font-geist), Geist, Arial, sans-serif';
// IntentLock tokens (apps/web/app/experience.css :root): warm neutral paper, deep forest, citron accent.
const theme=studioTheme.withParams({
  fontFamily:FONT,fontSize:13,accentColor:'#245a47',backgroundColor:'#fcfcf8',foregroundColor:'#151b1b',textColor:'#151b1b',
  subtleTextColor:'#626a66',borderColor:'#d7d9d0',borderRadius:4,
  studioCanvasBackgroundColor:'#f0f0e9',studioCanvasFontFamily:FONT,
  studioWidgetBackgroundColor:'#fcfcf8',studioWidgetBorderRadius:4,studioWidgetBorder:[1,'#d7d9d0'],
  studioWidgetTitleFontFamily:FONT,studioWidgetTitleFontSize:15,studioWidgetTitleFontWeight:650,studioWidgetTitleTextColor:'#151b1b',
  studioWidgetSubtitleFontFamily:FONT,studioWidgetSubtitleFontSize:11,studioWidgetSubtitleTextColor:'#626a66',
  studioValueWidgetFontSize:40,
  studioToggleButtonActiveBackgroundColor:'#dcfb78',studioToggleButtonActiveBorderColor:'#245a47',studioToggleButtonActiveColor:'#151b1b',
  chartFontFamily:FONT,chartTextColor:'#151b1b',chartSubtleTextColor:'#626a66',chartAxisLabelFontFamily:FONT,chartAxisLabelColor:'#4c5850',
  chartAxisLineColor:'#b9bdb3',chartGridLineColor:'#e3e5dc',
  chartPaletteFills1Color:'#245a47',chartPaletteFills2Color:'#c5e84f',chartPaletteFills3Color:'#7aa089',chartPaletteFills4Color:'#c0873a',chartPaletteFills5Color:'#8e3830',chartPaletteFills6Color:'#626a66',
  chartPaletteStrokes1Color:'#173d30',chartPaletteStrokes2Color:'#9bbb2a',chartPaletteStrokes3Color:'#587a66',chartPaletteStrokes4Color:'#966428',chartPaletteStrokes5Color:'#6b2620',chartPaletteStrokes6Color:'#4a514d',
  gridRowHeight:38,gridHeaderBackgroundColor:'#efefe6',
} as never);

export default function StudioView({dataset,editable}:{dataset:Dataset;editable:boolean}){
  const data=useMemo(()=>toStudioData(dataset),[dataset]);
  return <AgStudioProvider licenseKey={LICENSE_KEY}>
    <AgStudio data={data} initialState={REPORT_STATE as never} theme={theme as never} mode={editable?'edit':'view'} style={{height:'100%',width:'100%'}}/>
  </AgStudioProvider>;
}
