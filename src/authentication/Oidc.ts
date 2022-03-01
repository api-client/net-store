/* eslint-disable import/no-named-as-default-member */
import https from 'https';
import http from 'http';
import { URL, URLSearchParams } from 'url';
import Router from '@koa/router';
import { randomBytes } from 'crypto';
import { DefaultContext, ParameterizedContext } from 'koa';
import { IUser } from '@advanced-rest-client/core'
import jwt from 'jsonwebtoken';
import { IOidcConfiguration, IApplicationState } from '../definitions.js';
import { Authentication } from './Authentication.js';
import session, { ITokenContents, IAuthenticatedSession } from '../session/GlobalSession.js';
import { IApiError } from '../routes/BaseRoute.js';
import { RouteBuilder } from '../routes/RouteBuilder.js';
import { ApiError } from '../ApiError.js';
import { StorePersistance } from '../persistance/StorePersistance.js';
import Clients, { IClientFilterOptions } from '../routes/WsClients.js';

export interface OpenIdProviderMetadata {
  /**
   * URL using the https scheme with no query or fragment component that the OP asserts as its Issuer Identifier. If Issuer discovery is supported (see Section 2), this value MUST be identical to the issuer value returned by WebFinger. This also MUST be identical to the iss Claim value in ID Tokens issued from this Issuer.
   */
  issuer: string;
  /**
   * URL of the OP's OAuth 2.0 Authorization Endpoint [OpenID.Core].
   */
  authorization_endpoint: string;
  /**
   * URL of the OP's OAuth 2.0 Token Endpoint [OpenID.Core]. This is REQUIRED unless only the Implicit Flow is used.
   */
  token_endpoint?: string;
  /**
   * URL of the OP's UserInfo Endpoint [OpenID.Core]. This URL MUST use the https scheme and MAY contain port, path, and query parameter components.
   */
  userinfo_endpoint?: string;
  /**
   * URL of the OP's JSON Web Key Set [JWK] document. This contains the signing key(s) the RP uses to validate signatures from the OP. The JWK Set MAY also contain the Server's encryption key(s), which are used by RPs to encrypt requests to the Server. When both signing and encryption keys are made available, a use (Key Use) parameter value is REQUIRED for all keys in the referenced JWK Set to indicate each key's intended usage. Although some algorithms allow the same key to be used for both signatures and encryption, doing so is NOT RECOMMENDED, as it is less secure. The JWK x5c parameter MAY be used to provide X.509 representations of keys provided. When used, the bare key values MUST still be present and MUST match those in the certificate.
   */
  jwks_uri: string;
  /**
   * URL of the OP's Dynamic Client Registration Endpoint.
   */
  registration_endpoint?: string;
  /**
   * JSON array containing a list of the OAuth 2.0 [RFC6749] scope values that this server supports. The server MUST support the openid scope value. Servers MAY choose not to advertise some supported scope values even when this parameter is used, although those defined in [OpenID.Core] SHOULD be listed, if supported.
   */
  scopes_supported?: string[];
  /**
   * JSON array containing a list of the OAuth 2.0 response_type values that this OP supports. Dynamic OpenID Providers MUST support the code, id_token, and the token id_token Response Type values.
   */
  response_types_supported: string[];
  /**
   * JSON array containing a list of the OAuth 2.0 response_mode values that this OP supports, as specified in OAuth 2.0 Multiple Response Type Encoding Practices [OAuth.Responses]. If omitted, the default for Dynamic OpenID Providers is ["query", "fragment"].
   */
  response_modes_supported?: string[];
  /**
   * JSON array containing a list of the OAuth 2.0 Grant Type values that this OP supports. Dynamic OpenID Providers MUST support the authorization_code and implicit Grant Type values and MAY support other Grant Types. If omitted, the default value is ["authorization_code", "implicit"].
   */
  grant_types_supported?: string[];
  /**
   * JSON array containing a list of the Authentication Context Class References that this OP supports.
   */
  acr_values_supported?: string[];
  /**
   * JSON array containing a list of the Subject Identifier types that this OP supports. Valid types include pairwise and public.
   */
  subject_types_supported: string[];
  /**
   * JSON array containing a list of the JWS signing algorithms (alg values) supported by the OP for the ID Token to encode the Claims in a JWT [JWT]. The algorithm RS256 MUST be included. The value none MAY be supported, but MUST NOT be used unless the Response Type used returns no ID Token from the Authorization Endpoint (such as when using the Authorization Code Flow).
   */
  id_token_signing_alg_values_supported: string[];
  /**
   * JSON array containing a list of the JWE encryption algorithms (alg values) supported by the OP for the ID Token to encode the Claims in a JWT [JWT].
   */
  id_token_encryption_alg_values_supported?: string[];
  /**
   * JSON array containing a list of the JWE encryption algorithms (enc values) supported by the OP for the ID Token to encode the Claims in a JWT [JWT].
   */
  id_token_encryption_enc_values_supported?: string[];
  /**
   * JSON array containing a list of the JWS [JWS] signing algorithms (alg values) [JWA] supported by the UserInfo Endpoint to encode the Claims in a JWT [JWT]. The value none MAY be included.
   */
  userinfo_signing_alg_values_supported?: string[];
  /**
   * JSON array containing a list of the JWE [JWE] encryption algorithms (alg values) [JWA] supported by the UserInfo Endpoint to encode the Claims in a JWT [JWT].
   */
  userinfo_encryption_alg_values_supported?: string[];
  /**
   * JSON array containing a list of the JWE encryption algorithms (enc values) [JWA] supported by the UserInfo Endpoint to encode the Claims in a JWT [JWT].
   */
  userinfo_encryption_enc_values_supported?: string[];
  /**
   * JSON array containing a list of the JWS signing algorithms (alg values) supported by the OP for Request Objects, which are described in Section 6.1 of OpenID Connect Core 1.0 [OpenID.Core]. These algorithms are used both when the Request Object is passed by value (using the request parameter) and when it is passed by reference (using the request_uri parameter). Servers SHOULD support none and RS256.
   */
  request_object_signing_alg_values_supported?: string[];
  /**
   * JSON array containing a list of the JWE encryption algorithms (alg values) supported by the OP for Request Objects. These algorithms are used both when the Request Object is passed by value and when it is passed by reference.
   */
  request_object_encryption_alg_values_supported?: string[];
  /**
   * JSON array containing a list of the JWE encryption algorithms (enc values) supported by the OP for Request Objects. These algorithms are used both when the Request Object is passed by value and when it is passed by reference.
   */
  request_object_encryption_enc_values_supported?: string[];
  /**
   * JSON array containing a list of Client Authentication methods supported by this Token Endpoint. The options are client_secret_post, client_secret_basic, client_secret_jwt, and private_key_jwt, as described in Section 9 of OpenID Connect Core 1.0 [OpenID.Core]. Other authentication methods MAY be defined by extensions. If omitted, the default is client_secret_basic -- the HTTP Basic Authentication Scheme specified in Section 2.3.1 of OAuth 2.0 [RFC6749].
   */
  token_endpoint_auth_methods_supported?: string[];
  /**
   * JSON array containing a list of the JWS signing algorithms (alg values) supported by the Token Endpoint for the signature on the JWT [JWT] used to authenticate the Client at the Token Endpoint for the private_key_jwt and client_secret_jwt authentication methods. Servers SHOULD support RS256. The value none MUST NOT be used.
   */
  token_endpoint_auth_signing_alg_values_supported?: string[];
  /**
   * JSON array containing a list of the display parameter values that the OpenID Provider supports. These values are described in Section 3.1.2.1 of OpenID Connect Core 1.0 [OpenID.Core].
   */
  display_values_supported?: string[];
  /**
   * JSON array containing a list of the Claim Types that the OpenID Provider supports. These Claim Types are described in Section 5.6 of OpenID Connect Core 1.0 [OpenID.Core]. Values defined by this specification are normal, aggregated, and distributed. If omitted, the implementation supports only normal Claims.
   */
  claim_types_supported?: string[];
  /**
   * JSON array containing a list of the Claim Names of the Claims that the OpenID Provider MAY be able to supply values for. Note that for privacy or other reasons, this might not be an exhaustive list.
   */
  claims_supported?: string[];
  /**
   * URL of a page containing human-readable information that developers might want or need to know when using the OpenID Provider. In particular, if the OpenID Provider does not support Dynamic Client Registration, then information on how to register Clients needs to be provided in this documentation.
   */
  service_documentation?: string;
  /**
   * Languages and scripts supported for values in Claims being returned, represented as a JSON array of BCP47 [RFC5646] language tag values. Not all languages and scripts are necessarily supported for all Claim values.
   */
  claims_locales_supported?: string[];
  /**
   * Languages and scripts supported for the user interface, represented as a JSON array of BCP47 [RFC5646] language tag values.
   */
  ui_locales_supported?: string[];
  /**
   * Boolean value specifying whether the OP supports use of the claims parameter, with true indicating support. If omitted, the default value is false.
   */
  claims_parameter_supported?: boolean;
  /**
   * Boolean value specifying whether the OP supports use of the request parameter, with true indicating support. If omitted, the default value is false.
   */
  request_parameter_supported?: boolean;
  /**
   * Boolean value specifying whether the OP supports use of the request_uri parameter, with true indicating support. If omitted, the default value is true.
   */
  request_uri_parameter_supported?: boolean;
  /**
   * Boolean value specifying whether the OP requires any request_uri values used to be pre-registered using the request_uris registration parameter. Pre-registration is REQUIRED when the value is true. If omitted, the default value is false.
   */
  require_request_uri_registration?: boolean;
  /**
   * URL that the OpenID Provider provides to the person registering the Client to read about the OP's requirements on how the Relying Party can use the data provided by the OP. The registration process SHOULD display this URL to the person registering the Client if it is given.
   */
  op_policy_uri?: string;
  /**
   * URL that the OpenID Provider provides to the person registering the Client to read about OpenID Provider's terms of service. The registration process SHOULD display this URL to the person registering the Client if it is given.
   */
  op_tos_uri?: string; 
}

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
  // eslint-disable-next-line no-cond-assign
  while ((l = name[i])) {
    if ((l === '_' || l === '-') && i + 1 < name.length) {
      // eslint-disable-next-line no-param-reassign
      name = name.substring(0, i) + name[i + 1].toUpperCase() + name.substring(i + 2);
      changed = true;
    }
    // eslint-disable-next-line no-plusplus
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
  protected meta?: OpenIdProviderMetadata;

  constructor(router: Router<IApplicationState, DefaultContext>, store: StorePersistance, config: IOidcConfiguration) {
    super(router, store);
    this.config = config;
    this.router = router;
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
   * Reads the session id value from the token.
   * 
   * @param token The token received from the client.
   */
  readTokenSessionId(token: string): string {
    const contents = jwt.verify(token, session.secret) as ITokenContents;
    if (!contents) {
      throw new Error(`Invalid token.`);
    }
    return contents.sid;
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

  protected discover(url: string): Promise<OpenIdProviderMetadata> {
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
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
      })
      .on('error', (e) => {
        reject(e);
      });
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
      session.addOAuthSession(ctx.state.sid, state, nonce);
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
      const info = await session.getOAuthSession(state);
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
      sid = await session.getOAuthSessionId(state as string);
      await session.deleteOauthSession(state as string);
      const tokenInfo = await this.exchangeCode(code);
      const user = await this.getUserInfo(tokenInfo.accessToken);
      const newSession: IAuthenticatedSession = {
        authenticated: true,
        uid: user.key,
      };
      await session.set(sid, newSession);
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
      console.error(e);
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

  sanityCheck(meta: OpenIdProviderMetadata, config: IOidcConfiguration): void {
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
    const { meta } = this;
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
    if (info.email) {
      result.email = [{
        email: info.email,
        verified: info.email_verified === true,
      }];
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
