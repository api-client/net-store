import Koa, { DefaultContext, DefaultState, ParameterizedContext, Request } from 'koa';
import http from 'http';
import Router from '@koa/router';
import { Timers } from '@api-client/core';

export class EchoServer {
  app = new Koa();
  router: Router<DefaultState, DefaultContext>  = new Router();
  server?: http.Server;

  constructor() {
    const { router } = this;
    router.get('/', this._getRouteHandler.bind(this));
    router.head('/', this._getRouteHandler.bind(this));
    router.delete('/', this._getRouteHandler.bind(this));
    router.post('/', this._postRouteHandler.bind(this));
    router.put('/', this._postRouteHandler.bind(this));
    router.patch('/', this._postRouteHandler.bind(this));
    this.app.use(router.routes());
  }

  start(port: number): Promise<void> {
    return new Promise((resolve) => {
      const server = http.createServer(this.app.callback());
      this.server = server;
      server.listen(port, () => {
        resolve();
      });
    });
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
      server.close(() => {
        resolve();
      });
    });
  }

  protected async _getRouteHandler(ctx: ParameterizedContext<DefaultState>): Promise<void> {
    const start = Date.now();
    await Timers.sleep(120);
    const { headers, query, originalUrl, hostname, method, path, ip, protocol, url } = ctx;
    ctx.status = 200;
    ctx.type = 'json';
    ctx.status = 200;
    ctx.body = {
      headers,
      query,
      originalUrl,
      hostname,
      method,
      path,
      ip,
      protocol,
      url,
      delay: Date.now() - start,
    };
  }

  protected async _postRouteHandler(ctx: ParameterizedContext<DefaultState>): Promise<void> {
    const start = Date.now();
    const data = await this.readBufferBody(ctx.request);
    await Timers.sleep(120);
    const { headers, query, originalUrl, hostname, method, path, ip, protocol, url } = ctx;
    ctx.status = 200;
    ctx.type = 'json';
    ctx.status = 200;
    ctx.body = {
      headers,
      query,
      originalUrl,
      hostname,
      method,
      path,
      ip,
      protocol,
      url,
      delay: Date.now() - start,
      body: data.toString('utf8'),
    };
  }

  protected readBufferBody(request: Request): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      let message: Buffer;
      request.req.on('data', (chunk) => {
        try {
          if (message) {
            message = Buffer.concat([message, chunk]);
          } else {
            message = chunk;
          }
        } catch (e) {
          reject(e);
          throw e;
        }
      });
      request.req.on('end', () => {
        if (!message) {
          reject(new Error(`Invalid request body. Expected a message.`));
          return;
        }
        resolve(message);
      });
    });
  }
}
