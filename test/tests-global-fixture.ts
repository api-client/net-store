/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable import/no-named-as-default-member */

import fs from 'fs/promises';
import getPort from './helpers/getPort.js';
import path from 'path';
import { OAuth2Server, MutableResponse } from 'oauth2-mock-server';
import { DataMock } from '@pawel-up/data-mock';
import { DummyLogger } from '@api-client/core';
import { Server, ProxyServer } from '../index.js';
import { TestStore } from './helpers/TestStore.js';
import { SetupConfig } from './helpers/interfaces.js';
import { IServerConfiguration, IServerProxyConfiguration } from '../src/definitions.js';
import { TestsHttpRoute } from './helpers/TestsHttpRoute.js';
import { EchoServer } from './servers/EchoServer.js';

let noAuthServer: Server;
let oidcAuthServer: Server;
let proxyServer: ProxyServer;
let echoServer: EchoServer;
const oauthServer = new OAuth2Server(
  'test/certs/server_key.key',
  'test/certs/server_cert.crt'
);
const logger = new DummyLogger();
const noAuthStore = new TestStore(logger, 'test/data/no-auth');
const oidcAuthStore = new TestStore(logger, 'test/data/oidc-auth');

const lockFile = path.join('test', 'servers.lock');
const playgroundPath = path.join('test', 'data');

async function createPlayground(): Promise<void> {
  await fs.mkdir(playgroundPath, { recursive: true });
}

async function deletePlayground(): Promise<void> {
  await fs.rm(playgroundPath, { recursive: true, force: true });
}

const mock = new DataMock();

function beforeUserinfo(userInfoResponse: MutableResponse): void {
  const fName = mock.person.firstName();
  const sName = mock.person.lastName();
  const picture = mock.internet.avatar();
  const email = mock.internet.email();
  userInfoResponse.body = {
    sub: mock.types.uuid(),
    given_name: fName,
    family_name: sName,
    name: `${fName} ${sName}`,
    picture,
    email,
    email_verified: mock.types.boolean(),
    locale: mock.random.pickOne(['pl', 'en', 'pt', 'de', 'ja']),
  };
}
oauthServer.service.on('beforeUserinfo', beforeUserinfo);

export const mochaGlobalSetup = async () => {
  await createPlayground();

  const prefix = '/v1';
  const singleUserPort = await getPort();
  const multiUserPort = await getPort();
  const oauthPort = await getPort();
  const proxyPort = await getPort();
  const echoPort = await getPort();
  const singleUserBaseUri = `http://localhost:${singleUserPort}${prefix}`;
  const multiUserBaseUri = `http://localhost:${multiUserPort}${prefix}`;
  const singleUserWsBaseUri = `ws://localhost:${singleUserPort}${prefix}`;
  const multiUserWsBaseUri = `ws://localhost:${multiUserPort}${prefix}`;
  const proxyBaseUri = `http://localhost:${proxyPort}${prefix}`;
  const echoBaseUri = `http://localhost:${echoPort}/`;

  // OpenId server
  await oauthServer.issuer.keys.generate('RS256');
  await oauthServer.start(oauthPort);

  const singleUserConfig: IServerConfiguration = {
    mode: 'single-user',
    router: { prefix },
    session: {
      secret: 'EOX0Xu6aSb',
    },
    logger,
    portOrSocket: singleUserPort,
    host: 'localhost',
  };
  const multiUserConfig: IServerConfiguration = {
    router: { prefix },
    session: {
      secret: 'EOX0Xu6aSb',
    },
    mode: 'multi-user',
    isSsl: false,
    portOrSocket: multiUserPort,
    authentication: {
      type: 'oidc',
      config: {
        issuerUri: oauthServer.issuer.url as string,
        clientId: 'abcd',
        clientSecret: 'abcdefg',
        redirectBaseUri: multiUserBaseUri,
        ignoreCertErrors: true,
      }
    },
    logger,
  };

  const proxyConfig: IServerProxyConfiguration = ({
    port: proxyPort,
    prefix,
    logger,
    cors: {
      enabled: true,
      cors: {
        exposeHeaders: ['location'],
        // allowHeaders: '*',
        allowMethods: 'GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS',
        origin: (ctx) =>  ctx.request.header.origin || '',
      },
    },
  });
  
  noAuthServer = new Server(noAuthStore, singleUserConfig);
  oidcAuthServer = new Server(oidcAuthStore, multiUserConfig);
  proxyServer = new ProxyServer(proxyConfig);
  // stores
  await noAuthStore.initialize();
  await oidcAuthStore.initialize();
  
  // No auth test server
  await noAuthServer.initialize(TestsHttpRoute);
  await noAuthServer.start();
  // OpenID Connect test server
  await oidcAuthServer.initialize(TestsHttpRoute);
  await oidcAuthServer.start();
  // proxy server
  await proxyServer.start();
  // echo server for tests
  echoServer = new EchoServer();
  await echoServer.start(echoPort);

  const info: SetupConfig = {
    singleUserBaseUri,
    multiUserBaseUri,
    singleUserPort,
    multiUserPort,
    oauthPort,
    prefix,
    singleUserWsBaseUri,
    multiUserWsBaseUri,
    proxyPort,
    proxyBaseUri,
    echoPort,
    echoBaseUri,
  };
  await fs.writeFile(lockFile, JSON.stringify(info));
};

export const mochaGlobalTeardown = async () => {
  await oauthServer.stop();
  await noAuthServer.stop();
  await proxyServer.stop();
  await echoServer.stop();
  await noAuthServer.cleanup();
  await oidcAuthServer.stop();
  await oidcAuthServer.cleanup();
  await noAuthStore.cleanup();
  await oidcAuthStore.cleanup();
  await fs.rm(lockFile, { force: true });
  await deletePlayground();
};
