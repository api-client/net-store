import { WebSocketServer, WebSocket, Server, RawData } from 'ws';
import { EventEmitter } from 'events'
import http from 'http';
import { IUser, Logger } from '@advanced-rest-client/core';
import Clients from './WsClients.js';
import { StorePersistence } from '../persistence/StorePersistence.js';

export interface ClientInfo {
  /**
   * The currently authenticated user.
   * May not be set in the single-user environment.
   */
  user?: IUser;
  /**
   * The client socket.
   */
  socket: WebSocket;
}

export interface SocketRoute {
  /**
   * Emitted when the server has no more connections and should be closed.
   */
  on(event: 'close', listener: () => void): this;
}

/**
 * The base class for web sockets servers and routes.
 */
export abstract class SocketRoute extends EventEmitter {
  server?: Server<WebSocket>;
  /**
   * The route data, e.g. ['spaces', '[spaceId]', 'projects', '[projectId]']
   * The route is stripped from the base route prefix.
   */
  route: string[] = [''];
  /**
   * The full route string, without the prefix
   */
  routeUrl = '/';

  constructor(protected store: StorePersistence, protected logger: Logger) {
    super();
    this._connectionHandler = this._connectionHandler.bind(this);
    this._closeHandler = this._closeHandler.bind(this);
  }

  closeWhenNeeded(): void {
    if (Clients.count(this.routeUrl) === 0) {
      this.shutDown();
      this.emit('close');
    }
  }

  /**
   * @returns Preconfigured base server.
   */
  createServer(): Server<WebSocket> {
    const server = new WebSocketServer({ clientTracking: false, noServer: true });
    this.server = server;
    server.on('connection', this._connectionHandler);
    server.on('close', this._closeHandler);
    return server;
  }

  /**
   * Removes the event listeners from the server and prevents it from accepting new connections.
   */
  shutDown(): void {
    const { server } = this;
    Clients.closeByUrl(this.routeUrl);
    if (server) {
      server.removeAllListeners('connection');
      server.removeAllListeners('close');
      server.close();
    }
  }

  /**
   * A helper method that should be called when a new client is connected to the server.
   * It registers the ws client in the global clients registry and adds the `close` handler
   * to the client to remove the client when it decide to disconnect.
   */
  registerClient(ws: WebSocket, user?: IUser, sid?: string): void {
    Clients.register(ws, this.routeUrl, user, sid);
    ws.on('close', () => {
      Clients.unregister(ws);
      this.closeWhenNeeded();
    });
  }

  /**
   * Finds the client for the given channel and returns associated user information.
   * @param ws The channel object
   */
  getUserInfo(ws: WebSocket): IUser | undefined {
    return Clients.getUserByChannel(ws);
  }

  protected abstract _connectionHandler(ws: WebSocket, req: http.IncomingMessage, user?: IUser, sid?: string): void;
  
  protected _closeHandler(): void {
    Clients.closeByUrl(this.routeUrl);
  }

  readDataAsJson(data: RawData): unknown {
    let value: string;
    if (Array.isArray(data)) {
      value = data.map(i => i.toString('utf8')).join('');
    } else if (Buffer.isBuffer(data)) {
      value = data.toString('utf8');
    } else if (typeof data === 'string') {
      value = data;
    } else {
      throw new Error('Unsupported data.');
    }
    let result;
    try {
      result = JSON.parse(value);
    } catch (e) {
      throw new Error(`Unknown message format.`);
    }
    return result;
  }

  sendError(ws: WebSocket, cause: string, path = this.routeUrl): void {
    const message = JSON.stringify({
      error: true,
      cause: `Unable to process spaces query: ${cause}`,
      time: Date.now(),
      path,
    });
    ws.send(message);
  }
}
