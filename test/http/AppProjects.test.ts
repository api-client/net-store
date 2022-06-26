/* eslint-disable import/no-named-as-default-member */
import chai, { assert } from 'chai';
import { 
  RouteBuilder, StoreSdk, AppProject, AppProjectKind, IAppProject, ProjectMock, IPatchInfo, IDeleteRecord, IRevertResult, IQueryResult,
} from '@api-client/core';
import { JsonPatch } from '@api-client/json';
import chaiAsPromised from 'chai-as-promised';
import getConfig from '../helpers/getSetup.js';
import HttpHelper from '../helpers/HttpHelper.js';

chai.use(chaiAsPromised);

describe('http', () => {
  let apiUri: string;
  const http = new HttpHelper();
  const mock = new ProjectMock();

  describe('Multi-user', () => {
    let sdk: StoreSdk;

    before(async () => {
      const cnf = await getConfig();
      apiUri = cnf.multiUserBaseUri;
      sdk = new StoreSdk(cnf.multiUserBaseUri);
      sdk.silent = true;
    });

    describe('/app/{appId}/projects', () => {
      describe('GET', () => {
        let user1Token: string;
        let user2Token: string;
        const appId1 = 'x1b2e3';
        const appId2 = 't2a3f7';
  
        before(async () => {
          user1Token = await http.createUserToken(apiUri);
          user2Token = await http.createUserToken(apiUri);
          await http.post(`${apiUri}/test/generate/app/projects?size=40&noRequests=true&app=${appId1}`, { token: user1Token });
          await http.post(`${apiUri}/test/generate/app/projects?size=10&noRequests=true&app=${appId1}`, { token: user2Token });
          await http.post(`${apiUri}/test/generate/app/projects?size=10&noRequests=true&app=${appId2}`, { token: user1Token });
  
          sdk.token = user1Token;
        });
  
        after(async () => {
          await http.delete(`${apiUri}/test/reset/app/projects`);
          await http.delete(`${apiUri}/test/reset/users`);
          await http.delete(`${apiUri}/test/reset/sessions`);
        });
  
        it('returns a query result for default parameters', async () => {
          const result = await sdk.app.projects.list(appId1);
          assert.typeOf(result, 'object', 'result is an object');
          assert.typeOf(result.cursor, 'string', 'has page token');
          assert.typeOf(result.items, 'array', 'has response items');
          assert.lengthOf(result.items, 35, 'has default limit of items');
        });
  
        it('respects the "limit" parameter', async () => {
          const result = await sdk.app.projects.list(appId1, {
            limit: 5,
          });
          assert.lengthOf(result.items, 5);
        });
  
        it('respects the "cursor" parameter', async () => {
          const result1 = await sdk.app.projects.list(appId1, {
            limit: 10,
          });
          const result2 = await sdk.app.projects.list(appId1, {
            cursor: result1.cursor,
          });
          assert.lengthOf(result2.items, 10);
          const all = await sdk.app.projects.list(appId1, {
            limit: 20,
          });
          assert.deepEqual(all.items, result1.items.concat(result2.items), 'has both pages');
        });
  
        it('only list user projects', async () => {
          const result = await sdk.app.projects.list(appId1, undefined, { token: user2Token });
          assert.lengthOf(result.items, 10);
        });
  
        it('only list application and user projects', async () => {
          const result = await sdk.app.projects.list(appId2);
          assert.lengthOf(result.items, 10);
        });
  
        it('does not return results for unknown app', async () => {
          const result = await sdk.app.projects.list('other');
          assert.lengthOf(result.items, 0);
        });
  
        it('sdk throws an error when unknown user', async () => {
          await assert.isRejected(sdk.app.projects.list(appId2, undefined, { token: 'test' }), `Not authorized.`);
        });
      });
  
      describe('POST', () => {
        const appId1 = 'x1b2e3';
  
        before(async () => {
          sdk.token = await http.createUserToken(apiUri);
        });
  
        after(async () => {
          await http.delete(`${apiUri}/test/reset/app/projects`);
          await http.delete(`${apiUri}/test/reset/users`);
          await http.delete(`${apiUri}/test/reset/sessions`);
        });
  
        it('returns the created record', async () => {
          const data = AppProject.fromName('test').toJSON();
          const result = await sdk.app.projects.create(data, appId1);
          assert.typeOf(result, 'object');
          assert.typeOf(result.key, 'string', 'has an key');
          assert.equal(result.kind, AppProjectKind, 'has the created object');
        });
  
        it('returns the location header', async () => {
          const data = AppProject.fromName('test').toJSON();
          const result = await http.post(`${apiUri}${RouteBuilder.appProjects(appId1)}`, {
            token: sdk.token,
            body: JSON.stringify(data),
            headers: {
              'content-type': 'application/json',
            },
          });
          const loc = result.headers.location as string;
          assert.typeOf(loc, 'string', 'has the header');
          assert.include(loc, RouteBuilder.appProjects(appId1), 'has the projects root');
        });
  
      });

      describe('lists since', () => {
        const appId = 'x1b2e3';

        before(async () => {
          sdk.token = await http.createUserToken(apiUri);
        });

        after(async () => {
          await http.delete(`${apiUri}/test/reset/app/projects`);
          await http.delete(`${apiUri}/test/reset/users`);
          await http.delete(`${apiUri}/test/reset/sessions`);
        });
  
        it('returns empty array', async () => {
          const now = Date.now();
          const p1 = mock.app.appProject({ foldersSize: 0, noRequests: true });
          p1.created = now - 1000;
          p1.updated = now - 1000;
          const p2 = mock.app.appProject({ foldersSize: 0, noRequests: true });
          p2.created = now + 1000;
          p2.updated = now + 1000;
          await sdk.app.projects.createBatch([p1, p2], appId);

          const result = await sdk.app.projects.list(appId, { since: now });
          assert.lengthOf(result.items, 1, 'returns a single item');
          assert.deepEqual(result.items, [p2]);
        });
      });
    });

    describe('/app/{appId}/projects/{key}', () => {
      describe('GET', () => {
        let user1Token: string;
        let user2Token: string;
        const appId1 = 'x1b2e3';
        let id: string;
  
        before(async () => {
          user1Token = await http.createUserToken(apiUri);
          user2Token = await http.createUserToken(apiUri);
          sdk.token = user1Token;

          const data = AppProject.fromName('test').toJSON();
          await sdk.app.projects.create(data, appId1);
          id = data.key;
        });
  
        after(async () => {
          await http.delete(`${apiUri}/test/reset/app/projects`);
          await http.delete(`${apiUri}/test/reset/users`);
          await http.delete(`${apiUri}/test/reset/sessions`);
        });

        it('returns the document media', async () => {
          const result = await sdk.app.projects.read(id, appId1);
          assert.equal(result.kind, AppProjectKind, 'has the kind');
          assert.typeOf(result.created, 'number', 'has the created');
          assert.typeOf(result.info, 'object', 'has the info');
        });

        it('sdk throws an error when unknown user', async () => {
          await assert.isRejected(sdk.app.projects.read(id, appId1, { token: 'test' }), `The client is not authorized to access this resource.`);
        });

        it('sdk throws an error when unknown key', async () => {
          await assert.isRejected(sdk.app.projects.read('other', appId1), `Not found.`);
        });

        it('throws when reading record of another user', async () => {
          await assert.isRejected(sdk.app.projects.read('other', appId1, { token: user2Token }), `Not found.`);
        });
      });

      describe('DELETE', () => {
        let user1Token: string;
        let user2Token: string;
        const appId1 = 'x1b2e3';
        const appId2 = 't2a3f7';
        let p1: IAppProject;
        let p2: IAppProject;
        let p3: IAppProject;
  
        before(async () => {
          user1Token = await http.createUserToken(apiUri);
          user2Token = await http.createUserToken(apiUri);
          sdk.token = user1Token;
        });
  
        after(async () => {
          await http.delete(`${apiUri}/test/reset/app/projects`);
          await http.delete(`${apiUri}/test/reset/users`);
          await http.delete(`${apiUri}/test/reset/sessions`);
        });

        beforeEach(async () => {
          p1 = mock.app.appProject({ foldersSize: 0, noRequests: true });
          await sdk.app.projects.create(p1, appId1);
          p2 = mock.app.appProject({ foldersSize: 0, noRequests: true });
          await sdk.app.projects.create(p1, appId1, { token: user2Token });
          p3 = mock.app.appProject({ foldersSize: 0, noRequests: true });
          await sdk.app.projects.create(p3, appId2);
        });

        it('deletes the requested record', async () => {
          await sdk.app.projects.delete(p1.key, appId1);
          await assert.isRejected(
            sdk.app.projects.read(p1.key, appId1), 
            `Not found.`
          );
        });

        it('returns the delete record', async () => {
          const result = await sdk.app.projects.delete(p1.key, appId1);
          assert.deepEqual(result, { key: p1.key });
        });
    
        it('throws when not found', async () => {
          await assert.isRejected(
            sdk.app.projects.delete('other', appId1), 
            `Not found.`
          );
        });

        it('throws when items not belonging to the user', async () => {
          await assert.isRejected(
            sdk.app.projects.delete(p2.key, appId1, { token: user2Token }), 
            `Not found.`
          );
        });

        it('throws when items not belonging to the app', async () => {
          await assert.isRejected(
            sdk.app.projects.delete(p3.key, appId1), 
            `Not found.`
          );
        });
      });

      describe('PATCH', () => {
        let user1Token: string;
        let user2Token: string;
        const appId1 = 'x1b2e3';
        const appId2 = 't2a3f7';
        let p1: IAppProject;
  
        before(async () => {
          user1Token = await http.createUserToken(apiUri);
          user2Token = await http.createUserToken(apiUri);
          sdk.token = user1Token;
        });
  
        after(async () => {
          await http.delete(`${apiUri}/test/reset/app/projects`);
          await http.delete(`${apiUri}/test/reset/users`);
          await http.delete(`${apiUri}/test/reset/sessions`);
        });

        beforeEach(async () => {
          p1 = mock.app.appProject({ foldersSize: 0, noRequests: true });
          await sdk.app.projects.create(p1, appId1);
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
          await sdk.app.projects.patch(p1.key, appId1, info);
          const result = await sdk.app.projects.read(p1.key, appId1) as IAppProject;
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
          const data = await sdk.app.projects.patch(p1.key, appId1, info);
          
          assert.typeOf(data, 'object', 'has the data object');
          assert.equal(data.app, appId1, 'has the data.app');
          assert.equal(data.appVersion, '1', 'has the data.appVersion');
          assert.equal(data.id, '123', 'has the data.id');
          assert.deepEqual(data.patch, patch, 'has the data.patch');
          assert.typeOf(data.revert, 'array', 'has the data.revert');
        });

        it('throws when the project not belonging to the user', async () => {
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

          await assert.isRejected(
            sdk.app.projects.patch(p1.key, appId1, info, { token: user2Token }), 
            `Not found.`
          );
        });

        it('throws when items not belonging to the app', async () => {
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

          await assert.isRejected(
            sdk.app.projects.patch(p1.key, appId2, info), 
            `Not found.`
          );
        });
      });
    });
    
    describe('/app/{appId}/projects/batch/create', () => {
      const appId = 'x1b2e3';
      let data: IAppProject[];
  
      before(async () => {
        sdk.token = await http.createUserToken(apiUri);
      });

      after(async () => {
        await http.delete(`${apiUri}/test/reset/app/projects`);
        await http.delete(`${apiUri}/test/reset/users`);
        await http.delete(`${apiUri}/test/reset/sessions`);
      });

      beforeEach(() => {
        data = mock.app.appProjects(2, { foldersSize: 0, noRequests: true });
      });

      it('returns the change record', async () => {
        const result = await sdk.app.projects.createBatch(data, appId);
        assert.typeOf(result, 'object', 'returns an object');
        assert.typeOf(result.items, 'array', 'the .items is an array');
        assert.lengthOf(result.items, 2, 'the .items has 2 results');
        const [r1, r2] = result.items;
        assert.typeOf(r1.key, 'string', 'has the #1 key');
        assert.deepEqual(r1, data[0], 'has the #1 item');
        assert.typeOf(r2.key, 'string', 'has the #2 key');
        assert.deepEqual(r2, data[1], 'has the #2 item');
      });

      it('handles empty arrays', async () => {
        const result = await sdk.app.projects.createBatch([], appId);
        assert.deepEqual(result.items, []);
      });
    });

    describe('/app/{appId}/projects/batch/read', () => {
      let user1Token: string;
      let user2Token: string;
      const appId1 = 'x1b2e3';
      const appId2 = 't2a3f7';
      let data1: IAppProject[];
      let data2: IAppProject[];
      let data3: IAppProject[];

      before(async () => {
        user1Token = await http.createUserToken(apiUri);
        user2Token = await http.createUserToken(apiUri);
        sdk.token = user1Token;

        data1 = mock.app.appProjects(5, { foldersSize: 0, noRequests: true });
        await sdk.app.projects.createBatch(data1, appId1);
        data2 = mock.app.appProjects(5, { foldersSize: 0, noRequests: true });
        await sdk.app.projects.createBatch(data2, appId1, { token: user2Token });
        data3 = mock.app.appProjects(5, { foldersSize: 0, noRequests: true });
        await sdk.app.projects.createBatch(data3, appId2);
      });

      after(async () => {
        await http.delete(`${apiUri}/test/reset/app/projects`);
        await http.delete(`${apiUri}/test/reset/users`);
        await http.delete(`${apiUri}/test/reset/sessions`);
      });

      it('reds the requested records', async () => {
        const result = await sdk.app.projects.readBatch([data1[0].key, data1[1].key], appId1);
        assert.typeOf(result, 'object', 'returns an object');
        assert.typeOf(result.items, 'array', 'the .items is an array');
        assert.lengthOf(result.items, 2, 'the .items has 2 results');
        const [p1, p2] = (result.items as IAppProject[]);
        assert.typeOf(p1.key, 'string', 'has the #1 key');
        assert.deepEqual(p1, data1[0], 'has the #1 item');
        assert.typeOf(p2.key, 'string', 'has the #2 key');
        assert.deepEqual(p2, data1[1], 'has the #2 item');
      });
  
      it('returns null when an item is not found', async () => {
        const result = await sdk.app.projects.readBatch([data1[0].key, 'other'], appId1);
        const [p1, p2] = (result.items as IAppProject[]);
        assert.deepEqual(p1, data1[0], 'has the #1 item');
        assert.isNull(p2);
      });
  
      it('handles empty arrays', async () => {
        const result = await sdk.app.projects.readBatch([], appId1);
        assert.deepEqual(result.items, []);
      });

      it('ignores deleted items', async () => {
        const p6 = mock.app.appProject({ foldersSize: 0, noRequests: true });
        await sdk.app.projects.create(p6, appId1);
        await sdk.app.projects.delete(p6.key, appId1);
        const result = await sdk.app.projects.readBatch([data1[0].key, p6.key], appId1);
        const [p1, p2] = (result.items as IAppProject[]);
        assert.deepEqual(p1, data1[0], 'has the #1 item');
        assert.isNull(p2);
      });

      it('ignores items not belonging to the user', async () => {
        const result = await sdk.app.projects.readBatch([data1[0].key, data2[0].key], appId1);
        const [p1, p2] = (result.items as IAppProject[]);
        assert.deepEqual(p1, data1[0], 'has the #1 item');
        assert.isNull(p2);
      });

      it('ignores items not belonging to another app', async () => {
        const result = await sdk.app.projects.readBatch([data1[0].key, data3[0].key], appId1);
        const [p1, p2] = (result.items as IAppProject[]);
        assert.deepEqual(p1, data1[0], 'has the #1 item');
        assert.isNull(p2);
      });
    });

    describe('/app/{appId}/projects/batch/delete', () => {
      let user1Token: string;
      let user2Token: string;
      const appId1 = 'x1b2e3';
      const appId2 = 't2a3f7';
      let data1: IAppProject[];
      let data2: IAppProject[];
      let data3: IAppProject[];

      before(async () => {
        user1Token = await http.createUserToken(apiUri);
        user2Token = await http.createUserToken(apiUri);
        sdk.token = user1Token;

        data1 = mock.app.appProjects(3, { foldersSize: 0, noRequests: true });
        await sdk.app.projects.createBatch(data1, appId1);
        data2 = mock.app.appProjects(1, { foldersSize: 0, noRequests: true });
        await sdk.app.projects.createBatch(data2, appId1, { token: user2Token });
        data3 = mock.app.appProjects(1, { foldersSize: 0, noRequests: true });
        await sdk.app.projects.createBatch(data3, appId2);
      });

      after(async () => {
        await http.delete(`${apiUri}/test/reset/app/projects`);
        await http.delete(`${apiUri}/test/reset/users`);
        await http.delete(`${apiUri}/test/reset/sessions`);
      });

      it('deletes the requested records', async () => {
        await sdk.app.projects.deleteBatch([data1[0].key, data1[1].key], appId1);
        const result = await sdk.app.projects.readBatch([data1[0].key, data1[1].key, data1[2].key], appId1);
        assert.lengthOf(result.items, 3, 'has 3 results');
        const [p1, p2, p3] = (result.items as IAppProject[]);
        assert.isNull(p1, 'deletes item #1');
        assert.isNull(p2, 'deletes item #2');
        assert.deepEqual(p3, data1[2], 'has item #3');
      });

      it('returns the delete record', async () => {
        const result = await sdk.app.projects.deleteBatch([data1[0].key, data1[1].key], appId1);
        assert.typeOf(result, 'object', 'returns an object');
        assert.typeOf(result.items, 'array', 'has the items');
        const [log1, log2] = result.items as IDeleteRecord[];
        assert.deepEqual(log1, { key: data1[0].key });
        assert.deepEqual(log2, { key: data1[1].key });
      });
  
      it('returns undefined when an item is not found', async () => {
        const result = await sdk.app.projects.deleteBatch([data1[0].key, 'other'], appId1);
        const [log1, log2] = result.items as IDeleteRecord[];
        assert.deepEqual(log1, { key: data1[0].key });
        assert.isNull(log2);
      });

      it('handles empty arrays', async () => {
        const result = await sdk.app.projects.deleteBatch([], appId1);
        assert.deepEqual(result.items, []);
      });

      it('ignores items not belonging to the user', async () => {
        const result = await sdk.app.projects.deleteBatch([data1[0].key, data2[0].key], appId1);
        const [log1, log2] = result.items as IDeleteRecord[];
        assert.deepEqual(log1, { key: data1[0].key });
        assert.isNull(log2);
      });

      it('ignores items not belonging to another app', async () => {
        const result = await sdk.app.projects.deleteBatch([data1[0].key, data3[0].key], appId1);
        const [log1, log2] = result.items as IDeleteRecord[];
        assert.deepEqual(log1, { key: data1[0].key });
        assert.isNull(log2);
      });
    });

    describe('/app/{appId}/projects/batch/undelete', () => {
      let user1Token: string;
      let user2Token: string;
      const appId1 = 'x1b2e3';
      const appId2 = 't2a3f7';
      let data1: IAppProject[];
      let data2: IAppProject[];
      let data3: IAppProject[];

      before(async () => {
        user1Token = await http.createUserToken(apiUri);
        user2Token = await http.createUserToken(apiUri);
        sdk.token = user1Token;
      });

      after(async () => {
        await http.delete(`${apiUri}/test/reset/app/projects`);
        await http.delete(`${apiUri}/test/reset/users`);
        await http.delete(`${apiUri}/test/reset/sessions`);
      });

      beforeEach(async () => {
        data1 = mock.app.appProjects(3, { foldersSize: 0, noRequests: true });
        await sdk.app.projects.createBatch(data1, appId1);
        data2 = mock.app.appProjects(1, { foldersSize: 0, noRequests: true });
        await sdk.app.projects.createBatch(data2, appId1, { token: user2Token });
        data3 = mock.app.appProjects(1, { foldersSize: 0, noRequests: true });
        await sdk.app.projects.createBatch(data3, appId2);

        await sdk.app.projects.deleteBatch(data1.map(i => i.key), appId1);
        await sdk.app.projects.deleteBatch(data2.map(i => i.key), appId1, { token: user2Token });
        await sdk.app.projects.deleteBatch(data3.map(i => i.key), appId2);
      });

      it('restores the requested records', async () => {
        await sdk.app.projects.undeleteBatch([data1[0].key, data1[1].key], appId1);
        const result = await sdk.app.projects.readBatch([data1[0].key, data1[1].key, data1[2].key], appId1);
        assert.lengthOf(result.items, 3, 'has 3 results');
        const [p1, p2, p3] = (result.items as IAppProject[]);
        assert.deepEqual(p1, data1[0], 'restores item #1');
        assert.deepEqual(p2, data1[1],'restores item #2');
        assert.isNull(p3, 'keeps item #3 deleted');
      });

      it('returns the revert record', async () => {
        const result = await sdk.app.projects.undeleteBatch([data1[0].key, data1[1].key], appId1);
        assert.typeOf(result, 'object', 'returns an object');
        assert.typeOf(result.items, 'array', 'has the items');
        const [log1, log2] = result.items as IRevertResult<IAppProject>[];
        assert.deepEqual(log1, { key: data1[0].key, kind: data1[0].kind, item: data1[0] });
        assert.deepEqual(log2, { key: data1[1].key, kind: data1[1].kind, item: data1[1] });
      });
  
      it('returns undefined when an item is not found', async () => {
        const result = await sdk.app.projects.undeleteBatch([data1[0].key, 'other'], appId1);
        const [log1, log2] = result.items as IRevertResult<IAppProject>[];
        assert.deepEqual(log1, { key: data1[0].key, kind: data1[0].kind, item: data1[0] });
        assert.isNull(log2);
      });

      it('returns undefined when an item is not deleted', async () => {
        const p4 = mock.app.appProject({ foldersSize: 0, noRequests: true });
        await sdk.app.projects.create(p4, appId1);
        const result = await sdk.app.projects.undeleteBatch([data1[0].key, p4.key], appId1);
        const [log1, log2] = result.items as IRevertResult<IAppProject>[];
        assert.deepEqual(log1, { key: data1[0].key, kind: data1[0].kind, item: data1[0] });
        assert.isNull(log2);
      });
  
      it('handles empty arrays', async () => {
        const result = await sdk.app.projects.undeleteBatch([], appId1);
        assert.deepEqual(result.items, []);
      });

      it('ignores items not belonging to the user', async () => {
        const result = await sdk.app.projects.undeleteBatch([data1[0].key, data2[0].key], appId1);
        const [log1, log2] = result.items as IRevertResult<IAppProject>[];
        assert.deepEqual(log1, { key: data1[0].key, kind: data1[0].kind, item: data1[0] });
        assert.isNull(log2);
      });

      it('ignores items not belonging to another app', async () => {
        const result = await sdk.app.projects.undeleteBatch([data1[0].key, data3[0].key], appId1);
        const [log1, log2] = result.items as IRevertResult<IAppProject>[];
        assert.deepEqual(log1, { key: data1[0].key, kind: data1[0].kind, item: data1[0] });
        assert.isNull(log2);
      });
    });

    describe('/app/{appId}/query/projects', () => {
      describe('GET', () => {
        let user1Token: string;
        let user2Token: string;
        const appId1 = 'x1b2e3';
        const appId2 = 't2a3f7';

        let data1: IAppProject[];
        let data2: IAppProject[];
        let data3: IAppProject[];
  
        before(async () => {
          user1Token = await http.createUserToken(apiUri);
          user2Token = await http.createUserToken(apiUri);
          const r1 = await http.post(`${apiUri}/test/generate/app/projects?size=3&app=${appId1}`, { token: user1Token });
          const r2 = await http.post(`${apiUri}/test/generate/app/projects?size=1&app=${appId1}`, { token: user2Token });
          const r3 = await http.post(`${apiUri}/test/generate/app/projects?size=1&app=${appId2}`, { token: user1Token });
  
          sdk.token = user1Token;

          data1 = JSON.parse(r1.body as string) as IAppProject[];
          data2 = JSON.parse(r2.body as string) as IAppProject[];
          data3 = JSON.parse(r3.body as string) as IAppProject[];
        });
  
        after(async () => {
          await http.delete(`${apiUri}/test/reset/app/projects`);
          await http.delete(`${apiUri}/test/reset/users`);
          await http.delete(`${apiUri}/test/reset/sessions`);
        });

        // 
        // Note, the detailed tests are performed in the unit tests.
        // These tests the API communication only.
        // 

        it('searches for a project', async () => {
          const p = data1[0];
          const result = await sdk.app.projects.query(appId1, { query: p.info.name });

          assert.typeOf(result, 'object', 'returns an object');
          assert.typeOf(result.items, 'array', 'has the items');
          assert.isAtLeast(result.items.length, 1, 'has the project');
          const qr = result.items.find(i => i.doc.key === p.key) as IQueryResult<IAppProject>;
          assert.include(qr.index, 'doc:info:name', 'has the index');
          assert.deepEqual(qr.doc, p, 'returns the document');
        });

        it('does not return other users data', async () => {
          const p = data2[0];
          const result = await sdk.app.projects.query(appId1, { query: p.info.name });
          const qr = result.items.find(i => i.doc.key === p.key);
          assert.isUndefined(qr);
        });

        it('does not return other app data', async () => {
          const p = data3[0];
          const result = await sdk.app.projects.query(appId1, { query: p.info.name });
          const qr = result.items.find(i => i.doc.key === p.key);
          assert.isUndefined(qr);
        });
      });
    });
  });

  describe('Single-user', () => {
    let sdk: StoreSdk;

    before(async () => {
      const cnf = await getConfig();
      apiUri = cnf.singleUserBaseUri;
      sdk = new StoreSdk(cnf.singleUserBaseUri);
      sdk.silent = true;
    });

    describe('/app/{appId}/projects', () => {
      describe('GET', () => {
        let user1Token: string;
        const appId1 = 'x1b2e3';
        const appId2 = 't2a3f7';
  
        before(async () => {
          user1Token = await http.createUserToken(apiUri);
          await http.post(`${apiUri}/test/generate/app/projects?size=40&noRequests=true&app=${appId1}`, { token: user1Token });
          await http.post(`${apiUri}/test/generate/app/projects?size=10&noRequests=true&app=${appId2}`, { token: user1Token });
  
          sdk.token = user1Token;
        });
  
        after(async () => {
          await http.delete(`${apiUri}/test/reset/app/projects`);
          await http.delete(`${apiUri}/test/reset/users`);
          await http.delete(`${apiUri}/test/reset/sessions`);
        });
  
        it('returns a query result for default parameters', async () => {
          const result = await sdk.app.projects.list(appId1);
          assert.typeOf(result, 'object', 'result is an object');
          assert.typeOf(result.cursor, 'string', 'has page token');
          assert.typeOf(result.items, 'array', 'has response items');
          assert.lengthOf(result.items, 35, 'has default limit of items');
        });
  
        it('respects the "limit" parameter', async () => {
          const result = await sdk.app.projects.list(appId1, {
            limit: 5,
          });
          assert.lengthOf(result.items, 5);
        });
  
        it('respects the "cursor" parameter', async () => {
          const result1 = await sdk.app.projects.list(appId1, {
            limit: 10,
          });
          const result2 = await sdk.app.projects.list(appId1, {
            cursor: result1.cursor,
          });
          assert.lengthOf(result2.items, 10);
          const all = await sdk.app.projects.list(appId1, {
            limit: 20,
          });
          assert.deepEqual(all.items, result1.items.concat(result2.items), 'has both pages');
        });
  
        it('only list application and user projects', async () => {
          const result = await sdk.app.projects.list(appId2);
          assert.lengthOf(result.items, 10);
        });
  
        it('does not return results for unknown app', async () => {
          const result = await sdk.app.projects.list('other');
          assert.lengthOf(result.items, 0);
        });
      });
  
      describe('POST', () => {
        const appId1 = 'x1b2e3';
  
        before(async () => {
          sdk.token = await http.createUserToken(apiUri);
        });
  
        after(async () => {
          await http.delete(`${apiUri}/test/reset/app/projects`);
          await http.delete(`${apiUri}/test/reset/users`);
          await http.delete(`${apiUri}/test/reset/sessions`);
        });
  
        it('returns the created record', async () => {
          const data = AppProject.fromName('test').toJSON();
          const result = await sdk.app.projects.create(data, appId1);
          assert.typeOf(result, 'object');
          assert.typeOf(result.key, 'string', 'has an key');
          assert.equal(result.kind, AppProjectKind, 'has the created object');
        });
  
        it('returns the location header', async () => {
          const data = AppProject.fromName('test').toJSON();
          const result = await http.post(`${apiUri}${RouteBuilder.appProjects(appId1)}`, {
            token: sdk.token,
            body: JSON.stringify(data),
            headers: {
              'content-type': 'application/json',
            },
          });
          const loc = result.headers.location as string;
          assert.typeOf(loc, 'string', 'has the header');
          assert.include(loc, RouteBuilder.appProjects(appId1), 'has the projects root');
        });
  
      });
    });

    describe('/app/{appId}/projects/{key}', () => {
      describe('GET', () => {
        let user1Token: string;
        let user2Token: string;
        const appId1 = 'x1b2e3';
        let id: string;
  
        before(async () => {
          user1Token = await http.createUserToken(apiUri);
          user2Token = await http.createUserToken(apiUri);
          sdk.token = user1Token;

          const data = AppProject.fromName('test').toJSON();
          await sdk.app.projects.create(data, appId1);
          id = data.key;
        });
  
        after(async () => {
          await http.delete(`${apiUri}/test/reset/app/projects`);
          await http.delete(`${apiUri}/test/reset/users`);
          await http.delete(`${apiUri}/test/reset/sessions`);
        });

        it('returns the document media', async () => {
          const result = await sdk.app.projects.read(id, appId1);
          assert.equal(result.kind, AppProjectKind, 'has the kind');
          assert.typeOf(result.created, 'number', 'has the created');
          assert.typeOf(result.info, 'object', 'has the info');
        });

        it('sdk throws an error when unknown user', async () => {
          await assert.isRejected(sdk.app.projects.read(id, appId1, { token: 'test' }), `The client is not authorized to access this resource.`);
        });

        it('sdk throws an error when unknown key', async () => {
          await assert.isRejected(sdk.app.projects.read('other', appId1), `Not found.`);
        });

        it('throws when reading record of another user', async () => {
          await assert.isRejected(sdk.app.projects.read('other', appId1, { token: user2Token }), `Not found.`);
        });
      });

      describe('DELETE', () => {
        let user1Token: string;
        const appId1 = 'x1b2e3';
        const appId2 = 't2a3f7';
        let p1: IAppProject;
        let p3: IAppProject;
  
        before(async () => {
          user1Token = await http.createUserToken(apiUri);
          sdk.token = user1Token;
        });
  
        after(async () => {
          await http.delete(`${apiUri}/test/reset/app/projects`);
          await http.delete(`${apiUri}/test/reset/users`);
          await http.delete(`${apiUri}/test/reset/sessions`);
        });

        beforeEach(async () => {
          p1 = mock.app.appProject({ foldersSize: 0, noRequests: true });
          await sdk.app.projects.create(p1, appId1);
          p3 = mock.app.appProject({ foldersSize: 0, noRequests: true });
          await sdk.app.projects.create(p3, appId2);
        });

        it('deletes the requested record', async () => {
          await sdk.app.projects.delete(p1.key, appId1);
          await assert.isRejected(
            sdk.app.projects.read(p1.key, appId1), 
            `Not found.`
          );
        });

        it('returns the delete record', async () => {
          const result = await sdk.app.projects.delete(p1.key, appId1);
          assert.deepEqual(result, { key: p1.key });
        });
    
        it('throws when not found', async () => {
          await assert.isRejected(
            sdk.app.projects.delete('other', appId1), 
            `Not found.`
          );
        });

        it('throws when items not belonging to the app', async () => {
          await assert.isRejected(
            sdk.app.projects.delete(p3.key, appId1), 
            `Not found.`
          );
        });
      });

      describe('PATCH', () => {
        let user1Token: string;
        const appId1 = 'x1b2e3';
        const appId2 = 't2a3f7';
        let p1: IAppProject;
  
        before(async () => {
          user1Token = await http.createUserToken(apiUri);
          sdk.token = user1Token;
        });
  
        after(async () => {
          await http.delete(`${apiUri}/test/reset/app/projects`);
          await http.delete(`${apiUri}/test/reset/users`);
          await http.delete(`${apiUri}/test/reset/sessions`);
        });

        beforeEach(async () => {
          p1 = mock.app.appProject({ foldersSize: 0, noRequests: true });
          await sdk.app.projects.create(p1, appId1);
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
          await sdk.app.projects.patch(p1.key, appId1, info);
          const result = await sdk.app.projects.read(p1.key, appId1) as IAppProject;
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
          const data = await sdk.app.projects.patch(p1.key, appId1, info);
          
          assert.typeOf(data, 'object', 'has the data object');
          assert.equal(data.app, appId1, 'has the data.app');
          assert.equal(data.appVersion, '1', 'has the data.appVersion');
          assert.equal(data.id, '123', 'has the data.id');
          assert.deepEqual(data.patch, patch, 'has the data.patch');
          assert.typeOf(data.revert, 'array', 'has the data.revert');
        });

        it('throws when items not belonging to the app', async () => {
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

          await assert.isRejected(
            sdk.app.projects.patch(p1.key, appId2, info), 
            `Not found.`
          );
        });
      });
    });

    describe('/app/{appId}/projects/batch/create', () => {
      const appId = 'x1b2e3';
      let data: IAppProject[];
  
      before(async () => {
        sdk.token = await http.createUserToken(apiUri);
      });

      after(async () => {
        await http.delete(`${apiUri}/test/reset/app/projects`);
        await http.delete(`${apiUri}/test/reset/users`);
        await http.delete(`${apiUri}/test/reset/sessions`);
      });

      beforeEach(() => {
        data = mock.app.appProjects(2, { foldersSize: 0, noRequests: true });
      });

      it('returns the change record', async () => {
        const result = await sdk.app.projects.createBatch(data, appId);
        assert.typeOf(result, 'object', 'returns an object');
        assert.typeOf(result.items, 'array', 'the .items is an array');
        assert.lengthOf(result.items, 2, 'the .items has 2 results');
        const [r1, r2] = result.items;
        assert.typeOf(r1.key, 'string', 'has the #1 key');
        assert.deepEqual(r1, data[0], 'has the #1 item');
        assert.typeOf(r2.key, 'string', 'has the #2 key');
        assert.deepEqual(r2, data[1], 'has the #2 item');
      });

      it('handles empty arrays', async () => {
        const result = await sdk.app.projects.createBatch([], appId);
        assert.deepEqual(result.items, []);
      });
    });

    describe('/app/{appId}/projects/batch/read', () => {
      let user1Token: string;
      const appId1 = 'x1b2e3';
      const appId2 = 't2a3f7';
      let data1: IAppProject[];
      let data3: IAppProject[];

      before(async () => {
        user1Token = await http.createUserToken(apiUri);
        sdk.token = user1Token;

        data1 = mock.app.appProjects(5, { foldersSize: 0, noRequests: true });
        await sdk.app.projects.createBatch(data1, appId1);
        data3 = mock.app.appProjects(5, { foldersSize: 0, noRequests: true });
        await sdk.app.projects.createBatch(data3, appId2);
      });

      after(async () => {
        await http.delete(`${apiUri}/test/reset/app/projects`);
        await http.delete(`${apiUri}/test/reset/users`);
        await http.delete(`${apiUri}/test/reset/sessions`);
      });

      it('reds the requested records', async () => {
        const result = await sdk.app.projects.readBatch([data1[0].key, data1[1].key], appId1);
        assert.typeOf(result, 'object', 'returns an object');
        assert.typeOf(result.items, 'array', 'the .items is an array');
        assert.lengthOf(result.items, 2, 'the .items has 2 results');
        const [p1, p2] = (result.items as IAppProject[]);
        assert.typeOf(p1.key, 'string', 'has the #1 key');
        assert.deepEqual(p1, data1[0], 'has the #1 item');
        assert.typeOf(p2.key, 'string', 'has the #2 key');
        assert.deepEqual(p2, data1[1], 'has the #2 item');
      });
  
      it('returns null when an item is not found', async () => {
        const result = await sdk.app.projects.readBatch([data1[0].key, 'other'], appId1);
        const [p1, p2] = (result.items as IAppProject[]);
        assert.deepEqual(p1, data1[0], 'has the #1 item');
        assert.isNull(p2);
      });
  
      it('handles empty arrays', async () => {
        const result = await sdk.app.projects.readBatch([], appId1);
        assert.deepEqual(result.items, []);
      });

      it('ignores deleted items', async () => {
        const p6 = mock.app.appProject({ foldersSize: 0, noRequests: true });
        await sdk.app.projects.create(p6, appId1);
        await sdk.app.projects.delete(p6.key, appId1);
        const result = await sdk.app.projects.readBatch([data1[0].key, p6.key], appId1);
        const [p1, p2] = (result.items as IAppProject[]);
        assert.deepEqual(p1, data1[0], 'has the #1 item');
        assert.isNull(p2);
      });

      it('ignores items not belonging to another app', async () => {
        const result = await sdk.app.projects.readBatch([data1[0].key, data3[0].key], appId1);
        const [p1, p2] = (result.items as IAppProject[]);
        assert.deepEqual(p1, data1[0], 'has the #1 item');
        assert.isNull(p2);
      });
    });

    describe('/app/{appId}/projects/batch/delete', () => {
      let user1Token: string;
      const appId1 = 'x1b2e3';
      const appId2 = 't2a3f7';
      let data1: IAppProject[];
      let data3: IAppProject[];

      before(async () => {
        user1Token = await http.createUserToken(apiUri);
        sdk.token = user1Token;

        data1 = mock.app.appProjects(3, { foldersSize: 0, noRequests: true });
        await sdk.app.projects.createBatch(data1, appId1);
        data3 = mock.app.appProjects(1, { foldersSize: 0, noRequests: true });
        await sdk.app.projects.createBatch(data3, appId2);
      });

      after(async () => {
        await http.delete(`${apiUri}/test/reset/app/projects`);
        await http.delete(`${apiUri}/test/reset/users`);
        await http.delete(`${apiUri}/test/reset/sessions`);
      });

      it('deletes the requested records', async () => {
        await sdk.app.projects.deleteBatch([data1[0].key, data1[1].key], appId1);
        const result = await sdk.app.projects.readBatch([data1[0].key, data1[1].key, data1[2].key], appId1);
        assert.lengthOf(result.items, 3, 'has 3 results');
        const [p1, p2, p3] = (result.items as IAppProject[]);
        assert.isNull(p1, 'deletes item #1');
        assert.isNull(p2, 'deletes item #2');
        assert.deepEqual(p3, data1[2], 'has item #3');
      });

      it('returns the delete record', async () => {
        const result = await sdk.app.projects.deleteBatch([data1[0].key, data1[1].key], appId1);
        assert.typeOf(result, 'object', 'returns an object');
        assert.typeOf(result.items, 'array', 'has the items');
        const [log1, log2] = result.items as IDeleteRecord[];
        assert.deepEqual(log1, { key: data1[0].key });
        assert.deepEqual(log2, { key: data1[1].key });
      });
  
      it('returns undefined when an item is not found', async () => {
        const result = await sdk.app.projects.deleteBatch([data1[0].key, 'other'], appId1);
        const [log1, log2] = result.items as IDeleteRecord[];
        assert.deepEqual(log1, { key: data1[0].key });
        assert.isNull(log2);
      });

      it('handles empty arrays', async () => {
        const result = await sdk.app.projects.deleteBatch([], appId1);
        assert.deepEqual(result.items, []);
      });

      it('ignores items not belonging to another app', async () => {
        const result = await sdk.app.projects.deleteBatch([data1[0].key, data3[0].key], appId1);
        const [log1, log2] = result.items as IDeleteRecord[];
        assert.deepEqual(log1, { key: data1[0].key });
        assert.isNull(log2);
      });
    });

    describe('/app/{appId}/projects/batch/undelete', () => {
      let user1Token: string;
      const appId1 = 'x1b2e3';
      const appId2 = 't2a3f7';
      let data1: IAppProject[];
      let data3: IAppProject[];

      before(async () => {
        user1Token = await http.createUserToken(apiUri);
        sdk.token = user1Token;
      });

      after(async () => {
        await http.delete(`${apiUri}/test/reset/app/projects`);
        await http.delete(`${apiUri}/test/reset/users`);
        await http.delete(`${apiUri}/test/reset/sessions`);
      });

      beforeEach(async () => {
        data1 = mock.app.appProjects(3, { foldersSize: 0, noRequests: true });
        await sdk.app.projects.createBatch(data1, appId1);
        data3 = mock.app.appProjects(1, { foldersSize: 0, noRequests: true });
        await sdk.app.projects.createBatch(data3, appId2);

        await sdk.app.projects.deleteBatch(data1.map(i => i.key), appId1);
        await sdk.app.projects.deleteBatch(data3.map(i => i.key), appId2);
      });

      it('restores the requested records', async () => {
        await sdk.app.projects.undeleteBatch([data1[0].key, data1[1].key], appId1);
        const result = await sdk.app.projects.readBatch([data1[0].key, data1[1].key, data1[2].key], appId1);
        assert.lengthOf(result.items, 3, 'has 3 results');
        const [p1, p2, p3] = (result.items as IAppProject[]);
        assert.deepEqual(p1, data1[0], 'restores item #1');
        assert.deepEqual(p2, data1[1],'restores item #2');
        assert.isNull(p3, 'keeps item #3 deleted');
      });

      it('returns the revert record', async () => {
        const result = await sdk.app.projects.undeleteBatch([data1[0].key, data1[1].key], appId1);
        assert.typeOf(result, 'object', 'returns an object');
        assert.typeOf(result.items, 'array', 'has the items');
        const [log1, log2] = result.items as IRevertResult<IAppProject>[];
        assert.deepEqual(log1, { key: data1[0].key, kind: data1[0].kind, item: data1[0] });
        assert.deepEqual(log2, { key: data1[1].key, kind: data1[1].kind, item: data1[1] });
      });
  
      it('returns undefined when an item is not found', async () => {
        const result = await sdk.app.projects.undeleteBatch([data1[0].key, 'other'], appId1);
        const [log1, log2] = result.items as IRevertResult<IAppProject>[];
        assert.deepEqual(log1, { key: data1[0].key, kind: data1[0].kind, item: data1[0] });
        assert.isNull(log2);
      });

      it('returns undefined when an item is not deleted', async () => {
        const p4 = mock.app.appProject({ foldersSize: 0, noRequests: true });
        await sdk.app.projects.create(p4, appId1);
        const result = await sdk.app.projects.undeleteBatch([data1[0].key, p4.key], appId1);
        const [log1, log2] = result.items as IRevertResult<IAppProject>[];
        assert.deepEqual(log1, { key: data1[0].key, kind: data1[0].kind, item: data1[0] });
        assert.isNull(log2);
      });
  
      it('handles empty arrays', async () => {
        const result = await sdk.app.projects.undeleteBatch([], appId1);
        assert.deepEqual(result.items, []);
      });

      it('ignores items not belonging to another app', async () => {
        const result = await sdk.app.projects.undeleteBatch([data1[0].key, data3[0].key], appId1);
        const [log1, log2] = result.items as IRevertResult<IAppProject>[];
        assert.deepEqual(log1, { key: data1[0].key, kind: data1[0].kind, item: data1[0] });
        assert.isNull(log2);
      });
    });

    describe('/app/{appId}/query/projects', () => {
      describe('GET', () => {
        const appId1 = 'x1b2e3';
        const appId2 = 't2a3f7';

        let data1: IAppProject[];
        let data3: IAppProject[];
  
        before(async () => {
          sdk.token = await http.createUserToken(apiUri);
          const r1 = await http.post(`${apiUri}/test/generate/app/projects?size=3&app=${appId1}`, { token: sdk.token });
          const r3 = await http.post(`${apiUri}/test/generate/app/projects?size=1&app=${appId2}`, { token: sdk.token });

          data1 = JSON.parse(r1.body as string) as IAppProject[];
          data3 = JSON.parse(r3.body as string) as IAppProject[];
        });
  
        after(async () => {
          await http.delete(`${apiUri}/test/reset/app/projects`);
          await http.delete(`${apiUri}/test/reset/users`);
          await http.delete(`${apiUri}/test/reset/sessions`);
        });

        // 
        // Note, the detailed tests are performed in the unit tests.
        // These tests the API communication only.
        // 

        it('searches for a project', async () => {
          const p = data1[0];
          const result = await sdk.app.projects.query(appId1, { query: p.info.name });

          assert.typeOf(result, 'object', 'returns an object');
          assert.typeOf(result.items, 'array', 'has the items');
          assert.isAtLeast(result.items.length, 1, 'has the project');
          const qr = result.items.find(i => i.doc.key === p.key) as IQueryResult<IAppProject>;
          assert.include(qr.index, 'doc:info:name', 'has the index');
          assert.deepEqual(qr.doc, p, 'returns the document');
        });

        it('does not return other app data', async () => {
          const p = data3[0];
          const result = await sdk.app.projects.query(appId1, { query: p.info.name });
          const qr = result.items.find(i => i.doc.key === p.key);
          assert.isUndefined(qr);
        });
      });
    });
  });
});
