/** Deterministic browser WebSocket double controlled entirely by a test. */

export class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = FakeWebSocket.CONNECTING;
  readonly OPEN = FakeWebSocket.OPEN;
  readonly CLOSING = FakeWebSocket.CLOSING;
  readonly CLOSED = FakeWebSocket.CLOSED;
  readonly url: string;
  readonly protocol = "";
  readonly extensions = "";
  readonly sent: string[] = [];
  binaryType: BinaryType = "blob";
  bufferedAmount = 0;
  readyState = FakeWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(url: string | URL) {
    super();
    this.url = String(url);
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this.readyState !== FakeWebSocket.OPEN) {
      throw new DOMException("The socket is not open", "InvalidStateError");
    }
    if (typeof data !== "string") {
      throw new TypeError("The realtime page-sync test socket accepts text frames only");
    }
    this.sent.push(data);
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSING;
    this.serverClose(code, reason, true);
  }

  open(): void {
    if (this.readyState !== FakeWebSocket.CONNECTING) {
      throw new Error("Only a connecting fake socket can open");
    }
    this.readyState = FakeWebSocket.OPEN;
    const event = new Event("open");
    this.onopen?.(event);
    this.dispatchEvent(event);
  }

  serverMessage(data: unknown): void {
    if (this.readyState !== FakeWebSocket.OPEN) {
      throw new Error("A closed fake socket cannot receive a server message");
    }
    const event = new MessageEvent("message", {
      data: typeof data === "string" ? data : JSON.stringify(data),
    });
    this.onmessage?.(event);
    this.dispatchEvent(event);
  }

  serverError(): void {
    const event = new Event("error");
    this.onerror?.(event);
    this.dispatchEvent(event);
  }

  serverClose(code = 1006, reason = "", wasClean = false): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    const event = new CloseEvent("close", { code, reason, wasClean });
    this.onclose?.(event);
    this.dispatchEvent(event);
  }
}

export class FakeWebSocketFactory {
  readonly sockets: FakeWebSocket[] = [];

  create = (url: string | URL): WebSocket => {
    const socket = new FakeWebSocket(url);
    this.sockets.push(socket);
    return socket as unknown as WebSocket;
  };

  get latest(): FakeWebSocket {
    const socket = this.sockets.at(-1);
    if (socket === undefined) throw new Error("No fake WebSocket was created");
    return socket;
  }
}
