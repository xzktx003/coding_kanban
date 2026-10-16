// Exact extracted lx body with original icon/formatter/Intl primitives; not the full native transcript.
import * as Core from './assets/app-initial-c4ebaa710049.js';
import * as Native from './assets/app-initial-41ab338a184f.js';
import * as Composer from './assets/app-initial-fee819fe4f22.js';
import * as Checkmark from './assets/checkmark-circle-light-20-eed3d3a99d50.js';
Core.e3(); Checkmark.n(); Composer.wdt();
const gx=Core.tLt(),Y=Core.$At(),ua=Composer.nDt,j=Core.Fbt,iu=Native.eg,r=Core.$4,vg=Checkmark.t;
function lx(e){let t=(0,gx.c)(6),{goal:n}=e,i;t[0]===Symbol.for(`react.memo_cache_sentinel`)?(i=(0,Y.jsx)(`span`,{className:`h-3 border-s border-default`}),t[0]=i):i=t[0];let a;t[1]===Symbol.for(`react.memo_cache_sentinel`)?(a=(0,Y.jsx)(ua,{className:`shrink-0`,"aria-hidden":!1,icon:{assets:{16:r,20:vg}}}),t[1]=a):a=t[1];let o=n.timeUsedSeconds*1e3,s;t[2]===o?s=t[3]:(s=iu(o),t[2]=o,t[3]=s);let c;return t[4]===s?c=t[5]:(c=(0,Y.jsxs)(`span`,{className:`ms-1.5 flex h-full items-center gap-1.5 text-xs leading-5 text-tertiary`,children:[i,a,(0,Y.jsx)(j,{id:`assistantMessageContent.goalAchieved`,defaultMessage:`Goal achieved in {totalTime}`,description:`Assistant action row label shown when a thread goal was completed`,values:{totalTime:s}})]}),t[4]=s,t[5]=c),c}

window.renderNativeGoalCompletion=(goal={timeUsedSeconds:3661})=>{const {R,root,wrap}=window.nativeGoalCore;root.render(wrap(R.createElement(lx,{goal})));};
