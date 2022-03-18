import { assert } from 'chai';
import fs from 'fs/promises';
import path from 'path';
import sinon from 'sinon';
import { DefaultLogger, IHttpHistory, ProjectMock, IBackendEvent, ISentRequest, Workspace, HttpProject } from '@api-client/core';
import { ArcLevelUp } from '../../src/persistence/ArcLevelUp.js';
import { KeyGenerator } from '../../src/persistence/KeyGenerator.js';
import DefaultUser from '../../src/authentication/DefaultUser.js';
import Clients, { IClientFilterOptions } from '../../src/routes/WsClients.js';
import { DataHelper } from './DataHelper.js';
import { ApiError } from '../../src/ApiError.js';

const storePath = path.join('test', 'data', 'units', 'store', 'history');

describe('Unit tests', () => {
  let store: ArcLevelUp;
  const mock = new ProjectMock();

  before(async () => {
    await fs.mkdir(storePath, { recursive: true });
    store = new ArcLevelUp(new DefaultLogger(), storePath);
    await store.initialize();
  });

  after(async () => {
    await store.cleanup();
    await fs.rm(storePath, { recursive: true, force: true });
  });

  describe('ArcLevelUp', () => {
    describe('#history', () => {
      describe('add()', () => {
        after(async () => {
          await DataHelper.clearAllHistory(store);
        });

        it('adds an item to the store and updated the user', async () => {
          const item = mock.history.httpHistory();
          await store.history.add(item, DefaultUser);
          const key = KeyGenerator.historyDataKey(new Date(item.created).toJSON(), DefaultUser.key);
          const entity = await store.history.data.get(key);
          const data = store.decodeDocument(entity) as IHttpHistory;
          assert.equal(data.user, DefaultUser.key, 'sets the user key');
        });

        it('adds the item to the spaces store', async () => {
          const item = mock.history.httpHistory();
          item.space = 'test-space';
          await store.history.add(item, DefaultUser);
          const dataKey = KeyGenerator.historyDataKey(new Date(item.created).toJSON(), DefaultUser.key);
          const spaceKey = KeyGenerator.historySpaceKey(new Date(item.created).toJSON(), 'test-space', DefaultUser.key);
          const value = (await store.history.space.get(spaceKey)).toString();
          assert.equal(value, dataKey, 'stores the data key');
        });

        it('adds the item to the request store', async () => {
          const item = mock.history.httpHistory();
          item.request = 'test-request';
          await store.history.add(item, DefaultUser);
          const dataKey = KeyGenerator.historyDataKey(new Date(item.created).toJSON(), DefaultUser.key);
          const requestKey = KeyGenerator.historyRequestKey(new Date(item.created).toJSON(), 'test-request', DefaultUser.key);
          const value = (await store.history.request.get(requestKey)).toString();
          assert.equal(value, dataKey, 'stores the data key');
        });

        it('adds the item to the app store', async () => {
          const item = mock.history.httpHistory();
          item.app = 'test-app';
          await store.history.add(item, DefaultUser);
          const dataKey = KeyGenerator.historyDataKey(new Date(item.created).toJSON(), DefaultUser.key);
          const appKey = KeyGenerator.historyAppKey(new Date(item.created).toJSON(), 'test-app', DefaultUser.key);
          const value = (await store.history.app.get(appKey)).toString();
          assert.equal(value, dataKey, 'stores the data key');
        });

        it('informs the WS client', async () => {
          const spy = sinon.spy(Clients, 'notify');
          const item = mock.history.httpHistory();
          try {
            await store.history.add(item, DefaultUser);
          } finally {
            // @ts-ignore
            Clients.notify.restore();
          }
          assert.isTrue(spy.calledOnce, 'Calls the notify function');
          const event = spy.args[0][0] as IBackendEvent;
          const filter = spy.args[0][1] as IClientFilterOptions;
          assert.equal(event.type, 'event');
          assert.equal(event.operation, 'created');
          assert.typeOf(event.data, 'object');
          assert.equal(event.kind, item.kind);
          assert.equal(filter.url, '/history');
        });
      });

      describe('list()', () => {
        describe('list user', () => {
          before(async () => {
            await DataHelper.addHistory(store.history.data, 40, { user: DefaultUser.key, });
            await DataHelper.addHistory(store.history.data, 2, { user: 'other-user' });
          });

          after(async () => {
            await store.history.data.clear();
          });

          it('lists all requests to the limit', async () => {
            const list = await store.history.list(DefaultUser, { type: 'user' });
            assert.typeOf(list.cursor, 'string', 'has the cursor');
            assert.typeOf(list.data, 'array', 'has the data');
            assert.lengthOf(list.data, 35, 'has the default list size');
          });

          it('lists all requests to the limit', async () => {
            const list = await store.history.list(DefaultUser, { limit: 4, type: 'user' });
            assert.typeOf(list.cursor, 'string', 'has the cursor');
            assert.typeOf(list.data, 'array', 'has the data');
            assert.lengthOf(list.data, 4, 'has the default list size');
          });

          it('paginates to the next page', async () => {
            const list1 = await store.history.list(DefaultUser, { limit: 2, type: 'user' });
            assert.lengthOf(list1.data, 2, 'original list has 2 items');
            const list2 = await store.history.list(DefaultUser, { cursor: list1.cursor, type: 'user', });
            assert.lengthOf(list2.data, 2, 'uses the page cursor limit param');
            assert.notDeepEqual(list1.data[0], list2.data[0], 'arrays are not equal');
            assert.notDeepEqual(list1.data[1], list2.data[0], 'has the next element');
          });

          it('reaches the end of pagination', async () => {
            const list1 = await store.history.list(DefaultUser, { limit: 35, type: 'user' });
            assert.lengthOf(list1.data, 35, 'original list has 35 items');
            const list2 = await store.history.list(DefaultUser, { cursor: list1.cursor, type: 'user', });
            assert.lengthOf(list2.data, 5, 'has only the remaining entires');
          });
        });

        describe('lists all space', () => {
          const user1 = mock.user.user();
          const user2 = mock.user.user();
          let space1Id: string;
          let space2Id: string;

          before(async () => {
            await store.user.add(user1.key, user1);
            await store.user.add(user2.key, user2);
            const space1 = Workspace.fromName('test1');
            const space2 = Workspace.fromName('test2');
            space1Id = space1.key;
            space2Id = space2.key;
            await store.space.add(space1Id, space1.toJSON(), user1, 'owner');
            await store.space.add(space2Id, space2.toJSON(), user2, 'owner');

            const c1 = await DataHelper.addHistory(store.history.data, 20, { space: space1Id, user: user1.key });
            const c2 = await DataHelper.addHistory(store.history.data, 20, { space: space1Id, user: user2.key });
            const c3 = await DataHelper.addHistory(store.history.data, 40, { space: space2Id, usersSize: 4, });
            await DataHelper.insertSpaceHistory(store.history.space, c1);
            await DataHelper.insertSpaceHistory(store.history.space, c2);
            await DataHelper.insertSpaceHistory(store.history.space, c3);
          });

          after(async () => {
            await store.history.data.clear();
            await store.history.space.clear();
            await store.user.db.clear();
            await store.space.db.clear();
          });

          it('lists all requests to the limit', async () => {
            const list = await store.history.list(user1, { type: 'space', id: space1Id });
            assert.typeOf(list.cursor, 'string', 'has the cursor');
            assert.typeOf(list.data, 'array', 'has the data');
            assert.lengthOf(list.data, 35, 'has the default list size');
            const data = list.data as IHttpHistory[];
            const hasInvalid = data.some(i => i.space !== space1Id);
            assert.isFalse(hasInvalid, 'has no other items')
          });

          it('respects the limit', async () => {
            const list = await store.history.list(user1, { limit: 4, type: 'space', id: space1Id });
            assert.typeOf(list.cursor, 'string', 'has the cursor');
            assert.typeOf(list.data, 'array', 'has the data');
            assert.lengthOf(list.data, 4, 'has the default list size');
          });

          it('paginates to the next page', async () => {
            const list1 = await store.history.list(user1, { limit: 2, type: 'space', id: space1Id });
            assert.lengthOf(list1.data, 2, 'original list has 2 items');
            const list2 = await store.history.list(user1, { cursor: list1.cursor, });
            assert.lengthOf(list2.data, 2, 'uses the page cursor limit param');
            assert.notDeepEqual(list1.data[0], list2.data[0], 'arrays are not equal');
            assert.notDeepEqual(list1.data[1], list2.data[0], 'has the next element');
          });

          it('reaches the end of pagination', async () => {
            const list1 = await store.history.list(user1, { limit: 35, type: 'space', id: space1Id });
            assert.lengthOf(list1.data, 35, 'original list has 35 items');
            const list2 = await store.history.list(user1, { cursor: list1.cursor, });
            assert.lengthOf(list2.data, 5, 'has only the remaining entires');
          });

          it('reads for the user only data', async () => {
            const list1 = await store.history.list(user1, { limit: 35, type: 'space', id: space1Id, user: true, });
            assert.lengthOf(list1.data, 20, 'has 20 items');
          });

          it('throws when accessing a space without a read access', async () => {
            let error: ApiError | undefined;
            try {
              await store.history.list(user1, { type: 'space', id: space2Id });
            } catch (e) {
              error = e as ApiError;
            }
            assert.ok(error, 'has the error');
            if (error) {
              assert.equal(error.message, 'Not found.');
              assert.equal(error.code, 404);
            }
          });
        });

        describe('lists all project', () => {
          const user1 = mock.user.user();
          const user2 = mock.user.user();
          let space1Id: string;
          let space2Id: string;
          let project1Id: string;
          let project2Id: string;

          before(async () => {
            await store.user.add(user1.key, user1);
            await store.user.add(user2.key, user2);
            const space1 = Workspace.fromName('test1');
            const space2 = Workspace.fromName('test2');
            space1Id = space1.key;
            space2Id = space2.key;
            await store.space.add(space1Id, space1.toJSON(), user1, 'owner');
            await store.space.add(space2Id, space2.toJSON(), user2, 'owner');
            const project1 = HttpProject.fromName('test project1');
            const project2 = HttpProject.fromName('test project2');
            project1Id = project1.key;
            project2Id = project2.key;
            await store.project.add(space1Id, project1Id, project1.toJSON(), user1);
            await store.project.add(space2Id, project2Id, project2.toJSON(), user2);

            const c1 = await DataHelper.addHistory(store.history.data, 20, { project: project1Id, user: user1.key, space: space1Id });
            const c2 = await DataHelper.addHistory(store.history.data, 20, { project: project1Id, user: 'other-user', space: space1Id });
            const c3 = await DataHelper.addHistory(store.history.data, 40, { projectsSize: 4, usersSize: 4, space: space1Id });
            await DataHelper.insertProjectHistory(store.history.project, c1);
            await DataHelper.insertProjectHistory(store.history.project, c2);
            await DataHelper.insertProjectHistory(store.history.project, c3);
            await DataHelper.insertSpaceHistory(store.history.space, c1);
            await DataHelper.insertSpaceHistory(store.history.space, c2);
            await DataHelper.insertSpaceHistory(store.history.space, c3);
          });

          after(async () => {
            await store.history.data.clear();
            await store.history.project.clear();
            await store.history.space.clear();
            await store.user.db.clear();
            await store.space.db.clear();
            await store.project.index.clear();
            await store.project.data.clear();
          });

          it('lists all requests to the limit', async () => {
            const list = await store.history.list(user1, { type: 'project', id: project1Id, space: space1Id });
            assert.typeOf(list.cursor, 'string', 'has the cursor');
            assert.typeOf(list.data, 'array', 'has the data');
            assert.lengthOf(list.data, 35, 'has the default list size');
            const data = list.data as IHttpHistory[];
            const hasInvalid = data.some(i => i.project !== project1Id);
            assert.isFalse(hasInvalid, 'has no other items')
          });

          it('respects the limit', async () => {
            const list = await store.history.list(user1, { limit: 4, type: 'project', id: project1Id, space: space1Id });
            assert.typeOf(list.cursor, 'string', 'has the cursor');
            assert.typeOf(list.data, 'array', 'has the data');
            assert.lengthOf(list.data, 4, 'has the default list size');
          });

          it('paginates to the next page', async () => {
            const list1 = await store.history.list(user1, { limit: 2, type: 'project', id: project1Id, space: space1Id });
            assert.lengthOf(list1.data, 2, 'original list has 2 items');
            const list2 = await store.history.list(user1, { cursor: list1.cursor, });
            assert.lengthOf(list2.data, 2, 'uses the page cursor limit param');
            assert.notDeepEqual(list1.data[0], list2.data[0], 'arrays are not equal');
            assert.notDeepEqual(list1.data[1], list2.data[0], 'has the next element');
          });

          it('reaches the end of pagination', async () => {
            const list1 = await store.history.list(user1, { limit: 35, type: 'project', id: project1Id, space: space1Id });
            assert.lengthOf(list1.data, 35, 'original list has 35 items');
            const list2 = await store.history.list(user1, { cursor: list1.cursor, });
            assert.lengthOf(list2.data, 5, 'has only the remaining entires');
          });

          it('reads for the user only data', async () => {
            const list1 = await store.history.list(user1, { limit: 35, type: 'project', id: project1Id, user: true, space: space1Id });
            assert.lengthOf(list1.data, 20, 'has 20 items');
          });

          it('throws when accessing a space without a read access', async () => {
            let error: ApiError | undefined;
            try {
              await store.history.list(user1, { type: 'project', id: project2Id, space: space2Id });
            } catch (e) {
              error = e as ApiError;
            }
            assert.ok(error, 'has the error');
            if (error) {
              assert.equal(error.message, 'Not found.');
              assert.equal(error.code, 404);
            }
          });

          it('throws when accessing a valid space without a valid project', async () => {
            let error: ApiError | undefined;
            try {
              await store.history.list(user1, { type: 'project', id: project2Id, space: space1Id });
            } catch (e) {
              error = e as ApiError;
            }
            assert.ok(error, 'has the error');
            if (error) {
              assert.equal(error.message, 'Not found.');
              assert.equal(error.code, 404);
            }
          });
        });

        describe('lists all request', () => {
          const requestId = 'test-request';
          const user = mock.user.user();
          let spaceId: string;

          before(async () => {
            await store.user.add(user.key, user);
            const space = Workspace.fromName('test');
            spaceId = space.key;
            await store.space.add(spaceId, space.toJSON(), user, 'owner');

            const c1 = await DataHelper.addHistory(store.history.data, 20, { request: requestId, user: user.key, space: spaceId });
            const c2 = await DataHelper.addHistory(store.history.data, 20, { request: requestId, user: 'other-user', space: spaceId });
            const c3 = await DataHelper.addHistory(store.history.data, 40, { requestsSize: 4, usersSize: 4, space: spaceId });
            await DataHelper.insertRequestHistory(store.history.request, c1);
            await DataHelper.insertRequestHistory(store.history.request, c2);
            await DataHelper.insertRequestHistory(store.history.request, c3);
            await DataHelper.insertSpaceHistory(store.history.space, c1);
            await DataHelper.insertSpaceHistory(store.history.space, c2);
            await DataHelper.insertSpaceHistory(store.history.space, c3);
          });

          after(async () => {
            await store.history.data.clear();
            await store.history.request.clear();
            await store.history.space.clear();
            await store.user.db.clear();
            await store.space.db.clear();
          });

          it('lists all requests to the limit', async () => {
            const list = await store.history.list(user, { type: 'request', id: requestId, space: spaceId });
            assert.typeOf(list.cursor, 'string', 'has the cursor');
            assert.typeOf(list.data, 'array', 'has the data');
            assert.lengthOf(list.data, 35, 'has the default list size');
            const data = list.data as IHttpHistory[];
            const hasInvalid = data.some(i => i.request !== requestId);
            assert.isFalse(hasInvalid, 'has no other items')
          });

          it('respects the limit', async () => {
            const list = await store.history.list(user, { limit: 4, type: 'request', id: requestId, space: spaceId });
            assert.typeOf(list.cursor, 'string', 'has the cursor');
            assert.typeOf(list.data, 'array', 'has the data');
            assert.lengthOf(list.data, 4, 'has the default list size');
          });

          it('paginates to the next page', async () => {
            const list1 = await store.history.list(user, { limit: 2, type: 'request', id: requestId, space: spaceId });
            assert.lengthOf(list1.data, 2, 'original list has 2 items');
            const list2 = await store.history.list(user, { cursor: list1.cursor, });
            assert.lengthOf(list2.data, 2, 'uses the page cursor limit param');
            assert.notDeepEqual(list1.data[0], list2.data[0], 'arrays are not equal');
            assert.notDeepEqual(list1.data[1], list2.data[0], 'has the next element');
          });

          it('reaches the end of pagination', async () => {
            const list1 = await store.history.list(user, { limit: 35, type: 'request', id: requestId, space: spaceId });
            assert.lengthOf(list1.data, 35, 'original list has 35 items');
            const list2 = await store.history.list(user, { cursor: list1.cursor, });
            assert.lengthOf(list2.data, 5, 'has only the remaining entires');
          });

          it('reads for the user only data', async () => {
            const list1 = await store.history.list(user, { limit: 35, type: 'request', id: requestId, space: spaceId, user: true, });
            assert.lengthOf(list1.data, 20, 'has 20 items');
          });
        });

        describe('query the history', () => {
          const user = mock.user.user();
          const requestId = 'test-request';
          let spaceId: string;
          let projectId: string;

          let c1: IHttpHistory[];

          before(async () => {
            await store.user.add(user.key, user);
            const space = Workspace.fromName('test');
            spaceId = space.key;
            await store.space.add(spaceId, space.toJSON(), user, 'owner');
            const project = HttpProject.fromName('test project');
            projectId = project.key;
            store.project.add(spaceId, projectId, project.toJSON(), user);

            c1 = mock.history.httpHistoryList(7, { user: user.key });
            c1[0].log.request!.url = 'https://sub.api.com/v1/api/uCh7liOX?a=b&c=d';
            c1[0].log.request!.headers = 'x-custom-header: abc\nAuthorization: Bearer 12345token';
            c1[0].log.request!.httpMessage = 'some very custom string including: myToken1234';
            c1[0].log.response!.headers = 'x-custom-header: abc\nAuthorization: Bearer 987654token';
            c1[1].log.request!.url = 'https://api.com/v1/api/uCh7liOX/get';
            c1[1].log.request!.payload = 'username=iAmThePassword';
            c1[2].log.request!.url = 'https://dot.com/v1?test=true';
            c1[2].log.request!.payload = { type: 'x-www-form-urlencoded', data: 'username=AlsoAPassword' };
            c1[1].log.response!.payload = 'access_token=U9ajTl0g';
            c1[2].log.response!.payload = { type: 'x-www-form-urlencoded', data: 'access_token=opa0m3ST' };
            // my-special-header: 3TOhwXSB is for testing the user queries
            c1[3].log.request!.headers = 'my-special-header: 3TOhwXSB';
            // requestId to search for data that have the same request id value
            c1[4].request = requestId;
            c1[4].log.request!.headers = 'LBTV9zMj';
            c1[5].space = spaceId;
            c1[5].log.request!.headers = 'LBTV9zMj';
            c1[6].project = projectId;
            c1[6].log.request!.headers = 'LBTV9zMj';
            await DataHelper.insertHistory(store.history.data, c1);
            await DataHelper.insertSpaceHistory(store.history.space, c1);
            await DataHelper.insertRequestHistory(store.history.space, c1);
            await DataHelper.insertProjectHistory(store.history.space, c1);
            const c2 = mock.history.httpHistoryList(20, { user: 'other-user' });
            c2.forEach((item) => {
              const request = item.log.request as ISentRequest;
              if (!request.headers) {
                request.headers = '';
              }
              if (request.headers) {
                request.headers += '\n';
              }
              request.headers += 'my-special-header: 3TOhwXSB';
            });
            await DataHelper.insertHistory(store.history.data, c2);
            // const c2 = await DataHelper.addHistory(store.history.data, 20, { request: requestId, user: 'other-user' });
            const c3 = await DataHelper.addHistory(store.history.data, 40, { requestsSize: 4, usersSize: 4 });
            await DataHelper.insertRequestHistory(store.history.request, c1);
            await DataHelper.insertRequestHistory(store.history.request, c2);
            await DataHelper.insertRequestHistory(store.history.request, c3);
          });

          after(async () => {
            await DataHelper.clearAllHistory(store);
            await store.user.db.clear();
            await store.space.db.clear();
            await store.project.index.clear();
            await store.project.data.clear();
          });

          it('lists requests for the part of URL', async () => {
            // @ts-ignore
            const list = await store.history.list(user, { query: '/v1/api/uCh7liOX' });
            assert.typeOf(list.cursor, 'string', 'has the cursor');
            assert.typeOf(list.data, 'array', 'has the data');
            assert.lengthOf(list.data, 2, 'have found both requests');
          });

          it('lists requests for the base URI', async () => {
            // @ts-ignore
            const list = await store.history.list(user, { query: 'https://sub.api.com/v1/api/uCh7liOX' });
            assert.typeOf(list.cursor, 'string', 'has the cursor');
            assert.typeOf(list.data, 'array', 'has the data');
            assert.lengthOf(list.data, 1, 'have found both requests');
            const data = list.data as IHttpHistory[];
            assert.deepEqual(data[0], c1[0]);
          });

          it('lists requests for a matched request header', async () => {
            // @ts-ignore
            const list = await store.history.list(user, { query: '12345token' });
            assert.typeOf(list.cursor, 'string', 'has the cursor');
            assert.typeOf(list.data, 'array', 'has the data');
            assert.lengthOf(list.data, 1, 'have found both requests');
            const data = list.data as IHttpHistory[];
            assert.deepEqual(data[0], c1[0]);
          });

          it('lists requests for a matched http message', async () => {
            // @ts-ignore
            const list = await store.history.list(user, { query: 'myToken1234' });
            assert.typeOf(list.cursor, 'string', 'has the cursor');
            assert.typeOf(list.data, 'array', 'has the data');
            assert.lengthOf(list.data, 1, 'have found both requests');
            const data = list.data as IHttpHistory[];
            assert.deepEqual(data[0], c1[0]);
          });

          it('lists requests for a matched response header', async () => {
            // @ts-ignore
            const list = await store.history.list(user, { query: '987654token' });
            assert.typeOf(list.cursor, 'string', 'has the cursor');
            assert.typeOf(list.data, 'array', 'has the data');
            assert.lengthOf(list.data, 1, 'have found both requests');
            const data = list.data as IHttpHistory[];
            assert.deepEqual(data[0], c1[0]);
          });

          it('lists requests for a matched request payload as string', async () => {
            // @ts-ignore
            const list = await store.history.list(user, { query: 'iAmThePassword' });
            assert.typeOf(list.cursor, 'string', 'has the cursor');
            assert.typeOf(list.data, 'array', 'has the data');
            assert.lengthOf(list.data, 1, 'have found both requests');
            const data = list.data as IHttpHistory[];
            assert.deepEqual(data[0], c1[1]);
          });

          it('lists requests for a matched request payload.data as string', async () => {
            // @ts-ignore
            const list = await store.history.list(user, { query: 'AlsoAPassword' });
            assert.typeOf(list.cursor, 'string', 'has the cursor');
            assert.typeOf(list.data, 'array', 'has the data');
            assert.lengthOf(list.data, 1, 'have found both requests');
            const data = list.data as IHttpHistory[];
            assert.deepEqual(data[0], c1[2]);
          });

          it('lists requests for a matched response payload as string', async () => {
            // @ts-ignore
            const list = await store.history.list(user, { query: 'access_token U9ajTl0g' });
            assert.typeOf(list.cursor, 'string', 'has the cursor');
            assert.typeOf(list.data, 'array', 'has the data');
            assert.lengthOf(list.data, 1, 'have found both requests');
            const data = list.data as IHttpHistory[];
            assert.deepEqual(data[0], c1[1]);
          });

          it('lists requests for a matched request payload.data as string', async () => {
            // @ts-ignore
            const list = await store.history.list(user, { query: 'access token opa0m3ST' });
            assert.typeOf(list.cursor, 'string', 'has the cursor');
            assert.typeOf(list.data, 'array', 'has the data');
            assert.lengthOf(list.data, 1, 'have found both requests');
            const data = list.data as IHttpHistory[];
            assert.deepEqual(data[0], c1[2]);
          });

          it('lists only user records', async () => {
            // @ts-ignore
            const list = await store.history.list(user, { query: 'my-special-header: 3TOhwXSB', user: true });
            assert.typeOf(list.cursor, 'string', 'has the cursor');
            assert.typeOf(list.data, 'array', 'has the data');
            assert.lengthOf(list.data, 1, 'have found both requests');
            const data = list.data as IHttpHistory[];
            assert.deepEqual(data[0], c1[3]);
          });

          it('lists only records for a request', async () => {
            const list = await store.history.list(user, { query: 'LBTV9zMj', type: 'request', id: requestId, space: spaceId });
            assert.typeOf(list.cursor, 'string', 'has the cursor');
            assert.typeOf(list.data, 'array', 'has the data');
            assert.lengthOf(list.data, 1, 'have found both requests');
            const data = list.data as IHttpHistory[];
            assert.deepEqual(data[0], c1[4]);
          });

          it('lists only records for an space', async () => {
            const list = await store.history.list(user, { query: 'LBTV9zMj', type: 'space', id: spaceId });
            assert.typeOf(list.cursor, 'string', 'has the cursor');
            assert.typeOf(list.data, 'array', 'has the data');
            assert.lengthOf(list.data, 1, 'have found both requests');
            const data = list.data as IHttpHistory[];
            assert.deepEqual(data[0], c1[5]);
          });

          it('lists only records for a project', async () => {
            const list = await store.history.list(user, { query: 'LBTV9zMj', type: 'project', id: projectId, space: spaceId });
            assert.typeOf(list.cursor, 'string', 'has the cursor');
            assert.typeOf(list.data, 'array', 'has the data');
            assert.lengthOf(list.data, 1, 'have found both requests');
            const data = list.data as IHttpHistory[];
            assert.deepEqual(data[0], c1[6]);
          });
        });
      });

      describe('read()', () => {
        const user1 = mock.user.user();
        const user2 = mock.user.user();
        let space1Id: string;
        let space2Id: string;
        let history1: IHttpHistory;
        let history2: IHttpHistory;
        let history3: IHttpHistory;

        before(async () => {
          await store.user.add(user1.key, user1);
          await store.user.add(user2.key, user2);
          const space1 = Workspace.fromName('test1');
          const space2 = Workspace.fromName('test2');
          space1Id = space1.key;
          space2Id = space2.key;
          await store.space.add(space1Id, space1.toJSON(), user1, 'owner');
          await store.space.add(space2Id, space2.toJSON(), user2, 'owner');

          history1 = mock.history.httpHistory({ user: user1.key, space: space1Id });
          history2 = mock.history.httpHistory({ user: user2.key });
          history3 = mock.history.httpHistory({ user: user2.key, space: space2Id });
          await DataHelper.insertHistory(store.history.data, [history1, history2, history3]);

          await DataHelper.insertSpaceHistory(store.history.space, [history1, history3]);
        });

        after(async () => {
          await store.history.data.clear();
          await store.history.space.clear();
          await store.user.db.clear();
          await store.space.db.clear();
        });

        it('reads an object when has access to the space', async () => {
          const key = DataHelper.getHistoryEncodedKey(history1);
          const result = await store.history.read(key, user1);
          assert.deepEqual(result, history1);
        });

        it('reads an object when is an owner', async () => {
          const key = DataHelper.getHistoryEncodedKey(history2);
          const result = await store.history.read(key, user2);
          assert.deepEqual(result, history2);
        });

        it('throws when object not found', async () => {
          const history4 = mock.history.httpHistory({ user: user1.key, space: space1Id });
          const key = DataHelper.getHistoryEncodedKey(history4);

          let error: ApiError | undefined;
          try {
            await store.history.read(key, user1);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, 'Not found.');
            assert.equal(error.code, 404);
          }
        });

        it('throws when the user have no access to the space', async () => {
          const key = DataHelper.getHistoryEncodedKey(history3);
          let error: ApiError | undefined;
          try {
            await store.history.read(key, user1);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, 'Not found.');
            assert.equal(error.code, 404);
          }
        });

        it('throws when accessing history of another user', async () => {
          const key = DataHelper.getHistoryEncodedKey(history2);
          let error: ApiError | undefined;
          try {
            await store.history.read(key, user1);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, 'You are not authorized to read this resource.');
            assert.equal(error.code, 401);
          }
        });
      });

      describe('delete()', () => {
        it('marks the object deleted in the data store', async () => {
          const item = mock.history.httpHistory({ user: DefaultUser.key });
          const id = await store.history.add(item, DefaultUser);
          await store.history.delete(id, DefaultUser);
          const key = DataHelper.getHistoryEncodedKey(item);
          let error: ApiError | undefined;
          try {
            await store.history.read(key, DefaultUser);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, 'Not found.');
            assert.equal(error.code, 404);
          }
        });

        it('throws when not found', async () => {
          let error: ApiError | undefined;
          try {
            await store.history.delete('a key', DefaultUser);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, 'Not found.');
            assert.equal(error.code, 404);
          }
        });

        it('throws when no user property', async () => {
          const item = mock.history.httpHistory();
          // @ts-ignore
          delete item.user;
          const date = new Date(item.created);
          const time = date.toJSON();
          const dataKey = KeyGenerator.historyDataKey(time, DefaultUser.key);
          await store.history.data.put(dataKey, JSON.stringify(item));
          const encodedKey = Buffer.from(dataKey).toString('base64url');

          let error: ApiError | undefined;
          try {
            await store.history.delete(encodedKey, DefaultUser);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, 'Invalid state. The history record is missing the user key.');
            assert.equal(error.code, 500);
          }
        });

        it('throws when deleting other users record', async () => {
          const user1 = mock.user.user();
          const user2 = mock.user.user();

          const item = mock.history.httpHistory({ user: user1.key });
          const id = await store.history.add(item, user1);

          let error: ApiError | undefined;
          try {
            await store.history.delete(id, user2);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, 'You are not authorized to delete this object.');
            assert.equal(error.code, 403);
          }
        });
      });
    });
  });
});