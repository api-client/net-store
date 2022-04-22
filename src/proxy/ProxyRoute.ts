import Router from '@koa/router';
import { ParameterizedContext } from 'koa';
import { Logger, ApiError, uuidV4 } from '@api-client/core';
import ApiRoute from '../routes/ApiRoute.js';
import ProjectProxy, { IProjectProxyInit } from './ProjectProxy.js';
import RequestProxy, { IRequestProxyInit } from './RequestProxy.js';

type Proxy = RequestProxy | ProjectProxy;

export default class ProxyRoute extends ApiRoute {
  state = new Map<string, Proxy>();

  get jsonType(): string {
    return 'application/json';
  }
  
  constructor(protected router: Router, protected logger: Logger) {
    super();
    router.post('/init', this._initRoute.bind(this));
    router.all('/proxy/:key', this._proxyRoute.bind(this));
  }

  protected async _initRoute(ctx: ParameterizedContext): Promise<void> {
    try {
      const body = await this.readJsonBody(ctx.request) as IProjectProxyInit | IRequestProxyInit;
      if (!body.kind) {
        throw new ApiError(`Expected the "kind" to be set on the request.`, 400);
      }
      let location: string;
      switch (body.kind) {
        case 'Core#Project': location = await this.addProjectProxy(body); break;
        case 'Core#Request': location = await this.addRequestProxy(body); break;
        default: throw new ApiError(`Unknown proxy kind: ${(body as any).kind}`, 400);
      }
      ctx.status = 204;
      ctx.set('location', location);
    } catch (cause) {
      this.logger.debug(`Error when initializing a proxy ${(cause as Error).message}`);
      this.errorResponse(ctx, cause);
    }
  }

  protected async addRequestProxy(init: IRequestProxyInit): Promise<string> {
    const { request, authorization, config } = init;
    this.logger.debug(`Initializing a request proxy: ${request && request.url || 'unknown URL'}`);
    const proxy = new RequestProxy();
    await proxy.configure(request, authorization, config);
    const id = uuidV4();
    this.state.set(id, proxy);
    return this.getExecutionRoute(id);
  }

  protected async addProjectProxy(init: IProjectProxyInit): Promise<string> {
    const { opts, pid, token, baseUri } = init;
    this.logger.debug(`Initializing a project proxy for project ${pid}`);
    const proxy = new ProjectProxy();
    await proxy.configure(pid, opts, token, baseUri);
    const id = uuidV4();
    this.state.set(id, proxy);
    return this.getExecutionRoute(id);
  }

  protected getExecutionRoute(id: string): string {
    const { router } = this;
    let prefix = '';
    if (router.opts.prefix) {
      prefix = router.opts.prefix;
      if (!prefix.endsWith('/')) {
        prefix += '/';
      }
    }
    return `${prefix}proxy/${id}`;
  }

  protected async _proxyRoute(ctx: ParameterizedContext): Promise<void> {
    const { key } = ctx.params;
    this.logger.debug(`Executing proxy for ${key}`);
    try {
      const proxy = this.state.get(key);
      if (!proxy) {
        this.logger.warn(`Proxy ${key} does not exist`);
        throw new ApiError(`Unknown key: ${key}. The request may have been already executed.`, 400);
      }
      this.state.delete(key);
      let body: Buffer | undefined;
      if (this._hasBody(ctx)) {
        this.logger.debug(`Reading body to the proxy.`);
        body = await this.readBufferBody(ctx.request);
      }
      this.logger.debug(`Running the request.`);
      const result = await proxy.execute(body);
      if (result.headers) {
        ctx.response.headers = result.headers;
      }
      if (typeof result.status === 'number') {
        ctx.status = result.status;
      } else {
        ctx.status = 200;
      }
      if (result.body) {
        ctx.body = result.body;
      }
      this.logger.debug(`Proxy finished.`);
    } catch (cause) {
      this.logger.debug(`Error when running a proxy ${(cause as Error).message}`);
      this.errorResponse(ctx, cause);
    }
  }

  /**
   * Determines whether the proxy request has a body.
   * This always returns `false` for `GET` and `HEAD` requests.
   * For a request to have a body it has to have a `content-length` header set to more than `0` (zero).
   */
  protected _hasBody(ctx: ParameterizedContext): boolean {
    const { method } = ctx;
    if (['get', 'head'].includes(method.toLowerCase())) {
      return false;
    }
    const length = ctx.header['content-length'];
    if (!length) {
      return false;
    }
    const size = Number(length);
    if (!Number.isInteger(size)) {
      return false;
    }
    return size > 0;
  }
}
