import { IUser } from '@advanced-rest-client/core';
import { WebSocket } from 'ws';

export interface IClientInfo {
  /**
   * The currently authenticated user.
   * May not be set in the single-user environment.
   */
  user?: IUser;
  /**
   * When available, the session id.
   */
  sid?: string;
  /**
   * The client socket.
   */
  socket: WebSocket;
  /**
   * The URL the client is connected to.
   */
  url: string;
}

export interface IClientFilterOptions {
  /**
   * The list of specific users to target.
   */
  users?: string[];
  /**
   * Notifies clients connected to this URL (path actually).
   */
  url?: string;
  /**
   * The list of specific users to target based on their session id.
   */
  sids?: string[];
}

/**
 * A global registry of clients connected to all web socket servers.
 * 
 * It is used by the store to identify clients it wants to notify.
 */
class WsClients {
  clients: IClientInfo[] = [];

  register(socket: WebSocket, url: string, user?: IUser, sid?: string): void {
    this.clients.push({
      socket,
      url,
      user,
      sid,
    });
  }

  unregister(socket: WebSocket): void {
    const index = this.clients.findIndex(i => i.socket === socket);
    if (index >= 0) {
      this.clients.splice(index, 1);
    }
  }

  /**
   * Finds clients by the route URL.
   * 
   * @param url The route path.
   * @returns List of clients associated with the route path.
   */
  findByUrl(url: string): IClientInfo[] {
    return this.clients.filter(i => i.url === url);
  }

  /**
   * Finds clients for the filter query.
   * @param filter The clients filter.
   * @returns The filtered clients. Returns all when no filter.
   */
  filter(filter: IClientFilterOptions={}): IClientInfo[] {
    return this.clients.filter(i => {
      const { url, users, sids } = filter;
      if (url && i.url !== url) {
        return false;
      }
      if (users && users.length) {
        if (!i.user) {
          return false;
        }
        return users.includes(i.user.key);
      }
      if (sids && sids.length) {
        if (!i.sid) {
          return false;
        }
        return sids.includes(i.sid);
      }
      return true;
    });
  }

  /**
   * Finds the client for the given channel and returns associated user information.
   * @param ws The channel object
   */
  getUserByChannel(ws: WebSocket): IUser | undefined {
    const info = this.clients.find(i => i.socket === ws);
    return info?.user;
  }

  /**
   * Closes connections to clients connected to a specific URL.
   * @param url The URL to search for.
   */
  closeByUrl(url: string): void {
    const list = this.findByUrl(url);
    list.forEach((info) => {
      if (info.socket.readyState === info.socket.OPEN) {
        info.socket.close();
      }
    });
  }

  notify(message: unknown, filter: IClientFilterOptions={}): void {
    const list = this.filter(filter);
    const typed = typeof message === 'string' ? message : JSON.stringify(message);
    list.forEach((info) => {
      if (info.socket.readyState === WebSocket.OPEN) {
        info.socket.send(typed);
      }
    });
  }

  /**
   * Counts the number of clients attached to a specific URL.
   */
  count(url: string): number {
    let result = 0;
    const list = this.clients.filter(i => i.url === url);
    list.forEach((info) => {
      if (info.socket.readyState === info.socket.OPEN) {
        result += 1;
      }
    });
    return result;
  }
}

const instance = new WsClients();
export default instance;
