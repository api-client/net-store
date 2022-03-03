/* eslint-disable import/no-named-as-default */
/* eslint-disable import/no-named-as-default-member */
import Koa, { DefaultContext } from 'koa';
import http from 'http';
import https from 'https';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { IUser, Logger, DefaultLogger } from '@advanced-rest-client/core';
import cors, { Options as CorsOptions } from '@koa/cors';
import Router, { RouterOptions } from '@koa/router';
import views from 'koa-views';
import { dir } from 'tmp-promise';
import { platform } from 'os';
import { Duplex } from 'stream'
import { ApiRoutes } from './ApiRoutes.js';
import { 
  SupportedServer, IRunningServer, IServerConfiguration, IOidcConfiguration, IAuthenticationConfiguration, 
  IApplicationState, ITestingServerConfiguration } from './definitions.js'
import { StorePersistence } from './persistence/StorePersistence.js';
import { Authentication } from './authentication/Authentication.js';
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

  servers: IRunningServer[] = [];
  app = new Koa();
  router: Router<IApplicationState, DefaultContext>;
  opts: IServerConfiguration;
  logger: Logger;
  protected apiHandler?: ApiRoutes;
  protected store: StorePersistence;
  protected auth?: Authentication;
  protected info: BackendInfo;
  protected session: AppSession;

  /**
   * @param opts Optional server configuration options.
   */
  constructor(store: StorePersistence, opts: IServerConfiguration={}) {
    this.opts = opts;
    this.store = store;
    const info = new BackendInfo();
    this.info = info;
    this.session = new AppSession(this.store, opts.session || {});
    this.logger = this.setupLogger(opts);

    if (opts.authentication) {
      if (typeof opts.authentication === 'function') {
        info.hasAuthentication = true;
      } else {
        const config = opts.authentication as IAuthenticationConfiguration;
        info.hasAuthentication = config.enabled === true;
      }
    } else {
      info.hasAuthentication = false;
    }
    const routerOptions: RouterOptions = {};
    if (opts.router && opts.router.prefix) {
      routerOptions.prefix = opts.router.prefix;
    }
    this.router = new Router(routerOptions);

    // API testing
    const typed = opts as ITestingServerConfiguration;
    if (typed.testing === true) {
      this.info.testing = true;
    }
  }

  /**
   * Creates a logger object to log debug output.
   */
  setupLogger(opts: IServerConfiguration = {}): Logger {
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
    if (this.info.hasAuthentication) {
      let factory: Authentication;
      if (typeof opts.authentication === 'function') {
        factory = await this.initializeCustomAuth();
      } else {
        factory = await this.initializeAuthentication(opts.authentication as IAuthenticationConfiguration);
      }
      this.auth = factory;
      this.app.use(factory.middleware);
    }
    await this.setupRoutes(...customRoutes);
  }

  /**
   * Initializes a custom authentication function provided by the configuration.
   */
  protected async initializeCustomAuth(): Promise<Authentication> {
    const { opts, router, store } = this;
    const ctr = opts.authentication as new(router: Router<IApplicationState, DefaultContext>, store: StorePersistence, session: AppSession, logger: Logger) => Authentication;
    const factory = new ctr(router, store, this.session, this.logger);
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
    const factory = new Oidc(this.router, this.store, this.session, this.logger, config);
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
   * Starts the www server on a given port.
   * @param portOrSocket The port number to use or a socket path
   */
  startHttp(portOrSocket: number|string): Promise<void> {
    return new Promise((resolve) => {
      const server = http.createServer(this.app.callback());
      this.servers.push({
        server,
        type: 'http',
        portOrSocket,
      });
      server.on('upgrade', this._upgradeCallback.bind(this));
      server.listen(portOrSocket, () => {
        resolve();
      });
    });
  }

  /**
   * Stops a running www server, if any.
   * 
   * @param portOrSocket When specified it closes a www server on a specific port/socket. When not it stops all running http servers.
   */
  stopHttp(portOrSocket?: number|string): Promise<void[]> {
    return this._stop('http', portOrSocket);
  }

  /**
   * Starts the www over SSL server on a given port.
   * 
   * @param sslOptions The SSL options to use when creating the server.
   * @param portOrSocket The port number to use or a socket path
   */
  startSsl(sslOptions: https.ServerOptions, portOrSocket: number|string): Promise<void> {
    return new Promise((resolve) => {
      const server = https.createServer(sslOptions, this.app.callback());
      this.servers.push({
        server,
        type: 'https',
        portOrSocket,
      });
      server.listen(portOrSocket, () => {
        resolve();
      });
      server.on('upgrade', this._upgradeCallback.bind(this));
    });
  }

  /**
   * Stops a running www over SSL server, if any.
   * 
   * @param portOrSocket When specified it closes an ssl server on a specific port/socket. When not it stops all running https servers.
   */
  stopSsl(portOrSocket?: number|string): Promise<void[]> {
    return this._stop('https', portOrSocket);
  }

  /**
   * @param type The server type to stop.
   * @param portOrSocket The optional port of the server.
   */
  protected _stop(type: SupportedServer, portOrSocket?: number|string): Promise<void[]> {
    const toStop = this.servers.filter((s) => {
      if (s.type === type) {
        if (portOrSocket) {
          return portOrSocket === s.portOrSocket;
        }
        return true;
      }
      return false;
    });
    const promises = toStop.map((item) => this._stopServer(item.server));
    return Promise.all(promises);
  }

  protected _stopServer(server: https.Server | http.Server): Promise<void> {
    return new Promise((resolve) => {
      server.close(() => {
        resolve();
      });
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
    if (this.info.hasAuthentication) {
      const factory = this.auth as Authentication;
      try {
        sessionId = await factory.getSessionId(request);
        const authLocation = factory.getAuthLocation();
        if (request.url === authLocation) {
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
        const sessionValue = await this.session.get(sessionId);
        if (!sessionValue) {
          throw new Error(`Session not established.`);
        }
        if (!sessionValue.authenticated) {
          throw new Error(`Using unauthenticated session.`);
        }
        user = await this.store.readSystemUser(sessionValue.uid);
      } catch (e) {
        const cause = e as Error;
        this.logger.error('[Invalid authentication]', cause);
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    const prefix = this.opts.router && this.opts.router.prefix ? this.opts.router.prefix : '';
    if (prefix && !request.url.startsWith(prefix)) {
      this.logger.error('The request URL does not start with the prefix.');
      socket.write('HTTP/1.1 404 Not found\r\n\r\n');
      socket.destroy();
      return;
    }
    let url = request.url.substring(prefix.length);

    if (url.includes('?')) {
      // clears the URL from any query parameters. Authentication uses QP to set session.
      const index = url.indexOf('?');
      url = url.substring(0, index);
    }
    const route = this.apiHandler.getOrCreateWs(url);
    if (!route || !route.server) {
      this.logger.error('Route not found.');
      socket.write('HTTP/1.1 404 Not found\r\n\r\n');
      socket.destroy();
      return;
    }

    const { server } = route;

    server.handleUpgrade(request, socket, head, (ws) => {
      server.emit('connection', ws, request, user, sessionId);
    });
  }
}
