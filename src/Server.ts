/* eslint-disable import/no-named-as-default */
/* eslint-disable import/no-named-as-default-member */
import Koa, { DefaultContext } from 'koa';
import http from 'http';
import https from 'https';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { IUser, Logger, DefaultLogger } from '@api-client/core';
import cors, { Options as CorsOptions } from '@koa/cors';
import Router, { RouterOptions } from '@koa/router';
import views from 'koa-views';
import { dir } from 'tmp-promise';
import { platform } from 'os';
import { Duplex } from 'stream'
import { ApiRoutes } from './ApiRoutes.js';
import { IRunningServer, IServerConfiguration, IOidcConfiguration, IAuthenticationConfiguration, IApplicationState } from './definitions.js'
import { StorePersistence } from './persistence/StorePersistence.js';
import { Authentication, IAuthenticationOptions } from './authentication/Authentication.js';
import { SingleUserAuthentication } from './authentication/SingleUserAuthentication.js';
import { BackendInfo } from './BackendInfo.js';
import { AppSession } from './session/AppSession.js';
import { BaseRoute } from './routes/BaseRoute.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * AMF web API server.
 * A web server that exposes an API to parse API projects with the AMF parser.
 */
export class Server {
  /**
   * This function can be used to create a temporary directory where a socket will be put.
   * @returns A path to a temporary folder where the socket path can be created.
   */
  static async createSocketPath(): Promise<string> {
    const tmpObj = await dir({ unsafeCleanup: true });
    return tmpObj.path;
  }

  /**
   * Use this with combination with the `Server.createSocketPath()`.
   * 
   * ```javascript
   * const socketName = 'my-socket.sock';
   * const socketPath = await Server.createSocketPath();
   * const socketLocation = Server.createPlatformSocket(socketPath, socketName);
   * ```
   * 
   * @param socketPath The path to the socket.
   * @param socketName The socket name.
   * @returns The platform specific socket path.
   */
  static createPlatformSocket(socketPath: string, socketName: string): string {
    if (platform() === 'win32') {
      return join('\\\\?\\pipe', socketPath, socketName);
    }
    return join(socketPath, socketName)
  }

  server?: IRunningServer;
  app = new Koa();
  router: Router<IApplicationState, DefaultContext>;
  opts: IServerConfiguration;
  logger: Logger;
  protected apiHandler?: ApiRoutes;
  protected store: StorePersistence;
  protected auth?: Authentication;
  protected info = new BackendInfo();
  protected session: AppSession;

  /**
   * @param store The store to use with the server.
   * @param opts The server configuration options.
   */
  constructor(store: StorePersistence, opts: IServerConfiguration) {
    this.validateConfiguration(opts);
    this.opts = opts;
    this.store = store;
    this.info.applyConfig(opts)
    this.session = new AppSession(this.store, opts.session || {});
    this.logger = this.setupLogger(opts);

    const routerOptions: RouterOptions = {};
    if (opts.router && opts.router.prefix) {
      routerOptions.prefix = opts.router.prefix;
    }
    this.router = new Router(routerOptions);
  }

  validateConfiguration(opts: IServerConfiguration): void {
    if (opts.isSsl && !opts.serverOptions) {
      throw new Error(`The "serverOptions" configuration is required for an ssl server.`);
    }
    if (!opts.session || !opts.session.secret) {
      throw new Error(`The "session.secret" configuration is required.`);
    }
    if (!['single-user', 'multi-user'].includes(opts.mode)) {
      throw new Error(`Unknown mode: ${opts.mode}.`);
    }
    if (opts.mode === 'multi-user' && !opts.authentication) {
      throw new Error(`The "authentication" configuration is required for multi-user mode.`);
    }
  }

  /**
   * Creates a logger object to log debug output.
   */
  setupLogger(opts: IServerConfiguration): Logger {
    if (opts.logger) {
      return opts.logger;
    }
    return new DefaultLogger();
  }

  /**
   * Signals all processes to end.
   */
  async cleanup(): Promise<void> {
    this.session.cleanup();
    if (!this.apiHandler) {
      return;
    }
    this.apiHandler.cleanup();
  }

