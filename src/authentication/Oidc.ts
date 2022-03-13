/* eslint-disable import/no-named-as-default-member */
import https from 'https';
import http from 'http';
import { URL, URLSearchParams } from 'url';
import { randomBytes } from 'crypto';
import { ParameterizedContext, Next } from 'koa';
import { IUser } from '@api-client/core'
import { IOidcConfiguration, IApplicationState } from '../definitions.js';
import { Authentication, IAuthenticationOptions } from './Authentication.js';
import { ITokenContents, IAuthenticatedSession } from '../session/AppSession.js';
import { ApiError, IApiError } from '../ApiError.js';
import { RouteBuilder } from '../routes/RouteBuilder.js';
import Clients, { IClientFilterOptions } from '../routes/WsClients.js';
import { IOpenIdProviderMetadata } from './OpenIdProviderMetadata.js';


interface FetchResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export interface IOidcProviderInfo {
  /**
   * When received from the auth server, the refresh token.
   * Can be used to periodically check for user data to update the profile information
   * (name, pic). For now this is not planned to develop.
   */
  refreshToken?: string;
}


/**
 * Replaces `-` or `_` with camel case.
 * @param name The string to process
 * @return Camel cased string or `undefined` if not transformed.
 */
function camel(name: string): string | undefined {
  let i = 0;
  let l;
  let changed = false;
  while ((l = name[i])) {
    if ((l === '_' || l === '-') && i + 1 < name.length) {
      name = name.substring(0, i) + name[i + 1].toUpperCase() + name.substring(i + 2);
      changed = true;
    }
    i++;
  }
  return changed ? name : undefined;
}

/**
 * The built-in support for OpenID Connect authentication scheme.
 */
export class Oidc extends Authentication {
  /**
   * The OIDC configuration.
   */
  protected config: IOidcConfiguration;
  /**
   * Read OIDC provider meta data.
   */
  protected meta?: IOpenIdProviderMetadata;

  constructor(init: IAuthenticationOptions, config: IOidcConfiguration) {
    super(init);
    this.config = config;
  }

  async initialize(): Promise<void> {
    const { issuerUri } = this.config;
    const oidcUrl = this.buildIssuerUrl(issuerUri);
    this.meta = await this.discover(oidcUrl);
    this.router.post(this.getAuthLocation(), this.initAuthHandler.bind(this));
    this.router.get(this.getAuthLocation(), this.authRequestHandler.bind(this));
    this.router.get('/auth/callback', this.callbackHandler.bind(this));
  }

  /**
   * When requested by any route, it generates the path the client should use to
   * authenticate the user.
   * The path is sent in the `location` header.
   */
  getAuthLocation(): string {
    return '/auth/login';
  }

