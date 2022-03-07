/* eslint-disable no-console */
import { DefaultLogger } from '@api-client/core';
import { ArcLevelUp, Server } from '../index.js';

class DevelopmentEnvironment {
  store: ArcLevelUp;
  server: Server;

  constructor() {
    const logger = new DefaultLogger();
    this.store = new ArcLevelUp(logger, 'develop/dbs');
    this.server = new Server(this.store, {
      logger,
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
