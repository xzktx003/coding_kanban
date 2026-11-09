import net from 'node:net';
import {chmodSync} from 'node:fs';
const socketPath=process.argv[3];
const sockets=new Set();
const server=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('data',data=>socket.write(data));});
server.listen(socketPath,()=>{chmodSync(socketPath,0o600);process.send?.({ready:true});});
process.on('SIGTERM',()=>{for(const socket of sockets)socket.destroy();server.close(()=>process.exit(0));});
