/* eslint-disable import/no-named-as-default-member */
import { assert } from 'chai';
import { IUser, RouteBuilder, StoreSdk } from '@api-client/core';
import getConfig from '../helpers/getSetup.js';
import HttpHelper from '../helpers/HttpHelper.js';
import { Tokens } from '../../src/session/Tokens.js';

describe('http', () => {
  let baseUri: string;
  let sdk: StoreSdk;
  const http = new HttpHelper();
  const tokens = new Tokens('EOX0Xu6aSb', '7d');

  describe('Multi-user', () => {

    before(async () => {
      const cnf = await getConfig();
      baseUri = cnf.multiUserBaseUri;
      sdk = new StoreSdk(cnf.multiUserBaseUri);
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
          const user1 = await sdk.user.me({ token: user1Token });
          const user2 = await sdk.user.me({ token: user2Token });
          assert.notDeepEqual(user1, user2, 'Users are different');
        });

        it('returns 401 when no token', async () => {
          const path = RouteBuilder.usersMe();
          const result = await http.get(`${baseUri}${path}`);
          assert.equal(result.status, 401);
        });

        it('returns 401 when invalid token', async () => {
          const token = tokens.generate({
            invalid: true,
          });
          const path = RouteBuilder.usersMe();
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
          user2 = await sdk.user.me({ token: user2Token });
        });

        after(async () => {
          await http.delete(`${baseUri}/test/reset/users`);
          await http.delete(`${baseUri}/test/reset/sessions`);
        });

        it('lists all users', async () => {
          const list = await sdk.user.list(undefined, { token: user1Token });
          assert.lengthOf(list.data, 2, 'has both users');
          assert.typeOf(list.cursor, 'string', 'has the page cursor');

          const hasProvider = list.data.some(i => !!i.provider);
          assert.isFalse(hasProvider, 'data has no "provider".')
        });

        it('queries for the user by name', async () => {
          const q = user2.name.split(' ')[0];
          const list = await sdk.user.list({ query: q }, { token: user1Token });
          assert.lengthOf(list.data, 1, 'has the query user')
        });

        it('queries for the user by email', async () => {
          const email = user2.email as any[];
          const q = (email[0].email as string).split('@')[0];
          const list = await sdk.user.list({ query: q }, { token: user1Token });
          assert.lengthOf(list.data, 1, 'has the query user')
        });
      });

      describe('/users/user', () => {
        let user1Token: string;
        let user2: IUser;

        before(async () => {
          user1Token = await http.createUserToken(baseUri);
          user2 = await sdk.user.me({ token: user1Token });
          sdk.token = user1Token;
        });

        after(async () => {
          await http.delete(`${baseUri}/test/reset/users`);
          await http.delete(`${baseUri}/test/reset/sessions`);
        });

        it('reads the user from the store', async () => {
          const result = await sdk.user.read(user2.key);
          assert.deepEqual(result, user2);
          assert.isUndefined(result.provider, 'has no "provider"')
        });

        it('returns 404 when no user', async () => {
          const path = RouteBuilder.user('other');
          const result = await http.get(`${baseUri}${path}`, { token: user1Token });
          assert.equal(result.status, 404, 'has the 404 status code');
        });

        it('returns 401 when no token', async () => {
          const path = RouteBuilder.user(user2.key);
          const result = await http.get(`${baseUri}${path}`);
          assert.equal(result.status, 401, 'has the 401 status code');
        });
      });
    });
  });
});
