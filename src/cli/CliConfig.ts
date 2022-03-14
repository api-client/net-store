import { DefaultLogger } from '@api-client/core';
import { ICommandOptions } from './CliOptions.js';
import { IServerConfiguration, IAuthenticationConfiguration, AuthorizationSchemes, AuthorizationTypes, IOidcConfiguration } from '../definitions.js';

export class CliConfig {
  static getAuthType(opts: ICommandOptions): AuthorizationTypes {
    const { authType } = opts;
    if (!authType) {
      throw new Error(`You need to specify the authentication type in the multi-user mode.`);
    }
    if (!['oidc'].includes(authType)) {
      throw new Error(`Unsupported authentication type: ${authType}.`);
    }
    return authType as AuthorizationTypes;
  }

  static getSingleModeOptions(opts: ICommandOptions): IServerConfiguration {
    const { prefix, sessionSecret } = opts;
    const logger = new DefaultLogger();
    const config: IServerConfiguration = {
      mode: 'single-user',
      logger,
      session: {},
      router: {},
    };
    if (sessionSecret) {
      config.session!.secret = sessionSecret;
    }
    if (prefix) {
      config.router!.prefix = prefix;
    }
    return config;
  }

  static getMultiModeOptions(opts: ICommandOptions): IServerConfiguration {
    const { authType } = opts;
    const config = this.getSingleModeOptions(opts);
    config.mode = 'multi-user';
    if (!authType) {
      throw new Error(`You need to specify the authentication type in the multi-user mode.`);
    }
    if (!['oidc'].includes(authType)) {
      throw new Error(`Unsupported authentication type: ${authType}.`);
    }
    config.authentication = this.collectAuthConfiguration(opts);
    return config;
  }

  static getPort(opts: ICommandOptions): number {
    const { port } = opts;
    if (!port) {
      throw new Error(`The "port" option is required. You can also set the "API_STORE_PORT" environment variable.`);
    }
    const typedPort = Number(port);
    if (Number.isNaN(typedPort)) {
      throw new Error(`The "port" option has an invalid value. Please, specify a port number.`);
    }
    return typedPort;
  }

  private static collectAuthConfiguration(opts: ICommandOptions): IAuthenticationConfiguration {
    let config: AuthorizationSchemes | undefined;
    switch (opts.authType) {
      case 'oidc': config = this.collectOidcConfig(opts);
    }
    if (!config) {
      throw new Error(`Unsupported authentication type: ${opts.authType}.`);
    }
    return {
      type: opts.authType as AuthorizationTypes,
      config,
    }
  }

  private static collectOidcConfig(opts: ICommandOptions): IOidcConfiguration {
    const { oidcClientId, oidcClientSecret, oidcDomain, oidcRedirectBase, oidcIssuerUri } = opts;
    if (!oidcClientId) {
      throw new Error(`You need to specify the "--oidc-client-id" option in the multi-user mode.`);
    }
    if (!oidcClientSecret) {
      throw new Error(`You need to specify the "--oidc-client-secret" option in the multi-user mode.`);
    }
    if (!oidcIssuerUri) {
      throw new Error(`You need to specify the "--oidc-issuer-uri" option in the multi-user mode.`);
    }
    if (!oidcRedirectBase) {
      throw new Error(`You need to specify the "--oidc-redirect-base" option in the multi-user mode.`);
    }
    const result: IOidcConfiguration = {
      clientId: oidcClientId,
      clientSecret: oidcClientSecret,
      issuerUri: oidcIssuerUri,
      redirectBaseUri: oidcRedirectBase,
    };
    if (Array.isArray(oidcDomain)) {
      result.allowedDomains = oidcDomain;
    }
    return result;
  }
}
