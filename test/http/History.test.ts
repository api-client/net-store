/* eslint-disable import/no-named-as-default-member */
import { assert } from 'chai';
import { StoreSdk, IUser, IHttpHistory, ProjectMock, IHttpHistoryBulkAdd, IWorkspace, RouteBuilder, AccessOperation, IAccessPatchInfo } from '@api-client/core';
import getConfig from '../helpers/getSetup.js';
import HttpHelper from '../helpers/HttpHelper.js';
import DefaultUser from '../../src/authentication/DefaultUser.js';

//
// Note, the store has unit tests for storing the data. This test the HTTP endpoint's logic.
//

describe('http', () => {
  const mock = new ProjectMock();
  const http = new HttpHelper();
  let sdk: StoreSdk;
  let baseUri: string;

  describe('Multi-user', () => {
    before(async () => {
      const cnf = await getConfig();
      baseUri = cnf.multiUserBaseUri;
      sdk = new StoreSdk(cnf.multiUserBaseUri);
    });
  
    describe('/history', () => {
      describe('POST', () => {
        let user1Id: string;

        before(async () => {
          const user1Token = await http.createUserToken(baseUri);
          const user1Response = await http.get(`${baseUri}/users/me`, { token: user1Token });
          user1Id = (JSON.parse(user1Response.body as string) as IUser).key;
          sdk.token = user1Token;
        });
  
        after(async () => {
          await http.delete(`${baseUri}/test/reset/sessions`);
          await http.delete(`${baseUri}/test/reset/users`);
          await http.delete(`${baseUri}/test/reset/history`);
        });
  
        it('adds an item to the store and updated the user', async () => {
          const item = await mock.history.httpHistory({ app: 'test-app' });
          const id = await sdk.history.create(item);
          assert.typeOf(id, 'string', 'has the created id in the body');
          const read = await sdk.history.read(id);
          assert.equal(read.user, user1Id, 'sets the user key');
        });
      });
  
      describe('GET', () => {
        // detailed tests are performed in the unit tests
        // These tests passing parameters to the store and HTTP responses.
        before(async () => {
          sdk.token = await http.createUserToken(baseUri);
        });
  
        after(async () => {
          await http.delete(`${baseUri}/test/reset/sessions`);
          await http.delete(`${baseUri}/test/reset/users`);
        });
        
        afterEach(async () => {
          await http.delete(`${baseUri}/test/reset/history`);
        });
        
        it('lists the user history', async () => {
          const item = await mock.history.httpHistory();
          item.app = 'test-app';
          await sdk.history.create(item);
          const list = await sdk.history.list({ type: 'user' });

          assert.typeOf(list.cursor, 'string', 'has the cursor');
          assert.lengthOf(list.data, 1, 'has the created item');
        });
  
        it('lists the application history', async () => {
          const item1 = await mock.history.httpHistory();
          const item2 = await mock.history.httpHistory();
          item1.app = 'other-app';
          item2.app = 'test-app';
          await sdk.history.create(item1);
          await sdk.history.create(item2);

          const list = await sdk.history.list({ type: 'app', id: 'test-app' });
          assert.typeOf(list.cursor, 'string', 'has the cursor');
          assert.lengthOf(list.data, 1, 'has the created item');
          
          const [h1] = list.data as IHttpHistory[];
          assert.equal(h1.app, 'test-app', 'has the app history');
        });
  
        it('uses the page token', async () => {
          const item = await mock.history.httpHistory();
          item.app = 'test-app';
          await sdk.history.create(item);
          const list1 = await sdk.history.list({ type: 'user' });
          const list2 = await sdk.history.list({ type: 'user', cursor: list1.cursor });
          assert.lengthOf(list2.data, 0);
        });
      });
    });
  
    describe('/history/batch/create', () => {
      let user1Id: string;
      before(async () => {
        sdk.token = await http.createUserToken(baseUri);
        const user = await sdk.user.me();
        user1Id = user.key;
      });
  
      after(async () => {
        await http.delete(`${baseUri}/test/reset/sessions`);
        await http.delete(`${baseUri}/test/reset/users`);
        await http.delete(`${baseUri}/test/reset/history`);
      });
  
      it('adds the history in bulk', async () => {
        const log = await mock.projectRequest.log();
        const item: IHttpHistoryBulkAdd = {
          app: 'test-app',
          log: [log],
        };

        const ids = await sdk.history.createBulk(item);
        assert.typeOf(ids, 'array', 'has the created ids in the body');

        const read = await sdk.history.read(ids[0]);
        assert.equal(read.user, user1Id, 'sets the user key');
      });
    });
  
    describe('/history/batch/delete', () => {
      before(async () => {
        sdk.token = await http.createUserToken(baseUri);
      });
  
      after(async () => {
        await http.delete(`${baseUri}/test/reset/sessions`);
        await http.delete(`${baseUri}/test/reset/users`);
        await http.delete(`${baseUri}/test/reset/history`);
      });
  
      it('removes history data', async () => {
        const item = await mock.history.httpHistory({ app: 'test-app' });
        const id = await sdk.history.create(item);
        await sdk.history.delete([id]);
      });
    });
  
    describe('/history/[key]', () => {
      describe('GET', () => {
        let user1Token: string;
        let user2Token: string;
        let user3Token: string;
        let space1Key: string;
        let created1Id: string;
        let created2Id: string;
        let user2Id: string;
        before(async () => {
          user1Token = await http.createUserToken(baseUri);
          user2Token = await http.createUserToken(baseUri);
          user3Token = await http.createUserToken(baseUri);

          const user = await sdk.user.me({ token: user2Token });
          user2Id = user.key;
  
          const item1 = await mock.history.httpHistory({ app: 'test-app' });
          created1Id = await sdk.history.create(item1, { token: user1Token });
  
          const rawSpaces = await http.post(`${baseUri}/test/generate/files?size=1`, { token: user1Token });
          space1Key = (JSON.parse(rawSpaces.body as string)[0] as IWorkspace).key;

          const item2 = await mock.history.httpHistory({ space: space1Key });
          created2Id = await sdk.history.create(item2, { token: user1Token });

          const accessInfo: IAccessPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch: [{
              op: 'add',
              id: user2Id,
              value: 'reader',
              type: 'user',
            } as AccessOperation],
          };
          
          // add user 2 read access to the space
          await sdk.file.patchUsers(space1Key, accessInfo, { token: user1Token });
        });
    
        after(async () => {
          await http.delete(`${baseUri}/test/reset/sessions`);
          await http.delete(`${baseUri}/test/reset/users`);
          await http.delete(`${baseUri}/test/reset/history`);
          await http.delete(`${baseUri}/test/reset/files`);
        });
  
        it('returns the history object for the owner and app status', async () => {
          const item = await sdk.history.read(created1Id, { token: user1Token });
          assert.equal(item.key, created1Id, 'returns the history object')
        });
  
        it('returns the history object for the owner and space status', async () => {
          const item = await sdk.history.read(created2Id, { token: user1Token });
          assert.equal(item.key, created2Id, 'returns the history object')
        });
  
        it('returns 404 when unknown id', async () => {
          const result = await http.get(`${baseUri}${RouteBuilder.historyItem('unknown')}`, { token: user1Token });
          assert.equal(result.status, 404, 'has the 404 status code');
        });
  
        it('returns 401 when unauthorized (app access)', async () => {
          const result = await http.get(`${baseUri}${RouteBuilder.historyItem(created1Id)}`, { token: user2Token });
          assert.equal(result.status, 401, 'has the 401 status code');
        });
  
        it('returns the history object for a shared with the user space', async () => {
          const item = await sdk.history.read(created2Id, { token: user2Token });
          assert.equal(item.key, created2Id, 'returns the history object')
        });
  
        it('returns 404 when unauthorized (space access)', async () => {
          const result = await http.get(`${baseUri}${RouteBuilder.historyItem(created2Id)}`, { token: user3Token });
          assert.equal(result.status, 404, 'has the 404 status code');
        });
      });
  
      describe('Delete', () => {
        let user1Token: string;
        let user2Token: string;
        let user3Token: string;
        let space1Key: string;
        let created1Id: string;
        let created2Id: string;
        let user2Id: string;
        before(async () => {
          user1Token = await http.createUserToken(baseUri);
          user2Token = await http.createUserToken(baseUri);
          user3Token = await http.createUserToken(baseUri);
          const user = await sdk.user.me({ token: user2Token });
          user2Id = user.key;
        });
    
        after(async () => {
          await http.delete(`${baseUri}/test/reset/sessions`);
          await http.delete(`${baseUri}/test/reset/users`);
          await http.delete(`${baseUri}/test/reset/history`);
          await http.delete(`${baseUri}/test/reset/files`);
        });
  
        beforeEach(async () => {
          const item1 = await mock.history.httpHistory({ app: 'test-app' });
          created1Id = await sdk.history.create(item1, { token: user1Token });

          const rawSpaces = await http.post(`${baseUri}/test/generate/files?size=1`, { token: user1Token });
          space1Key = (JSON.parse(rawSpaces.body as string)[0] as IWorkspace).key;
          
          const item2 = await mock.history.httpHistory({ space: space1Key });
          created2Id = await sdk.history.create(item2, { token: user1Token });

          // add user 2 read access to the space
          const accessInfo: IAccessPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch: [{
              op: 'add',
              id: user2Id,
              value: 'reader',
              type: 'user',
            } as AccessOperation],
          };
          await sdk.file.patchUsers(space1Key, accessInfo, { token: user1Token });
        });
  
        it('deletes a user own record (app type)', async () => {
          await sdk.history.delete(created1Id, { token: user1Token });
          const readResult = await http.get(`${baseUri}${RouteBuilder.historyItem(created1Id)}`, { token: user1Token });
          assert.equal(readResult.status, 404, 'deleted read has the 404 status code');
        });
  
        it('deletes a user own record (space type)', async () => {
          await sdk.history.delete(created2Id, { token: user1Token });
          const readResult = await http.get(`${baseUri}${RouteBuilder.historyItem(created2Id)}`, { token: user1Token });
          assert.equal(readResult.status, 404, 'deleted read has the 404 status code');
        });
  
        it('does not delete another user record', async () => {
          const deleteResult = await http.delete(`${baseUri}${RouteBuilder.historyItem(created1Id)}`, { token: user3Token });
          assert.equal(deleteResult.status, 403, 'delete has the 403 status code');
        });
  
        it('does not delete another user record from the shared space', async () => {
          const deleteResult = await http.delete(`${baseUri}${RouteBuilder.historyItem(created1Id)}`, { token: user2Token });
          assert.equal(deleteResult.status, 403, 'delete has the 403 status code');
        });
      });
    });
  });

  describe('Single user', () => {
    before(async () => {
      const cnf = await getConfig();
      baseUri = cnf.singleUserBaseUri;
      sdk = new StoreSdk(cnf.singleUserBaseUri);
    });

    describe('/history', () => {
      describe('POST', () => {
        before(async () => {
          sdk.token = await http.createUserToken(baseUri);
        });
  
        after(async () => {
          await http.delete(`${baseUri}/test/reset/sessions`);
          await http.delete(`${baseUri}/test/reset/users`);
          await http.delete(`${baseUri}/test/reset/history`);
        });
  
        it('adds an item to the store and updated the user', async () => {
          const item = await mock.history.httpHistory();
          item.app = 'test-app';
          const id = await sdk.history.create(item);
          assert.typeOf(id, 'string', 'has the created id in the body');
          const read = await sdk.history.read(id);
          assert.equal(read.user, DefaultUser.key, 'sets the user key');
        });
      });
  
      describe('GET', () => {
        // detailed tests are performed in the unit tests
        // This tests passing parameters to the store and HTTP responses.
        before(async () => {
          sdk.token = await http.createUserToken(baseUri);
        });
  
        after(async () => {
          await http.delete(`${baseUri}/test/reset/sessions`);
          await http.delete(`${baseUri}/test/reset/users`);
        });
        
        afterEach(async () => {
          await http.delete(`${baseUri}/test/reset/history`);
        });
        
        it('lists the user history', async () => {
          const item = await mock.history.httpHistory();
          item.app = 'test-app';
          await sdk.history.create(item);
          const list = await sdk.history.list({ type: 'user' });

          assert.typeOf(list.cursor, 'string', 'has the cursor');
          assert.lengthOf(list.data, 1, 'has the created item');
        });
  
        it('lists the application history', async () => {
          const item1 = await mock.history.httpHistory();
          const item2 = await mock.history.httpHistory();
          item1.app = 'other-other';
          item2.app = 'test-app';
          await sdk.history.create(item1);
          await sdk.history.create(item2);
          const list = await sdk.history.list({ type: 'app', id: 'test-app' });
          assert.typeOf(list.cursor, 'string', 'has the cursor');
          assert.lengthOf(list.data, 1, 'has the created item');
          const [h1] = list.data as IHttpHistory[];
          assert.equal(h1.app, 'test-app', 'has the app history');
        });
  
        it('uses the page token', async () => {
          const item = await mock.history.httpHistory();
          item.app = 'test-app';
          await sdk.history.create(item);
          const list1 = await sdk.history.list({ type: 'user' });
          const list2 = await sdk.history.list({ type: 'user', cursor: list1.cursor });
          assert.lengthOf(list2.data, 0);
        });
      });
    });
  
    describe('/history/batch/create', () => {
      before(async () => {
        sdk.token = await http.createUserToken(baseUri);
      });
  
      after(async () => {
        await http.delete(`${baseUri}/test/reset/sessions`);
        await http.delete(`${baseUri}/test/reset/users`);
        await http.delete(`${baseUri}/test/reset/history`);
      });
  
      it('adds the history in bulk', async () => {
        const log = await mock.projectRequest.log();
        const item: IHttpHistoryBulkAdd = {
          app: 'test-app',
          log: [log],
        };
  
        const ids = await sdk.history.createBulk(item);
        assert.typeOf(ids, 'array', 'has the created ids in the body');

        const read = await sdk.history.read(ids[0]);
        assert.equal(read.user, DefaultUser.key, 'sets the user key');
      });
    });
  
    describe('/history/batch/delete', () => {
      before(async () => {
        sdk.token = await http.createUserToken(baseUri);
      });
  
      after(async () => {
        await http.delete(`${baseUri}/test/reset/sessions`);
        await http.delete(`${baseUri}/test/reset/users`);
        await http.delete(`${baseUri}/test/reset/history`);
      });
  
      it('removes history data', async () => {
        const item = await mock.history.httpHistory({ app: 'test-app' });
        const id = await sdk.history.create(item);
        await sdk.history.delete([id]);
      });
    });
  
    describe('/history/[key]', () => {
      describe('GET', () => {
        let user1Token: string;
        let created1Id: string;
        before(async () => {
          user1Token = await http.createUserToken(baseUri);
          const item1 = await mock.history.httpHistory({ app: 'test-app' });
          created1Id = await sdk.history.create(item1, { token: user1Token });
        });
    
        after(async () => {
          await http.delete(`${baseUri}/test/reset/sessions`);
          await http.delete(`${baseUri}/test/reset/users`);
          await http.delete(`${baseUri}/test/reset/history`);
        });
  
        it('returns the history object', async () => {
          const item = await sdk.history.read(created1Id, { token: user1Token });
          assert.equal(item.key, created1Id, 'returns the object')
        });
  
        it('returns 404 when unknown id', async () => {
          const result = await http.get(`${baseUri}${RouteBuilder.historyItem('unknown')}`, { token: user1Token });
          assert.equal(result.status, 404, 'has the 404 status code');
        });
      });
  
      describe('Delete', () => {
        let user1Token: string;
        let created1Id: string;
        before(async () => {
          user1Token = await http.createUserToken(baseUri);
        });
    
        after(async () => {
          await http.delete(`${baseUri}/test/reset/sessions`);
          await http.delete(`${baseUri}/test/reset/users`);
          await http.delete(`${baseUri}/test/reset/history`);
        });
  
        beforeEach(async () => {
          const item1 = await mock.history.httpHistory({ app: 'test-app' });
          created1Id = await sdk.history.create(item1, { token: user1Token });
        });
  
        it('deletes a user record', async () => {
          await sdk.history.delete(created1Id, { token: user1Token });
          const readResult = await http.get(`${baseUri}${RouteBuilder.historyItem(created1Id)}`, { token: user1Token });
          assert.equal(readResult.status, 404, 'deleted read has the 404 status code');
        });
      });
    });
  });
});
