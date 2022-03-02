/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable import/no-named-as-default-member */

import fs from 'fs/promises';
import getPort from './helpers/getPort.js';
import path from 'path';
import { OAuth2Server } from 'oauth2-mock-server';
import { Server } from '../index.js';
import { TestStore } from './helpers/TestStore.js';
import { SetupConfig } from './helpers/interfaces.js';
import { ITestingServerConfiguration } from '../src/definitions.js';

let noAuthServer: Server;
let oidcAuthServer: Server;
const oauthServer = new OAuth2Server(
  'test/certs/server_key.key',
  'test/certs/server_cert.crt'
);
const noAuthStore = new TestStore('test/data/no-auth');
const oidcAuthStore = new TestStore('test/data/oidc-auth');

const lockFile = path.join('test', 'servers.lock');
const playgroundPath = path.join('test', 'data');

async function createPlayground(): Promise<void> {
  await fs.mkdir(playgroundPath, { recursive: true });
}

async function deletePlayground(): Promise<void> {
  await fs.rm(playgroundPath, { recursive: true, force: true });
}

export const mochaGlobalSetup = async () => {
  await createPlayground();

  const prefix = '/v1';
  const singleUserPort = await getPort();
  const multiUserPort = await getPort();
  const oauthPort = await getPort();
  const singleUserBaseUri = `http://localhost:${singleUserPort}${prefix}`;
  const multiUserBaseUri = `http://localhost:${multiUserPort}${prefix}`;

  // OpenId server
  await oauthServer.issuer.keys.generate('RS256');
  await oauthServer.start(oauthPort);

  const singleUserConfig: ITestingServerConfiguration = {
    router: { prefix },
    session: {
      secret: 'EOX0Xu6aSb',
    },
    testing: true,
  };
  const multiUserConfig: ITestingServerConfiguration = {
    router: { prefix },
    session: {
      secret: 'EOX0Xu6aSb',
    },
    authentication: {
      enabled: true,
      type: 'oidc',
      config: {
        issuerUri: oauthServer.issuer.url as string,
        clientId: 'abcd',
        clientSecret: 'abcdefg',
        redirectBaseUri: multiUserBaseUri,
        ignoreCertErrors: true,
      }
    },
    testing: true,
  };
  
  noAuthServer = new Server(noAuthStore, singleUserConfig);
  oidcAuthServer = new Server(oidcAuthStore, multiUserConfig);
  // stores
  await noAuthStore.initialize();
  await oidcAuthStore.initialize();
  
  // No auth test server
  await noAuthServer.initialize();
  await noAuthServer.startHttp(singleUserPort);
  // OpenID Connect test server
  await oidcAuthServer.initialize();
  await oidcAuthServer.startHttp(multiUserPort);

  const info: SetupConfig = {
    singleUserBaseUri,
    multiUserBaseUri,
    singleUserPort,
    multiUserPort,
    oauthPort,
    prefix,
  };
  await fs.writeFile(lockFile, JSON.stringify(info));
};

export const mochaGlobalTeardown = async () => {
  await oauthServer.stop();
  await noAuthServer.stopHttp();
  await noAuthServer.cleanup();
  await oidcAuthServer.stopHttp();
  await oidcAuthServer.cleanup();
  await noAuthStore.cleanup();
  await oidcAuthStore.cleanup();
  await fs.rm(lockFile, { force: true });
  await deletePlayground();
};
