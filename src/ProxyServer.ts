import { Logger, DefaultLogger } from '@api-client/core';
import Koa, { DefaultContext, DefaultState } from 'koa';
import cors, { Options as CorsOptions } from '@koa/cors';
import Router, { RouterOptions } from '@koa/router';
import http from 'http';
import { IServerProxyConfiguration } from "./definitions.js";
import ProxyRoute from './proxy/ProxyRoute.js';

/**
 * A server that uses the Core libraries to make an HTTP request.
 * 
 * To proxy a request it is a 2-step process.
 * 
 * Step 1: Initialization
 * The client sends a request with the HTTP request meta. Depending on the proxy type (single request, project request)
 * the meta vary from then HTTP request data (without the payload), request configuration, to the project id and 
 * the access token for the store.
 * 
 * In this step this data is being stored in a temporary (in-memory) store and an endpoint is generated
 * for the client to actually send the request. The endpoint returns the `location` header with the generated endpoint.
 * 
 * Step 2: Making the request
 * This second step is necessary to properly send the HTTP request payload for a single HTTP request.
 * The client takes the location returned by the step 1 and sends the body of the original request (when available).
 * The response from this step is the actual response from the target endpoint.
 */
export class ProxyServer {
  logger: Logger;
  app = new Koa();
  router: Router<DefaultState, DefaultContext>;
  route: ProxyRoute;
  server?: http.Server;

  constructor(protected config: IServerProxyConfiguration) {
    if (!config) {
      throw new Error(`The proxy server configuration is missing`);
    }
    if (!config.port) {
      throw new Error(`The proxy server configuration port is missing`);
    }
    this.logger = this.setupLogger(config);
    const routerOptions: RouterOptions = {};
    if (config.prefix) {
      routerOptions.prefix = config.prefix;
    }
    this.router = new Router(routerOptions);
    this.route = new ProxyRoute(this.router, this.logger);

    if (config.cors && config.cors.enabled) {
      const corsConfig = config.cors.cors || this.defaultCorsConfig();
      this.app.use(cors(corsConfig));
    }

    this.app.use(this.router.routes());
    this.app.use(this.router.allowedMethods());
  }

  /**
   * Creates a logger object to log debug output.
   */
  protected setupLogger(opts: IServerProxyConfiguration): Logger {
    if (opts.logger) {
      return opts.logger;
    }
    return new DefaultLogger();
  }

  /**
   * Starts the HTTP proxy
   */
  async start(): Promise<void> {
    const { port } = this.config;
    return new Promise((resolve) => {
      const server = http.createServer(this.app.callback());
      this.server = server;
      server.listen(port, () => {
        resolve();
      });
    });
  }

  /**
   * Starts the HTTP proxy
   */
  async stop(): Promise<void> {
    const { server } = this;
    if (!server) {
      return;
    }
    this.server = undefined;
    return new Promise((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }

  protected defaultCorsConfig(): CorsOptions {
    return {
      allowMethods: '*',
    };
  }
}
