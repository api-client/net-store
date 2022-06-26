/* eslint-disable import/no-named-as-default-member */
import { assert, use } from 'chai';
import chaiUuid from 'chai-uuid';
import { 
  StoreSdk, HttpRequestKind, IApiError, IRequestLog, RequestLog, IBasicAuthorization,
  IRequestProxyInit,
  SetDataStepKind,
  ISetDataStep,
  SetVariableStepKind,
  ISetVariableStep,
  IProxyResult,
} from '@api-client/core';
import getConfig from '../helpers/getSetup.js';
import HttpHelper from '../helpers/HttpHelper.js';

use(chaiUuid);

describe('HTTP proxy', () => {
  describe('RequestProxy', () => {
    const http = new HttpHelper();
    let apiUri: string;
    let proxyUri: string;
    let proxyToken: string;
    let echoBaseUri: string;
    let sdk: StoreSdk;
    let message: IRequestProxyInit;

    before(async () => {
      const cnf = await getConfig();
      apiUri = cnf.multiUserBaseUri;
      proxyUri = cnf.proxyBaseUri;
      echoBaseUri = cnf.echoBaseUri;
      sdk = new StoreSdk(cnf.multiUserBaseUri);
      sdk.silent = true;
      sdk.token = await http.createUserToken(apiUri);
      proxyToken = `${sdk.token}, ${apiUri}`;
    });

    after(async () => {
      await http.delete(`${apiUri}/test/reset/users`);
      await http.delete(`${apiUri}/test/reset/sessions`);
    });

    beforeEach(() => {
      message = {
        kind: HttpRequestKind,
        request: {
          url: echoBaseUri,
          method: 'GET',
        },
        authorization: [],
      };
    });

    it('returns an error when no request', async () => {
      // @ts-ignore
      delete message.request;
      const body = JSON.stringify(message);
      const info = await http.post(proxyUri, { token: proxyToken, body });
      assert.equal(info.status, 400, 'has the 400 status code');
      const response = JSON.parse(info.body as string) as IApiError;
      assert.isTrue(response.error, 'has the error response');
      assert.equal(response.code, 400, 'has the error code');
      assert.equal(response.message, 'Invalid request', 'has the message');
      assert.equal(response.detail, 'The "request" parameter is required.');
    });

    it('returns an error when the request has no URL', async () => {
      // @ts-ignore
      delete message.request.url;
      const body = JSON.stringify(message);
      const info = await http.post(proxyUri, { token: proxyToken, body });
      assert.equal(info.status, 400, 'has the 400 status code');
      const response = JSON.parse(info.body as string) as IApiError;
      assert.isTrue(response.error, 'has the error response');
      assert.equal(response.code, 400, 'has the error code');
      assert.equal(response.message, 'Invalid request', 'has the message');
      assert.equal(response.detail, 'The "request.url" parameter is required.');
    });

    it('proxies a GET request', async () => {
      message.request.headers = 'x-test: true\nauthorization: xyz';
      message.request.url += '?a=b#c';
      const body = JSON.stringify(message);
      const runInfo = await http.post(proxyUri, { token: proxyToken, body });
      assert.equal(runInfo.status, 200, 'has status code');
      assert.include(runInfo.headers['content-type'], 'application/json', 'has the content type');
      const result = JSON.parse(runInfo.body as string) as IProxyResult<IRequestLog>;
      const data = new RequestLog(result.result);
      const echo = JSON.parse(await data.response?.readPayloadAsString() as string);
      assert.equal(echo.headers['x-test'], 'true');
      assert.equal(echo.url, '/?a=b');
    });

    it('adds the authorization data', async () => {
      message.authorization = [{
        kind: 'Core#RequestAuthorization',
        enabled: true,
        type: 'basic',
        valid: true,
        config: {
          username: 'a',
          password: 'b',
        } as IBasicAuthorization,
      }];
      const body = JSON.stringify(message);
      const runInfo = await http.post(proxyUri, { token: proxyToken, body });
      assert.equal(runInfo.status, 200, 'has status code');
      assert.include(runInfo.headers['content-type'], 'application/json', 'has the content type');
      const result = JSON.parse(runInfo.body as string) as IProxyResult<IRequestLog>;
      const data = new RequestLog(result.result);
      const echo = JSON.parse(await data.response?.readPayloadAsString() as string);
      assert.equal(echo.headers['authorization'], 'Basic YTpi');
    });

    it('adds the variables', async () => {
      message.variables = {
        v1: 'value1',
      };
      message.request.url += '?a={v1}';
      const body = JSON.stringify(message);
      const runInfo = await http.post(proxyUri, { token: proxyToken, body });
      assert.equal(runInfo.status, 200, 'has status code');
      const result = JSON.parse(runInfo.body as string) as IProxyResult<IRequestLog>;
      const data = new RequestLog(result.result);
      const echo = JSON.parse(await data.response?.readPayloadAsString() as string);
      assert.equal(echo.url, '/?a=value1');
    });

    it('adds the request flows', async () => {
      message.flows = [
        {
          trigger: 'request',
          actions: [
            {
              steps: [
                {
                  kind: SetDataStepKind,
                  value: 'val1',
                } as ISetDataStep,
                {
                  kind: SetVariableStepKind,
                  name: 'var1',
                } as ISetVariableStep,
              ],
            }
          ],
        }
      ];
      const body = JSON.stringify(message);
      const runInfo = await http.post(proxyUri, { token: proxyToken, body });
      assert.equal(runInfo.status, 200, 'has status code');
      const response = JSON.parse(runInfo.body as string) as IProxyResult<IRequestLog>;
      const vars = response.variables as Record<string, string>;
      assert.equal(vars.var1, 'val1');
    });

    it('proxies a body', async () => {
      message.request.method = 'POST';
      message.request.headers = `content-type: application/json`;
      message.request.payload = `{"test":true}`;
      const body = JSON.stringify(message);
      const runInfo = await http.post(proxyUri, { token: proxyToken, body });
      assert.equal(runInfo.status, 200, 'has status code');
      const result = JSON.parse(runInfo.body as string) as IProxyResult<IRequestLog>;
      const data = new RequestLog(result.result);
      const echo = JSON.parse(await data.response?.readPayloadAsString() as string);
      assert.equal(echo.body, '{"test":true}');
    });
  });
});
