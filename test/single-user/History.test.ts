/* eslint-disable import/no-named-as-default-member */
import { assert } from 'chai';
import { IHttpHistory, ProjectMock, IListResponse } from '@api-client/core';
import DefaultUser from '../../src/authentication/DefaultUser.js';
import getConfig from '../helpers/getSetup.js';
import HttpHelper from '../helpers/HttpHelper.js';
import { RouteBuilder } from '../../index.js';

describe('Single user', () => {
  const mock = new ProjectMock();
  let baseUri: string;
  const http = new HttpHelper();

  before(async () => {
    const cnf = await getConfig();
    baseUri = cnf.singleUserBaseUri;
  });

  describe('/history', () => {
    describe('POST', () => {
      let user1Token: string;
      before(async () => {
        user1Token = await http.createUserToken(baseUri);
      });

      after(async () => {
        await http.delete(`${baseUri}/test/reset/sessions`);
        await http.delete(`${baseUri}/test/reset/users`);
        await http.delete(`${baseUri}/test/reset/history`);
      });

      it('adds an item to the store and updated the user', async () => {
        const item = mock.history.httpHistory();
        item.app = 'test-app';
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
        assert.equal(data.user, DefaultUser.key, 'sets the user key');
      });
    });

    describe('GET', () => {
      // detailed tests are performed in the unit tests
      // This tests passing parameters to the store and HTTP responses.
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
});
