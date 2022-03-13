/* eslint-disable import/no-named-as-default-member */
import { assert } from 'chai';
import { 
  IUser, IListResponse,
} from '@api-client/core';
import getConfig from '../helpers/getSetup.js';
import HttpHelper from '../helpers/HttpHelper.js';
import { RouteBuilder } from '../../index.js';
import { Tokens } from '../../src/session/Tokens.js';

describe('Multi user', () => {
  let baseUri: string;
  const http = new HttpHelper();
  const tokens = new Tokens('EOX0Xu6aSb', '7d');

  before(async () => {
    const cnf = await getConfig();
    baseUri = cnf.multiUserBaseUri;
  });

  describe('Users', () => {
    describe('/users/me', () => {
      let user1Token: string;
      let user2Token: string;

      before(async () => {
        user1Token = await http.createUserToken(baseUri);
        user2Token = await http.createUserToken(baseUri);
      });

      after(async () => {
        await http.delete(`${baseUri}/test/reset/users`);
        await http.delete(`${baseUri}/test/reset/sessions`);
      });

      it('returns user session for each user', async () => {
        const path = RouteBuilder.buildUsersMeRoute();
        const result1 = await http.get(`${baseUri}${path}`, { token: user1Token });
        const result2 = await http.get(`${baseUri}${path}`, { token: user2Token });
        assert.equal(result1.status, 200, 'user #1 status is 200');
        assert.equal(result2.status, 200, 'user #2 status is 200');
        const u1 = JSON.parse(result1.body as string) as IUser;
        const u2 = JSON.parse(result2.body as string) as IUser;
        assert.notDeepEqual(u1, u2, 'Users are different');
      });

      it('returns 401 when no token', async () => {
        const path = RouteBuilder.buildUsersMeRoute();
        const result = await http.get(`${baseUri}${path}`);
        assert.equal(result.status, 401);
      });

      it('returns 401 when invalid token', async () => {
        const token = tokens.generate({
          invalid: true,
        });
        const path = RouteBuilder.buildUsersMeRoute();
        const result = await http.get(`${baseUri}${path}`, { token });
        assert.equal(result.status, 401);
      });
    });

    describe('/users', () => {
      let user1Token: string;
      let user2Token: string;
      let user2: IUser;

      before(async () => {
        user1Token = await http.createUserToken(baseUri);
        user2Token = await http.createUserToken(baseUri);
        const user2Response = await http.get(`${baseUri}/users/me`, { token: user2Token });
        user2 = JSON.parse(user2Response.body as string) as IUser;
      });

      after(async () => {
        await http.delete(`${baseUri}/test/reset/users`);
        await http.delete(`${baseUri}/test/reset/sessions`);
      });

      it('lists all users', async () => {
        const path = RouteBuilder.buildUsersRoute();
        const result = await http.get(`${baseUri}${path}`, { token: user1Token });
        assert.equal(result.status, 200, 'has the 200 status code');
        const response = JSON.parse(result.body as string) as IListResponse;
        const data = response.data as IUser[];
        assert.lengthOf(data, 2, 'has both users');
        assert.typeOf(response.cursor, 'string', 'has the page cursor');

        const hasProvider = data.some(i => !!i.provider);
        assert.isFalse(hasProvider, 'data has no "provider".')
      });

      it('queries for the user by name', async () => {
        const q = user2.name.split(' ')[0];
        const path = RouteBuilder.buildUsersRoute();
        const result = await http.get(`${baseUri}${path}?query=${encodeURIComponent(q)}`, { token: user1Token });
        assert.equal(result.status, 200, 'has the 200 status code');
        const response = JSON.parse(result.body as string) as IListResponse;
        const data = response.data as IUser[];
        assert.lengthOf(data, 1, 'has the query user')
      });

      it('queries for the user by email', async () => {
        const email = user2.email as any[];
        const q = (email[0].email as string).split('@')[0];
        const path = RouteBuilder.buildUsersRoute();
        const result = await http.get(`${baseUri}${path}?query=${encodeURIComponent(q)}`, { token: user1Token });
        assert.equal(result.status, 200, 'has the 200 status code');
        const response = JSON.parse(result.body as string) as IListResponse;
        const data = response.data as IUser[];
        assert.lengthOf(data, 1, 'has the query user')
      });
    });
  });
});
