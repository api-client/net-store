/* eslint-disable import/no-named-as-default-member */
import { assert } from 'chai';
import jwt, { JwtPayload } from 'jsonwebtoken';
import getConfig from '../helpers/getSetup.js';
import HttpHelper from '../helpers/HttpHelper.js';

describe('http', () => {
  let baseUri: string;
  const http = new HttpHelper();

  describe('Sessions', () => {
    describe('Multi-user', () => {
      before(async () => {
        const cnf = await getConfig();
        baseUri = cnf.multiUserBaseUri;
      });
  
      describe('POST /sessions', () => {
        after(async () => {
          await http.delete(`${baseUri}/test/reset/sessions`);
        });
  
        it('creates a new session and returns the token', async () => {
          const result = await http.post(`${baseUri}/sessions`);
          assert.equal(result.status, 200, 'returns 200 status code');
          assert.include(result.headers['content-type'], 'text/plain', 'is a text/plain response');
          assert.typeOf(result.body, 'string', 'has the response body');
          const data = jwt.verify(result.body as string, 'EOX0Xu6aSb') as JwtPayload;
          assert.typeOf(data.sid as string, 'string', 'has the payload')
          assert.equal(data.aud as string, 'urn:api-client', 'has the aud')
          assert.equal(data.iss as string, 'urn:apic-store', 'has the iss')
        });
      });
  
      describe('POST /sessions/renew', () => {
        after(async () => {
          await http.delete(`${baseUri}/test/reset/sessions`);
        });
  
        it('returns 401 error when session not initialized', async () => {
          const result = await http.post(`${baseUri}/sessions/renew`);
          assert.equal(result.status, 401, 'has 401 status code');
          assert.include(result.headers['content-type'], 'application/json', 'has the application/json body');
          const body = JSON.parse(result.body as string);
          assert.equal(body.message, 'Not authorized', 'has the error message');
        });
  
        it('returns 401 error when no user session', async () => {
          const token = await http.createSession(baseUri);
          const result = await http.post(`${baseUri}/sessions/renew`, {
            token,
          });
          assert.equal(result.status, 401, 'has 401 status code');
          assert.include(result.headers['content-type'], 'application/json', 'has the application/json body');
          const body = JSON.parse(result.body as string);
          assert.equal(body.message, 'Not authorized', 'has the error message');
        });
  
        it('renews the token of an authenticated user', async () => {
          const token = await http.createUserToken(baseUri);
          const result = await http.post(`${baseUri}/sessions/renew`, {
            token,
          });
          assert.equal(result.status, 200, 'returns 200 status code');
          assert.include(result.headers['content-type'], 'text/plain', 'is a text/plain response');
          assert.typeOf(result.body, 'string', 'has the response body');
          assert.notEqual(result.body, token, 'has a new token');
        });
      });
  
      describe('DELETE /sessions', () => {
        after(async () => {
          await http.delete(`${baseUri}/test/reset/sessions`);
        });
  
        it('deletes an existing session', async () => {
          const token = await http.createUserToken(baseUri);
          const r1 = await http.delete(`${baseUri}/sessions`, {
            token,
          });
          assert.equal(r1.status, 205, 'has the 205 status');
          // make any request, should not authenticate
          const r2 = await http.get(`${baseUri}/files`, {
            token,
          });
          assert.equal(r2.status, 401, 'has the 401 status');
        });
      });
    });

    describe('Single user', () => {
      before(async () => {
        const cnf = await getConfig();
        baseUri = cnf.singleUserBaseUri;
      });
  
      function validateToken(token: string): void {
        const data = jwt.verify(token, 'EOX0Xu6aSb') as JwtPayload;
        assert.typeOf(data.sid as string, 'string', 'has the payload');
        assert.equal(data.aud as string, 'urn:api-client', 'has the aud');
        assert.equal(data.iss as string, 'urn:apic-store', 'has the iss');
      }

      describe('POST /sessions', () => {
        after(async () => {
          await http.delete(`${baseUri}/test/reset/sessions`);
        });
        
        it('creates a new session and returns the token', async () => {
          const result = await http.post(`${baseUri}/sessions`);
          assert.equal(result.status, 200, 'returns 200 status code');
          assert.include(result.headers['content-type'], 'text/plain', 'is a text/plain response');
          assert.typeOf(result.body, 'string', 'has the response body');
          validateToken(result.body as string);
        });
      });
  
      describe('POST /sessions/renew', () => {
        after(async () => {
          await http.delete(`${baseUri}/test/reset/sessions`);
        });
  
        it('returns a token when session not initialized', async () => {
          const token = await http.createSession(baseUri);
          const result = await http.post(`${baseUri}/sessions/renew`, { token });
          assert.equal(result.status, 200, 'has 200 status code');
          validateToken(result.body as string);
        });
  
        it('returns 200 when no user session', async () => {
          const token = await http.createSession(baseUri);
          const result = await http.post(`${baseUri}/sessions/renew`, {
            token,
          });
          assert.equal(result.status, 200, 'has 200 status code');
          validateToken(result.body as string);
        });
  
        it('renews the token of an authenticated user', async () => {
          const sessionInfo = await http.post(`${baseUri}/sessions`);
          const token = sessionInfo.body as string;
          const result = await http.post(`${baseUri}/sessions/renew`, {
            token,
          });
          assert.equal(result.status, 200, 'returns 200 status code');
          assert.include(result.headers['content-type'], 'text/plain', 'is a text/plain response');
          assert.typeOf(result.body, 'string', 'has the response body');
          assert.notEqual(result.body, token, 'has a new token');
        });
      });
  
      describe('DELETE /sessions', () => {
        after(async () => {
          await http.delete(`${baseUri}/test/reset/sessions`);
        });
  
        it('deletes an existing session', async () => {
          const r0 = await http.post(`${baseUri}/sessions`);
          const token = r0.body as string;
          const r1 = await http.delete(`${baseUri}/sessions`, {
            token,
          });
          assert.equal(r1.status, 205, 'has the 205 status');
          // make any request, should not authenticate
          const r2 = await http.get(`${baseUri}/files`, {
            token,
          });
          assert.equal(r2.status, 401, 'has the 401 status');
        });
      });
    });
  });
});
