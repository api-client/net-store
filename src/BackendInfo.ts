import { IBackendInfo } from '@api-client/core';
import { IServerConfiguration, IOidcConfiguration } from './definitions.js';

export class BackendInfo {
  info: IBackendInfo = {
    auth: { path: '/auth/login' },
    hosting: { port: 0 },
    mode: 'single-user',
    capabilities: [
      'files',
      'http-history',
      'app-history',
      'app-projects',
    ],
  };

  toJSON(): IBackendInfo {
    return { ...this.info };
  }

  applyConfig(opts: IServerConfiguration): void {
    const { authentication, mode, router, portOrSocket, host, } = opts;
    const { info } = this;
    info.mode = mode === 'multi-user' ? mode : 'single-user';
    if (router && router.prefix) {
      info.hosting.prefix = router.prefix;
    }
    if (host) {
      info.hosting.host = host;
    }
    if (typeof portOrSocket === 'string') {
      info.hosting.socket = portOrSocket;
    } else if (typeof portOrSocket === 'number') {
      info.hosting.port = portOrSocket;
    }

    if (typeof authentication === 'object') {
      info.auth.type = authentication.type;
      if (authentication.type === 'oidc') {
        info.auth.redirect = (authentication.config as IOidcConfiguration).issuerUri;
      }
      info.capabilities.push('authorization');
      info.capabilities.push('authentication');
    }
  }
}
