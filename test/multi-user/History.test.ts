/* eslint-disable import/no-named-as-default-member */
import { assert } from 'chai';
import { IUser, IHttpHistory, ProjectMock, IListResponse, IHttpHistoryBulkAdd, IWorkspace, RouteBuilder, AccessOperation } from '@api-client/core';
import getConfig from '../helpers/getSetup.js';
import HttpHelper from '../helpers/HttpHelper.js';

describe('Multi user', () => {
  const mock = new ProjectMock();
  let baseUri: string;
  const http = new HttpHelper();

  before(async () => {
    const cnf = await getConfig();
    baseUri = cnf.multiUserBaseUri;
  });

  describe('/history', () => {
    describe('POST', () => {
      let user1Token: string;
      let user1Id: string;
      before(async () => {
        user1Token = await http.createUserToken(baseUri);
        const user1Response = await http.get(`${baseUri}/users/me`, { token: user1Token });
        user1Id = (JSON.parse(user1Response.body as string) as IUser).key;
      });

      after(async () => {
        await http.delete(`${baseUri}/test/reset/sessions`);
        await http.delete(`${baseUri}/test/reset/users`);
        await http.delete(`${baseUri}/test/reset/history`);
      });

      it('adds an item to the store and updated the user', async () => {
        const item = mock.history.httpHistory({ app: 'test-app' });
        const httpPath = RouteBuilder.history();
        const result = await http.post(`${baseUri}${httpPath}`, {
          body: JSON.stringify(item),
          token: user1Token,
        });
        assert.equal(result.status, 200, 'has 200 status');
        const id = result.body as string;
        assert.typeOf(id, 'string', 'has the created id in the body');
        const readResult = await http.get(`${baseUri}${RouteBuilder.historyItem(id)}`, { token: user1Token });
        assert.equal(readResult.status, 200, 'read status is 200');
        const readBody = readResult.body as string;
        assert.typeOf(readBody, 'string', 'has the read body');
        const data = JSON.parse(readBody) as IHttpHistory;
        assert.equal(data.user, user1Id, 'sets the user key');
      });
    });

    describe('GET', () => {
      // detailed tests are performed in the unit tests
      // These tests passing parameters to the store and HTTP responses.
      let user1Token: string;
      before(async () => {
        user1Token = await http.createUserToken(baseUri);
      });

      after(async () => {
        await http.delete(`${baseUri}/test/reset/sessions`);
        await http.delete(`${baseUri}/test/reset/users`);
      });
      
      afterEach(async () => {
        await http.delete(`${baseUri}/test/reset/history`);
      });
      
      it('lists the user history', async () => {
        const item = mock.history.httpHistory();
        item.app = 'test-app';
        const httpPath = RouteBuilder.history();
        await http.post(`${baseUri}${httpPath}`, {
          body: JSON.stringify(item),
          token: user1Token,
        });
        const result = await http.get(`${baseUri}${httpPath}`, { token: user1Token });
        assert.equal(result.status, 200, 'has the 200 status');
        const body = result.body as string;
        assert.typeOf(body, 'string', 'has the body');
        const list = JSON.parse(body) as IListResponse;
        assert.typeOf(list.cursor, 'string', 'has the cursor');
        assert.lengthOf(list.data, 1, 'has the created item');
      });

      it('lists the application history', async () => {
        const httpPath = RouteBuilder.history();
        const item1 = mock.history.httpHistory();
        const item2 = mock.history.httpHistory();
        item2.app = 'test-app';
        await http.post(`${baseUri}${httpPath}`, { body: JSON.stringify(item1), token: user1Token });
        await http.post(`${baseUri}${httpPath}`, { body: JSON.stringify(item2), token: user1Token });
        const result = await http.get(`${baseUri}${httpPath}?type=app&id=test-app`, { token: user1Token });
        assert.equal(result.status, 200, 'has the 200 status');
        const body = result.body as string;
        assert.typeOf(body, 'string', 'has the body');
        const list = JSON.parse(body) as IListResponse;
        assert.typeOf(list.cursor, 'string', 'has the cursor');
        assert.lengthOf(list.data, 1, 'has the created item');
        const [h1] = list.data as IHttpHistory[];
        assert.equal(h1.app, 'test-app', 'has the app history');
      });

      it('uses the page token', async () => {
        const item = mock.history.httpHistory();
        const httpPath = RouteBuilder.history();
        await http.post(`${baseUri}${httpPath}`, {
          body: JSON.stringify(item),
          token: user1Token,
        });
        const result1 = await http.get(`${baseUri}${httpPath}`, { token: user1Token });
        assert.equal(result1.status, 200, 'has the 200 status');
        const body1 = result1.body as string;
        const list1 = JSON.parse(body1) as IListResponse;
        const result2 = await http.get(`${baseUri}${httpPath}?cursor=${list1.cursor}`, { token: user1Token });
        assert.equal(result1.status, 200, 'has the 200 status');
        const body2 = result2.body as string;
        const list2 = JSON.parse(body2) as IListResponse;
        assert.lengthOf(list2.data, 0);
      });
    });
  });

  describe('/history/batch/create', () => {
    let user1Token: string;
    let user1Id: string;
    before(async () => {
      user1Token = await http.createUserToken(baseUri);
      const user1Response = await http.get(`${baseUri}/users/me`, { token: user1Token });
      user1Id = (JSON.parse(user1Response.body as string) as IUser).key;
    });

    after(async () => {
      await http.delete(`${baseUri}/test/reset/sessions`);
      await http.delete(`${baseUri}/test/reset/users`);
      await http.delete(`${baseUri}/test/reset/history`);
    });

    it('adds the history in bulk', async () => {
      const log = mock.projectRequest.log();
      const item: IHttpHistoryBulkAdd = {
        app: 'test-app',
        log: [log],
      };

      const httpPath = RouteBuilder.historyBatchCreate();
      const result = await http.post(`${baseUri}${httpPath}`, {
        body: JSON.stringify(item),
        token: user1Token,
      });
      assert.equal(result.status, 200, 'has 200 status');
      const body = result.body as string;
      const list = JSON.parse(body) as IListResponse;
      const ids = list.data as string[];
      assert.typeOf(ids, 'array', 'has the created ids in the body');

      const readResult = await http.get(`${baseUri}${RouteBuilder.historyItem(ids[0])}`, { token: user1Token });
      assert.equal(readResult.status, 200, 'read status is 200');
      const readBody = readResult.body as string;
      assert.typeOf(readBody, 'string', 'has the read body');
      const data = JSON.parse(readBody) as IHttpHistory;
      assert.equal(data.user, user1Id, 'sets the user key');
    });
  });

  describe('/history/batch/delete', () => {
    let user1Token: string;
    before(async () => {
      user1Token = await http.createUserToken(baseUri);
    });

    after(async () => {
      await http.delete(`${baseUri}/test/reset/sessions`);
      await http.delete(`${baseUri}/test/reset/users`);
      await http.delete(`${baseUri}/test/reset/history`);
    });

    it('removes history data', async () => {
      const item = mock.history.httpHistory({ app: 'test-app' });
      const createResult = await http.post(`${baseUri}${RouteBuilder.history()}`, {
        body: JSON.stringify(item),
        token: user1Token,
      });
      assert.equal(createResult.status, 200, 'has 200 status');
      const id = createResult.body as string;
      
      const deleteResult = await http.post(`${baseUri}${RouteBuilder.historyBatchDelete()}`, {
        body: JSON.stringify([id]),
        token: user1Token,
      });
      assert.equal(deleteResult.status, 204, 'has 204 status');
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
        const user2Response = await http.get(`${baseUri}/users/me`, { token: user2Token });
        user2Id = (JSON.parse(user2Response.body as string) as IUser).key;

        const item1 = mock.history.httpHistory({ app: 'test-app' });
        const createResult1 = await http.post(`${baseUri}${RouteBuilder.history()}`, {
          body: JSON.stringify(item1),
          token: user1Token,
        });
        assert.equal(createResult1.status, 200, 'created the app history');
        created1Id = createResult1.body as string;

        const rawSpaces = await http.post(`${baseUri}/test/generate/spaces?size=1`, { token: user1Token });
        space1Key = (JSON.parse(rawSpaces.body as string)[0] as IWorkspace).key;
        const item2 = mock.history.httpHistory({ space: space1Key });
        const createResult2 = await http.post(`${baseUri}${RouteBuilder.history()}`, {
          body: JSON.stringify(item2),
          token: user1Token,
        });
        assert.equal(createResult2.status, 200, 'created the space history');
        created2Id = createResult2.body as string;
        // add user 2 read access to the space
        const addUserResponse = await http.patch(`${baseUri}${RouteBuilder.spaceUsers(space1Key)}`, {
          token: user1Token,
          body: JSON.stringify([{
            op: 'add',
            id: user2Id,
            value: 'reader',
            type: 'user',
          } as AccessOperation]),
        });
        assert.equal(addUserResponse.status, 204, 'added the user 2 to the space 1');
      });
  
      after(async () => {
        await http.delete(`${baseUri}/test/reset/sessions`);
        await http.delete(`${baseUri}/test/reset/users`);
        await http.delete(`${baseUri}/test/reset/history`);
        await http.delete(`${baseUri}/test/reset/spaces`);
      });

      it('returns the history object for the owner and app status', async () => {
        const result = await http.get(`${baseUri}${RouteBuilder.historyItem(created1Id)}`, { token: user1Token });
        assert.equal(result.status, 200, 'has the 200 status code');
        const body = result.body as string;
        assert.typeOf(body, 'string', 'has the body');
        const history = JSON.parse(body) as IHttpHistory;
        assert.equal(history.key, created1Id, 'returns the history object')
      });

      it('returns the history object for the owner and space status', async () => {
        const result = await http.get(`${baseUri}${RouteBuilder.historyItem(created2Id)}`, { token: user1Token });
        assert.equal(result.status, 200, 'has the 200 status code');
        const body = result.body as string;
        assert.typeOf(body, 'string', 'has the body');
        const history = JSON.parse(body) as IHttpHistory;
        assert.equal(history.key, created2Id, 'returns the history object')
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
        const result = await http.get(`${baseUri}${RouteBuilder.historyItem(created2Id)}`, { token: user2Token });
        assert.equal(result.status, 200, 'has the 200 status code');
        const body = result.body as string;
        assert.typeOf(body, 'string', 'has the body');
        const history = JSON.parse(body) as IHttpHistory;
        assert.equal(history.key, created2Id, 'returns the history object')
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
        const user2Response = await http.get(`${baseUri}/users/me`, { token: user2Token });
        user2Id = (JSON.parse(user2Response.body as string) as IUser).key;
      });
  
      after(async () => {
        await http.delete(`${baseUri}/test/reset/sessions`);
        await http.delete(`${baseUri}/test/reset/users`);
        await http.delete(`${baseUri}/test/reset/history`);
        await http.delete(`${baseUri}/test/reset/spaces`);
      });

      beforeEach(async () => {
        const item1 = mock.history.httpHistory({ app: 'test-app' });
        const createResult1 = await http.post(`${baseUri}${RouteBuilder.history()}`, {
          body: JSON.stringify(item1),
          token: user1Token,
        });
        assert.equal(createResult1.status, 200, 'created the app history');
        created1Id = createResult1.body as string;

        const rawSpaces = await http.post(`${baseUri}/test/generate/spaces?size=1`, { token: user1Token });
        space1Key = (JSON.parse(rawSpaces.body as string)[0] as IWorkspace).key;
        const item2 = mock.history.httpHistory({ space: space1Key });
        const createResult2 = await http.post(`${baseUri}${RouteBuilder.history()}`, {
          body: JSON.stringify(item2),
          token: user1Token,
        });
        assert.equal(createResult2.status, 200, 'created the space history');
        created2Id = createResult2.body as string;
        // add user 2 read access to the space
        const addUserResponse = await http.patch(`${baseUri}${RouteBuilder.spaceUsers(space1Key)}`, {
          token: user1Token,
          body: JSON.stringify([{
            op: 'add',
            id: user2Id,
            value: 'reader',
            type: 'user',
          } as AccessOperation]),
        });
        assert.equal(addUserResponse.status, 204, 'added the user 2 to the space 1');
      });

      it('deletes a user own record (app type)', async () => {
        const deleteResult = await http.delete(`${baseUri}${RouteBuilder.historyItem(created1Id)}`, { token: user1Token });
        assert.equal(deleteResult.status, 204, 'delete has the 204 status code');
        const readResult = await http.get(`${baseUri}${RouteBuilder.historyItem(created1Id)}`, { token: user1Token });
        assert.equal(readResult.status, 404, 'deleted read has the 404 status code');
      });

      it('deletes a user own record (space type)', async () => {
        const deleteResult = await http.delete(`${baseUri}${RouteBuilder.historyItem(created2Id)}`, { token: user1Token });
        assert.equal(deleteResult.status, 204, 'delete has the 204 status code');
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
