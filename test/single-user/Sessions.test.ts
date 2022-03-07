/* eslint-disable import/no-named-as-default-member */
import { assert } from 'chai';
import jwt, { JwtPayload } from 'jsonwebtoken';
import getConfig from '../helpers/getSetup.js';
import HttpHelper from '../helpers/HttpHelper.js';

describe('Single user', () => {
  describe('Sessions', () => {
    let baseUri: string;
    const http = new HttpHelper();

    before(async () => {
      const cnf = await getConfig();
      baseUri = cnf.singleUserBaseUri;
    });

    describe('POST /sessions', () => {
      it('creates a new session and returns the token', async () => {
        const result = await http.post(`${baseUri}/sessions`);
        assert.equal(result.status, 200, 'returns 200 status code');
        assert.include(result.headers['content-type'], 'text/plain', 'is a text/plain response');
        assert.typeOf(result.body, 'string', 'has the response body');
        const data = jwt.verify(result.body as string, 'EOX0Xu6aSb') as JwtPayload;
        assert.typeOf(data.sid as string, 'string', 'has the payload')
        assert.equal(data.aud as string, 'urn:api-client', 'has the aud')
        assert.equal(data.iss as string, 'urn:arc-store', 'has the iss')
      });
    });
  });
});
