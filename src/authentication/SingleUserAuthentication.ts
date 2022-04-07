import { IUser, ApiError, IApiError } from '@api-client/core';
import { ParameterizedContext, DefaultState, DefaultContext, Next } from 'koa';
import http from 'http';
import { Authentication } from './Authentication.js';
import DefaultUser from './DefaultUser.js'
import { ITokenContents } from '../session/AppSession.js';

export class SingleUserAuthentication extends Authentication {
  static get defaultSid(): string {
    return 'default';
  }

  async initialize(): Promise<void> {
    // ...
  }

  // async getSessionId(): Promise<string | undefined> {
  //   return SingleUserAuthentication.defaultSid;
  // }

  async getSessionUser(requestOrSid: http.IncomingMessage | string): Promise<IUser | undefined> {
    let sid: string | undefined;
    if (typeof requestOrSid === 'string') {
      sid = requestOrSid;
    } else {
      sid = await this.getSessionId(requestOrSid);
    }
    if (sid) {
      const sessionValue = await this.session.get(sid);
      if (!sessionValue) {
        throw new ApiError(`Invalid state. Session does not exist.`, 500);
      }
      if (sessionValue.authenticated && sessionValue.uid === DefaultUser.key) {
        return DefaultUser;
      }
    }
  }

  async middleware(ctx: ParameterizedContext<DefaultState, DefaultContext, unknown>, next: Next): Promise<void> {
    try {
      const sid = await this.getSessionId(ctx.req);
      ctx.state.sid = sid;
      if (sid) {
        const sessionValue = await this.session.get(sid);
        if (!sessionValue) {
          throw new ApiError(`Invalid state. Session does not exist.`, 500);
        }
        if (sessionValue.authenticated && sessionValue.uid === DefaultUser.key) {
          ctx.state.user = DefaultUser;
        }
      }
    } catch (cause) {
      const e = cause as ApiError;
      const error = new ApiError(e.message || 'Unknown error', e.code || 400);
      ctx.body = this.wrapError(error, error.code);
      ctx.status = error.code;
    }
    return next();
  }

  wrapError(cause: Error, code = 500, detail?: string): IApiError {
    return {
      error: true,
      code,
      message: cause.message,
      detail: detail || 'The server misbehave. That is all we know.'
    };
  }

  getAuthLocation(): string {
    return '/';
  }

  /**
   * A function that checks whether the request has a valid access token (JWT)
   * and if so it returns the associated with the token session id.
   * The session id can be then used to read session data from the session store.
   * 
   * @param request The client request. Note, it is not a Koa request as this is also used by the web sockets.
   * @returns The session key, if any. It throws an error when the token is invalid.
   */
  async getSessionId(request: http.IncomingMessage): Promise<string | undefined> {
    const url = request.url || '';
    let token: string | undefined;
    // WebSocket cannot create headers when making the connection.
    // Therefore the token is passed in the query param.
    if (url.includes('token=')) {
      const index = url.indexOf('token=');
      token = url.substring(index + 6);
      if (token.includes('&')) {
        const endIndex = token.indexOf('&');
        token = token.substring(0, endIndex);
      }
    } else {
      const auth = request.headers['authorization'];
      if (!auth) {
        return;
      }
      if (Array.isArray(auth)) {
        return;
      }
      const type = auth.substring(0, 7).toLowerCase();
      if (type !== 'bearer ') {
        throw new Error(`Invalid authentication type. Expected Bearer.`);
      }
      token = auth.substring(7);
    }
    return this.readTokenSessionId(token);
  }

  /**
   * Reads the session id value from the token.
   * 
   * @param token The token received from the client.
   */
  readTokenSessionId(token: string): string {
    const data = this.session.readTokenContents(token) as ITokenContents;
    return data.sid;
  }
}
