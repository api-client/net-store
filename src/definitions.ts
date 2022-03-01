import http from 'http';
import https from 'https';
import { Options as CorsOptions } from '@koa/cors';
import { DefaultState } from 'koa';
import { IUser } from '@advanced-rest-client/core';
import { Authentication } from './authentication/Authentication.js'

export type SupportedServer = 'https' | 'http';

export interface IRunningServer {
  server: https.Server | http.Server;
  type: SupportedServer;
  portOrSocket: number | string;
}

export interface IServerConfiguration {
  /**
   * Router configuration options.
   */
  router?: IRouterConfiguration;
  /**
   * CORS configuration.
   */
  cors?: ICorsConfiguration;
  /**
   * The authentication configuration, if any.
   * 
   * By default the server is installed with ARC (and other apps)
   * on the same machine without authentication support. All requests are treated as authenticated
   * in a single-user environment.
   * 
   * When this is set the server turns into a multi-user mode where the user must be authenticated
   * to access server resources. This configuration tells the server how to obtain user credentials.
   * 
   * Preferred way is to use the OIDC scheme. Additionally you can use server hooks to register own middleware
   * to support authentication.
   */
  authentication?: IAuthenticationConfiguration | typeof Authentication;
  /**
   * Configuration related to session.
   * 
   * Note, the server does not use the HTTP session mechanisms (like cookies). It handles it's session via the authorization header.
   */
  session?: ISessionConfiguration;
}

export interface ISessionConfiguration {
  /**
   * The secret used to encrypt session data.
   * Should not be revealed no anyone other than the developer. Use secrets/variables to pass this value.
   */
  secret?: string;
  /**
   * Expressed in seconds or a string describing a time span zeit/ms.
   * Eg: 60, "2 days", "10h", "7d". A numeric value is interpreted as a seconds count. 
   * If you use a string be sure you provide the time units (days, hours, etc), otherwise milliseconds unit is used by default 
   * ("120" is equal to "120ms").
   */
  expiresIn?: string | number;
}

export interface ICorsConfiguration {
  /**
   * When set it enables CORS headers for the API.
   * By default it is disabled.
   */
  enabled?: boolean;
  /**
   * Optional configuration passed to `@koa/cors`.
   * See more here: https://github.com/koajs/cors
   * When not set it uses default values.
   * 
   * Note, default values apply the request's origin to the `Access-Control-Allow-Origin` header.
   */
  cors?: CorsOptions;
}

export interface IAuthenticationConfiguration {
  /**
   * Whether the authentication is supported by the server.
   */
  enabled: boolean;
  /**
   * The authentication protocol to use. Not set when just disabling the configuration.
   */
  type?: AuthorizationTypes;
  /**
   * The authentication configuration depending on the selected type.
   */
  config?: AuthorizationSchemes;
}

export type AuthorizationSchemes = IOidcConfiguration;
export type AuthorizationTypes = 'oidc';

export interface IOidcConfiguration {
  /**
   * The URL of the issuer for discovery.
   * The server download the discovery list and populates the required data.
   */
  issuerUri: string;
  /**
   * The application client id registered in the oauth provider.
   */
  clientId: string;
  /**
   * The application client secret registered in the oauth provider.
   * This should be passed to the configuration environment as a variable. Do not make the secret public.
   */
  clientSecret: string;
  /**
   * Technically the whole base URI of the server, including the prefix.
   * The redirect URI must point back to the same domain, port, and base URI as this server.
   */
  redirectBaseUri: string;
}

export interface IRouterConfiguration {
  /**
   * The prefix to use with the API routes. E.g. /api/v1.
   */
  prefix?: string;
}

export interface IApplicationState extends DefaultState {
  /**
   * When authenticated, it contains the user object.
   */
  user?: IUser;
  /**
   * When the session was initialized then it contains the session identifier.
   */
  sid?: string;
}