  protected getAuthInit(): IAuthenticationOptions {
    return {
      logger: this.logger,
      router: this.router,
      session: this.session,
      store: this.store,
    }
  }

  /**
   * Depending on the configuration initializes required libraries.
   * @param customRoutes Any custom routes to initialize.
   */
  async initialize(...customRoutes: typeof BaseRoute[]): Promise<void> {
    const { opts } = this;
    this.session.initialize();
    if (opts.cors && opts.cors.enabled) {
      const config = opts.cors.cors || this.defaultCorsConfig();
      this.app.use(cors(config));
    }
    this.app.use(views(join(__dirname, 'views'), { extension: 'ejs' }));
    let factory: Authentication;
    if (this.info.info.mode === 'multi-user') {
      if (typeof opts.authentication === 'function') {
        factory = await this.initializeCustomAuth();
      } else {
        factory = await this.initializeAuthentication(opts.authentication as IAuthenticationConfiguration);
      }
    } else {
      factory = new SingleUserAuthentication(this.getAuthInit());
    }
    this.auth = factory;
    this.app.use(factory.middleware);
    this.info.info.auth.path = factory.getAuthLocation();
    await this.setupRoutes(...customRoutes);
  }

  /**
   * Initializes a custom authentication function provided by the configuration.
   */
  protected async initializeCustomAuth(): Promise<Authentication> {
    const { opts } = this;
    const ctr = opts.authentication as new(init: IAuthenticationOptions) => Authentication;
    const factory = new ctr(this.getAuthInit());
    await factory.initialize();
    return factory;
  }

  /**
   * Initializes one of the pre-defined authentication schemes.
   */
  protected async initializeAuthentication(options: IAuthenticationConfiguration): Promise<Authentication> {
    switch (options.type) {
      case 'oidc': return this.initializeOidc(options.config as IOidcConfiguration);
      default: throw new Error(`Unknown authentication scheme: ${options.type}`);
    }
  }
  
  /**
   * Initializes the OIDC authentication scheme.
   * Note, the import is dynamic to save on unnecessary imports at startup.
   */
  protected async initializeOidc(config: IOidcConfiguration): Promise<Authentication> {
    const { Oidc } = await import('./authentication/Oidc.js');
    if (!config || !config.issuerUri) {
      throw new Error(`OpenID Connect configuration error.`);
    }
    const factory = new Oidc(this.getAuthInit(), config);
    await factory.initialize();
    return factory;
  }

  /**
   * Called when initializing the server class.
   * Sets up the API routes.
   */
  protected async setupRoutes(...customRoutes: typeof BaseRoute[]): Promise<void> {
    const { router } = this;
    const handler = new ApiRoutes(this.store, router, this.session, this.info, this.logger, this.opts);
    await handler.setup(...customRoutes);

    this.app.use(router.routes());
    this.app.use(router.allowedMethods());
    this.apiHandler = handler;
  }

  /**
   * Starts the server according to the previous configuration.
   */
  async start(): Promise<void> {
    const { isSsl, portOrSocket } = this.opts;
    if (isSsl) {
      return this._startSsl(this.opts.serverOptions!, portOrSocket);
    }
    return this._startHttp(portOrSocket);
  }

  /**
   * Stops the previously started server.
   */
  async stop(): Promise<void> {
    const { server } = this;
    if (!server) {
      return;
    }
    this.server = undefined;
    return new Promise((resolve) => {
      server.server.close(() => {
        resolve();
      });
    });
  }

  /**
   * Starts the www server on a given port.
   * @param portOrSocket The port number to use or a socket path
   */
  protected _startHttp(portOrSocket: number|string): Promise<void> {
    return new Promise((resolve) => {
      const server = http.createServer(this.app.callback());
      this.server = {
        server,
        type: 'http',
        portOrSocket,
      };
      server.on('upgrade', this._upgradeCallback.bind(this));
      server.listen(portOrSocket, () => {
        resolve();
      });
    });
  }

  
  /**
   * Starts the www over SSL server on a given port.
   * 
   * @param sslOptions The SSL options to use when creating the server.
   * @param portOrSocket The port number to use or a socket path
   */
  protected _startSsl(sslOptions: https.ServerOptions, portOrSocket: number|string): Promise<void> {
    return new Promise((resolve) => {
      const server = https.createServer(sslOptions, this.app.callback());
      this.server = {
        server,
        type: 'https',
        portOrSocket,
      };
      server.listen(portOrSocket, () => {
        resolve();
      });
      server.on('upgrade', this._upgradeCallback.bind(this));
    });
  }

