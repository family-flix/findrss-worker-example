export class WorkerSocket {
  constructor(hub, attachment) {
    this.hub = hub;
    this.attachment = attachment;
  }
  deserializeAttachment() {
    return {
      ...this.attachment
    };
  }
  serializeAttachment(value) {
    this.attachment = value;
    return this.hub.stub.update(value.connection_id, value);
  }
  send(message) {
    return this.hub.stub.send(this.attachment.connection_id, message);
  }
  close(code, reason) {
    return this.hub.stub.close_connection(this.attachment.connection_id, code, reason);
  }
}
export class WorkerSocketHub {
  constructor(stub) {
    this.stub = stub;
  }
  async get_all() {
    return (await this.stub.connections()).map(value => new WorkerSocket(this, value));
  }
  async get_for_device(id) {
    return (await this.get_all()).filter(socket => socket.attachment.device_id === id);
  }
  async get_for_method(method) {
    return (await this.get_all()).filter(socket => socket.attachment.methods.includes(method));
  }
  close(socket, code, reason) {
    return socket.close(code, reason);
  }
  send(socket, value) {
    return socket.send(JSON.stringify(value));
  }
  async wait(id, timeout, signal) {
    signal?.throwIfAborted();
    const waiter_id = crypto.randomUUID();
    const pending = this.stub.wait(id, timeout, waiter_id);
    const cancel = async () => {
      try {
        await this.stub.cancel_wait(id, waiter_id);
      } catch (error) {
        console.warn('等待器取消失败', error.message);
      }
    };
    signal?.addEventListener('abort', cancel, {
      once: true
    });
    try {
      const row = await pending;
      signal?.throwIfAborted();
      return row;
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
  }
  resolve(id, value) {
    return this.stub.resolve(id, value);
  }
}
export class WorkerAdminEvents {
  constructor(stub) {
    this.stub = stub;
  }
  async invalidate(type, id = null) {
    await this.stub.broadcast(type, id);
  }
}
