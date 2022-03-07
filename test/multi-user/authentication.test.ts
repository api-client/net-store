import { assert } from 'chai';
import getConfig from '../helpers/getSetup.js';
import HttpHelper from '../helpers/HttpHelper.js';
import WsHelper, { RawData } from '../helpers/WsHelper.js';

describe('Multi user', () => {
  let baseUri: string;
  let baseUriWs: string;
  const http = new HttpHelper();
  const ws = new WsHelper();

  before(async () => {
    const cnf = await getConfig();
    baseUri = cnf.multiUserBaseUri;
    baseUriWs = cnf.multiUserWsBaseUri;
  });

  describe('Authentication', () => {
    it('creates authentication session', async () => {
      const token = await http.createSession(baseUri);
      const loginEndpoint = `${baseUri}/auth/login`;
      const result = await http.post(loginEndpoint, {
        token,
      });
      assert.equal(result.status, 204, 'created the session');
      assert.include(result.headers.location, '/auth/login?state=', 'has the auth session location');
    });

    it('informs the client about the authentication result', async () => {
      const token = await http.createSession(baseUri);
      const loginEndpoint = `${baseUri}/auth/login`;
      const loginEndpointWs = `${baseUriWs}/auth/login`;
      const result = await http.post(loginEndpoint, {
        token,
      });
      const authUrl = new URL(`/v1${result.headers.location}`, baseUri);
      const client = await ws.createAndConnect(loginEndpointWs, token);
      const messages: any[] = [];
      client.on('message', (data: RawData) => {
        messages.push(JSON.parse(data.toString()));
      });
      // this test server uses mocked OAuth server which always returns user data.
      await http.get(authUrl.toString());
      await ws.disconnect(client);
      
      assert.lengthOf(messages, 1, 'received one event');
      const [ev] = messages;
      assert.equal(ev.status, 'OK', 'returns the OK status');
    });
  });
});