  defaultCorsConfig(): CorsOptions {
    return {
      allowMethods: 'GET,PUT,POST,DELETE',
    };
  }

  protected async _upgradeCallback(request: http.IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    if (!request.url) {
      this.logger.error('No request URL.');
      socket.write('HTTP/1.1 404 Not found\r\n\r\n');
      socket.destroy();
      return;
    }
    if (!this.apiHandler) {
      this.logger.error('API Handler not initialized');
      socket.write('HTTP/1.1 500 Not initialized\r\n\r\n');
      socket.destroy();
      return;
    }
    
    let user: IUser | undefined;
    let sessionId: string | undefined;

    const wsPath = this.readNormalizedPath(request.url);
    const factory = this.auth as Authentication;
    try {
      sessionId = await factory.getSessionId(request);
      if (this.info.info.mode === 'single-user') {
        if (!sessionId) {
          throw new Error(`No authorization info.`);
        }
        user = await factory.getSessionUser(sessionId);
      } else {
        const authLocation = factory.getAuthLocation();
        if (request.url.includes(`${authLocation}?token=`)) {
          // we allow un-auth user here.
          const route = this.apiHandler.getOrCreateWs(authLocation);
          if (!route || !route.server) {
            throw new Error('Unable to create auth socket.');
          }
          const { server } = route;
          server.handleUpgrade(request, socket, head, (ws) => {
            server.emit('connection', ws, request, undefined, sessionId);
          });
          return;
        }
        if (!sessionId) {
          throw new Error(`No authorization info.`);
        }
        user = await factory.getSessionUser(sessionId);
        // const sessionValue = await this.session.get(sessionId);
        // if (!sessionValue) {
        //   throw new Error(`Session not established.`);
        // }
        // if (!sessionValue.authenticated) {
        //   throw new Error(`Using unauthenticated session.`);
        // }
        // user = await this.store.readSystemUser(sessionValue.uid);
      }
    } catch (e) {
      const cause = e as Error;
      this.logger.error('[Invalid authentication]', cause);
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const prefix = this.opts.router && this.opts.router.prefix ? this.opts.router.prefix : '';
    if (prefix && !request.url.startsWith(prefix)) {
      this.logger.error('The request URL does not start with the prefix.');
      socket.write('HTTP/1.1 404 Not found\r\n\r\n');
      socket.destroy();
      return;
    }
    const route = this.apiHandler.getOrCreateWs(wsPath);
    
    if (!route || !route.server) {
      this.logger.error('Route not found.');
      socket.write('HTTP/1.1 404 Not found\r\n\r\n');
      socket.destroy();
      return;
    }

    // handle WS authorization
    const authorized = await route.isAuthorized(user);
    if (!authorized) {
      this.apiHandler.removeWsRoute(route);
      this.logger.error('Route not found.');
      socket.write('HTTP/1.1 403 Not authorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const { server } = route;

    server.handleUpgrade(request, socket, head, (ws) => {
      server.emit('connection', ws, request, user, sessionId);
    });
  }

  protected readNormalizedPath(url: string): string {
    let wsPath = url;
    try {
      const parser = new URL(url, 'http://localhost');
      const alt = parser.searchParams.get('alt');
      parser.search = '';
      if (alt) {
        parser.searchParams.set('alt', alt);
      }
      const prefix = this.opts.router && this.opts.router.prefix ? this.opts.router.prefix : '';
      parser.pathname = parser.pathname.replace(prefix, '');
      wsPath = `${parser.pathname}${parser.search}`;
    } catch (e) {
      this.logger.error(e);
    }
    return wsPath;
  }
}
