/* eslint-disable no-console */
import { DefaultLogger } from '@api-client/core';
import { StoreLevelUp, Server } from '../index.js';
import Secrets from './secrets.js';

const port = 8080;
const prefix = '/v1';
const baseUri = `http://localhost:${port}${prefix}`;

class DevelopmentEnvironment {
  store: StoreLevelUp;
  server: Server;

  constructor() {
    const logger = new DefaultLogger();
    this.store = new StoreLevelUp(logger, 'develop/auth');
    this.server = new Server(this.store, {
      mode: 'multi-user',
      logger,
      router: {
        prefix,
      },
      session: {
        secret: Secrets.secret,
      },
      authentication: {
        type: 'oidc',
        config: {
          issuerUri: 'https://accounts.google.com/',
          clientId: Secrets.oidcClientId,
          clientSecret: Secrets.oidcClientSecret,
          redirectBaseUri: baseUri,
        }
      }
    });
  }
  
  async start(): Promise<void> {
    await this.store.initialize();
    await this.server.initialize();
    await this.server.startHttp(port);
    console.log(`Server started: ${baseUri}`);
  }
}

const instance = new DevelopmentEnvironment();
instance.start();
