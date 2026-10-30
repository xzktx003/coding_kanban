/** Native IDs are scoped to one process; they are never a standalone UI identity. */
export function acpDraftSessionId(nativeSessionId:string|null,historySessionId:string|null|undefined,connectionId:string|null){
 return historySessionId??(nativeSessionId&&connectionId?`connection:${connectionId}:session:${nativeSessionId}`:null);
}
