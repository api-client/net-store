import Router from '@koa/router';
import { ParameterizedContext } from 'koa';
import { 
  Logger, ApiError,  HttpProjectKind, HttpRequestKind, AppProjectKind, 
  IUser, StoreSdk, ProxyService, 
  IHttpProjectProxyInit, IRequestProxyInit, IAppProjectProxyInit, IProjectExecutionLog, IProxyResult, IRequestLog 
} from '@api-client/core';
import ApiRoute from '../routes/ApiRoute.js';

export default class ProxyRoute extends ApiRoute {
  service = new ProxyService();

  get jsonType(): string {
    return 'application/json';
  }
  
  constructor(protected router: Router, protected logger: Logger) {
    super();
    router.post('/', this._proxyRoute.bind(this));
  }

  getTokenAndBaseUri(ctx: ParameterizedContext): string[] {
    let auth = ctx.headers['authorization'];
    if (!auth) {
      throw new ApiError({
        error: true,
        message: 'Unauthorized',
        detail: 'Unauthorized to use the proxy service. Set the authentication credentials.',
        code: 401,
      });
    }
    if (Array.isArray(auth)) {
      throw new ApiError({
        error: true,
        message: 'Invalid credentials',
        detail: 'Authorization header has multiple entries.',
        code: 401,
      });
    }
    const type = auth.substring(0, 7).toLowerCase();
    if (type !== 'bearer ') {
      throw new ApiError({
        error: true,
        message: 'Invalid credentials',
        detail: 'Invalid authentication type. Expected Bearer.',
        code: 401,
      });
    }
    const value = auth.substring(7);
    const [token, url] = value.split(',').map(i => i.trim());
    if (!token) {
      throw new ApiError({
        error: true,
        message: 'Invalid credentials',
        detail: 'The authentication token is missing.',
        code: 401,
      });
    }
    if (!url) {
      throw new ApiError({
        error: true,
        message: 'Invalid credentials',
        detail: 'The store uri is missing.',
        code: 401,
      });
    }
    if (!url.startsWith('http')) {
      throw new ApiError({
        error: true,
        message: 'Invalid credentials',
        detail: 'The store uri is invalid.',
        code: 401,
      });
    }
    return [token, url];
  }

  async getUserOrThrow(token: string, url: string): Promise<IUser> {
    const sdk = new StoreSdk(url);
    sdk.token = token;
    let user: IUser | undefined; 
    try {
      user = await sdk.user.me();
    } catch (e) {
      // ...
    }
    if (!user) {
      throw new ApiError({
        error: true,
        message: 'Invalid credentials',
        detail: 'The access token is invalid or expired.',
        code: 401,
      });
    }
    return user;
  }

  protected async _proxyRoute(ctx: ParameterizedContext): Promise<void> {
    try {
      // only authenticated uses can use the proxy.
      const [token, storeUri] = this.getTokenAndBaseUri(ctx);
      await this.getUserOrThrow(token, storeUri);
      const body = await this.readJsonBody(ctx.request) as IHttpProjectProxyInit | IRequestProxyInit | IAppProjectProxyInit;
      if (!body.kind) {
        throw new ApiError(`Expected the "kind" to be set on the request.`, 400);
      }
      let result: IProxyResult<IProjectExecutionLog | IRequestLog>;
      switch (body.kind) {
        case HttpProjectKind: result = await this.service.proxyHttpProject(token, storeUri, body); break;
        case AppProjectKind: result = await this.service.proxyAppProject(token, storeUri, body); break;
        case HttpRequestKind: result = await this.service.proxyRequest(body); break;
        default: throw new ApiError(`Unknown proxy kind: ${(body as any).kind}`, 400);
      }
      ctx.status = 200;
      ctx.type = this.jsonType;
      ctx.body = result;
    } catch (cause) {
      this.logger.debug(`Error when initializing a proxy ${(cause as Error).message}`);
      this.errorResponse(ctx, cause);
    }
  }
}
