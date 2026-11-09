/** Only the original, unique and visible ChatGPT mode button is actionable. */
export function decideAccountModeAction(surface,state){
 if(surface?.chatgpt===true&&surface?.codex===false&&surface?.newChat===true&&surface?.editable===1&&surface?.chatgptControls===1&&state?.switcherClicks===0)return 'open-original-switcher';
 return 'wait';
}
/** Work is not a selection target, even if visible in the same menu. */
export function canChooseOriginalCodex(state){
 return !!(state?.menuOpened===true&&state?.codexVisible===1&&state?.clickedCodex!==true);
}

/** Do not wait indefinitely once the original home is visibly settled. */
export function missingModeSwitcherTooLong(surface,stableMs){
 return !!(surface?.chatgpt===true&&surface?.codex===false&&surface?.newChat===true&&surface?.editable===1&&surface?.chatgptControls!==1&&Number.isFinite(stableMs)&&stableMs>=10000);
}

export function switchUnsettledTooLong(surface,switcher,elapsedMs){
 const ready=surface?.codex===true&&surface?.newChat===true&&surface?.projects===true&&surface?.navigation===true&&surface?.editable===1;return !!(switcher?.clickedCodex===true&&!ready&&Number.isFinite(elapsedMs)&&elapsedMs>=30000);
}

export function classifyObservedWork(work){
 if(work?.enabled===true||work?.ready===true||work?.environmentPresent===true)return 'active';
 if(work?.enabled===false&&work?.ready===false&&work?.environmentPresent===false)return 'disabled';
 return 'unknown';
}
