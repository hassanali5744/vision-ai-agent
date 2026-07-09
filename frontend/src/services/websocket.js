class WebSocketService {
  constructor() {
    this.socket = null;
    this.url = "ws://localhost:8000/ws/sync";
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.listeners = new Set();
    this.connected = false;
    this.status = "disconnected";
    this.sessionId = "default";
    this.refCount = 0;
    this.heartbeatTimer = null;
    this.pongTimeoutTimer = null;
    this.pongReceived = false;
  }

  setSessionId(sessionId) {
    this.sessionId = sessionId;
  }

  connect(sessionId = this.sessionId) {
    this.sessionId = sessionId;
    this.refCount++;
    console.log(`[WS] Connect called. refCount: ${this.refCount}, sessionId: ${sessionId}`);

    if (this.refCount === 1) {
      this._establishConnection();
    } else {
      this.emit("status", this.status);
    }
  }

  disconnect() {
    if (this.refCount > 0) {
      this.refCount--;
    }
    console.log(`[WS] Disconnect called. refCount: ${this.refCount}`);

    if (this.refCount === 0) {
      this._closeConnection();
    }
  }

  _establishConnection() {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.status = "connecting";
    this.emit("status", this.status);

    const targetUrl = `${this.url}?session_id=${encodeURIComponent(this.sessionId)}`;
    this.socket = new WebSocket(targetUrl);

    this.socket.onopen = () => {
      this.connected = true;
      this.status = "connected";
      this.reconnectAttempts = 0;
      this.emit("status", this.status);
      this.emit("open");
      this.startHeartbeat();
    };

    this.socket.onmessage = (event) => {
      try {
        const payload = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (payload.type === "pong") {
          this.pongReceived = true;
          if (this.pongTimeoutTimer) {
            window.clearTimeout(this.pongTimeoutTimer);
            this.pongTimeoutTimer = null;
          }
          return;
        }
        this.emit("message", payload);
      } catch (error) {
        console.error("[WS] Failed to parse message", error);
      }
    };

    this.socket.onerror = (error) => {
      console.error("[WS] Socket error", error);
      this.emit("error", error);
    };

    this.socket.onclose = () => {
      this.connected = false;
      this.status = "disconnected";
      this.emit("status", this.status);
      this.emit("close");
      this.stopHeartbeat();

      if (this.refCount > 0) {
        this.scheduleReconnect();
      }
    };
  }

  _closeConnection() {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = this.maxReconnectAttempts;
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.connected = false;
    this.status = "disconnected";
    this.emit("status", this.status);
  }

  send(payload) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.warn("[WS] Socket not connected; dropping message", payload);
      return false;
    }

    this.socket.send(JSON.stringify(payload));
    return true;
  }

  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  emit(eventName, payload) {
    for (const callback of this.listeners) {
      callback(eventName, payload);
    }
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.pongReceived = false;
        this.send({ type: "ping", timestamp: Date.now() });

        this.pongTimeoutTimer = window.setTimeout(() => {
          if (!this.pongReceived) {
            console.warn("[WS] Heartbeat timeout (no pong received), closing connection");
            if (this.socket) {
              this.socket.close();
            }
          }
        }, 5000);
      }
    }, 15000);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pongTimeoutTimer) {
      window.clearTimeout(this.pongTimeoutTimer);
      this.pongTimeoutTimer = null;
    }
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      return;
    }

    this.reconnectAttempts += 1;
    this.status = "connecting";
    this.emit("status", this.status);

    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
    }
    this.reconnectTimer = window.setTimeout(() => {
      if (this.refCount > 0) {
        this._establishConnection();
      }
    }, 1000 * this.reconnectAttempts);
  }
}

const websocketService = new WebSocketService();

export const connectWebSocket = (sessionId = "default") => websocketService.connect(sessionId);
export const disconnectWebSocket = () => websocketService.disconnect();
export const sendWebSocketMessage = (payload) => websocketService.send(payload);
export const subscribeToWebSocket = (callback) => websocketService.subscribe(callback);
export const getWebSocketStatus = () => ({
  connected: websocketService.connected,
  status: websocketService.status,
});
export default websocketService;

