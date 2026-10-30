let owner:symbol|null=null;
/** One same-page owner; Web Locks additionally provide same-origin cross-page exclusion when supported. */
export async function claimMicrophone(signal:AbortSignal):Promise<()=>void>{
 signal.throwIfAborted();if(owner)throw new Error("麦克风正由另一个听写或语音会话使用，请先结束它。");const token=Symbol("microphone");owner=token;
 let released=false,releaseLock:(()=>void)|undefined;
 const release=()=>{if(released)return;released=true;if(owner===token)owner=null;releaseLock?.();signal.removeEventListener("abort",release);};
 signal.addEventListener("abort",release,{once:true});
 if(navigator.locks?.request){try{await new Promise<void>((resolve,reject)=>{void navigator.locks.request("kanban-session-microphone",{ifAvailable:true},async lock=>{if(!lock){reject(new Error("另一个页面正在使用麦克风，请先结束它。"));return;}await new Promise<void>(done=>{releaseLock=done;if(released){done();reject(signal.reason??new Error("麦克风请求已取消"));}else resolve();});}).catch(reject);});}catch(error){release();throw error;}}
 signal.throwIfAborted();return release;
}
