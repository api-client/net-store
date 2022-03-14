import { Command, Argument, Option,  } from 'commander';

export interface ICommandOptions {
  port?: string;
  prefix?: string;
  sessionSecret?: string;
  authType?: string;
  oidcClientId?: string;
  oidcClientSecret?: string;
  oidcIssuerUri?: string;
  oidcRedirectBase?: string;
  oidcDomain?: string[];
  dataPath?: string;
}

export class CliOptions {
  static addOptions(program: Command): void {
    program
    .addArgument(this.modeArgument())
    .addOption(this.portOption())
    .addOption(this.prefixOption())
    .addOption(this.sessionSecretOption())
    .addOption(this.authTypeOption())
    .addOption(this.oidcIssuerUriOption())
    .addOption(this.oauthCidOption())
    .addOption(this.oauthCisOption())
    .addOption(this.oidcRedirectBaseOption())
    .addOption(this.oidcDomainOption())
    .addOption(this.dataPathOption())
  }

  private static modeArgument(): Argument {
    return new Argument(
      '[mode]', 
      'The store mode. The single user mode does not require authentication configuration. The multi user mode is targeted to run the instance of the store in a local network so multiple users may use the same store.'
    )
    .choices(['single-user', 'multi-user'])
    .default('single-user');
  }

  private static portOption(): Option {
    const portOption = new Option(
      '-p, --port <value>', 
      'The port on which to start the server.'
    )
    .env('API_STORE_PORT');
    portOption.required = true;
    return portOption;
  }

  private static sessionSecretOption(): Option {
    return new Option(
      '--session-secret [value]', 
      'A secret to use with the application session to has the data.'
    )
    .env('API_STORE_SIS_SECRET');
  }

  private static authTypeOption(): Option {
    return new Option(
      '--auth-type [value]', 
      'Authentication type to use with the store. Required for the "multi-user" mode.'
    )
    .choices(['oidc']);
  }

  private static oauthCidOption(): Option {
    return new Option(
      '--oidc-client-id [value]', 
      'The OAuth2 client id.'
    )
    .env('API_STORE_AUTH_CID');
  }

  private static oauthCisOption(): Option {
    return new Option(
      '--oidc-client-secret [value]', 
      'The OAuth2 client secret.'
    )
    .env('API_STORE_AUTH_CIS');
  }

  private static prefixOption(): Option {
    return new Option(
      '--prefix', 
      'The prefix to all API routes, including authentication. OAuth configuration must include the prefix'
    );
  }

  private static oidcIssuerUriOption(): Option {
    return new Option(
      '--oidc-issuer-uri [value]', 
      'OpenID Connect issuer URL.'
    );
  }

  private static oidcRedirectBaseOption(): Option {
    return new Option(
      '--oidc-redirect-base [value]', 
      'OAuth2 redirect base URI. Should include the prefix.'
    );
  }

  private static oidcDomainOption(): Option {
    return new Option(
      '--oidc-domain [value...]', 
      'The list of domains the users are authorized to register from.'
    );
  }

  private static dataPathOption(): Option {
    return new Option(
      '--data-path [value]', 
      'The location where the store should keep its data. By default it keeps the data in the user config directory.'
    );
  }
}
