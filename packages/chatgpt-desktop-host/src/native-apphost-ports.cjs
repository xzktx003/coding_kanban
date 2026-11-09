"use strict";

// Own only the AppHost port transferred by the private preload for this view.
function createOwnedAppHostPorts({getOwnedRecord, output, fail}) {
  const records = new WeakMap(), heldPorts = new WeakSet();
  const current = (record, portId, entry) => {
    try {
      return !record.failed && !record.window.isDestroyed() &&
        getOwnedRecord(record.window.webContents) === record && records.get(record)?.get(portId) === entry;
    } catch { return false; }
  };
  function detach(record, portId, entry) {
    if (records.get(record)?.get(portId) !== entry) return false;
    records.get(record).delete(portId); heldPorts.delete(entry.port);
    entry.port.removeListener('message', entry.onMessage);
    entry.port.removeListener('close', entry.onClose);
    entry.port.removeListener('messageerror', entry.onError);
    record.ports.delete(portId);
    return true;
  }
  function closeTransferred(ports) {
    if (!Array.isArray(ports)) return;
    for (const port of ports) {
      try { if (port && !heldPorts.has(port)) port.close(); } catch {}
    }
  }
  function adopt(event, payload) {
    let record, port, id, portId;
    try {
      const fields = payload && Object.getOwnPropertyDescriptors(payload);
      id = fields?.id?.value; portId = fields?.portId?.value;
      if (!fields || Object.keys(fields).sort().join(',') !== 'id,portId' ||
          !Object.hasOwn(fields.id, 'value') || !Object.hasOwn(fields.portId, 'value') ||
          !Number.isSafeInteger(id) || id < 1 || typeof portId !== 'string' || !/^app-host-[1-9][0-9]*$/.test(portId) ||
          !event?.sender || event.senderFrame !== event.sender.mainFrame ||
          !Array.isArray(event.ports) || event.ports.length !== 1) throw Error('Invalid transfer');
      record = getOwnedRecord(event.sender); port = event.ports[0];
      const pending = record?.pending.get(id);
      if (!record || record.failed || !record.bootstrapped || record.window.isDestroyed() ||
          record.window.webContents !== event.sender || record.senderId !== event.sender.id ||
          !pending || pending.type !== 'openPort' || pending.portId !== portId || !record.ports.has(portId) ||
          !port || heldPorts.has(port) || records.get(record)?.has(portId)) throw Error('Unowned transfer');
    } catch { closeTransferred(event?.ports); return false; }
    const map = records.get(record) ?? new Map(); records.set(record,map);
    const entry = {port};
    const closed = () => {
      if (!current(record,portId,entry)) return;
      detach(record,portId,entry);
      try { port.close(); output(record,{type:'portClosed',portId}); } catch { fail(record); }
    };
    entry.onMessage = event => {
      if (!current(record,portId,entry)) return;
      try { output(record,{type:'portMessage',portId,data:event.data}); } catch { fail(record); }
    };
    entry.onClose = closed; entry.onError = closed;
    try {
      map.set(portId,entry); heldPorts.add(port);
      port.on('message',entry.onMessage); port.on('close',entry.onClose); port.on('messageerror',entry.onError);
      port.start();
      record.pending.delete(id);
      output(record,{type:'return',id,value:undefined});
      return true;
    } catch {
      detach(record,portId,entry);
      try { port.close(); } catch {}
      fail(record);
      return false;
    }
  }
  function dispatch(record, message) {
    const {id,portId,type} = message, entry = records.get(record)?.get(portId);
    const pending = record.pending.get(id);
    if (!entry || !current(record,portId,entry) || !pending || pending.type !== type || pending.portId !== portId ||
        (type !== 'portPost' && type !== 'closePort')) throw Error('Unknown owned port');
    try {
      if (type === 'portPost') entry.port.postMessage(message.data);
      else { detach(record,portId,entry); entry.port.close(); }
    } catch {
      record.pending.delete(id); output(record,{type:'throw',id}); return;
    }
    record.pending.delete(id); output(record,{type:'return',id,value:undefined});
  }
  function retire(record) {
    const map = records.get(record);
    if (!map) return;
    for (const [portId,entry] of map) {
      detach(record,portId,entry);
      try { entry.port.close(); } catch {}
    }
    records.delete(record);
  }
  return Object.freeze({adopt,dispatch,retire});
}
module.exports = {createOwnedAppHostPorts};
