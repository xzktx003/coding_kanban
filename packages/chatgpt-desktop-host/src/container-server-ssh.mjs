const fail=()=>Object.assign(new Error('Private SSH client configuration invalid'),{code:'CONTAINER_SSH_INVALID_CONFIG'});
/** Fixed new-host constructor option; never installs a server or accepts a path. */
export function containerServerSshOption(options){
 const descriptor=Object.getOwnPropertyDescriptor(options,'serverSsh');
 if(!descriptor)return undefined;
 if(!Object.hasOwn(descriptor,'value')||(descriptor.value!==undefined&&typeof descriptor.value!=='boolean'))throw fail();
 return descriptor.value===true?true:undefined;
}
