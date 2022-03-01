import { ArcLevelUp, Server } from '../index.js';

class DevelopmentEnvironment {
  store: ArcLevelUp;
  server: Server;

  constructor() {
    this.store = new ArcLevelUp('develop/dbs');
    this.server = new Server(this.store, {
      router: {
        prefix: '/v1',
      }
    });
  }
  async start(): Promise<void> {
    await this.store.initialize();
    await this.server.initialize();
    await this.server.startHttp(8080);
    console.log(`Server started: http://localhost:8080/v1`);
  }
}

const instance = new DevelopmentEnvironment();
instance.start();
