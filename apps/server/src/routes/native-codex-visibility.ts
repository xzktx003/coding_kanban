import type {IncomingMessage} from "node:http";
import type {FastifyInstance,FastifyRequest} from "fastify";
import WebSocket,{WebSocketServer} from "ws";
import type {NativeCodexGateway} from "../services/native-codex-gateway.js";

export interface NativeVisibilityController {
  profileId:string;
  snapshot():{available:boolean};
  attach(input:{origin:string;instanceId:string;leaseId?:string;token?:string},hooks:{assertCurrent():Promise<void>;onReplaced():void}):Promise<{
    identity:{leaseId:string;token:string};
    update(value:{sequence:number;threadIds:string[]}):Promise<unknown>;
    disconnect():void;
  }>;
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const NATIVE_VISIBILITY_MESSAGE_BYTES=8192;

/** Only an explicitly registered profile may publish visible thread UUIDs. */
export async function registerNativeCodexVisibility(app:FastifyInstance,options:{
  profileId:string;controller:NativeVisibilityController;
  gateway:Pick<NativeCodexGateway,"instanceStatus">;
  sameOrigin(request:FastifyRequest):boolean;
}) {
  const {profileId,controller,gateway}=options;
  if(!UUID.test(profileId)||controller.profileId!==profileId)throw Error("exact registered visibility profile required");
  const path=`/api/native-codex/clients/${profileId}/visibility`;
  const wss=new WebSocketServer({noServer:true,maxPayload:NATIVE_VISIBILITY_MESSAGE_BYTES,perMessageDeflate:false});
  const heads=new WeakMap<IncomingMessage,Buffer>(),alive=new WeakSet<WebSocket>();
  const capture=(request:IncomingMessage,_socket:unknown,head:Buffer)=>{
    if(request.url?.split("?",1)[0]===path)heads.set(request,head);
  };
  app.server.prependListener("upgrade",capture);
  const heartbeat=setInterval(()=>{
    for(const client of wss.clients){if(!alive.has(client))client.terminate();else{alive.delete(client);client.ping()}}
  },30000);heartbeat.unref();
  app.addHook("preClose",async()=>{clearInterval(heartbeat);for(const client of wss.clients)client.terminate()});
  app.addHook("onClose",async()=>{
    app.server.removeListener("upgrade",capture);
    await new Promise<void>(resolve=>wss.close(()=>resolve()));
  });
  const connected=(client:WebSocket,request:FastifyRequest)=>{
    if(wss.clients.size>64){client.close(1013,"Visibility connection budget exceeded");return}
    alive.add(client);client.on("pong",()=>alive.add(client));
    let handle:Awaited<ReturnType<NativeVisibilityController["attach"]>>|undefined;
    let busy=false,ended=false;
    const timer=setTimeout(()=>client.close(1008,"Visibility hello required"),5000);timer.unref();
    const send=(value:unknown)=>{
      if(ended||client.readyState!==WebSocket.OPEN)return;
      const body=JSON.stringify(value);
      if(client.bufferedAmount+Buffer.byteLength(body)>NATIVE_VISIBILITY_MESSAGE_BYTES){client.close(1009,"Visibility receiver queue exceeded");return}
      client.send(body,error=>{if(error)client.terminate()});
    };
    client.on("error",()=>client.terminate());
    client.once("close",()=>{ended=true;clearTimeout(timer);handle?.disconnect()});
    client.on("message",(bytes,binary)=>{
      if(ended)return;
      if(binary){client.close(1003,"Visibility metadata must be text");return}
      if(busy){client.close(1013,"Visibility operation pending");return}
      let value:Record<string,unknown>;
      try{
        value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes as ArrayBuffer)));
        if(!value||typeof value!=="object"||Array.isArray(value))throw Error("metadata required");
      }catch{client.close(1008,"Invalid visibility metadata");return}
      busy=true;
      void(async()=>{
        if(!handle){
          const resume=Object.hasOwn(value,"leaseId")||Object.hasOwn(value,"token");
          if(value.type!=="hello"||Object.keys(value).sort().join(",")!==(resume?"instanceId,leaseId,token,type":"instanceId,type")||typeof value.instanceId!=="string"||!UUID.test(value.instanceId))throw Error("exact visibility hello required");
          const instanceId=value.instanceId;
          const assertCurrent=async()=>{
            if(ended)throw Error("visibility page disconnected");
            const status=await gateway.instanceStatus({instanceId});
            if(ended||status.status!==200||status.active!==true)throw Error("visibility native instance unavailable");
          };
          handle=await controller.attach({origin:request.headers.origin!,instanceId,
            ...(resume?{leaseId:value.leaseId as string,token:value.token as string}:{})},
            {assertCurrent,onReplaced:()=>client.close(1008,"Visibility connection replaced")});
          clearTimeout(timer);
          if(ended){handle.disconnect();return}
          send({type:"hello",...handle.identity});
        }else{
          if(value.type!=="visible"||Object.keys(value).sort().join(",")!=="sequence,threadIds,type")throw Error("exact visible threads required");
          await handle.update({sequence:value.sequence as number,threadIds:value.threadIds as string[]});
          send({type:"ack",sequence:value.sequence});
        }
      })().catch(error=>{
        send({type:"error",code:error?.code==="VISIBILITY_LEASE_UNAVAILABLE"?"lease-unavailable":"unavailable"});
        client.close(1008,"Visibility protection unavailable");
      }).finally(()=>{busy=false});
    });
  };
  await app.register(async scope=>{
    scope.addHook("onRequest",async(request,reply)=>{
      reply.header("cache-control","no-store");
      if(typeof request.headers.origin!=="string"||!options.sameOrigin(request))return reply.code(403).send({error:"Visibility requires same-origin access."});
      if(request.raw.url!==path||request.headers["sec-websocket-protocol"]!==undefined)return reply.code(400).send({error:"Invalid visibility connection."});
    });
    scope.addHook("onRoute",route=>{
      if(route.method!=="GET")return;
      const ordinary=route.handler;
      route.handler=function(request,reply){
        if(!request.ws)return ordinary.call(this,request,reply);
        reply.hijack();const head=heads.get(request.raw)??Buffer.alloc(0);heads.delete(request.raw);
        wss.handleUpgrade(request.raw,request.raw.socket,head,client=>connected(client,request));
      };
    });
    scope.get(path,async(_request,reply)=>reply.code(426).send({error:"Visibility requires WebSocket."}));
  });
}
