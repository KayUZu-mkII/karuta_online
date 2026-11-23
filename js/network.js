/**
 * KarutaNetwork: PeerJSを利用したルーム式P2Pマッチング管理
 */
(function (global) {
  const PEER_PREFIX = 'MIYABI-KARUTA-';

  class KarutaNetwork {
    constructor(handlers = {}) {
      this.peer = null;
      this.role = null; // 'host' | 'guest'
      this.roomCode = null;
      this.connections = new Map(); // host: peerId -> DataConnection
      this.hostConn = null; // guest: DataConnection
      this.handlers = handlers;
    }

    isAvailable() {
      return typeof global.Peer === 'function';
    }

    generateRoomCode() {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let code = '';
      for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return code;
    }

    destroy() {
      try {
        this.connections.forEach((conn) => conn.close());
        this.connections.clear();
        if (this.hostConn) {
          this.hostConn.close();
          this.hostConn = null;
        }
        if (this.peer) {
          this.peer.destroy();
          this.peer = null;
        }
      } catch (_) {}
      this.role = null;
      this.roomCode = null;
    }

    createRoom(playerName) {
      return new Promise((resolve, reject) => {
        if (!this.isAvailable()) {
          reject(new Error('PeerJSライブラリが読み込まれていません。'));
          return;
        }
        this.destroy();
        this.role = 'host';
        const code = this.generateRoomCode();
        this.roomCode = code;
        const peerId = PEER_PREFIX + code;

        const peer = new global.Peer(peerId, { debug: 1 });
        this.peer = peer;

        const timeout = setTimeout(() => {
          reject(new Error('ルーム作成がタイムアウトしました。ネットワーク状態を確認してください。'));
        }, 12000);

        peer.on('open', (id) => {
          clearTimeout(timeout);
          resolve({ roomCode: code, peerId: id });
        });

        peer.on('connection', (conn) => {
          conn.on('open', () => {
            this.connections.set(conn.peer, conn);
            if (this.handlers.onPeerConnected) {
              this.handlers.onPeerConnected(conn.peer);
            }
          });
          conn.on('data', (data) => {
            if (this.handlers.onMessage) {
              this.handlers.onMessage(data, conn.peer);
            }
          });
          conn.on('close', () => {
            this.connections.delete(conn.peer);
            if (this.handlers.onPeerDisconnected) {
              this.handlers.onPeerDisconnected(conn.peer);
            }
          });
          conn.on('error', () => {
            this.connections.delete(conn.peer);
          });
        });

        peer.on('error', (err) => {
          clearTimeout(timeout);
          if (this.handlers.onError) this.handlers.onError(err);
          reject(err);
        });
      });
    }

    joinRoom(roomCode, playerName) {
      return new Promise((resolve, reject) => {
        if (!this.isAvailable()) {
          reject(new Error('PeerJSライブラリが読み込まれていません。'));
          return;
        }
        const cleanCode = String(roomCode || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (cleanCode.length < 4) {
          reject(new Error('正しいルームIDを入力してください。'));
          return;
        }
        this.destroy();
        this.role = 'guest';
        this.roomCode = cleanCode;

        const peer = new global.Peer({ debug: 1 });
        this.peer = peer;

        const timeout = setTimeout(() => {
          reject(new Error('ルームへの接続がタイムアウトしました。ルームIDを確認してください。'));
        }, 12000);

        peer.on('open', (myId) => {
          const targetId = PEER_PREFIX + cleanCode;
          const conn = peer.connect(targetId, { reliable: true });
          this.hostConn = conn;

          conn.on('open', () => {
            clearTimeout(timeout);
            conn.send({ type: 'join', name: playerName, peerId: myId });
            resolve({ roomCode: cleanCode, peerId: myId });
          });

          conn.on('data', (data) => {
            if (this.handlers.onMessage) {
              this.handlers.onMessage(data, targetId);
            }
          });

          conn.on('close', () => {
            if (this.handlers.onDisconnectedFromHost) {
              this.handlers.onDisconnectedFromHost();
            }
          });

          conn.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        });

        peer.on('error', (err) => {
          clearTimeout(timeout);
          if (this.handlers.onError) this.handlers.onError(err);
          reject(err);
        });
      });
    }

    broadcast(payload) {
      if (this.role !== 'host') return;
      this.connections.forEach((conn) => {
        if (conn.open) {
          try {
            conn.send(payload);
          } catch (_) {}
        }
      });
    }

    sendToHost(payload) {
      if (this.role !== 'guest' || !this.hostConn || !this.hostConn.open) return;
      try {
        this.hostConn.send(payload);
      } catch (_) {}
    }
  }

  global.KarutaNetwork = KarutaNetwork;
})(window);