  readToken(request: http.IncomingMessage): string|undefined {
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
    return auth.substring(7);
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
   * Processes the request and returns the user object.
   * @param requestOrSid The client request. Note, it is not a Koa request as this is also used by the web sockets.
   * @returns The user object or undefined when not found.
   */
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
      if (sessionValue.authenticated) {
        return this.store.readSystemUser(sessionValue.uid);
      }
    }
  }

  /**
   * The middleware to register on the main application.
   * The middleware should setup the `sid` and `user` on the `ctx.state` object of the Koa context.
   * It should only throw when credentials are invalid, corrupted, or expired. It should not throw
   * when there's no session, user credentials, or the user.
   * 
   * @param ctx The Koa context object.
   * @param next The next function to call.
   */
  async middleware(ctx: ParameterizedContext, next: Next): Promise<void> {
    try {
      const sid = await this.getSessionId(ctx.req);
      ctx.state.sid = sid;
      if (sid) {
        const data = await this.session.get(sid);
        if (!data) {
          throw new ApiError(`Invalid state. Session does not exist.`, 500);
        }
        if (data.authenticated) {
          ctx.state.user = await this.store.readSystemUser(data.uid);
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

  /**
   * Reads the session id value from the token.
   * 
   * @param token The token received from the client.
   */
  readTokenSessionId(token: string): string {
    const data = this.session.readTokenContents(token) as ITokenContents;
    return data.sid;
  }

  /**
   * Constructs the OIDC discovery URL.
   * @param baseUri The issues URI.
   */
  protected buildIssuerUrl(baseUri: string): string {
    let url = baseUri;
    if (!url.includes('.well-known')) {
      if (!url.endsWith('/')) {
        url += '/';
      }
      url += '.well-known/openid-configuration';
    }
    return url;
  }

  protected discover(url: string): Promise<IOpenIdProviderMetadata> {
    return new Promise((resolve, reject) => {
      const request = https.request(url, {
        method: 'GET',
        rejectUnauthorized: this.config.ignoreCertErrors === true ? false : true,
      });
      request.on('response', (res) => {
        if (!res.statusCode) {
          reject(new Error(`Invalid response.`));
          return;
        }
        if (res.statusCode >= 300) {
          reject(new Error(`Unsupported status code ${res.statusCode}.`));
        }

        let data: Buffer | undefined;
        res.on('data', (d) => {
          if (!data) {
            data = d;
          } else {
            data = Buffer.concat([data, d]);
          }
        });
        res.on('end', () => {
          if (!data) {
            reject(new Error(`Invalid response from the OIDC server. No data.`));
            return;
          }
          const str = data.toString('utf8');
          let result;
          try {
            result = JSON.parse(str);
          } catch (e) {
            const err = e as Error;
            reject(err);
            return;
          }
          resolve(result);
        });
      });
      request.on('error', (error) => reject(error));
      request.end();
    });
  }

  protected async initAuthHandler(ctx: ParameterizedContext<IApplicationState>): Promise<void> {
    try {
      if (!ctx.state.sid) {
        ctx.status = 400;
        ctx.set('location', RouteBuilder.buildSessionsRoute());
        ctx.body = this.wrapError(new Error('Session not initialized'), 400);
        return;
      }
      const nonce = randomBytes(16).toString('hex');
      const state = randomBytes(16).toString('hex');
      await this.session.addOAuthSession(ctx.state.sid, state, nonce);
      ctx.status = 204;
      ctx.set('location', `${this.getAuthLocation()}?state=${state}`);
    } catch (cause) {
      const e = cause as Error;
      const error = new Error(e.message || 'Unknown error');
      ctx.body = this.wrapError(error, 400);
      ctx.status = 400;
    }
  }

  /**
   * Note, this is executed by a web browser so there's no session identifier here.
   * However, from the previous step the client had obtained a state parameter 
   * which now is used to identify the session.
   */
  protected async authRequestHandler(ctx: ParameterizedContext): Promise<void> {
    const { meta } = this;
    if (!meta) {
      ctx.body = {
        error: true,
        code: 500,
        message: 'Invalid server configuration.',
        detail: 'The server was not properly initialized. Missing OIDC meta.'
      };
      ctx.status = 500;
      return;
    }
    // build request URL and redirect the user to the oauth provider.
    try {
      const { state } = ctx.query;
      if (!state) {
        throw new Error(`Missing required parameter: state.`);
      }
      if (Array.isArray(state)) {
        throw new Error(`Invalid state parameter. Array is not accepted here.`);
      }
      const info = await this.session.getOAuthSession(state);
      if (!info.nonce) {
        throw new Error(`The session was not correctly initialized.`);
      }
      const url = this.buildAuthUrl(state, info.nonce);
      ctx.redirect(url);
    } catch (cause) {
      const e = cause as ApiError;
      const error = new ApiError(e.message || 'Unknown error', e.code || 400);
      ctx.body = this.wrapError(error, error.code);
      ctx.status = error.code;
    }
  }

  protected async callbackHandler(ctx: ParameterizedContext): Promise<void> {
    const { state, code } = ctx.query;
    if (!state) {
      await ctx.render('oauth2callback-error', { error: 'The state parameter is not returned by the authentication server.' });
      return;
    }
    if (!code || Array.isArray(code)) {
      await ctx.render('oauth2callback-error', { error: 'The code parameter is not returned by the authentication server.' });
      return;
    }
    let sid;
    try {
      sid = await this.session.getOAuthSessionId(state as string);
      await this.session.deleteOauthSession(state as string);
      const tokenInfo = await this.exchangeCode(code);
      const user = await this.getUserInfo(tokenInfo.accessToken);
      const newSession: IAuthenticatedSession = {
        authenticated: true,
        uid: user.key,
      };
      await this.session.set(sid, newSession);
      const provider: IOidcProviderInfo = {};
      if (tokenInfo.refreshToken) {
        provider.refreshToken = tokenInfo.refreshToken;
      }
      user.provider = provider;
      await this.store.addSystemUser(user.key, user);
      const event = {
        status: 'OK',
      };
      const filter: IClientFilterOptions = {
        url: this.getAuthLocation(),
        sids: [sid],
      };
      Clients.notify(event, filter);

      await ctx.render('oauth2callback-success');
    } catch (cause) {
      const e = cause as Error;
      this.logger.error(e);
      if (sid) {
        const event = {
          status: 'ERROR',
          message: e.message,
        };
        const filter: IClientFilterOptions = {
          url: this.getAuthLocation(),
          sids: [sid],
        };
        Clients.notify(event, filter);
      }
      await ctx.render('oauth2callback-error', { error: e.message });
    }
  }

  wrapError(cause: Error, code = 500, detail?: string): IApiError {
    return {
      error: true,
      code,
      message: cause.message,
      detail: detail || 'The server misbehave. That is all we know.'
    };
  }

  sanityCheck(meta: IOpenIdProviderMetadata, config: IOidcConfiguration): void {
    if (!Array.isArray(meta.response_types_supported) || !meta.response_types_supported.length) {
      throw new ApiError(`Discovery configuration failed. No response types defined.`, 500);
    }
    if (!Array.isArray(meta.grant_types_supported) || !meta.grant_types_supported) {
      throw new ApiError(`Discovery configuration failed. No grant types defined.`, 500);
    }
    if (!meta.userinfo_endpoint) {
      throw new ApiError(`Discovery configuration failed. No user info endpoint.`, 500);
    }
    if (!meta.response_types_supported.includes('code')) {
      throw new ApiError(`Unable to process the oidc request. Unable to find adequate response_type.`, 500);
    }
    if (!meta.token_endpoint) {
      throw new ApiError(`Discovery configuration failed. No token_endpoint property.`, 500);
    }
    if (!config.clientId) {
      throw new ApiError(`The client_id is not configured.`, 500);
    }
    if (!config.clientSecret) {
      throw new ApiError(`The client_secret is not configured.`, 500);
    }
    if (!config.redirectBaseUri) {
      throw new ApiError(`The redirect_uri is not configured.`, 500);
    }
  }

  buildAuthUrl(state: string, nonce: string): string {
    const { meta, config } = this;
    if (!meta) {
      throw new ApiError('Invalid server configuration.', 500);
    }
    this.sanityCheck(meta, config);
    const url = new URL(meta.authorization_endpoint);
    const grantTypes = meta.grant_types_supported as string[];
    url.searchParams.set('response_type', 'code');
    if (grantTypes.includes('refresh_token')) {
      url.searchParams.set('access_type', 'offline');
    }
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('redirect_uri', `${config.redirectBaseUri}/auth/callback`);
    const scopes = ['openid'];
    const supportedScopes = meta.scopes_supported;
    if (Array.isArray(supportedScopes) && supportedScopes.length) {
      if (supportedScopes.includes('profile')) {
        // to get user name and picture to render in the UI.
        scopes.push('profile');
      }
      if (supportedScopes.includes('email')) {
        // to get user email for notifications, when supported.
        scopes.push('email');
      }
    }
    url.searchParams.set('scope', scopes.join(' '));
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    return url.toString();
  }

  async exchangeCode(code: string): Promise<Record<string, any>> {
    const { meta } = this;
    if (!meta) {
      throw new ApiError('Invalid server configuration.', 500);
    }
    const body = this.getCodeRequestBody(code);
    const url = meta.token_endpoint as string;
    return this.requestTokenInfo(url, body);
  }

  protected getCodeRequestBody(code: string): string {
    const { meta, config } = this;
    if (!meta) {
      throw new ApiError('Invalid server configuration.', 500);
    }
    const params = new URLSearchParams();
    params.set('grant_type', 'authorization_code');
    params.set('code', code);
    params.set('client_id', config.clientId);
    params.set('redirect_uri', `${config.redirectBaseUri}/auth/callback`);
    params.set('client_secret', config.clientSecret);
    return params.toString();
  }

  /**
   * Requests for token from the authorization server for `code`, `password`, `client_credentials` and custom grant types.
   *
   * @param url Base URI of the endpoint. Custom properties will be applied to the final URL.
   * @param body Generated body for given type. Custom properties will be applied to the final body.
   * @param optHeaders Optional headers to add to the request. Applied after custom data.
   * @return Promise resolved to the response string.
   */
  protected async requestTokenInfo(url: string, body: string, optHeaders?: Record<string, string>): Promise<Record<string, any>> {
    const urlInstance = new URL(url);
    let headers: Record<string, string> = {
      'content-type': 'application/x-www-form-urlencoded',
    };
    if (optHeaders) {
      headers = { ...headers, ...optHeaders };
    }
    const authTokenUrl = urlInstance.toString();
    const response = await this.fetchToken(authTokenUrl, headers, body);
    const { status } = response;
    if (status === 404) {
      throw new Error(`Authorization URI is invalid. Received status 404.`);
    }
    if (status >= 500) {
      throw new Error(`Authorization server error. Response code is ${status}`);
    }
    let responseBody = response.body;
    if (!responseBody) {
      responseBody = 'No response has been recorded';
    }
    if (status >= 400 && status < 500) {
      throw new Error(`Client error: ${responseBody}`);
    }
    let mime = response.headers['content-type'];
    if (Array.isArray(mime)) {
      [mime] = mime;
    }
    return this.processCodeResponse(responseBody, mime);
  }

  protected fetchToken(url: string, headers: Record<string, string>, body: string): Promise<FetchResponse> {
    return new Promise((resolve, reject) => {
      const request = https.request(url, {
        method: 'POST',
        headers,
        rejectUnauthorized: this.config.ignoreCertErrors === true ? false : true,
      });
      request.on('response', (response) => {
        const ro: FetchResponse = {
          status: response.statusCode as number,
          headers: response.headers,
          body: '',
        };
        response.on('data', (chunk) => {
          ro.body += chunk;
        });
        response.on('end', () => resolve(ro));
      });
      request.on('error', (error) => reject(error));
      request.write(body);
      request.end();
    });
  }

  /**
   * Processes body of the code exchange to a map of key value pairs.
   */
  protected processCodeResponse(body: string, mime=''): Record<string, any> {
    let tokenInfo: Record<string, any> = {};
    if (mime.includes('json')) {
      const info = JSON.parse(body);
      Object.keys(info).forEach((key) => {
        let name = key;
        if (name.includes('_') || name.includes('-')) {
          name = camel(name) as string;
        }
        tokenInfo[name] = info[key];
      });
    } else {
      tokenInfo = {};
      const params = new URLSearchParams(body);
      params.forEach((value, key) => {
        let name = key;
        if (key.includes('_') || key.includes('-')) {
          name = camel(key) as string;
        }
        tokenInfo[name] = value;
      });
    }
    return tokenInfo;
  }

  protected async getUserInfo(accessToken: string): Promise<IUser> {
    const { meta, config } = this;
    if (!meta) {
      throw new ApiError('Invalid server configuration.', 500);
    }
    let info;
    try {
      info = await this.readDiscoveryUserInfo(accessToken);
    } catch(e) {
      info = {};
    }
    if (!info.sub) {
      throw new Error(`Invalid profile response. Unable to proceed.`);
    }
    const { allowedDomains } = config;
    /* sub: 'user id',
      name: 'user name',
      given_name: '...',
      family_name: '...',
      picture: 'https://...',
      email: '...',
      email_verified: true,
      locale: '...' */
    const result: IUser = {
      key: info.sub,
      name: info.name || 'Anonymous',
    };
    const hasDomains = Array.isArray(allowedDomains) && allowedDomains.length;
    const email = info.email as string | undefined;
    if (email) {
      if (hasDomains) {
        const isAllowed = allowedDomains.some(domain => this.isDomainEmail(domain, email));
        if (!isAllowed) {
          throw new Error(`The email ${email} is not allowed to register. Contact your administrator for more information.`);
        }
      }
      result.email = [{
        email,
        verified: info.email_verified === true,
      }];
    } else if (hasDomains) {
      throw new Error(`Invalid user profile. An email is required to verify access to the domain.`);
    }
    if (info.locale) {
      result.locale = info.locale;
    }
    if (info.picture) {
      result.picture = {
        url: info.picture,
      };
    }
    return result;
  }

  /**
   * Checks the user email is in the domain.
   * @param domain The domain
   * @param email The email address to test against the domain.
   * @returns true when the email is in the domain.
   */
  protected isDomainEmail(domain: string, email: string): boolean {
    let lowerDomain = domain.toLowerCase();
    const lowerEmail = email.toLowerCase();
    if (!lowerDomain.startsWith('@')) {
      lowerDomain = `@${lowerDomain}`;
    }
    return lowerEmail.endsWith(lowerDomain);
  }

  protected async readDiscoveryUserInfo(accessToken: string): Promise<any> {
    const { meta } = this;
    if (!meta) {
      throw new ApiError('Invalid server configuration.', 500);
    }
    const { userinfo_endpoint } = meta;
    if (!userinfo_endpoint) {
      return;
    }
    return new Promise((resolve, reject) => {
      const request = https.request(userinfo_endpoint, {
        method: 'GET',
        headers: {
          'authorization': `Bearer ${accessToken}`,
        },
        rejectUnauthorized: this.config.ignoreCertErrors === true ? false : true,
      });
      request.on('response', (response) => {
        let data = '';
        response.on('data', (chunk) => {
          data += chunk;
        });
        response.on('end', () => {
          try {
            const info = JSON.parse(data);
            resolve(info)
          } catch (e) {
            reject(new Error('Unable to parse the user profile info.'));
          }
        });
      });
      request.on('error', (error) => reject(error));
      request.end();
    });
  }
}
