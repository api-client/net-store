import http from 'http';
import { DefaultContext, ParameterizedContext, Next } from 'koa';
import Router from '@koa/router';
import { IUser } from '@advanced-rest-client/core';
import { IApplicationState } from '../definitions.js';
import { StorePersistence } from '../persistence/StorePersistence.js';
import { AppSession } from '../session/AppSession.js';

/**
 * A base class for all authentication methods.
 * 
 * The authentication classes receive the reference to the data store and the main router.
 * During the initialization phase the logic should register all necessary routes.
 */
export abstract class Authentication {
  /**
   * The man application router.
   */
  protected router: Router<IApplicationState, DefaultContext>;
  protected store: StorePersistence;
  protected session: AppSession;

  constructor(router: Router<IApplicationState, DefaultContext>, store: StorePersistence, session: AppSession) {
    this.router = router;
    this.store = store;
    this.session = session;
  }
  /** 
   * Initializes the authentication, eg, sets up routes, checks configuration, etc.
   */
  abstract initialize(): Promise<void>;
  /**
   * A function that checks whether the request has a valid access token (JWT)
   * and if so it returns the associated with the token session id.
   * The session id can be then used to read session data from the session store.
   * 
   * @param request The client request. Note, it is not a Koa request as this is also used by the web sockets.
   * @returns The session key, if any. It throws an error when the token is invalid.
   */
  abstract getSessionId(request: http.IncomingMessage): Promise<string | undefined>;
  /**
   * Processes the request and returns the user object.
   * @param request The client request. Note, it is not a Koa request as this is also used by the web sockets.
   * @returns The user object or undefined when not found.
   */
  abstract getSessionUser(request: http.IncomingMessage): Promise<IUser | undefined>;
  /**
   * The middleware to register on the main application.
   * The middleware should setup the `sid` and `user` on the `ctx.state` object of the Koa context.
   * It should only throw when credentials are invalid, corrupted, or expired. It should not throw
   * when there's no session, user credentials, or the user.
   * 
   * @param ctx The Koa context object.
   * @param next The next function to call.
   */
  abstract middleware(ctx: ParameterizedContext, next: Next): Promise<void>;
  /**
   * When requested by any route, it generates the path the client should use to
   * authenticate the user.
   * The path is sent in the `location` header.
   */
  abstract getAuthLocation(): string;
}
