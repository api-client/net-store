/* eslint-disable import/no-named-as-default-member */
import { assert } from 'chai';
import { 
  IListResponse, IWorkspace, Workspace, AccessOperation, RouteBuilder,
} from '@api-client/core';
import getConfig from '../helpers/getSetup.js';
import HttpHelper from '../helpers/HttpHelper.js';
import { IGeneratedSessionUsers } from '../helpers/TestsHttpRoute.js';

describe('Multi user', () => {
  let baseUri: string;
  const http = new HttpHelper();

  before(async () => {
    const cnf = await getConfig();
    baseUri = cnf.multiUserBaseUri;
  });

  describe('/shared/spaces', () => {
    describe('GET', () => {
      let users: IGeneratedSessionUsers[];
      let spaces: IWorkspace[];

      before(async () => {
        const usersResponse = await http.post(`${baseUri}/test/generate/users?size=3`);
        users = JSON.parse(usersResponse.body as string) as IGeneratedSessionUsers[];
        const spacesResponse = await http.post(`${baseUri}/test/generate/shared/spaces?size=40&type=user&owner=${users[0].user.key}&target=${users[1].user.key}`);
        spaces = JSON.parse(spacesResponse.body as string) as IWorkspace[];
      });

      after(async () => {
        await http.delete(`${baseUri}/test/reset/spaces`);
        await http.delete(`${baseUri}/test/reset/users`);
        await http.delete(`${baseUri}/test/reset/sessions`);
        await http.delete(`${baseUri}/test/reset/shared`);
        await http.delete(`${baseUri}/test/reset/permissions`);
      });

      it('lists the spaces shared with the user', async () => {
        const path = RouteBuilder.sharedSpaces();
        const result = await http.get(`${baseUri}${path}`, { token: users[1].token });
        assert.equal(result.status, 200, 'has 200 status code');

        const list = JSON.parse(result.body as string) as IListResponse<IWorkspace>;
        assert.typeOf(list.cursor, 'string', 'has the cursor');
        assert.typeOf(list.data, 'array', 'has the data');
        assert.lengthOf(list.data, 35, 'has the default list size');
      });

      it('lists spaces only shared with the user', async () => {
        const path = RouteBuilder.sharedSpaces();
        const result = await http.get(`${baseUri}${path}?limit=100`, { token: users[1].token });
        assert.equal(result.status, 200, 'has 200 status code');

        const list = JSON.parse(result.body as string) as IListResponse<IWorkspace>;
        assert.lengthOf(list.data, 40, 'has the default list size');
      });

      it('does not list spaces that have a parent', async () => {
        const parent = spaces[0].key;
        const space = Workspace.fromName('s2', users[0].user.key).toJSON();
        
        const spaceResponse = await http.post(`${baseUri}${RouteBuilder.space(parent)}`, {
          token: users[0].token,
          body: JSON.stringify(space),
        });
        assert.equal(spaceResponse.status, 204, 'created a sub-space');
        
        const records: AccessOperation[] = [{
          op: 'add',
          type: 'user',
          value: 'reader',
          id: users[1].user.key,
        }];
        const usersResponse = await http.patch(`${baseUri}${RouteBuilder.spaceUsers(parent)}`, {
          token: users[0].token,
          body: JSON.stringify(records),
        });
        assert.equal(usersResponse.status, 204, 'has the 204 status code');

        const path = RouteBuilder.sharedSpaces();
        const result = await http.get(`${baseUri}${path}?limit=100`, { token: users[1].token });
        assert.equal(result.status, 200, 'has 200 status code');

        const list = JSON.parse(result.body as string) as IListResponse<IWorkspace>;
        assert.lengthOf(list.data, 40, 'has all records');
      });

      it('lists spaces for a parent', async () => {
        const [user1, , user3] = users;
        const parent = spaces[0].key;
        const space = Workspace.fromName('s2', user1.user.key).toJSON();

        const spaceResponse = await http.post(`${baseUri}${RouteBuilder.space(parent)}`, {
          token: user1.token,
          body: JSON.stringify(space),
        });
        assert.equal(spaceResponse.status, 204, 'created a sub-space');

        const records: AccessOperation[] = [{
          op: 'add',
          type: 'user',
          value: 'reader',
          id: user3.user.key,
        }];
        const usersResponse = await http.patch(`${baseUri}${RouteBuilder.spaceUsers(space.key)}`, {
          token: user1.token,
          body: JSON.stringify(records),
        });
        assert.equal(usersResponse.status, 204, 'has the 204 status code');

        const path = RouteBuilder.sharedSpaces();
        const result = await http.get(`${baseUri}${path}?parent=${parent}`, { token: user3.token });
        assert.equal(result.status, 200, 'has 200 status code');
        
        const list = JSON.parse(result.body as string) as IListResponse<IWorkspace>;
        assert.lengthOf(list.data, 1, 'has all parent records');
      });

      it('respects the limit parameter', async () => {
        const path = RouteBuilder.sharedSpaces();
        const result = await http.get(`${baseUri}${path}?limit=4`, { token: users[1].token });
        assert.equal(result.status, 200, 'has 200 status code');

        const list = JSON.parse(result.body as string) as IListResponse<IWorkspace>;
        assert.typeOf(list.cursor, 'string', 'has the cursor');
        assert.typeOf(list.data, 'array', 'has the data');
        assert.lengthOf(list.data, 4, 'has the default list size');
      });

      it('respects the page cursor', async () => {
        const [, user2] = users;
        const path = RouteBuilder.sharedSpaces();

        const r1 = await http.get(`${baseUri}${path}?limit=2`, { token: user2.token });
        assert.equal(r1.status, 200, 'has 200 status code');

        const list1 = JSON.parse(r1.body as string) as IListResponse<IWorkspace>;
        assert.lengthOf(list1.data, 2, 'original list has 2 items');

        const r2 = await http.get(`${baseUri}${path}?cursor=${list1.cursor}`, { token: user2.token });
        assert.equal(r2.status, 200, 'has 200 status code');

        const list2 = JSON.parse(r2.body as string) as IListResponse<IWorkspace>;

        assert.lengthOf(list2.data, 2, 'uses the page cursor limit param');
        assert.notDeepEqual(list1.data[0], list2.data[0], 'arrays are not equal');
        assert.notDeepEqual(list1.data[1], list2.data[0], 'has the next element');
      });
    });
  });
});
