import { ArcLevelUp, Server } from '../index.js';
import Secrets from './secrets.js';

const port = 8080;
const prefix = '/v1';
const baseUri = `http://localhost:${port}${prefix}`;

class DevelopmentEnvironment {
  store: ArcLevelUp;
  server: Server;

  constructor() {
    this.store = new ArcLevelUp('develop/auth');
    this.server = new Server(this.store, {
      router: {
        prefix,
      },
      session: {
        secret: Secrets.secret,
      },
      authentication: {
        enabled: true,
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
