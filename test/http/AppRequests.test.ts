/* eslint-disable import/no-named-as-default-member */
import chai, { assert } from 'chai';
import { 
  RouteBuilder, StoreSdk, AppRequest, AppRequestKind, IAppRequest, ProjectMock, IPatchInfo, IDeleteRecord, IRevertResult,
} from '@api-client/core';
import { JsonPatch } from '@api-client/json';
import chaiAsPromised from 'chai-as-promised';
import getConfig from '../helpers/getSetup.js';
import HttpHelper from '../helpers/HttpHelper.js';

chai.use(chaiAsPromised);

describe('http', () => {
  let baseUri: string;
  const http = new HttpHelper();
  const mock = new ProjectMock();

  describe('Multi-user', () => {
    let sdk: StoreSdk;

    before(async () => {
      const cnf = await getConfig();
      baseUri = cnf.multiUserBaseUri;
      sdk = new StoreSdk(cnf.multiUserBaseUri);
      sdk.silent = true;
    });

    describe('/app/{appId}/requests', () => {
      describe('GET', () => {
        let user1Token: string;
        let user2Token: string;
        const appId1 = 'x1b2e3';
        const appId2 = 't2a3f7';
  
        before(async () => {
          user1Token = await http.createUserToken(baseUri);
          user2Token = await http.createUserToken(baseUri);
          await http.post(`${baseUri}/test/generate/app/requests?size=40&isoKey=true&app=${appId1}`, { token: user1Token });
          await http.post(`${baseUri}/test/generate/app/requests?size=10&isoKey=true&app=${appId1}`, { token: user2Token });
          await http.post(`${baseUri}/test/generate/app/requests?size=10&isoKey=true&app=${appId2}`, { token: user1Token });
  
          sdk.token = user1Token;
        });
  
        after(async () => {
          await http.delete(`${baseUri}/test/reset/app/requests`);
          await http.delete(`${baseUri}/test/reset/users`);
          await http.delete(`${baseUri}/test/reset/sessions`);
        });
  
        it('returns a query result for default parameters', async () => {
          const result = await sdk.app.requests.list(appId1);
          assert.typeOf(result, 'object', 'result is an object');
          assert.typeOf(result.cursor, 'string', 'has page token');
          assert.typeOf(result.items, 'array', 'has response items');
          assert.lengthOf(result.items, 35, 'has default limit of items');
        });
  
        it('respects the "limit" parameter', async () => {
          const result = await sdk.app.requests.list(appId1, {
            limit: 5,
          });
          assert.lengthOf(result.items, 5);
        });
  
        it('respects the "cursor" parameter', async () => {
          const result1 = await sdk.app.requests.list(appId1, {
            limit: 10,
          });
          const result2 = await sdk.app.requests.list(appId1, {
            cursor: result1.cursor,
          });
          assert.lengthOf(result2.items, 10);
          const all = await sdk.app.requests.list(appId1, {
            limit: 20,
          });
          assert.deepEqual(all.items, result1.items.concat(result2.items), 'has both pages');
        });
  
        it('only list user requests', async () => {
          const result = await sdk.app.requests.list(appId1, undefined, { token: user2Token });
          assert.lengthOf(result.items, 10);
        });
  
        it('only list application and user requests', async () => {
          const result = await sdk.app.requests.list(appId2);
          assert.lengthOf(result.items, 10);
        });
  
        it('does not return results for unknown app', async () => {
          const result = await sdk.app.requests.list('other');
          assert.lengthOf(result.items, 0);
        });
  
        it('sdk throws an error when unknown user', async () => {
          await assert.isRejected(sdk.app.requests.list(appId2, undefined, { token: 'test' }), `Not authorized.`);
        });
      });
  
      describe('POST', () => {
        const appId1 = 'x1b2e3';
  
        before(async () => {
          sdk.token = await http.createUserToken(baseUri);
        });
  
        after(async () => {
          await http.delete(`${baseUri}/test/reset/app/requests`);
          await http.delete(`${baseUri}/test/reset/users`);
          await http.delete(`${baseUri}/test/reset/sessions`);
        });
  
        it('returns the created record', async () => {
          const data = AppRequest.fromName('test', appId1).toJSON();
          const result = await sdk.app.requests.create(data, appId1);
          assert.typeOf(result, 'object');
          assert.typeOf(result.key, 'string', 'has an key');
          assert.equal(result.kind, AppRequestKind, 'has the created object');
        });
  
        it('returns the location header', async () => {
          const data = AppRequest.fromName('test', appId1).toJSON();
          const result = await http.post(`${baseUri}${RouteBuilder.appRequests(appId1)}`, {
            token: sdk.token,
            body: JSON.stringify(data),
            headers: {
              'content-type': 'application/json',
            },
          });
          const loc = result.headers.location as string;
          assert.typeOf(loc, 'string', 'has the header');
          assert.include(loc, RouteBuilder.appRequests(appId1), 'has the requests root');
        });
  
      });
    });

    describe('/app/{appId}/requests/{key}', () => {
      describe('GET', () => {
        let user1Token: string;
        let user2Token: string;
        const appId1 = 'x1b2e3';
        let id: string;
  
        before(async () => {
          user1Token = await http.createUserToken(baseUri);
          user2Token = await http.createUserToken(baseUri);
          sdk.token = user1Token;

          const data = AppRequest.fromName('test', appId1).toJSON();
          await sdk.app.requests.create(data, appId1);
          id = data.key;
        });
  
        after(async () => {
          await http.delete(`${baseUri}/test/reset/app/requests`);
          await http.delete(`${baseUri}/test/reset/users`);
          await http.delete(`${baseUri}/test/reset/sessions`);
        });

        it('returns the document media', async () => {
          const result = await sdk.app.requests.read(id, appId1);
          assert.equal(result.kind, AppRequestKind, 'has the kind');
          assert.typeOf(result.created, 'number', 'has the created');
          assert.typeOf(result.info, 'object', 'has the info');
        });

        it('sdk throws an error when unknown user', async () => {
          await assert.isRejected(sdk.app.requests.read(id, appId1, { token: 'test' }), `The client is not authorized to access this resource.`);
        });

        it('sdk throws an error when unknown key', async () => {
          await assert.isRejected(sdk.app.requests.read('other', appId1), `Not found.`);
        });

        it('throws when reading record of another user', async () => {
          await assert.isRejected(sdk.app.requests.read('other', appId1, { token: user2Token }), `Not found.`);
        });
      });

      describe('DELETE', () => {
        let user1Token: string;
        let user2Token: string;
        const appId1 = 'x1b2e3';
        const appId2 = 't2a3f7';
        let p1: IAppRequest;
        let p2: IAppRequest;
        let p3: IAppRequest;
  
        before(async () => {
          user1Token = await http.createUserToken(baseUri);
          user2Token = await http.createUserToken(baseUri);
          sdk.token = user1Token;
        });
  
        after(async () => {
          await http.delete(`${baseUri}/test/reset/app/requests`);
          await http.delete(`${baseUri}/test/reset/users`);
          await http.delete(`${baseUri}/test/reset/sessions`);
        });

        beforeEach(async () => {
          p1 = mock.app.appRequest({ app: appId1, isoKey: true });
          await sdk.app.requests.create(p1, appId1);
          p2 = mock.app.appRequest({ app: appId1, isoKey: true });
          await sdk.app.requests.create(p1, appId1, { token: user2Token });
          p3 = mock.app.appRequest({ app: appId1, isoKey: true });
          await sdk.app.requests.create(p3, appId2);
        });

        it('deletes the requested record', async () => {
          await sdk.app.requests.delete(p1.key, appId1);
          await assert.isRejected(
            sdk.app.requests.read(p1.key, appId1), 
            `Not found.`
          );
        });

        it('returns the delete record', async () => {
          const result = await sdk.app.requests.delete(p1.key, appId1);
          assert.deepEqual(result, { key: p1.key });
        });
    
        it('throws when not found', async () => {
          await assert.isRejected(
            sdk.app.requests.delete('other', appId1), 
            `Not found.`
          );
        });

        it('throws when items not belonging to the user', async () => {
          await assert.isRejected(
            sdk.app.requests.delete(p2.key, appId1, { token: user2Token }), 
            `Not found.`
          );
        });

        it('throws when items not belonging to the app', async () => {
          await assert.isRejected(
            sdk.app.requests.delete(p3.key, appId1), 
            `Not found.`
          );
        });
      });

      describe('PATCH', () => {
        let user1Token: string;
        let user2Token: string;
        const appId1 = 'x1b2e3';
        const appId2 = 't2a3f7';
        let p1: IAppRequest;
  
        before(async () => {
          user1Token = await http.createUserToken(baseUri);
          user2Token = await http.createUserToken(baseUri);
          sdk.token = user1Token;
        });
  
        after(async () => {
          await http.delete(`${baseUri}/test/reset/app/requests`);
          await http.delete(`${baseUri}/test/reset/users`);
          await http.delete(`${baseUri}/test/reset/sessions`);
        });

        beforeEach(async () => {
          p1 = mock.app.appRequest({ app: appId1, isoKey: true });
          await sdk.app.requests.create(p1, appId1);
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
          await sdk.app.requests.patch(p1.key, appId1, info);
          const result = await sdk.app.requests.read(p1.key, appId1) as IAppRequest;
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
          const data = await sdk.app.requests.patch(p1.key, appId1, info);
          
          assert.typeOf(data, 'object', 'has the data object');
          assert.equal(data.app, appId1, 'has the data.app');
          assert.equal(data.appVersion, '1', 'has the data.appVersion');
          assert.equal(data.id, '123', 'has the data.id');
          assert.deepEqual(data.patch, patch, 'has the data.patch');
          assert.typeOf(data.revert, 'array', 'has the data.revert');
        });

        it('throws when the request not belonging to the user', async () => {
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
            sdk.app.requests.patch(p1.key, appId1, info, { token: user2Token }), 
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
            sdk.app.requests.patch(p1.key, appId2, info), 
            `Not found.`
          );
        });
      });
    });
    
    describe('/app/{appId}/requests/batch/create', () => {
      const appId = 'x1b2e3';
      let data: IAppRequest[];
  
      before(async () => {
        sdk.token = await http.createUserToken(baseUri);
      });

      after(async () => {
        await http.delete(`${baseUri}/test/reset/app/requests`);
        await http.delete(`${baseUri}/test/reset/users`);
        await http.delete(`${baseUri}/test/reset/sessions`);
      });

      beforeEach(() => {
        data = mock.app.appRequests(2, { app: appId, isoKey: true });
      });

      it('returns the change record', async () => {
        const result = await sdk.app.requests.createBatch(data, appId);
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
        const result = await sdk.app.requests.createBatch([], appId);
        assert.deepEqual(result.items, []);
      });
    });

    describe('/app/{appId}/requests/batch/read', () => {
      let user1Token: string;
      let user2Token: string;
      const appId1 = 'x1b2e3';
      const appId2 = 't2a3f7';
      let data1: IAppRequest[];
      let data2: IAppRequest[];
      let data3: IAppRequest[];

      before(async () => {
        user1Token = await http.createUserToken(baseUri);
        user2Token = await http.createUserToken(baseUri);
        sdk.token = user1Token;

        data1 = mock.app.appRequests(5, { app: appId1, isoKey: true });
        await sdk.app.requests.createBatch(data1, appId1);
        data2 = mock.app.appRequests(5, { app: appId1, isoKey: true });
        await sdk.app.requests.createBatch(data2, appId1, { token: user2Token });
        data3 = mock.app.appRequests(5, { app: appId2, isoKey: true });
        await sdk.app.requests.createBatch(data3, appId2);
      });

      after(async () => {
        await http.delete(`${baseUri}/test/reset/app/requests`);
        await http.delete(`${baseUri}/test/reset/users`);
        await http.delete(`${baseUri}/test/reset/sessions`);
      });

      it('reds the requested records', async () => {
        const result = await sdk.app.requests.readBatch([data1[0].key, data1[1].key], appId1);
        assert.typeOf(result, 'object', 'returns an object');
        assert.typeOf(result.items, 'array', 'the .items is an array');
        assert.lengthOf(result.items, 2, 'the .items has 2 results');
        const [p1, p2] = (result.items as IAppRequest[]);
        assert.typeOf(p1.key, 'string', 'has the #1 key');
        assert.deepEqual(p1, data1[0], 'has the #1 item');
        assert.typeOf(p2.key, 'string', 'has the #2 key');
        assert.deepEqual(p2, data1[1], 'has the #2 item');
      });
  
      it('returns null when an item is not found', async () => {
        const result = await sdk.app.requests.readBatch([data1[0].key, 'other'], appId1);
        const [p1, p2] = (result.items as IAppRequest[]);
        assert.deepEqual(p1, data1[0], 'has the #1 item');
        assert.isNull(p2);
      });
  
      it('handles empty arrays', async () => {
        const result = await sdk.app.requests.readBatch([], appId1);
        assert.deepEqual(result.items, []);
      });

      it('ignores deleted items', async () => {
        const p6 = mock.app.appRequest({ app: appId1, isoKey: true });
        await sdk.app.requests.create(p6, appId1);
        await sdk.app.requests.delete(p6.key, appId1);
        const result = await sdk.app.requests.readBatch([data1[0].key, p6.key], appId1);
        const [p1, p2] = (result.items as IAppRequest[]);
        assert.deepEqual(p1, data1[0], 'has the #1 item');
        assert.isNull(p2);
      });

      it('ignores items not belonging to the user', async () => {
        const result = await sdk.app.requests.readBatch([data1[0].key, data2[0].key], appId1);
        const [p1, p2] = (result.items as IAppRequest[]);
        assert.deepEqual(p1, data1[0], 'has the #1 item');
        assert.isNull(p2);
      });

      it('ignores items not belonging to another app', async () => {
        const result = await sdk.app.requests.readBatch([data1[0].key, data3[0].key], appId1);
        const [p1, p2] = (result.items as IAppRequest[]);
        assert.deepEqual(p1, data1[0], 'has the #1 item');
        assert.isNull(p2);
      });
    });

    describe('/app/{appId}/requests/batch/delete', () => {
      let user1Token: string;
      let user2Token: string;
      const appId1 = 'x1b2e3';
      const appId2 = 't2a3f7';
      let data1: IAppRequest[];
      let data2: IAppRequest[];
      let data3: IAppRequest[];

      before(async () => {
        user1Token = await http.createUserToken(baseUri);
        user2Token = await http.createUserToken(baseUri);
        sdk.token = user1Token;

        data1 = mock.app.appRequests(3, { app: appId1, isoKey: true });
        await sdk.app.requests.createBatch(data1, appId1);
        data2 = mock.app.appRequests(1, { app: appId1, isoKey: true });
        await sdk.app.requests.createBatch(data2, appId1, { token: user2Token });
        data3 = mock.app.appRequests(1, { app: appId2, isoKey: true });
        await sdk.app.requests.createBatch(data3, appId2);
      });

      after(async () => {
        await http.delete(`${baseUri}/test/reset/app/requests`);
        await http.delete(`${baseUri}/test/reset/users`);
        await http.delete(`${baseUri}/test/reset/sessions`);
      });

      it('deletes the requested records', async () => {
        await sdk.app.requests.deleteBatch([data1[0].key, data1[1].key], appId1);
        const result = await sdk.app.requests.readBatch([data1[0].key, data1[1].key, data1[2].key], appId1);
        assert.lengthOf(result.items, 3, 'has 3 results');
        const [p1, p2, p3] = (result.items as IAppRequest[]);
        assert.isNull(p1, 'deletes item #1');
        assert.isNull(p2, 'deletes item #2');
        assert.deepEqual(p3, data1[2], 'has item #3');
      });

      it('returns the delete record', async () => {
        const result = await sdk.app.requests.deleteBatch([data1[0].key, data1[1].key], appId1);
        assert.typeOf(result, 'object', 'returns an object');
        assert.typeOf(result.items, 'array', 'has the items');
        const [log1, log2] = result.items as IDeleteRecord[];
        assert.deepEqual(log1, { key: data1[0].key });
        assert.deepEqual(log2, { key: data1[1].key });
      });
  
      it('returns undefined when an item is not found', async () => {
        const result = await sdk.app.requests.deleteBatch([data1[0].key, 'other'], appId1);
        const [log1, log2] = result.items as IDeleteRecord[];
        assert.deepEqual(log1, { key: data1[0].key });
        assert.isNull(log2);
      });

      it('handles empty arrays', async () => {
        const result = await sdk.app.requests.deleteBatch([], appId1);
        assert.deepEqual(result.items, []);
      });

      it('ignores items not belonging to the user', async () => {
        const result = await sdk.app.requests.deleteBatch([data1[0].key, data2[0].key], appId1);
        const [log1, log2] = result.items as IDeleteRecord[];
        assert.deepEqual(log1, { key: data1[0].key });
        assert.isNull(log2);
      });

      it('ignores items not belonging to another app', async () => {
        const result = await sdk.app.requests.deleteBatch([data1[0].key, data3[0].key], appId1);
        const [log1, log2] = result.items as IDeleteRecord[];
        assert.deepEqual(log1, { key: data1[0].key });
        assert.isNull(log2);
      });
    });

    describe('/app/{appId}/requests/batch/undelete', () => {
      let user1Token: string;
      let user2Token: string;
      const appId1 = 'x1b2e3';
      const appId2 = 't2a3f7';
      let data1: IAppRequest[];
      let data2: IAppRequest[];
      let data3: IAppRequest[];

      before(async () => {
        user1Token = await http.createUserToken(baseUri);
        user2Token = await http.createUserToken(baseUri);
        sdk.token = user1Token;
      });

      after(async () => {
        await http.delete(`${baseUri}/test/reset/app/requests`);
        await http.delete(`${baseUri}/test/reset/users`);
        await http.delete(`${baseUri}/test/reset/sessions`);
      });

      beforeEach(async () => {
        data1 = mock.app.appRequests(3, { app: appId1, isoKey: true });
        await sdk.app.requests.createBatch(data1, appId1);
        data2 = mock.app.appRequests(1, { app: appId1, isoKey: true });
        await sdk.app.requests.createBatch(data2, appId1, { token: user2Token });
        data3 = mock.app.appRequests(1, { app: appId2, isoKey: true });
        await sdk.app.requests.createBatch(data3, appId2);

        await sdk.app.requests.deleteBatch(data1.map(i => i.key), appId1);
        await sdk.app.requests.deleteBatch(data2.map(i => i.key), appId1, { token: user2Token });
        await sdk.app.requests.deleteBatch(data3.map(i => i.key), appId2);
      });

      it('restores the requested records', async () => {
        await sdk.app.requests.undeleteBatch([data1[0].key, data1[1].key], appId1);
        const result = await sdk.app.requests.readBatch([data1[0].key, data1[1].key, data1[2].key], appId1);
        assert.lengthOf(result.items, 3, 'has 3 results');
        const [p1, p2, p3] = (result.items as IAppRequest[]);
        assert.deepEqual(p1, data1[0], 'restores item #1');
        assert.deepEqual(p2, data1[1],'restores item #2');
        assert.isNull(p3, 'keeps item #3 deleted');
      });

      it('returns the revert record', async () => {
        const result = await sdk.app.requests.undeleteBatch([data1[0].key, data1[1].key], appId1);
        assert.typeOf(result, 'object', 'returns an object');
        assert.typeOf(result.items, 'array', 'has the items');
        const [log1, log2] = result.items as IRevertResult<IAppRequest>[];
        assert.deepEqual(log1, { key: data1[0].key, kind: data1[0].kind, item: data1[0] });
        assert.deepEqual(log2, { key: data1[1].key, kind: data1[1].kind, item: data1[1] });
      });
  
      it('returns undefined when an item is not found', async () => {
        const result = await sdk.app.requests.undeleteBatch([data1[0].key, 'other'], appId1);
        const [log1, log2] = result.items as IRevertResult<IAppRequest>[];
        assert.deepEqual(log1, { key: data1[0].key, kind: data1[0].kind, item: data1[0] });
        assert.isNull(log2);
      });

      it('returns undefined when an item is not deleted', async () => {
        const p4 = mock.app.appRequest({ app: appId1, isoKey: true });
        await sdk.app.requests.create(p4, appId1);
        const result = await sdk.app.requests.undeleteBatch([data1[0].key, p4.key], appId1);
        const [log1, log2] = result.items as IRevertResult<IAppRequest>[];
        assert.deepEqual(log1, { key: data1[0].key, kind: data1[0].kind, item: data1[0] });
        assert.isNull(log2);
      });
  
      it('handles empty arrays', async () => {
        const result = await sdk.app.requests.undeleteBatch([], appId1);
        assert.deepEqual(result.items, []);
      });

      it('ignores items not belonging to the user', async () => {
        const result = await sdk.app.requests.undeleteBatch([data1[0].key, data2[0].key], appId1);
        const [log1, log2] = result.items as IRevertResult<IAppRequest>[];
        assert.deepEqual(log1, { key: data1[0].key, kind: data1[0].kind, item: data1[0] });
        assert.isNull(log2);
      });

      it('ignores items not belonging to another app', async () => {
        const result = await sdk.app.requests.undeleteBatch([data1[0].key, data3[0].key], appId1);
        const [log1, log2] = result.items as IRevertResult<IAppRequest>[];
        assert.deepEqual(log1, { key: data1[0].key, kind: data1[0].kind, item: data1[0] });
        assert.isNull(log2);
      });
    });
  });

  describe('Single-user', () => {
    let sdk: StoreSdk;

    before(async () => {
      const cnf = await getConfig();
      baseUri = cnf.singleUserBaseUri;
      sdk = new StoreSdk(cnf.singleUserBaseUri);
      sdk.silent = true;
    });

    describe('/app/{appId}/requests', () => {
      describe('GET', () => {
        let user1Token: string;
        const appId1 = 'x1b2e3';
        const appId2 = 't2a3f7';
  
        before(async () => {
          user1Token = await http.createUserToken(baseUri);
          await http.post(`${baseUri}/test/generate/app/requests?size=40&isoKey=true&app=${appId1}`, { token: user1Token });
          await http.post(`${baseUri}/test/generate/app/requests?size=10&isoKey=true&app=${appId2}`, { token: user1Token });
  
          sdk.token = user1Token;
        });
  
        after(async () => {
          await http.delete(`${baseUri}/test/reset/app/requests`);
          await http.delete(`${baseUri}/test/reset/users`);
          await http.delete(`${baseUri}/test/reset/sessions`);
        });
  
        it('returns a query result for default parameters', async () => {
          const result = await sdk.app.requests.list(appId1);
          assert.typeOf(result, 'object', 'result is an object');
          assert.typeOf(result.cursor, 'string', 'has page token');
          assert.typeOf(result.items, 'array', 'has response items');
          assert.lengthOf(result.items, 35, 'has default limit of items');
        });
  
        it('respects the "limit" parameter', async () => {
          const result = await sdk.app.requests.list(appId1, {
            limit: 5,
          });
          assert.lengthOf(result.items, 5);
        });
  
        it('respects the "cursor" parameter', async () => {
          const result1 = await sdk.app.requests.list(appId1, {
            limit: 10,
          });
          const result2 = await sdk.app.requests.list(appId1, {
            cursor: result1.cursor,
          });
          assert.lengthOf(result2.items, 10);
          const all = await sdk.app.requests.list(appId1, {
            limit: 20,
          });
          assert.deepEqual(all.items, result1.items.concat(result2.items), 'has both pages');
        });
  
        it('only list application and user requests', async () => {
          const result = await sdk.app.requests.list(appId2);
          assert.lengthOf(result.items, 10);
        });
  
        it('does not return results for unknown app', async () => {
          const result = await sdk.app.requests.list('other');
          assert.lengthOf(result.items, 0);
        });
      });
  
      describe('POST', () => {
        const appId1 = 'x1b2e3';
  
        before(async () => {
          sdk.token = await http.createUserToken(baseUri);
        });
  
        after(async () => {
          await http.delete(`${baseUri}/test/reset/app/requests`);
          await http.delete(`${baseUri}/test/reset/users`);
          await http.delete(`${baseUri}/test/reset/sessions`);
        });
  
        it('returns the created record', async () => {
          const data = AppRequest.fromName('test', appId1).toJSON();
          const result = await sdk.app.requests.create(data, appId1);
          assert.typeOf(result, 'object');
          assert.typeOf(result.key, 'string', 'has an key');
          assert.equal(result.kind, AppRequestKind, 'has the created object');
        });
  
        it('returns the location header', async () => {
          const data = AppRequest.fromName('test', appId1).toJSON();
          const result = await http.post(`${baseUri}${RouteBuilder.appRequests(appId1)}`, {
            token: sdk.token,
            body: JSON.stringify(data),
            headers: {
              'content-type': 'application/json',
            },
          });
          const loc = result.headers.location as string;
          assert.typeOf(loc, 'string', 'has the header');
          assert.include(loc, RouteBuilder.appRequests(appId1), 'has the requests root');
        });
  
      });
    });

    describe('/app/{appId}/requests/{key}', () => {
      describe('GET', () => {
        let user1Token: string;
        let user2Token: string;
        const appId1 = 'x1b2e3';
        let id: string;
  
        before(async () => {
          user1Token = await http.createUserToken(baseUri);
          user2Token = await http.createUserToken(baseUri);
          sdk.token = user1Token;

          const data = AppRequest.fromName('test', appId1).toJSON();
          await sdk.app.requests.create(data, appId1);
          id = data.key;
        });
  
        after(async () => {
          await http.delete(`${baseUri}/test/reset/app/requests`);
          await http.delete(`${baseUri}/test/reset/users`);
          await http.delete(`${baseUri}/test/reset/sessions`);
        });

        it('returns the document media', async () => {
          const result = await sdk.app.requests.read(id, appId1);
          assert.equal(result.kind, AppRequestKind, 'has the kind');
          assert.typeOf(result.created, 'number', 'has the created');
          assert.typeOf(result.info, 'object', 'has the info');
        });

        it('sdk throws an error when unknown user', async () => {
          await assert.isRejected(sdk.app.requests.read(id, appId1, { token: 'test' }), `The client is not authorized to access this resource.`);
        });

        it('sdk throws an error when unknown key', async () => {
          await assert.isRejected(sdk.app.requests.read('other', appId1), `Not found.`);
        });

        it('throws when reading record of another user', async () => {
          await assert.isRejected(sdk.app.requests.read('other', appId1, { token: user2Token }), `Not found.`);
        });
      });

      describe('DELETE', () => {
        let user1Token: string;
        const appId1 = 'x1b2e3';
        const appId2 = 't2a3f7';
        let p1: IAppRequest;
        let p3: IAppRequest;
  
        before(async () => {
          user1Token = await http.createUserToken(baseUri);
          sdk.token = user1Token;
        });
  
        after(async () => {
          await http.delete(`${baseUri}/test/reset/app/requests`);
          await http.delete(`${baseUri}/test/reset/users`);
          await http.delete(`${baseUri}/test/reset/sessions`);
        });

        beforeEach(async () => {
          p1 = mock.app.appRequest({ app: appId1, isoKey: true });
          await sdk.app.requests.create(p1, appId1);
          p3 = mock.app.appRequest({ app: appId2, isoKey: true });
          await sdk.app.requests.create(p3, appId2);
        });

        it('deletes the requested record', async () => {
          await sdk.app.requests.delete(p1.key, appId1);
          await assert.isRejected(
            sdk.app.requests.read(p1.key, appId1), 
            `Not found.`
          );
        });

        it('returns the delete record', async () => {
          const result = await sdk.app.requests.delete(p1.key, appId1);
          assert.deepEqual(result, { key: p1.key });
        });
    
        it('throws when not found', async () => {
          await assert.isRejected(
            sdk.app.requests.delete('other', appId1), 
            `Not found.`
          );
        });

        it('throws when items not belonging to the app', async () => {
          await assert.isRejected(
            sdk.app.requests.delete(p3.key, appId1), 
            `Not found.`
          );
        });
      });

      describe('PATCH', () => {
        let user1Token: string;
        const appId1 = 'x1b2e3';
        const appId2 = 't2a3f7';
        let p1: IAppRequest;
  
        before(async () => {
          user1Token = await http.createUserToken(baseUri);
          sdk.token = user1Token;
        });
  
        after(async () => {
          await http.delete(`${baseUri}/test/reset/app/requests`);
          await http.delete(`${baseUri}/test/reset/users`);
          await http.delete(`${baseUri}/test/reset/sessions`);
        });

        beforeEach(async () => {
          p1 = mock.app.appRequest({ app: appId1, isoKey: true });
          await sdk.app.requests.create(p1, appId1);
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
          await sdk.app.requests.patch(p1.key, appId1, info);
          const result = await sdk.app.requests.read(p1.key, appId1) as IAppRequest;
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
          const data = await sdk.app.requests.patch(p1.key, appId1, info);
          
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
            sdk.app.requests.patch(p1.key, appId2, info), 
            `Not found.`
          );
        });
      });
    });

    describe('/app/{appId}/requests/batch/create', () => {
      const appId = 'x1b2e3';
      let data: IAppRequest[];
  
      before(async () => {
        sdk.token = await http.createUserToken(baseUri);
      });

      after(async () => {
        await http.delete(`${baseUri}/test/reset/app/requests`);
        await http.delete(`${baseUri}/test/reset/users`);
        await http.delete(`${baseUri}/test/reset/sessions`);
      });

      beforeEach(() => {
        data = mock.app.appRequests(2, { app: appId, isoKey: true });
      });

      it('returns the change record', async () => {
        const result = await sdk.app.requests.createBatch(data, appId);
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
        const result = await sdk.app.requests.createBatch([], appId);
        assert.deepEqual(result.items, []);
      });
    });

    describe('/app/{appId}/requests/batch/read', () => {
      let user1Token: string;
      const appId1 = 'x1b2e3';
      const appId2 = 't2a3f7';
      let data1: IAppRequest[];
      let data3: IAppRequest[];

      before(async () => {
        user1Token = await http.createUserToken(baseUri);
        sdk.token = user1Token;

        data1 = mock.app.appRequests(5, { app: appId1, isoKey: true });
        await sdk.app.requests.createBatch(data1, appId1);
        data3 = mock.app.appRequests(5, { app: appId2, isoKey: true });
        await sdk.app.requests.createBatch(data3, appId2);
      });

      after(async () => {
        await http.delete(`${baseUri}/test/reset/app/requests`);
        await http.delete(`${baseUri}/test/reset/users`);
        await http.delete(`${baseUri}/test/reset/sessions`);
      });

      it('reds the requested records', async () => {
        const result = await sdk.app.requests.readBatch([data1[0].key, data1[1].key], appId1);
        assert.typeOf(result, 'object', 'returns an object');
        assert.typeOf(result.items, 'array', 'the .items is an array');
        assert.lengthOf(result.items, 2, 'the .items has 2 results');
        const [p1, p2] = (result.items as IAppRequest[]);
        assert.typeOf(p1.key, 'string', 'has the #1 key');
        assert.deepEqual(p1, data1[0], 'has the #1 item');
        assert.typeOf(p2.key, 'string', 'has the #2 key');
        assert.deepEqual(p2, data1[1], 'has the #2 item');
      });
  
      it('returns null when an item is not found', async () => {
        const result = await sdk.app.requests.readBatch([data1[0].key, 'other'], appId1);
        const [p1, p2] = (result.items as IAppRequest[]);
        assert.deepEqual(p1, data1[0], 'has the #1 item');
        assert.isNull(p2);
      });
  
      it('handles empty arrays', async () => {
        const result = await sdk.app.requests.readBatch([], appId1);
        assert.deepEqual(result.items, []);
      });

      it('ignores deleted items', async () => {
        const p6 = mock.app.appRequest({ app: appId1, isoKey: true });
        await sdk.app.requests.create(p6, appId1);
        await sdk.app.requests.delete(p6.key, appId1);
        const result = await sdk.app.requests.readBatch([data1[0].key, p6.key], appId1);
        const [p1, p2] = (result.items as IAppRequest[]);
        assert.deepEqual(p1, data1[0], 'has the #1 item');
        assert.isNull(p2);
      });

      it('ignores items not belonging to another app', async () => {
        const result = await sdk.app.requests.readBatch([data1[0].key, data3[0].key], appId1);
        const [p1, p2] = (result.items as IAppRequest[]);
        assert.deepEqual(p1, data1[0], 'has the #1 item');
        assert.isNull(p2);
      });
    });

    describe('/app/{appId}/requests/batch/delete', () => {
      let user1Token: string;
      const appId1 = 'x1b2e3';
      const appId2 = 't2a3f7';
      let data1: IAppRequest[];
      let data3: IAppRequest[];

      before(async () => {
        user1Token = await http.createUserToken(baseUri);
        sdk.token = user1Token;

        data1 = mock.app.appRequests(3, { app: appId1, isoKey: true });
        await sdk.app.requests.createBatch(data1, appId1);
        data3 = mock.app.appRequests(1, { app: appId2, isoKey: true });
        await sdk.app.requests.createBatch(data3, appId2);
      });

      after(async () => {
        await http.delete(`${baseUri}/test/reset/app/requests`);
        await http.delete(`${baseUri}/test/reset/users`);
        await http.delete(`${baseUri}/test/reset/sessions`);
      });

      it('deletes the requested records', async () => {
        await sdk.app.requests.deleteBatch([data1[0].key, data1[1].key], appId1);
        const result = await sdk.app.requests.readBatch([data1[0].key, data1[1].key, data1[2].key], appId1);
        assert.lengthOf(result.items, 3, 'has 3 results');
        const [p1, p2, p3] = (result.items as IAppRequest[]);
        assert.isNull(p1, 'deletes item #1');
        assert.isNull(p2, 'deletes item #2');
        assert.deepEqual(p3, data1[2], 'has item #3');
      });

      it('returns the delete record', async () => {
        const result = await sdk.app.requests.deleteBatch([data1[0].key, data1[1].key], appId1);
        assert.typeOf(result, 'object', 'returns an object');
        assert.typeOf(result.items, 'array', 'has the items');
        const [log1, log2] = result.items as IDeleteRecord[];
        assert.deepEqual(log1, { key: data1[0].key });
        assert.deepEqual(log2, { key: data1[1].key });
      });
  
      it('returns undefined when an item is not found', async () => {
        const result = await sdk.app.requests.deleteBatch([data1[0].key, 'other'], appId1);
        const [log1, log2] = result.items as IDeleteRecord[];
        assert.deepEqual(log1, { key: data1[0].key });
        assert.isNull(log2);
      });

      it('handles empty arrays', async () => {
        const result = await sdk.app.requests.deleteBatch([], appId1);
        assert.deepEqual(result.items, []);
      });

      it('ignores items not belonging to another app', async () => {
        const result = await sdk.app.requests.deleteBatch([data1[0].key, data3[0].key], appId1);
        const [log1, log2] = result.items as IDeleteRecord[];
        assert.deepEqual(log1, { key: data1[0].key });
        assert.isNull(log2);
      });
    });

    describe('/app/{appId}/requests/batch/undelete', () => {
      let user1Token: string;
      const appId1 = 'x1b2e3';
      const appId2 = 't2a3f7';
      let data1: IAppRequest[];
      let data3: IAppRequest[];

      before(async () => {
        user1Token = await http.createUserToken(baseUri);
        sdk.token = user1Token;
      });

      after(async () => {
        await http.delete(`${baseUri}/test/reset/app/requests`);
        await http.delete(`${baseUri}/test/reset/users`);
        await http.delete(`${baseUri}/test/reset/sessions`);
      });

      beforeEach(async () => {
        data1 = mock.app.appRequests(3, { app: appId1, isoKey: true });
        await sdk.app.requests.createBatch(data1, appId1);
        data3 = mock.app.appRequests(1, { app: appId2, isoKey: true });
        await sdk.app.requests.createBatch(data3, appId2);

        await sdk.app.requests.deleteBatch(data1.map(i => i.key), appId1);
        await sdk.app.requests.deleteBatch(data3.map(i => i.key), appId2);
      });

      it('restores the requested records', async () => {
        await sdk.app.requests.undeleteBatch([data1[0].key, data1[1].key], appId1);
        const result = await sdk.app.requests.readBatch([data1[0].key, data1[1].key, data1[2].key], appId1);
        assert.lengthOf(result.items, 3, 'has 3 results');
        const [p1, p2, p3] = (result.items as IAppRequest[]);
        assert.deepEqual(p1, data1[0], 'restores item #1');
        assert.deepEqual(p2, data1[1],'restores item #2');
        assert.isNull(p3, 'keeps item #3 deleted');
      });

      it('returns the revert record', async () => {
        const result = await sdk.app.requests.undeleteBatch([data1[0].key, data1[1].key], appId1);
        assert.typeOf(result, 'object', 'returns an object');
        assert.typeOf(result.items, 'array', 'has the items');
        const [log1, log2] = result.items as IRevertResult<IAppRequest>[];
        assert.deepEqual(log1, { key: data1[0].key, kind: data1[0].kind, item: data1[0] });
        assert.deepEqual(log2, { key: data1[1].key, kind: data1[1].kind, item: data1[1] });
      });
  
      it('returns undefined when an item is not found', async () => {
        const result = await sdk.app.requests.undeleteBatch([data1[0].key, 'other'], appId1);
        const [log1, log2] = result.items as IRevertResult<IAppRequest>[];
        assert.deepEqual(log1, { key: data1[0].key, kind: data1[0].kind, item: data1[0] });
        assert.isNull(log2);
      });

      it('returns undefined when an item is not deleted', async () => {
        const p4 = mock.app.appRequest({ app: appId1, isoKey: true });
        await sdk.app.requests.create(p4, appId1);
        const result = await sdk.app.requests.undeleteBatch([data1[0].key, p4.key], appId1);
        const [log1, log2] = result.items as IRevertResult<IAppRequest>[];
        assert.deepEqual(log1, { key: data1[0].key, kind: data1[0].kind, item: data1[0] });
        assert.isNull(log2);
      });
  
      it('handles empty arrays', async () => {
        const result = await sdk.app.requests.undeleteBatch([], appId1);
        assert.deepEqual(result.items, []);
      });

      it('ignores items not belonging to another app', async () => {
        const result = await sdk.app.requests.undeleteBatch([data1[0].key, data3[0].key], appId1);
        const [log1, log2] = result.items as IRevertResult<IAppRequest>[];
        assert.deepEqual(log1, { key: data1[0].key, kind: data1[0].kind, item: data1[0] });
        assert.isNull(log2);
      });
    });
  });
});
