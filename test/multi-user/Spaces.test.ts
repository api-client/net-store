/* eslint-disable import/no-named-as-default-member */
import { assert } from 'chai';
import { Workspace, IUserWorkspace, IWorkspace, WorkspaceKind, IListResponse } from '@advanced-rest-client/core';
import getConfig from '../helpers/getSetup.js';
import HttpHelper from '../helpers/HttpHelper.js';

describe('Multi user', () => {
  describe('/spaces', () => {
    let baseUri: string;
    let prefix: string;
    const http = new HttpHelper();

    before(async () => {
      const cnf = await getConfig();
      baseUri = cnf.multiUserBaseUri;
      prefix = cnf.prefix;
    });

    describe('POST /spaces', () => {
      let user1Token: string;
      before(async () => {
        user1Token = await http.createUserToken(baseUri);
        await http.delete(`${baseUri}/test/reset/spaces`);
      });

      after(async () => {
        await http.delete(`${baseUri}/test/reset/spaces`);
        await http.delete(`${baseUri}/test/reset/users`);
      });

      it('creates a new space', async () => {
        const space = Workspace.fromName('test');
        const result = await http.post(`${baseUri}/spaces`, {
          token: user1Token,
          body: JSON.stringify(space),
        });
        assert.equal(result.status, 204, 'has 204 status');
        assert.include(result.headers.location, '/spaces/', 'has the location');
        assert.equal(result.body, '', 'has no body');
      });

      it('returns an error when invalid workspace', async () => {
        const result = await http.post(`${baseUri}/spaces`, {
          token: user1Token,
          body: JSON.stringify({}),
        });
        assert.equal(result.status, 400, 'has 400 status');
        const body = result.body as string;
        const error = JSON.parse(body);
        assert.equal(error.message, 'Invalid space definition.', 'has the error message');
      });

      it('adds the user as the owner', async () => {
        const response = await http.post(`${baseUri}/spaces`, {
          token: user1Token,
          body: JSON.stringify(Workspace.fromName('test')),
        });
        const url = new URL(`${prefix}${response.headers.location}`, baseUri);
        const result = await http.get(url.toString(), {
          token: user1Token,
        });
        assert.equal(result.status, 200, 'has 200 status');
        
        const space = JSON.parse(result.body as string) as IUserWorkspace;
        assert.equal(space.access, 'owner');
      });
    });

    describe('GET /spaces', () => {
      let user1Token: string;
      before(async () => {
        user1Token = await http.createUserToken(baseUri);
      });

      before(async () => {
        await http.delete(`${baseUri}/test/reset/spaces`);
        await http.post(`${baseUri}/test/generate/spaces?size=40`, {
          token: user1Token,
        });
        await http.post(`${baseUri}/test/generate/spaces?size=5&owner=123er`);
      });

      after(async () => {
        await http.delete(`${baseUri}/test/reset/spaces`);
        await http.delete(`${baseUri}/test/reset/users`);
      });

      it('returns results and the page token', async () => {
        const result = await http.get(`${baseUri}/spaces`, {
          token: user1Token,
        });
        assert.equal(result.status, 200, 'has the 200 status');
        const list = JSON.parse(result.body as string) as IListResponse;
        assert.typeOf(list.cursor as string, 'string', 'has the cursor');
        assert.typeOf(list.data, 'array', 'has the data array');
        assert.lengthOf(list.data, 35, 'has the default list size');
        const item = list.data[0] as IWorkspace;
        assert.equal(item.kind, WorkspaceKind, 'has the space object');
        assert.typeOf(item.owner, 'string', 'has an owner');
        assert.notEqual(item.owner, 'default', 'has other than the default owner');
      });

      it('supports the limit parameter', async () => {
        const result = await http.get(`${baseUri}/spaces?limit=4`, {
          token: user1Token,
        });
        assert.equal(result.status, 200, 'has the 200 status');
        const list = JSON.parse(result.body as string) as IListResponse;
        assert.typeOf(list.cursor as string, 'string', 'has the cursor');
        assert.typeOf(list.data, 'array', 'has the data array');
        assert.lengthOf(list.data, 4, 'has the default list size');
      });

      it('paginates to the next page', async () => {
        const result1 = await http.get(`${baseUri}/spaces?limit=2`, {
          token: user1Token,
        });
        assert.equal(result1.status, 200, 'has the 200 status');
        const list1 = JSON.parse(result1.body as string) as IListResponse;
        const result2 = await http.get(`${baseUri}/spaces?cursor=${list1.cursor}`, {
          token: user1Token,
        });
        assert.equal(result2.status, 200, 'has the 200 status');
        const list2 = JSON.parse(result2.body as string) as IListResponse;
        assert.lengthOf(list2.data, 2, 'uses the page cursor limit param');
        assert.notDeepEqual(list1.data[0], list2.data[0], 'arrays are not equal');
        assert.notDeepEqual(list1.data[1], list2.data[0], 'has the next element');
      });

      it('reaches the end of pagination', async () => {
        const result1 = await http.get(`${baseUri}/spaces?limit=35`, {
          token: user1Token,
        });
        assert.equal(result1.status, 200, 'has the 200 status');
        const list1 = JSON.parse(result1.body as string) as IListResponse;
        const result2 = await http.get(`${baseUri}/spaces?cursor=${list1.cursor}`, {
          token: user1Token,
        });
        assert.equal(result2.status, 200, 'has the 200 status');
        const list2 = JSON.parse(result2.body as string) as IListResponse;
        assert.lengthOf(list2.data, 5, 'has only remaining entires');
      });

      it('returns the same cursor when no more entries', async () => {
        const result1 = await http.get(`${baseUri}/spaces?limit=35`, {
          token: user1Token,
        });
        assert.equal(result1.status, 200, 'has the 200 status');
        const list1 = JSON.parse(result1.body as string) as IListResponse;

        const result2 = await http.get(`${baseUri}/spaces?cursor=${list1.cursor}`, {
          token: user1Token,
        });
        assert.equal(result2.status, 200, 'has the 200 status');
        const list2 = JSON.parse(result2.body as string) as IListResponse;
        assert.lengthOf(list2.data, 5, 'has the remaining');

        const result3 = await http.get(`${baseUri}/spaces?cursor=${list2.cursor}`, {
          token: user1Token,
        });
        assert.equal(result3.status, 200, 'has the 200 status');
        const list3 = JSON.parse(result3.body as string) as IListResponse;
        assert.lengthOf(list3.data, 0, 'has no more entries');
        
        assert.equal(list2.cursor, list3.cursor);
      });
    });
  });
});
