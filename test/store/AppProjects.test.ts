import { assert } from 'chai';
import fs from 'fs/promises';
import path from 'path';
import { JsonPatch } from '@api-client/json';
import sinon from 'sinon';
import { 
  DefaultLogger, ProjectMock, AppProject, AppProjectKind, ApiError, IAppProject, IDeleteRecord, IRevertResult, IPatchInfo, IBackendEvent, RouteBuilder, IPatchRevision, IBatchUpdateResult,
} from '@api-client/core';
import { StoreLevelUp } from '../../src/persistence/StoreLevelUp.js';
import Clients, { IClientFilterOptions } from '../../src/routes/WsClients.js';

const storePath = path.join('test', 'data', 'units', 'store', 'file');

describe('Unit tests', () => {
  let store: StoreLevelUp;
  const mock = new ProjectMock();

  before(async () => {
    await fs.mkdir(storePath, { recursive: true });
    store = new StoreLevelUp(new DefaultLogger(), storePath);
    await store.initialize();
  });

  after(async () => {
    await store.cleanup();
    await fs.rm(storePath, { recursive: true, force: true });
  });

  describe('StoreLevelUp', () => {
    describe('#app', () => {
      describe('#projects', () => {
        describe('create()', () => {
          const user1 = mock.user.user();
          const appId = 'x1b2e3';

          before(async () => {
            await store.user.add(user1.key, user1);
          });
  
          after(async () => {
            await store.app.projects.db.clear();
            await store.user.db.clear();
          });

          it('returns the created record', async () => {
            const data = AppProject.fromName('test').toJSON();
            const result = await store.app.projects.create(data, appId, user1);
            assert.typeOf(result, 'object');
            assert.typeOf(result.key, 'string', 'has an key');
            assert.equal(result.kind, AppProjectKind, 'has the created object');
          });
      
          it('stores the record in the datastore', async () => {
            const data = AppProject.fromName('test').toJSON();
            await store.app.projects.create(data, appId, user1);
            const result = await store.app.projects.read(data.key, appId, user1);
            assert.deepEqual(result, data);
          });

          it('informs the WS client', async () => {
            const data = AppProject.fromName('test').toJSON();
            const spy = sinon.spy(Clients, 'notify');
            let result: IAppProject;
            try {
              result = await store.app.projects.create(data, appId, user1);
            } finally {
              spy.restore();
            }
            assert.isTrue(spy.calledOnce, 'Calls the notify function');
            const event = spy.args[0][0] as IBackendEvent;
            const filter = spy.args[0][1] as IClientFilterOptions;
            assert.equal(event.type, 'event');
            assert.equal(event.operation, 'created');
            assert.deepEqual(event.data, result);
            assert.equal(event.kind, result.kind);
            assert.equal(filter.url, RouteBuilder.appProjects(appId));
            assert.deepEqual(filter.users, [user1.key]);
          });
        });

        describe('read()', () => {
          const user1 = mock.user.user();
          const user2 = mock.user.user();
          const appId = 'x1b2e3';

          before(async () => {
            await store.user.add(user1.key, user1);
            await store.user.add(user2.key, user2);
          });
  
          after(async () => {
            await store.app.projects.db.clear();
            await store.user.db.clear();
          });

          let id: string;
          before(async () => {
            const data = AppProject.fromName('p1').toJSON();
            await store.app.projects.create(data, appId, user1);
            id = data.key;
          });

          it('returns the document media', async () => {
            const result = await store.app.projects.read(id, appId, user1);
            assert.equal(result.kind, AppProjectKind, 'has the kind');
            assert.typeOf(result.created, 'number', 'has the created');
            assert.typeOf(result.info, 'object', 'has the info');
          });
      
          it('throws when no key', async () => {
            let err: ApiError | undefined;
            try {
              await store.app.projects.read('', appId, user1);
            } catch (e) {
              err = e as ApiError;
            }
            assert.equal((err as ApiError).message, 'The "key" argument is missing.');
            assert.equal((err as ApiError).code, 400);
          });
      
          it('throws when not found', async () => {
            let err: ApiError | undefined;
            try {
              await store.app.projects.read('other', appId, user1);
            } catch (e) {
              err = e as ApiError;
            }
            assert.equal((err as ApiError).message, 'Not found.');
            assert.equal((err as ApiError).code, 404);
          });
      
          it('throws when reading record of another user', async () => {
            let err: ApiError | undefined;
            try {
              await store.app.projects.read(id, appId, user2);
            } catch (e) {
              err = e as ApiError;
            }
            assert.equal((err as ApiError).message, 'Not found.');
            assert.equal((err as ApiError).code, 404);
          });
      
          it('throws when reading record of another app', async () => {
            let err: ApiError | undefined;
            try {
              await store.app.projects.read(id, 'xyz', user1);
            } catch (e) {
              err = e as ApiError;
            }
            assert.equal((err as ApiError).message, 'Not found.');
            assert.equal((err as ApiError).code, 404);
          });
        });

        describe('list()', () => {
          describe('without data', () => {
            const user1 = mock.user.user();
            const appId = 'x1b2e3';

            before(async () => {
              await store.user.add(user1.key, user1);
            });
    
            after(async () => {
              await store.user.db.clear();
            });
      
            it('returns empty array', async () => {
              const result = await store.app.projects.list(appId, user1);
              assert.typeOf(result, 'object', 'result is an object');
              assert.lengthOf(result.items, 0, 'result has no items');
              assert.isUndefined(result.cursor, 'cursor is undefined');
            });
          });
      
          describe('with data', () => {
            const user1 = mock.user.user();
            const user2 = mock.user.user();
            const appId1 = 'x1b2e3';
            const appId2 = 't2a3f7';

            before(async () => {
              await store.user.add(user1.key, user1);
              await store.user.add(user2.key, user2);

              const data1 = mock.app.appProjects(40, { noRequests: true });
              await store.app.projects.createBatch(data1, appId1, user1);
              const data2 = mock.app.appProjects(10, { noRequests: true });
              await store.app.projects.createBatch(data2, appId1, user2);
              const data3 = mock.app.appProjects(10, { noRequests: true });
              await store.app.projects.createBatch(data3, appId2, user1);
            });
    
            after(async () => {
              await store.app.projects.db.clear();
              await store.user.db.clear();
            });
      
            it('returns a query result for default parameters', async () => {
              const result = await store.app.projects.list(appId1, user1);
              assert.typeOf(result, 'object', 'result is an object');
              assert.typeOf(result.cursor, 'string', 'has page token');
              assert.typeOf(result.items, 'array', 'has response items');
              assert.lengthOf(result.items, store.defaultLimit, 'has default limit of items');
            });
      
            it('respects the "limit" parameter', async () => {
              const result = await store.app.projects.list(appId1, user1, {
                limit: 5,
              });
              assert.lengthOf(result.items, 5);
            });
      
            it('respects the "cursor" parameter', async () => {
              const result1 = await store.app.projects.list(appId1, user1, {
                limit: 10,
              });
              const result2 = await store.app.projects.list(appId1, user1, {
                cursor: result1.cursor,
              });
              assert.lengthOf(result2.items, 10);
              const all = await store.app.projects.list(appId1, user1, {
                limit: 20,
              });
              assert.deepEqual(all.items, result1.items.concat(result2.items), 'has both pages');
            });
      
            it('does not set "cursor" when no more results', async () => {
              const result1 = await store.app.projects.list(appId1, user1, {
                limit: 40,
              });
              const result2 = await store.app.projects.list(appId1, user1, {
                cursor: result1.cursor,
              });
              assert.isUndefined(result2.cursor);
            });

            it('only list user projects', async () => {
              const result = await store.app.projects.list(appId1, user2);
              assert.lengthOf(result.items, 10);
            });

            it('only list application and user projects', async () => {
              const result = await store.app.projects.list(appId2, user1);
              assert.lengthOf(result.items, 10);
            });

            it('does not return results for unknown app', async () => {
              const result = await store.app.projects.list('other', user1);
              assert.lengthOf(result.items, 0);
            });

            it('does not return results for unknown user', async () => {
              const result = await store.app.projects.list(appId2, mock.user.user());
              assert.lengthOf(result.items, 0);
            });
          });
        });

        describe('delete()', () => {
          const user1 = mock.user.user();
          const user2 = mock.user.user();
          const appId1 = 'x1b2e3';
          const appId2 = 't2a3f7';
          let p1: IAppProject;
          let p2: IAppProject;
          let p3: IAppProject;

          before(async () => {
            await store.user.add(user1.key, user1);
            await store.user.add(user2.key, user2);
          });
  
          after(async () => {
            await store.app.projects.db.clear();
            await store.user.db.clear();
          });

          beforeEach(async () => {
            p1 = mock.app.appProject({ foldersSize: 0, noRequests: true });
            await store.app.projects.create(p1, appId1, user1);
            p2 = mock.app.appProject({ foldersSize: 0, noRequests: true });
            await store.app.projects.create(p2, appId1, user2);
            p3 = mock.app.appProject({ foldersSize: 0, noRequests: true });
            await store.app.projects.create(p3, appId2, user1);
          });

          it('deletes the requested record', async () => {
            await store.app.projects.delete(p1.key, appId1, user1);
            let result: IAppProject | undefined;
            try {
              result = await store.app.projects.read(p1.key, appId1, user1);
            } catch (e) {
              // ...
            }
            assert.isUndefined(result);
          });

          it('returns the delete record', async () => {
            const result = await store.app.projects.delete(p1.key, appId1, user1);
            assert.deepEqual(result, { key: p1.key });
          });
      
          it('throws when not found', async () => {
            let err: ApiError | undefined;
            try {
              await store.app.projects.delete('other', appId1, user1);
            } catch (e) {
              err = e as ApiError;
            }
            assert.equal((err as ApiError).message, 'Not found.');
            assert.equal((err as ApiError).code, 404);
          });
      
          it('throws when no key', async () => {
            let err: ApiError | undefined;
            try {
              // @ts-ignore
              await store.app.projects.delete(undefined, appId1, user1);
            } catch (e) {
              err = e as ApiError;
            }
            assert.equal((err as ApiError).message, 'The "key" argument is missing.');
            assert.equal((err as ApiError).code, 400);
          });

          it('throws when items not belonging to the user', async () => {
            let err: ApiError | undefined;
            try {
              await store.app.projects.delete(p2.key, appId1, user1);
            } catch (e) {
              err = e as ApiError;
            }
            assert.equal((err as ApiError).message, 'Not found.');
            assert.equal((err as ApiError).code, 404);
          });

          it('throws when items not belonging to the app', async () => {
            let err: ApiError | undefined;
            try {
              await store.app.projects.delete(p3.key, appId1, user1);
            } catch (e) {
              err = e as ApiError;
            }
            assert.equal((err as ApiError).message, 'Not found.');
            assert.equal((err as ApiError).code, 404);
          });

          it('informs WS clients', async () => {
            const spy = sinon.spy(Clients, 'notify');
            try {
              await store.app.projects.delete(p1.key, appId1, user1);
            } finally {
              spy.restore();
            }
            assert.equal(spy.callCount, 2, 'calls the notify function for the collection and the media');
            const e1 = spy.args[0][0] as IBackendEvent;
            const f1 = spy.args[0][1] as IClientFilterOptions;
            assert.equal(e1.type, 'event');
            assert.equal(e1.operation, 'deleted');
            assert.equal(e1.kind, p1.kind);
            assert.equal(e1.id, p1.key);
            assert.equal(f1.url, RouteBuilder.appProjects(appId1));

            const e2 = spy.args[1][0] as IBackendEvent;
            const f2 = spy.args[1][1] as IClientFilterOptions;
            assert.equal(e2.type, 'event');
            assert.equal(e2.operation, 'deleted');
            assert.equal(e2.kind, p1.kind);
            assert.equal(e2.id, p1.key);
            assert.equal(f2.url, RouteBuilder.appProjectItem(appId1, p1.key));
          });
        });

        describe('patch()', () => {
          const user1 = mock.user.user();
          const user2 = mock.user.user();
          const appId1 = 'x1b2e3';
          const appId2 = 't2a3f7';
          let p1: IAppProject;

          before(async () => {
            await store.user.add(user1.key, user1);
            await store.user.add(user2.key, user2);
          });
  
          after(async () => {
            await store.app.projects.db.clear();
            await store.user.db.clear();
          });

          beforeEach(async () => {
            p1 = mock.app.appProject({ foldersSize: 0, noRequests: true });
            await store.app.projects.create(p1, appId1, user1);
          });

          it('patches the object', async () => {
            const patch: JsonPatch = [
              {
                op: 'replace',
                path: '/info/name',
                value: 'New name',
              }
            ];
            const info: IPatchInfo = {
              app: appId1,
              appVersion: '1',
              id: '123',
              patch,
            };
            await store.app.projects.patch(p1.key, appId1, info, user1);
            const result = await store.app.projects.read(p1.key, appId1, user1) as IAppProject;
            assert.equal(result.info.name, 'New name');
          });

          it('returns the patch info', async () => {
            const patch: JsonPatch = [
              {
                op: 'replace',
                path: '/info/name',
                value: 'New name',
              }
            ];
            const info: IPatchInfo = {
              app: appId1,
              appVersion: '1',
              id: '123',
              patch,
            };
            const data = await store.app.projects.patch(p1.key, appId1, info, user1);
            
            assert.typeOf(data, 'object', 'has the data object');
            assert.equal(data.app, appId1, 'has the data.app');
            assert.equal(data.appVersion, '1', 'has the data.appVersion');
            assert.equal(data.id, '123', 'has the data.id');
            assert.deepEqual(data.patch, patch, 'has the data.patch');
            assert.typeOf(data.revert, 'array', 'has the data.revert');
          });

          it('throws when the project not belonging to the user', async () => {
            let err: ApiError | undefined;
            const patch: JsonPatch = [
              {
                op: 'replace',
                path: '/info/name',
                value: 'New name',
              }
            ];
            const info: IPatchInfo = {
              app: appId1,
              appVersion: '1',
              id: '123',
              patch,
            };
            try {
              await store.app.projects.patch(p1.key, appId1, info, user2);
            } catch (e) {
              err = e as ApiError;
            }
            assert.equal((err as ApiError).message, 'Not found.');
            assert.equal((err as ApiError).code, 404);
          });

          it('throws when items not belonging to the app', async () => {
            let err: ApiError | undefined;
            const patch: JsonPatch = [
              {
                op: 'replace',
                path: '/info/name',
                value: 'New name',
              }
            ];
            const info: IPatchInfo = {
              app: appId2,
              appVersion: '1',
              id: '123',
              patch,
            };
            try {
              await store.app.projects.patch(p1.key, appId2, info, user1);
            } catch (e) {
              err = e as ApiError;
            }
            assert.equal((err as ApiError).message, 'Not found.');
            assert.equal((err as ApiError).code, 404);
          });
          
          it('informs the WS client', async () => {
            const spy = sinon.spy(Clients, 'notify');
            let result: IPatchRevision;
            const patch: JsonPatch = [
              {
                op: 'replace',
                path: '/info/name',
                value: 'New name',
              }
            ];
            const info: IPatchInfo = {
              app: appId1,
              appVersion: '1',
              id: '123',
              patch,
            };
            try {
              result = await store.app.projects.patch(p1.key, appId1, info, user1);
            } finally {
              spy.restore();
            }
            assert.isTrue(spy.calledOnce, 'Calls the notify function');
            const event = spy.args[0][0] as IBackendEvent;
            const filter = spy.args[0][1] as IClientFilterOptions;
            assert.equal(event.type, 'event');
            assert.equal(event.operation, 'patch');
            assert.deepEqual(event.data, result);
            assert.equal(event.kind, p1.kind);
            assert.equal(filter.url, RouteBuilder.appProjectItem(appId1, p1.key));
            assert.deepEqual(filter.users, [user1.key]);
          });
        });

        describe('createBatch()', () => {
          const user1 = mock.user.user();
          const appId = 'x1b2e3';
          let data: IAppProject[];

          before(async () => {
            await store.user.add(user1.key, user1);
          });
  
          after(async () => {
            await store.app.projects.db.clear();
            await store.user.db.clear();
          });

          beforeEach(() => {
            data = mock.app.appProjects(2, { foldersSize: 0, noRequests: true });
          });

          it('returns the change record', async () => {
            const result = await store.app.projects.createBatch(data, appId, user1);
            assert.typeOf(result, 'object', 'returns an object');
            assert.typeOf(result.items, 'array', 'the .items is an array');
            assert.lengthOf(result.items, 2, 'the .items has 2 results');
            const [r1, r2] = result.items;
            assert.typeOf(r1.key, 'string', 'has the #1 key');
            assert.deepEqual(r1, data[0], 'has the #1 item');
            assert.typeOf(r2.key, 'string', 'has the #2 key');
            assert.deepEqual(r2, data[1], 'has the #2 item');
          });
      
          it('stores the documents in the datastore', async () => {
            await store.app.projects.createBatch(data, appId, user1);
            const result = await store.app.projects.read(data[0].key, appId, user1);
            assert.deepEqual(result, data[0]);
          });
      
          it('handles empty arrays', async () => {
            const result = await store.app.projects.createBatch([], appId, user1);
            assert.deepEqual(result.items, []);
          });

          it('throws when no values', async () => {
            let err: ApiError | undefined;
            try {
              // @ts-ignore
              await store.app.projects.createBatch(undefined, appId, user1);
            } catch (e) {
              err = e as ApiError;
            }
            assert.equal((err as ApiError).message, 'Unexpected argument. An array must be passed to "createBatch()" method.');
            assert.equal((err as ApiError).code, 400);
          });
      
          it('throws when an item has no key', async () => {
            let err: ApiError | undefined;
            try {
              // @ts-ignore
              data[1].key = undefined;
              await store.app.projects.createBatch(data, appId, user1);
            } catch (e) {
              err = e as ApiError;
            }
            assert.equal((err as ApiError).message, 'Unable to process bulk values when inserting to projects: a key is missing.');
            assert.equal((err as ApiError).code, 400);
          });

          it('informs the WS client', async () => {
            const spy = sinon.spy(Clients, 'notify');
            let result: IBatchUpdateResult<IAppProject>;
            try {
              result = await store.app.projects.createBatch(data, appId, user1);
            } finally {
              spy.restore();
            }
            assert.equal(spy.callCount, 2, 'calls the notify function twice');
            const e1 = spy.args[0][0] as IBackendEvent;
            const f1 = spy.args[0][1] as IClientFilterOptions;
            assert.equal(e1.type, 'event');
            assert.equal(e1.operation, 'created');
            assert.deepEqual(e1.data, result.items[0]);
            assert.equal(e1.kind, result.items[0].kind);
            assert.equal(f1.url, RouteBuilder.appProjects(appId));
            assert.deepEqual(f1.users, [user1.key]);

            const e2 = spy.args[1][0] as IBackendEvent;
            const f2 = spy.args[1][1] as IClientFilterOptions;
            assert.equal(e2.type, 'event');
            assert.equal(e2.operation, 'created');
            assert.deepEqual(e2.data, result.items[1]);
            assert.equal(e2.kind, result.items[1].kind);
            assert.equal(f2.url, RouteBuilder.appProjects(appId));
            assert.deepEqual(f2.users, [user1.key]);
          });
        });

        describe('readBatch()', () => {
          const user1 = mock.user.user();
          const user2 = mock.user.user();
          const appId1 = 'x1b2e3';
          const appId2 = 't2a3f7';
          let data1: IAppProject[];
          let data2: IAppProject[];
          let data3: IAppProject[];

          before(async () => {
            await store.user.add(user1.key, user1);
            await store.user.add(user2.key, user2);
            data1 = mock.app.appProjects(5, { foldersSize: 0, noRequests: true });
            await store.app.projects.createBatch(data1, appId1, user1);
            data2 = mock.app.appProjects(5, { foldersSize: 0, noRequests: true });
            await store.app.projects.createBatch(data2, appId1, user2);
            data3 = mock.app.appProjects(5, { foldersSize: 0, noRequests: true });
            await store.app.projects.createBatch(data3, appId2, user1);
          });
  
          after(async () => {
            await store.app.projects.db.clear();
            await store.user.db.clear();
          });

          it('reds the requested records', async () => {
            const result = await store.app.projects.readBatch([data1[0].key, data1[1].key], appId1, user1);
            assert.typeOf(result, 'object', 'returns an object');
            assert.typeOf(result.items, 'array', 'the .items is an array');
            assert.lengthOf(result.items, 2, 'the .items has 2 results');
            const [p1, p2] = (result.items as IAppProject[]);
            assert.typeOf(p1.key, 'string', 'has the #1 key');
            assert.deepEqual(p1, data1[0], 'has the #1 item');
            assert.typeOf(p2.key, 'string', 'has the #2 key');
            assert.deepEqual(p2, data1[1], 'has the #2 item');
          });
      
          it('returns undefined when an item is not found', async () => {
            const result = await store.app.projects.readBatch([data1[0].key, 'other'], appId1, user1);
            const [p1, p2] = (result.items as IAppProject[]);
            assert.deepEqual(p1, data1[0], 'has the #1 item');
            assert.isUndefined(p2);
          });
      
          it('handles empty arrays', async () => {
            const result = await store.app.projects.readBatch([], appId1, user1);
            assert.deepEqual(result.items, []);
          });

          it('throws when no keys', async () => {
            let err: ApiError | undefined;
            try {
              // @ts-ignore
              await store.app.projects.readBatch(undefined, appId1, user1);
            } catch (e) {
              err = e as ApiError;
            }
            assert.equal((err as ApiError).message, 'The "keys" argument is missing.');
            assert.equal((err as ApiError).code, 400);
          });
      
          it('throws when keys are invalid', async () => {
            let err: ApiError | undefined;
            try {
              // @ts-ignore
              await store.app.projects.readBatch('test', appId1, user1);
            } catch (e) {
              err = e as ApiError;
            }
            assert.equal((err as ApiError).message, 'The "keys" argument expected to be an array.');
            assert.equal((err as ApiError).code, 400);
          });

          it('ignores deleted items', async () => {
            const p6 = mock.app.appProject({ foldersSize: 0, noRequests: true });
            await store.app.projects.create(p6, appId1, user1);
            await store.app.projects.delete(p6.key, appId1, user1);
            const result = await store.app.projects.readBatch([data1[0].key, p6.key], appId1, user1);
            const [p1, p2] = (result.items as IAppProject[]);
            assert.deepEqual(p1, data1[0], 'has the #1 item');
            assert.isUndefined(p2);
          });

          it('ignores items not belonging to the user', async () => {
            const result = await store.app.projects.readBatch([data1[0].key, data2[0].key], appId1, user1);
            const [p1, p2] = (result.items as IAppProject[]);
            assert.deepEqual(p1, data1[0], 'has the #1 item');
            assert.isUndefined(p2);
          });

          it('ignores items not belonging to another app', async () => {
            const result = await store.app.projects.readBatch([data1[0].key, data3[0].key], appId1, user1);
            const [p1, p2] = (result.items as IAppProject[]);
            assert.deepEqual(p1, data1[0], 'has the #1 item');
            assert.isUndefined(p2);
          });
        });

        describe('deleteBatch()', () => {
          const user1 = mock.user.user();
          const user2 = mock.user.user();
          const appId1 = 'x1b2e3';
          const appId2 = 't2a3f7';
          let data1: IAppProject[];
          let data2: IAppProject[];
          let data3: IAppProject[];

          before(async () => {
            await store.user.add(user1.key, user1);
            await store.user.add(user2.key, user2);
          });
  
          after(async () => {
            await store.app.projects.db.clear();
            await store.user.db.clear();
          });

          beforeEach(async () => {
            data1 = mock.app.appProjects(3, { foldersSize: 0, noRequests: true });
            await store.app.projects.createBatch(data1, appId1, user1);
            data2 = mock.app.appProjects(1, { foldersSize: 0, noRequests: true });
            await store.app.projects.createBatch(data2, appId1, user2);
            data3 = mock.app.appProjects(1, { foldersSize: 0, noRequests: true });
            await store.app.projects.createBatch(data3, appId2, user1);
          })

          it('deletes the requested records', async () => {
            await store.app.projects.deleteBatch([data1[0].key, data1[1].key], appId1, user1);
            const result = await store.app.projects.readBatch([data1[0].key, data1[1].key, data1[2].key], appId1, user1);
            assert.lengthOf(result.items, 3, 'has 3 results');
            const [p1, p2, p3] = (result.items as IAppProject[]);
            assert.isUndefined(p1, 'deletes item #1');
            assert.isUndefined(p2, 'deletes item #2');
            assert.deepEqual(p3, data1[2], 'has item #3');
          });

          it('returns the delete record', async () => {
            const result = await store.app.projects.deleteBatch([data1[0].key, data1[1].key], appId1, user1);
            assert.typeOf(result, 'object', 'returns an object');
            assert.typeOf(result.items, 'array', 'has the items');
            const [log1, log2] = result.items as IDeleteRecord[];
            assert.deepEqual(log1, { key: data1[0].key });
            assert.deepEqual(log2, { key: data1[1].key });
          });
      
          it('returns undefined when an item is not found', async () => {
            const result = await store.app.projects.deleteBatch([data1[0].key, 'other'], appId1, user1);
            const [log1, log2] = result.items as IDeleteRecord[];
            assert.deepEqual(log1, { key: data1[0].key });
            assert.isUndefined(log2);
          });
      
          it('handles empty arrays', async () => {
            const result = await store.app.projects.deleteBatch([], appId1, user1);
            assert.deepEqual(result.items, []);
          });

          it('throws when no keys', async () => {
            let err: ApiError | undefined;
            try {
              // @ts-ignore
              await store.app.projects.deleteBatch(undefined, appId1, user1);
            } catch (e) {
              err = e as ApiError;
            }
            assert.equal((err as ApiError).message, 'The "keys" argument is missing.');
            assert.equal((err as ApiError).code, 400);
          });
      
          it('throws when keys are invalid', async () => {
            let err: ApiError | undefined;
            try {
              // @ts-ignore
              await store.app.projects.deleteBatch('test', appId1, user1);
            } catch (e) {
              err = e as ApiError;
            }
            assert.equal((err as ApiError).message, 'The "keys" argument expected to be an array.');
            assert.equal((err as ApiError).code, 400);
          });

          it('ignores items not belonging to the user', async () => {
            const result = await store.app.projects.deleteBatch([data1[0].key, data2[0].key], appId1, user1);
            const [log1, log2] = result.items as IDeleteRecord[];
            assert.deepEqual(log1, { key: data1[0].key });
            assert.isUndefined(log2);
          });

          it('ignores items not belonging to another app', async () => {
            const result = await store.app.projects.deleteBatch([data1[0].key, data3[0].key], appId1, user1);
            const [log1, log2] = result.items as IDeleteRecord[];
            assert.deepEqual(log1, { key: data1[0].key });
            assert.isUndefined(log2);
          });

          it('informs the WS client', async () => {
            const spy = sinon.spy(Clients, 'notify');
            try {
              await store.app.projects.deleteBatch([data1[0].key, data1[1].key], appId1, user1)
            } finally {
              spy.restore();
            }
            assert.equal(spy.callCount, 4, 'calls the notify function 4 times');
            // we will tests first two here (collection and the media) as all is in a loop.
            const e1 = spy.args[0][0] as IBackendEvent;
            const f1 = spy.args[0][1] as IClientFilterOptions;
            assert.equal(e1.type, 'event');
            assert.equal(e1.operation, 'deleted');
            assert.equal(e1.kind, AppProjectKind);
            assert.equal(e1.id, data1[0].key);
            assert.equal(f1.url, RouteBuilder.appProjects(appId1));
            assert.deepEqual(f1.users, [user1.key]);

            const e2 = spy.args[1][0] as IBackendEvent;
            const f2 = spy.args[1][1] as IClientFilterOptions;
            assert.equal(e2.type, 'event');
            assert.equal(e2.operation, 'deleted');
            assert.equal(e2.kind, AppProjectKind);
            assert.equal(e2.id, data1[0].key);
            assert.equal(f2.url, RouteBuilder.appProjectItem(appId1, data1[0].key));
            assert.deepEqual(f2.users, [user1.key]);
          });
        });

        describe('undeleteBatch()', () => {
          const user1 = mock.user.user();
          const user2 = mock.user.user();
          const appId1 = 'x1b2e3';
          const appId2 = 't2a3f7';
          let data1: IAppProject[];
          let data2: IAppProject[];
          let data3: IAppProject[];

          before(async () => {
            await store.user.add(user1.key, user1);
            await store.user.add(user2.key, user2);
          });
  
          after(async () => {
            await store.app.projects.db.clear();
            await store.user.db.clear();
          });

          beforeEach(async () => {
            data1 = mock.app.appProjects(3, { foldersSize: 0, noRequests: true });
            await store.app.projects.createBatch(data1, appId1, user1);
            data2 = mock.app.appProjects(1, { foldersSize: 0, noRequests: true });
            await store.app.projects.createBatch(data2, appId1, user2);
            data3 = mock.app.appProjects(1, { foldersSize: 0, noRequests: true });
            await store.app.projects.createBatch(data3, appId2, user1);

            await store.app.projects.deleteBatch(data1.map(i => i.key), appId1, user1);
            await store.app.projects.deleteBatch(data2.map(i => i.key), appId1, user2);
            await store.app.projects.deleteBatch(data3.map(i => i.key), appId2, user1);
          })

          it('restores the requested records', async () => {
            await store.app.projects.undeleteBatch([data1[0].key, data1[1].key], appId1, user1);
            const result = await store.app.projects.readBatch([data1[0].key, data1[1].key, data1[2].key], appId1, user1);
            assert.lengthOf(result.items, 3, 'has 3 results');
            const [p1, p2, p3] = (result.items as IAppProject[]);
            assert.deepEqual(p1, data1[0], 'restores item #1');
            assert.deepEqual(p2, data1[1],'restores item #2');
            assert.isUndefined(p3, 'keeps item #3 deleted');
          });

          it('returns the revert record', async () => {
            const result = await store.app.projects.undeleteBatch([data1[0].key, data1[1].key], appId1, user1);
            assert.typeOf(result, 'object', 'returns an object');
            assert.typeOf(result.items, 'array', 'has the items');
            const [log1, log2] = result.items as IRevertResult<IAppProject>[];
            assert.deepEqual(log1, { key: data1[0].key, kind: data1[0].kind, item: data1[0] });
            assert.deepEqual(log2, { key: data1[1].key, kind: data1[1].kind, item: data1[1] });
          });
      
          it('returns undefined when an item is not found', async () => {
            const result = await store.app.projects.undeleteBatch([data1[0].key, 'other'], appId1, user1);
            const [log1, log2] = result.items as IRevertResult<IAppProject>[];
            assert.deepEqual(log1, { key: data1[0].key, kind: data1[0].kind, item: data1[0] });
            assert.isUndefined(log2);
          });

          it('returns undefined when an item is not deleted', async () => {
            const p4 = mock.app.appProject({ foldersSize: 0, noRequests: true });
            await store.app.projects.create(p4, appId1, user1);
            const result = await store.app.projects.undeleteBatch([data1[0].key, p4.key], appId1, user1);
            const [log1, log2] = result.items as IRevertResult<IAppProject>[];
            assert.deepEqual(log1, { key: data1[0].key, kind: data1[0].kind, item: data1[0] });
            assert.isUndefined(log2);
          });
      
          it('handles empty arrays', async () => {
            const result = await store.app.projects.undeleteBatch([], appId1, user1);
            assert.deepEqual(result.items, []);
          });

          it('throws when no keys', async () => {
            let err: ApiError | undefined;
            try {
              // @ts-ignore
              await store.app.projects.undeleteBatch(undefined, appId1, user1);
            } catch (e) {
              err = e as ApiError;
            }
            assert.equal((err as ApiError).message, 'The "keys" argument is missing.');
            assert.equal((err as ApiError).code, 400);
          });
      
          it('throws when keys are invalid', async () => {
            let err: ApiError | undefined;
            try {
              // @ts-ignore
              await store.app.projects.undeleteBatch('test', appId1, user1);
            } catch (e) {
              err = e as ApiError;
            }
            assert.equal((err as ApiError).message, 'The "keys" argument expected to be an array.');
            assert.equal((err as ApiError).code, 400);
          });

          it('ignores items not belonging to the user', async () => {
            const result = await store.app.projects.undeleteBatch([data1[0].key, data2[0].key], appId1, user1);
            const [log1, log2] = result.items as IRevertResult<IAppProject>[];
            assert.deepEqual(log1, { key: data1[0].key, kind: data1[0].kind, item: data1[0] });
            assert.isUndefined(log2);
          });

          it('ignores items not belonging to another app', async () => {
            const result = await store.app.projects.undeleteBatch([data1[0].key, data3[0].key], appId1, user1);
            const [log1, log2] = result.items as IRevertResult<IAppProject>[];
            assert.deepEqual(log1, { key: data1[0].key, kind: data1[0].kind, item: data1[0] });
            assert.isUndefined(log2);
          });

          it('informs the WS client', async () => {
            const spy = sinon.spy(Clients, 'notify');
            try {
              await store.app.projects.undeleteBatch([data1[0].key, data1[1].key], appId1, user1);
            } finally {
              spy.restore();
            }
            assert.equal(spy.callCount, 2, 'calls the notify function 2 times');
            const e1 = spy.args[0][0] as IBackendEvent;
            const f1 = spy.args[0][1] as IClientFilterOptions;
            assert.equal(e1.type, 'event', 'has the type');
            assert.equal(e1.operation, 'created', 'has the operation');
            assert.equal(e1.kind, AppProjectKind), 'has the kind';
            assert.equal(e1.id, data1[0].key, 'has the id');
            assert.deepEqual(e1.data, data1[0], 'has the data');
            assert.equal(f1.url, RouteBuilder.appProjects(appId1), 'has the url');
            assert.deepEqual(f1.users, [user1.key], 'has the users');

            const e2 = spy.args[1][0] as IBackendEvent;
            const f2 = spy.args[1][1] as IClientFilterOptions;
            assert.equal(e2.type, 'event');
            assert.equal(e2.operation, 'created');
            assert.equal(e2.kind, AppProjectKind);
            assert.equal(e2.id, data1[1].key);
            assert.deepEqual(e2.data, data1[1]);
            assert.equal(f2.url, RouteBuilder.appProjects(appId1));
            assert.deepEqual(f2.users, [user1.key]);
          });
        });
      });
    });
  });
});
