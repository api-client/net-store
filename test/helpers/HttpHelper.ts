/* eslint-disable import/no-named-as-default-member */
import http from 'http';
import https from 'https';
import { URL } from 'url';
import jwt from 'jsonwebtoken';
// import { setTimeout } from 'timers/promises';

export interface HttpOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>,
  body?: string | Buffer;
  /**
   * Adds the token to the headers.
   */
  token?: string;
}

export interface FetchResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body?: string;
}

export default class HttpHelper {
  async get(url: string, opts: HttpOptions = {}): Promise<FetchResponse> {
    const result = await this._get(url, opts);
    if ([301, 302, 308, 307].includes(result.status)) {
      const loc = result.headers.location;
      if (!loc) {
        throw new Error('Expected redirection but no "location" header.')
      }
      const newUrl = new URL(loc, url);
      return this.get(newUrl.toString(), opts);
    }
    return result;
  }

  private _get(url: string, opts: HttpOptions = {}): Promise<FetchResponse> {
    return new Promise((resolve, reject) => {
      const { method='GET', headers={} } = opts;
      if (opts.token) {
        headers.authorization = `Bearer ${opts.token}`;
      }
      const isSsl = url.startsWith('https:');
      const lib = isSsl ? https : http;
      const request = lib.request(url, {
        method,
        headers,
        rejectUnauthorized: false,
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
      request.end();
    });
  }

  post(url: string, opts: HttpOptions = {}): Promise<FetchResponse> {
    return new Promise((resolve, reject) => {
      const { method='POST', headers={} } = opts;
      if (opts.token) {
        headers.authorization = `Bearer ${opts.token}`;
      }
      const request = http.request(url, {
        method,
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
      if (opts.body) {
        request.write(opts.body);
      }
      request.end();
    });
  }

  patch(url: string, opts: HttpOptions = {}): Promise<FetchResponse> {
    const options = { ...opts };
    options.method = 'PATCH';
    return this.post(url, options);
  }

  delete(url: string, opts: HttpOptions = {}): Promise<FetchResponse> {
    const options = { ...opts };
    options.method = 'DELETE';
    return this.post(url, options);
  }

  /**
   * Creates unauthenticated session in the backend.
   * @param baseUri Server's base URI (with the prefix).
   * @returns The JWT for unauthenticated user.
   */
  async createSession(baseUri: string): Promise<string> {
    const url = `${baseUri}/sessions`;
    const result = await this.post(url);
    jwt.verify(result.body as string, 'EOX0Xu6aSb');
    return result.body as string;
  }

  /**
   * Initializes the authentication session.
   * @param baseUri Server's base URI (with the prefix).
   * @param token The unauthenticated session JWT.
   * @returns The location of the authorization endpoint.
   */
  async getAuthSessionEndpoint(baseUri: string, token: string): Promise<string> {
    const url = `${baseUri}/auth/login`;
    const result = await this.post(url, {
      token,
    });
    const loc = result.headers.location;
    if (!loc) {
      throw new Error(`The location header not returned by the server.`)
    }
    return loc;
  }

  /**
   * Performs session initialization and user authentication.
   * 
   * @param baseUri The base URI of a multi-user server.
   * @returns The JWT that has authenticated user.
   */
  async createUserToken(baseUri: string): Promise<string> {
    const initToken = await this.createSession(baseUri);
    const meRoute = `${baseUri}/users/me`;
    const preTest = await this.get(meRoute, {
      token: initToken,
    });
    if (preTest.status === 200) {
      return initToken;
    }
    const path = await this.getAuthSessionEndpoint(baseUri, initToken);
    const authUrl = new URL(`/v1${path}`, baseUri);
    // this test server uses mocked OAuth server which always returns user data.
    await this.get(authUrl.toString());
    // when the above finishes we are either authenticated as a user or not.
    // We gonna check the /users/me endpoint for confirmation.
    const result = await this.get(meRoute, {
      token: initToken,
    });
    // we expect a user info
    if (result.status !== 200) {
      throw new Error(`Authentication unsuccessful. Reported status for /users/me: ${result.status}`);
    }
    return initToken;
  }
}
