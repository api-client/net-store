/* eslint-disable import/no-named-as-default-member */
import { assert } from 'chai';
import { Workspace, IWorkspace, WorkspaceKind, IListResponse, IBackendEvent, RouteBuilder, IUser, AccessOperation } from '@api-client/core';
import getConfig from '../helpers/getSetup.js';
import HttpHelper from '../helpers/HttpHelper.js';
import WsHelper, { RawData } from '../helpers/WsHelper.js';

describe('Multi user', () => {
  describe('/spaces', () => {
    let baseUri: string;
    let baseUriWs: string;
    const http = new HttpHelper();
    const ws = new WsHelper();

    before(async () => {
      const cnf = await getConfig();
      baseUri = cnf.multiUserBaseUri;
      baseUriWs = cnf.multiUserWsBaseUri;
    });

    describe('POST /spaces', () => {
      let user1Token: string;
      before(async () => {
        user1Token = await http.createUserToken(baseUri);
      });

      after(async () => {
        await http.delete(`${baseUri}/test/reset/spaces`);
        await http.delete(`${baseUri}/test/reset/users`);
        await http.delete(`${baseUri}/test/reset/sessions`);
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

      it('informs clients about the new space', async () => {
        const messages: IBackendEvent[] = [];
        const client = await ws.createAndConnect(`${baseUriWs}/spaces`, user1Token);
        client.on('message', (data: RawData) => {
          messages.push(JSON.parse(data.toString()));
        });
        await http.post(`${baseUri}/spaces`, {
          token: user1Token,
          body: JSON.stringify(Workspace.fromName('test')),
        });
        
        await ws.disconnect(client);
        assert.lengthOf(messages, 1, 'received one event');
        const [ev] = messages;
        assert.equal(ev.type, 'event');
        assert.equal(ev.operation, 'created');
        assert.equal(ev.kind, WorkspaceKind);
        const space = ev.data as IWorkspace;
        assert.equal(space.kind, WorkspaceKind);
      });
    });

    describe('GET /spaces', () => {
      let user1Token: string;
      before(async () => {
        user1Token = await http.createUserToken(baseUri);
        await http.delete(`${baseUri}/test/reset/spaces`);
        await http.post(`${baseUri}/test/generate/spaces?size=40`, {
          token: user1Token,
        });
        await http.post(`${baseUri}/test/generate/spaces?size=5&owner=123er`);
      });

      after(async () => {
        await http.delete(`${baseUri}/test/reset/spaces`);
        await http.delete(`${baseUri}/test/reset/users`);
        await http.delete(`${baseUri}/test/reset/sessions`);
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
    });

    describe('Deep space (spaces tree)', () => {
      let user1Token: string;
      let user2Token: string;
      let user1Id: string;
      let user2Id: string;
      let parentSpace: string;
      before(async () => {
        user1Token = await http.createUserToken(baseUri);
        user2Token = await http.createUserToken(baseUri);
        const user1Response = await http.get(`${baseUri}${RouteBuilder.usersMe()}`, { token: user1Token });
        const user2Response = await http.get(`${baseUri}/users/me`, { token: user2Token });
        user1Id = (JSON.parse(user1Response.body as string) as IUser).key;
        user2Id = (JSON.parse(user2Response.body as string) as IUser).key;
      });

      after(async () => {
        await http.delete(`${baseUri}/test/reset/users`);
        await http.delete(`${baseUri}/test/reset/sessions`);
      });

      beforeEach(async () => {
        const space = Workspace.fromName('parent');
        const result = await http.post(`${baseUri}${RouteBuilder.spaces()}`, {
          token: user1Token,
          body: JSON.stringify(space),
        });
        assert.equal(result.status, 204, 'created parent space');
        parentSpace = space.key;
      });

      afterEach(async () => {
        await http.delete(`${baseUri}/test/reset/spaces`);
      });

      it('creates a sub space', async () => {
        const srcSpace = Workspace.fromName('child');
        const result = await http.post(`${baseUri}${RouteBuilder.space(parentSpace)}`, {
          token: user1Token,
          body: JSON.stringify(srcSpace),
        });
        assert.equal(result.status, 204, 'created a child space');
        const readResult = await http.get(`${baseUri}${RouteBuilder.space(srcSpace.key)}`, { token: user1Token });
        assert.equal(readResult.status, 200, 'reads the sub space');
        const readSpace = JSON.parse(readResult.body as string) as IWorkspace;
        
        assert.equal(readSpace.owner, user1Id, 'sets the owner');
        assert.deepEqual(readSpace.parents, [parentSpace], 'sets the parents');
        assert.deepEqual(readSpace.permissionIds, [], 'sets the empty permissionIds');
        assert.deepEqual(readSpace.permissions, [], 'sets the empty permissions');
      });

      it('creates a deep tree', async () => {
        const s1 = Workspace.fromName('s1');
        const s2 = Workspace.fromName('s2');
        const s3 = Workspace.fromName('s2');
        const s4 = Workspace.fromName('s4');
        const r1 = await http.post(`${baseUri}${RouteBuilder.space(parentSpace)}`, { token: user1Token, body: JSON.stringify(s1) });
        const r2 = await http.post(`${baseUri}${RouteBuilder.space(s1.key)}`, { token: user1Token, body: JSON.stringify(s2) });
        const r3 = await http.post(`${baseUri}${RouteBuilder.space(s2.key)}`, { token: user1Token, body: JSON.stringify(s3) });
        const r4 = await http.post(`${baseUri}${RouteBuilder.space(s3.key)}`, { token: user1Token, body: JSON.stringify(s4) });
        assert.equal(r1.status, 204, 'created a child space #1');
        assert.equal(r2.status, 204, 'created a child space #2');
        assert.equal(r3.status, 204, 'created a child space #3');
        assert.equal(r4.status, 204, 'created a child space #4');

        const readResult = await http.get(`${baseUri}${RouteBuilder.space(s4.key)}`, { token: user1Token });
        assert.equal(readResult.status, 200, 'reads the sub space');
        const readSpace = JSON.parse(readResult.body as string) as IWorkspace;
        
        assert.equal(readSpace.owner, user1Id, 'sets the owner');
        assert.deepEqual(readSpace.parents, [parentSpace, s1.key, s2.key, s3.key], 'sets the parents');
      });

      it('lists only for root spaces without a parent', async () => {
        const s1 = Workspace.fromName('s1');
        const s2 = Workspace.fromName('s2');
        const s3 = Workspace.fromName('s2');
        const s4 = Workspace.fromName('s4');
        const r1 = await http.post(`${baseUri}${RouteBuilder.space(parentSpace)}`, { token: user1Token, body: JSON.stringify(s1) });
        const r2 = await http.post(`${baseUri}${RouteBuilder.space(parentSpace)}`, { token: user1Token, body: JSON.stringify(s2) });
        const r3 = await http.post(`${baseUri}${RouteBuilder.space(s1.key)}`, { token: user1Token, body: JSON.stringify(s3) });
        const r4 = await http.post(`${baseUri}${RouteBuilder.space(s1.key)}`, { token: user1Token, body: JSON.stringify(s4) });
        assert.equal(r1.status, 204, 'created a child space #1');
        assert.equal(r2.status, 204, 'created a child space #2');
        assert.equal(r3.status, 204, 'created a child space #3');
        assert.equal(r4.status, 204, 'created a child space #4');

        const result = await http.get(`${baseUri}/spaces`, {
          token: user1Token,
        });
        assert.equal(result.status, 200, 'has the 200 status');
        const list = JSON.parse(result.body as string) as IListResponse<IWorkspace>;
        assert.typeOf(list.cursor as string, 'string', 'has the cursor');
        assert.typeOf(list.data, 'array', 'has the data array');
        assert.lengthOf(list.data, 1, 'has all spaces');

        assert.equal(list.data[0].key, parentSpace);
      });

      it('lists only spaces of a parent', async () => {
        const s1 = Workspace.fromName('s1');
        const s2 = Workspace.fromName('s2');
        const s3 = Workspace.fromName('s2');
        const s4 = Workspace.fromName('s4');
        const r1 = await http.post(`${baseUri}${RouteBuilder.space(parentSpace)}`, { token: user1Token, body: JSON.stringify(s1) });
        const r2 = await http.post(`${baseUri}${RouteBuilder.space(parentSpace)}`, { token: user1Token, body: JSON.stringify(s2) });
        const r3 = await http.post(`${baseUri}${RouteBuilder.space(s1.key)}`, { token: user1Token, body: JSON.stringify(s3) });
        const r4 = await http.post(`${baseUri}${RouteBuilder.space(s1.key)}`, { token: user1Token, body: JSON.stringify(s4) });
        assert.equal(r1.status, 204, 'created a child space #1');
        assert.equal(r2.status, 204, 'created a child space #2');
        assert.equal(r3.status, 204, 'created a child space #3');
        assert.equal(r4.status, 204, 'created a child space #4');

        const result = await http.get(`${baseUri}/spaces?parent=${parentSpace}`, {
          token: user1Token,
        });
        assert.equal(result.status, 200, 'has the 200 status');
        const list = JSON.parse(result.body as string) as IListResponse<IWorkspace>;
        assert.typeOf(list.cursor as string, 'string', 'has the cursor');
        assert.typeOf(list.data, 'array', 'has the data array');
        assert.lengthOf(list.data, 2, 'has all spaces');
        const readIds = [list.data[0].key, list.data[1].key];
        assert.include(readIds, s1.key);
        assert.include(readIds, s2.key);
      });

      it('lists only spaces of a deep parent', async () => {
        const s1 = Workspace.fromName('s1');
        const s2 = Workspace.fromName('s2');
        const s3 = Workspace.fromName('s2');
        const s4 = Workspace.fromName('s4');
        const r1 = await http.post(`${baseUri}${RouteBuilder.space(parentSpace)}`, { token: user1Token, body: JSON.stringify(s1) });
        const r2 = await http.post(`${baseUri}${RouteBuilder.space(parentSpace)}`, { token: user1Token, body: JSON.stringify(s2) });
        const r3 = await http.post(`${baseUri}${RouteBuilder.space(s1.key)}`, { token: user1Token, body: JSON.stringify(s3) });
        const r4 = await http.post(`${baseUri}${RouteBuilder.space(s1.key)}`, { token: user1Token, body: JSON.stringify(s4) });
        assert.equal(r1.status, 204, 'created a child space #1');
        assert.equal(r2.status, 204, 'created a child space #2');
        assert.equal(r3.status, 204, 'created a child space #3');
        assert.equal(r4.status, 204, 'created a child space #4');

        const result = await http.get(`${baseUri}/spaces?parent=${s1.key}`, {
          token: user1Token,
        });
        assert.equal(result.status, 200, 'has the 200 status');
        const list = JSON.parse(result.body as string) as IListResponse<IWorkspace>;
        assert.typeOf(list.cursor as string, 'string', 'has the cursor');
        assert.typeOf(list.data, 'array', 'has the data array');
        assert.lengthOf(list.data, 2, 'has all spaces');
        const readIds = [list.data[0].key, list.data[1].key];
        assert.include(readIds, s3.key);
        assert.include(readIds, s4.key);
      });

      it('does not list shared spaces from the root level', async () => {
        const s1 = Workspace.fromName('s1');
        const s2 = Workspace.fromName('s2');
        const s3 = Workspace.fromName('s2');
        const s4 = Workspace.fromName('s4');
        const r1 = await http.post(`${baseUri}${RouteBuilder.space(parentSpace)}`, { token: user1Token, body: JSON.stringify(s1) });
        const r2 = await http.post(`${baseUri}${RouteBuilder.space(parentSpace)}`, { token: user1Token, body: JSON.stringify(s2) });
        const r3 = await http.post(`${baseUri}${RouteBuilder.space(s1.key)}`, { token: user1Token, body: JSON.stringify(s3) });
        const r4 = await http.post(`${baseUri}${RouteBuilder.space(s1.key)}`, { token: user1Token, body: JSON.stringify(s4) });
        assert.equal(r1.status, 204, 'created a child space #1');
        assert.equal(r2.status, 204, 'created a child space #2');
        assert.equal(r3.status, 204, 'created a child space #3');
        assert.equal(r4.status, 204, 'created a child space #4');

        const records: AccessOperation[] = [{
          op: 'add',
          id: user2Id,
          value: 'reader',
          type: 'user',
        }];
        const permResponse = await http.patch(`${baseUri}/spaces/${parentSpace}/users`, {
          token: user1Token,
          body: JSON.stringify(records),
        });
        assert.equal(permResponse.status, 204, 'has the 204 status code');
        const u21Response = await http.get(`${baseUri}/spaces`, {
          token: user2Token,
        });
        assert.equal(u21Response.status, 200, 'has the 200 status code');
        const list1 = JSON.parse(u21Response.body as string) as IListResponse<IWorkspace>;
        assert.lengthOf(list1.data, 0, 'has no root space');
      });
    });
  });
});
