/* eslint-disable import/no-named-as-default-member */
import { assert } from 'chai';
import { IWorkspace, Workspace, AccessOperation, StoreSdk, ProjectKind } from '@api-client/core';
import getConfig from '../helpers/getSetup.js';
import HttpHelper from '../helpers/HttpHelper.js';
import { IGeneratedSessionUsers } from '../helpers/TestsHttpRoute.js';

describe('http', () => {
  let baseUri: string;
  let sdk: StoreSdk;
  const http = new HttpHelper();

  describe('Multi-user', () => {
    before(async () => {
      const cnf = await getConfig();
      baseUri = cnf.multiUserBaseUri;
      sdk = new StoreSdk(cnf.multiUserBaseUri);
    });
  
    describe('/shared/spaces', () => {
      describe('GET', () => {
        let users: IGeneratedSessionUsers[];
        let spaces: IWorkspace[];
  
        before(async () => {
          const usersResponse = await http.post(`${baseUri}/test/generate/users?size=3`);
          users = JSON.parse(usersResponse.body as string) as IGeneratedSessionUsers[];
          const spacesResponse = await http.post(`${baseUri}/test/generate/shared/files?size=40&type=user&owner=${users[0].user.key}&target=${users[1].user.key}`);
          spaces = JSON.parse(spacesResponse.body as string) as IWorkspace[];
        });
  
        after(async () => {
          await http.delete(`${baseUri}/test/reset/files`);
          await http.delete(`${baseUri}/test/reset/users`);
          await http.delete(`${baseUri}/test/reset/sessions`);
          await http.delete(`${baseUri}/test/reset/shared`);
          await http.delete(`${baseUri}/test/reset/permissions`);
        });
  
        it('lists the spaces shared with the user', async () => {
          sdk.token = users[1].token;
          const list = await sdk.shared.list([ProjectKind]);
          assert.typeOf(list.cursor, 'string', 'has the cursor');
          assert.typeOf(list.data, 'array', 'has the data');
          assert.lengthOf(list.data, 35, 'has the default list size');
        });
  
        it('lists spaces only shared with the user', async () => {
          sdk.token = users[1].token;
          const list = await sdk.shared.list([ProjectKind], { limit: 100 });
          assert.lengthOf(list.data, 40, 'has the default list size');
        });
  
        it('does not list spaces that have a parent', async () => {
          const parent = spaces[0].key;
          const space = Workspace.fromName('s2', users[0].user.key).toJSON();

          sdk.token = users[0].token;
          await sdk.file.create(space, { parent });
          
          const records: AccessOperation[] = [{
            op: 'add',
            type: 'user',
            value: 'reader',
            id: users[1].user.key,
          }];
          await sdk.file.patchUsers(parent, records);
          
          sdk.token = users[1].token;
          const list = await sdk.shared.list([ProjectKind], { limit: 100 });

          assert.lengthOf(list.data, 40, 'has all records');
        });
  
        it('lists spaces for a parent', async () => {
          const [user1, , user3] = users;
          sdk.token = user1.token;

          const parent = spaces[0].key;
          const space = Workspace.fromName('s2', user1.user.key).toJSON();
          await sdk.file.create(space, { parent });

          const records: AccessOperation[] = [{
            op: 'add',
            type: 'user',
            value: 'reader',
            id: user3.user.key,
          }];
          await sdk.file.patchUsers(space.key, records);
          
          sdk.token = user3.token;
          const list = await sdk.shared.list([ProjectKind], { parent });
          assert.lengthOf(list.data, 1, 'has all parent records');
        });
  
        it('respects the limit parameter', async () => {
          sdk.token = users[1].token;
          const list = await sdk.shared.list([ProjectKind], { limit: 4 });

          assert.typeOf(list.cursor, 'string', 'has the cursor');
          assert.typeOf(list.data, 'array', 'has the data');
          assert.lengthOf(list.data, 4, 'has the default list size');
        });
  
        it('respects the page cursor', async () => {
          const [, user2] = users;

          sdk.token = user2.token;
          const list1 = await sdk.shared.list([ProjectKind], { limit: 2 });
          const list2 = await sdk.shared.list([ProjectKind], { cursor: list1.cursor });
  
          assert.lengthOf(list2.data, 2, 'uses the page cursor limit param');
          assert.notDeepEqual(list1.data[0], list2.data[0], 'arrays are not equal');
          assert.notDeepEqual(list1.data[1], list2.data[0], 'has the next element');
        });
      });
    });
  });

});
