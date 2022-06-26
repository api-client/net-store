/* eslint-disable import/no-named-as-default-member */
import { assert, use } from 'chai';
import chaiUuid from 'chai-uuid';
import { 
  HttpProject, HttpProjectKind, RouteBuilder, StoreSdk,
  Project, IApiError, IProjectExecutionLog, IHttpProjectProxyInit, IProxyResult,
} from '@api-client/core';
import getConfig from '../helpers/getSetup.js';
import HttpHelper from '../helpers/HttpHelper.js';

use(chaiUuid);

describe('HTTP proxy', () => {
  describe('HttpProjectProxy', () => {
    const http = new HttpHelper();
    let apiUri: string;
    let proxyUri: string;
    let sdk: StoreSdk;
    let pid: string;
    let proxyToken: string;

    before(async () => {
      const cnf = await getConfig();
      apiUri = cnf.multiUserBaseUri;
      proxyUri = cnf.proxyBaseUri;
      sdk = new StoreSdk(cnf.multiUserBaseUri);
      sdk.silent = true;
      sdk.token = await http.createUserToken(apiUri);

      proxyToken = `${sdk.token}, ${apiUri}`;

      // create a project

      const p1 = HttpProject.fromName('p1');
      p1.addRequest(`${apiUri}${RouteBuilder.backend()}`);
      const f1 = Project.fromProject(p1).toJSON();
      await sdk.file.create(f1, p1.toJSON());
      pid = p1.key;
    });

    after(async () => {
      await http.delete(`${apiUri}/test/reset/files`);
      await http.delete(`${apiUri}/test/reset/users`);
      await http.delete(`${apiUri}/test/reset/sessions`);
    });

    it('returns an error when no pid', async () => {
      const body = JSON.stringify({
        kind: HttpProjectKind,
        options: {},
      } as IHttpProjectProxyInit);
      const info = await http.post(proxyUri, { token: proxyToken, body });
      assert.equal(info.status, 400, 'has the 400 status code');
      const response = JSON.parse(info.body as string) as IApiError;
      assert.isTrue(response.error, 'has the error response');
      assert.equal(response.code, 400, 'has the error code');
      assert.equal(response.message, 'Invalid request', 'has the message');
      assert.equal(response.detail, 'The "pid" parameter is required.', 'has the detail');
    });

    it('returns an error when no options', async () => {
      const body = JSON.stringify({
        kind: HttpProjectKind,
        pid,
      } as IHttpProjectProxyInit);
      const info = await http.post(proxyUri, { token: proxyToken, body });
      assert.equal(info.status, 400, 'has the 400 status code');
      const response = JSON.parse(info.body as string) as IApiError;
      assert.isTrue(response.error, 'has the error response');
      assert.equal(response.code, 400, 'has the error code');
      assert.equal(response.message, 'Invalid request', 'has the message');
      assert.equal(response.detail, 'The "options" parameter is required.', 'has the detail');
    });

    it('returns an error when no token', async () => {
      const body = JSON.stringify({
        kind: HttpProjectKind,
        pid,
        options: {},
      } as IHttpProjectProxyInit);
      const info = await http.post(proxyUri, { body });
      assert.equal(info.status, 401, 'has the 401 status code');
      const response = JSON.parse(info.body as string) as IApiError;
      assert.isTrue(response.error, 'has the error response');
      assert.equal(response.code, 401, 'has the error code');
      assert.equal(response.message, 'Unauthorized', 'has the message');
      assert.equal(response.detail, 'Unauthorized to use the proxy service. Set the authentication credentials.', 'has the detail');
    });

    it('returns an error when no store URI', async () => {
      const body = JSON.stringify({
        kind: HttpProjectKind,
        pid,
        options: {},
      } as IHttpProjectProxyInit);
      const info = await http.post(proxyUri, { token: sdk.token, body });
      assert.equal(info.status, 401, 'has the 401 status code');
      const response = JSON.parse(info.body as string) as IApiError;
      assert.isTrue(response.error, 'has the error response');
      assert.equal(response.code, 401, 'has the error code');
      assert.equal(response.message, 'Invalid credentials', 'has the message');
      assert.equal(response.detail, 'The store uri is missing.', 'has the detail');
    });

    it('returns an error when invalid store URI', async () => {
      const body = JSON.stringify({
        kind: HttpProjectKind,
        pid,
        options: {},
      } as IHttpProjectProxyInit);
      const info = await http.post(proxyUri, { token: sdk.token + ', test', body });
      assert.equal(info.status, 401, 'has the 401 status code');
      const response = JSON.parse(info.body as string) as IApiError;
      assert.isTrue(response.error, 'has the error response');
      assert.equal(response.code, 401, 'has the error code');
      assert.equal(response.message, 'Invalid credentials', 'has the message');
      assert.equal(response.detail, 'The store uri is invalid.', 'has the detail');
    });

    it('returns an error when no user', async () => {
      const body = JSON.stringify({
        kind: HttpProjectKind,
        pid,
        options: {},
      } as IHttpProjectProxyInit);
      const info = await http.post(proxyUri, { token: `test, ${apiUri}`, body });
      assert.equal(info.status, 401, 'has the 401 status code');
      const response = JSON.parse(info.body as string) as IApiError;
      assert.isTrue(response.error, 'has the error response');
      assert.equal(response.code, 401, 'has the error code');
      assert.equal(response.message, 'Invalid credentials', 'has the message');
      assert.equal(response.detail, 'The access token is invalid or expired.', 'has the detail');
    });

    it('proxies the project requests', async () => {
      const body = JSON.stringify({
        kind: HttpProjectKind,
        pid,
        options: {},
      } as IHttpProjectProxyInit);
      const runInfo = await http.post(proxyUri, { token: proxyToken, body });
      assert.equal(runInfo.status, 200, 'has status code');
      assert.include(runInfo.headers['content-type'], 'application/json', 'has the content type');
      const response = JSON.parse(runInfo.body as string) as IProxyResult<IProjectExecutionLog>;
      assert.ok(response.result, 'has the result');
      assert.typeOf(response.result.started, 'number', 'has the response.started');
      assert.typeOf(response.result.ended, 'number', 'has the response.ended');
      assert.typeOf(response.result.iterations, 'array', 'has the response.iterations');
    });
  });
});
