import http from 'http';
import { DefaultContext } from 'koa';
import Router from '@koa/router';
import { IApplicationState } from '../definitions.js';
import { StorePersistence } from '../persistence/StorePersistence.js';
/**
 * A base class for all authentication methods.
 */
export abstract class Authentication {
  /**
   * The man application router.
   */
  protected router: Router<IApplicationState, DefaultContext>;
  protected store: StorePersistence;

  constructor(router: Router<IApplicationState, DefaultContext>, store: StorePersistence) {
    this.router = router;
    this.store = store;
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
   * When requested by any route, it generates the path the client should use to
   * authenticate the user.
   * The path is sent in the `location` header.
   */
  abstract getAuthLocation(): string;
}
