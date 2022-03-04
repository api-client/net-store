/* eslint-disable import/no-named-as-default-member */
import { assert } from 'chai';
import { 
  IWorkspace, IUser, IListResponse, UserAccessOperation, IUserWorkspace, IBackendEvent,
} from '@advanced-rest-client/core';
import { JsonPatch } from 'json8-patch';
import getConfig from '../helpers/getSetup.js';
import HttpHelper from '../helpers/HttpHelper.js';
import WsHelper, { RawData } from '../helpers/WsHelper.js';

describe('Multi user', () => {
  describe('/spaces/space', () => {
    let baseUri: string;
    let baseUriWs: string;
    const http = new HttpHelper();
    const ws = new WsHelper();

    before(async () => {
      const cnf = await getConfig();
      baseUri = cnf.multiUserBaseUri;
      baseUriWs = cnf.multiUserWsBaseUri;
    });

    describe('GET /spaces/space', () => {
      let created: IWorkspace[];
      let user1Token: string;

      before(async () => {
        user1Token = await http.createUserToken(baseUri);
        await http.post(`${baseUri}/test/generate/spaces?size=4`, {
          token: user1Token,
        });
        const result = await http.get(`${baseUri}/spaces`, {
          token: user1Token,
        });
        assert.equal(result.status, 200, 'has the 200 status');
        const list = JSON.parse(result.body as string) as IListResponse;
        created = list.data as IWorkspace[];
      });

      after(async () => {
        await http.delete(`${baseUri}/test/reset/spaces`);
        await http.delete(`${baseUri}/test/reset/users`);
      });

      it('reads a space info', async () => {
        const srcSpace = created[0];
        const result = await http.get(`${baseUri}/spaces/${srcSpace.key}`, {
          token: user1Token,
        });
        assert.equal(result.status, 200, 'has 200 status code');
        const space = JSON.parse(result.body as string) as IWorkspace;
        assert.deepEqual(space, srcSpace, 'returns the space');
      });

      it('returns 403 when no space', async () => {
        const result = await http.get(`${baseUri}/spaces/1234567890`, {
          token: user1Token,
        });
        assert.equal(result.status, 403, 'has 403 status code');
        const info = JSON.parse(result.body as string);
        assert.equal(info.message, 'Not authorized to read this space.');
      });

      it('returns 401 when no credentials', async () => {
        const srcSpace = created[0];
        const result = await http.get(`${baseUri}/spaces/${srcSpace.key}`);
        assert.equal(result.status, 401, 'has 401 status code');
        const info = JSON.parse(result.body as string);
        assert.equal(info.message, 'The client is not authorized to access this resource.');
      });
    });

    describe('PATCH /spaces/space', () => {
      let created: IWorkspace[];
      let other: IWorkspace[];
      let user1Token: string;

      // note: generate as many spaces as tests you perform
      // not have a "fresh" (or rather consistent) records in the data store.
      before(async () => {
        user1Token = await http.createUserToken(baseUri);
        const rawCreated = await http.post(`${baseUri}/test/generate/spaces?size=4`, {
          token: user1Token,
        });
        created = JSON.parse(rawCreated.body as string);
        const rawOther = await http.post(`${baseUri}/test/generate/spaces?size=1&owner=test`);
        other = JSON.parse(rawOther.body as string);
      });

      after(async () => {
        await http.delete(`${baseUri}/test/reset/spaces`);
        await http.delete(`${baseUri}/test/reset/users`);
      });

      it('patches the space', async () => {
        const srcSpace = created[0];
        const patch: JsonPatch = [
          {
            op: 'replace',
            path: '/info/name',
            value: 'New name',
          }
        ];
        const result = await http.patch(`${baseUri}/spaces/${srcSpace.key}`, {
          body: JSON.stringify(patch),
          token: user1Token,
        });
        assert.equal(result.status, 200, 'has 200 status code');
        const body = JSON.parse(result.body as string);
        assert.equal(body.status, 'OK', 'has the OK status');
        assert.typeOf(body.revert, 'array', 'has the revert patch');
      });

      it('patches the space in the store', async () => {
        const srcSpace = created[1];
        const patch: JsonPatch = [
          {
            op: 'replace',
            path: '/info/name',
            value: 'Other name',
          }
        ];
        await http.patch(`${baseUri}/spaces/${srcSpace.key}`, {
          body: JSON.stringify(patch),
          token: user1Token,
        });
        const result = await http.get(`${baseUri}/spaces/${srcSpace.key}`, {
          token: user1Token,
        });
        
        assert.equal(result.status, 200, 'has 200 status code');
        const space = JSON.parse(result.body as string) as IWorkspace;
        assert.equal(space.info.name, 'Other name', 'has the applied patch');
      });

      it('returns 403 when no space', async () => {
        const patch: JsonPatch = [
          {
            op: 'replace',
            path: '/info/name',
            value: 'Other name',
          }
        ];
        const result = await http.patch(`${baseUri}/spaces/1234567890`, {
          body: JSON.stringify(patch),
          token: user1Token,
        });
        assert.equal(result.status, 403, 'has 403 status code');
        const info = JSON.parse(result.body as string);
        assert.equal(info.message, 'Not authorized to read this space.');
      });

      it('returns 403 when accessing a workspace without access', async () => {
        const patch: JsonPatch = [
          {
            op: 'replace',
            path: '/info/name',
            value: 'Other name',
          }
        ];
        const result = await http.patch(`${baseUri}/spaces/${other[0].key}`, {
          body: JSON.stringify(patch),
          token: user1Token,
        });
        assert.equal(result.status, 403, 'has 403 status code');
        const info = JSON.parse(result.body as string);
        assert.equal(info.message, 'Not authorized to read this space.');
      });

      it('returns 400 when invalid patch dta', async () => {
        const srcSpace = created[1];
        const patch = [
          {
            test: "hello"
          }
        ];
        const result = await http.patch(`${baseUri}/spaces/${srcSpace.key}`, {
          body: JSON.stringify(patch),
          token: user1Token,
        });
        assert.equal(result.status, 400, 'has 404 status code');
        const info = JSON.parse(result.body as string);
        assert.equal(info.message, 'Malformed patch information.');
      });
    });

    describe('PATCH /spaces/space/users (adding users)', () => {
      let u1spaces: IWorkspace[];
      let u2spaces: IWorkspace[];
      let user1Token: string;
      let user2Token: string;
      let user3Token: string;
      let user2Id: string;
      let user3Id: string;

      // note: generate as many spaces as tests you perform
      // not have a "fresh" (or rather consistent) records in the data store.
      before(async () => {
        user1Token = await http.createUserToken(baseUri);
        user2Token = await http.createUserToken(baseUri);
        user3Token = await http.createUserToken(baseUri);
        const rawCreated = await http.post(`${baseUri}/test/generate/spaces?size=6`, { token: user1Token });
        const rawOther = await http.post(`${baseUri}/test/generate/spaces?size=1`, { token: user2Token });
        const user2Response = await http.get(`${baseUri}/users/me`, { token: user2Token });
        const user3Response = await http.get(`${baseUri}/users/me`, { token: user3Token });
        u1spaces = JSON.parse(rawCreated.body as string);
        u2spaces = JSON.parse(rawOther.body as string);
        user2Id = (JSON.parse(user2Response.body as string) as IUser).key;
        user3Id = (JSON.parse(user3Response.body as string) as IUser).key;
      });

      after(async () => {
        await http.delete(`${baseUri}/test/reset/spaces`);
        await http.delete(`${baseUri}/test/reset/users`);
      });

      it('adds the user to the space', async () => {
        const { key } = u1spaces[0];
        const records: UserAccessOperation[] = [{
          op: 'add',
          uid: user2Id,
          value: 'read',
        }];
        const body = JSON.stringify(records);
        const response = await http.patch(`${baseUri}/spaces/${key}/users`, {
          token: user1Token,
          body,
        });
        
        assert.equal(response.status, 204, 'has the 204 status code');
        const u2spacesResponse = await http.get(`${baseUri}/spaces`, {
          token: user2Token,
        });
        assert.equal(u2spacesResponse.status, 200, 'has the 200 status code');
        const list = JSON.parse(u2spacesResponse.body as string) as IListResponse;
        const data = list.data as IUserWorkspace[];
        assert.lengthOf(data, 2, 'the user has 2 workspaces');
        const added = data.find(i => i.key === key) as IUserWorkspace;
        const owned = data.find(i => i.key === u2spaces[0].key) as IUserWorkspace;
        
        assert.equal(added.access, 'read', 'has the set access level');
        assert.deepEqual(added.users, [user2Id], 'has the user on the workspace users');
        assert.ok(owned, 'has the owned space');
      });

      it('returns error when has no access to the space', async () => {
        const { key } = u2spaces[0];
        const records: UserAccessOperation[] = [{
          op: 'add',
          uid: user2Id,
          value: 'read',
        }];
        const body = JSON.stringify(records);
        const response = await http.patch(`${baseUri}/spaces/${key}/users`, {
          token: user1Token,
          body,
        });
        assert.equal(response.status, 403, 'has the 403 status code');
        const info = JSON.parse(response.body as string);
        assert.equal(info.message, 'Not authorized to read this space.');
      });

      it('returns error a user does not exist', async () => {
        const { key } = u1spaces[1];
        const records: UserAccessOperation[] = [{
          op: 'add',
          uid: user2Id,
          value: 'read',
        }, {
          op: 'add',
          uid: 'other',
          value: 'read',
        }];
        const body = JSON.stringify(records);
        const response = await http.patch(`${baseUri}/spaces/${key}/users`, {
          token: user1Token,
          body,
        });
        assert.equal(response.status, 400, 'has the 400 status code');
        const info = JSON.parse(response.body as string);
        assert.equal(info.message, 'Some users not found in the system: other.');
      });

      it('returns error when has no access to write to the space', async () => {
        // step 1. Add read access to the user #2
        const { key } = u1spaces[1];
        const a1records: UserAccessOperation[] = [{
          op: 'add',
          uid: user2Id,
          value: 'read',
        }];
        const a1response = await http.patch(`${baseUri}/spaces/${key}/users`, {
          token: user1Token,
          body: JSON.stringify(a1records),
        });
        assert.equal(a1response.status, 204, 'has the 204 status code');

        // step 1. Add any access to the user #3
        const a2records: UserAccessOperation[] = [{
          op: 'add',
          uid: user3Id,
          value: 'comment',
        }];
        const a2response = await http.patch(`${baseUri}/spaces/${key}/users`, {
          token: user2Token,
          body: JSON.stringify(a2records),
        });
        assert.equal(a2response.status, 403, 'has the 403 status code');
        const info = JSON.parse(a2response.body as string);
        assert.equal(info.message, 'Not authorized to write to this space.');
      });

      it('returns error when the space does not exist', async () => {
        const a1records: UserAccessOperation[] = [{
          op: 'add',
          uid: user2Id,
          value: 'read',
        }];
        const a1response = await http.patch(`${baseUri}/spaces/something/users`, {
          token: user1Token,
          body: JSON.stringify(a1records),
        });
        assert.equal(a1response.status, 403, 'has the 403 status code');
        const info = JSON.parse(a1response.body as string);
        assert.equal(info.message, 'Not authorized to read this space.');
      });

      it('informs space change via the web socket', async () => {
        const { key } = u1spaces[3];
        const records: UserAccessOperation[] = [{
          op: 'add',
          uid: user2Id,
          value: 'read',
        }];
        const messages: IBackendEvent[] = [];
        const client = await ws.createAndConnect(`${baseUriWs}/spaces/${key}`, user1Token);
        client.on('message', (data: RawData) => {
          messages.push(JSON.parse(data.toString()));
        });
        await http.patch(`${baseUri}/spaces/${key}/users`, {
          token: user1Token,
          body: JSON.stringify(records),
        });
        await ws.disconnect(client);
        assert.lengthOf(messages, 1, 'received one event');
        const [ev] = messages;
        assert.equal(ev.type, 'event');
        assert.equal(ev.operation, 'updated');
        assert.equal(ev.kind, 'ARC#Space');
        assert.equal(ev.id, key);
        assert.deepEqual(ev.data, [
          {
            "op": "add",
            "path": "/users",
            "value": [user2Id]
          }
        ]);
      });

      it('informs the added user about new permission', async () => {
        const { key } = u1spaces[4];
        const records: UserAccessOperation[] = [{
          op: 'add',
          uid: user2Id,
          value: 'read',
        }];
        const messages: IBackendEvent[] = [];
        const client = await ws.createAndConnect(`${baseUriWs}/spaces`, user2Token);
        client.on('message', (data: RawData) => {
          messages.push(JSON.parse(data.toString()));
        });
        await http.patch(`${baseUri}/spaces/${key}/users`, {
          token: user1Token,
          body: JSON.stringify(records),
        });
        await ws.disconnect(client);
        assert.lengthOf(messages, 1, 'received one event');
        const [ev] = messages;
        assert.equal(ev.type, 'event');
        assert.equal(ev.operation, 'access-granted');
        assert.equal(ev.kind, 'ARC#Space');
        assert.equal(ev.id, key);
      });

      it('adds the user only once', async () => {
        const { key } = u1spaces[5];

        // step 1. Add read access to the user #2
        const a1records: UserAccessOperation[] = [{
          op: 'add',
          uid: user2Id,
          value: 'read',
        }];
        const a1response = await http.patch(`${baseUri}/spaces/${key}/users`, {
          token: user1Token,
          body: JSON.stringify(a1records),
        });
        assert.equal(a1response.status, 204, 'has the 204 status code');

        // step 2. Add write access to the user #2
        const a2records: UserAccessOperation[] = [{
          op: 'add',
          uid: user2Id,
          value: 'write',
        }];
        const a2response = await http.patch(`${baseUri}/spaces/${key}/users`, {
          token: user1Token,
          body: JSON.stringify(a2records),
        });
        assert.equal(a2response.status, 204, 'has the 204 status code');
        
        // step 3. Should have write access.
        const getResponse = await http.get(`${baseUri}/spaces/${key}`, { token: user2Token });
        assert.equal(getResponse.status, 200, 'has the 200 status code');
        const body = JSON.parse(getResponse.body as string) as IUserWorkspace;
        assert.equal(body.access, 'write');
        assert.deepEqual(body.users, [user2Id]);
      });
    });

    describe('PATCH /spaces/space/users (removing users)', () => {
      let u1spaces: IWorkspace[];
      // let u2spaces: IWorkspace[];
      let user1Token: string;
      let user2Token: string;
      let user2Id: string;

      after(async () => {
        await http.delete(`${baseUri}/test/reset/spaces`);
        await http.delete(`${baseUri}/test/reset/users`);
      });

      beforeEach(async () => {
        user1Token = await http.createUserToken(baseUri);
        user2Token = await http.createUserToken(baseUri);
        const rawCreated = await http.post(`${baseUri}/test/generate/spaces?size=2`, { token: user1Token });
        // const rawOther = await http.post(`${baseUri}/test/generate/spaces?size=1`, { token: user2Token });
        const user2Response = await http.get(`${baseUri}/users/me`, { token: user2Token });
        u1spaces = JSON.parse(rawCreated.body as string);
        // u2spaces = JSON.parse(rawOther.body as string);
        user2Id = (JSON.parse(user2Response.body as string) as IUser).key;
      });

      async function grantSpace(spaceId: string, uid: string, token?: string): Promise<void> {
        const records: UserAccessOperation[] = [{
          op: 'add',
          uid,
          value: 'read',
        }];
        const response = await http.patch(`${baseUri}/spaces/${spaceId}/users`, {
          token,
          body: JSON.stringify(records),
        });
        assert.equal(response.status, 204);
      }

      it('removes a user from the working space', async () => {
        const { key } = u1spaces[0];
        await grantSpace(key, user2Id, user1Token);
        const patches: UserAccessOperation[] = [
          {
            op: 'remove',
            uid: user2Id,
          },
        ];
        const response = await http.patch(`${baseUri}/spaces/${key}/users`, {
          token: user1Token,
          body: JSON.stringify(patches),
        });
        assert.equal(response.status, 204, 'has the 204 status code');
        const getResponse = await http.get(`${baseUri}/spaces/${key}`, { token: user2Token });
        assert.equal(getResponse.status, 403, 'has the 403 status code');
      });

      it('informs about space change via the web socket', async () => {
        const { key } = u1spaces[0];
        const patches: UserAccessOperation[] = [
          {
            op: 'remove',
            uid: user2Id,
          },
        ];
        const messages: IBackendEvent[] = [];
        const client = await ws.createAndConnect(`${baseUriWs}/spaces/${key}`, user1Token);
        client.on('message', (data: RawData) => {
          messages.push(JSON.parse(data.toString()));
        });
        await http.patch(`${baseUri}/spaces/${key}/users`, {
          token: user1Token,
          body: JSON.stringify(patches),
        });
        await ws.disconnect(client);
        assert.lengthOf(messages, 1, 'received one event');
        const [ev] = messages;
        assert.equal(ev.type, 'event');
        assert.equal(ev.operation, 'updated');
        assert.equal(ev.kind, 'ARC#Space');
        assert.equal(ev.id, key);
        assert.deepEqual(ev.data, [
          {
            "op": "add",
            "path": "/users",
            "value": []
          }
        ]);
      });

      it('informs the removed user about new permission', async () => {
        const { key } = u1spaces[0];
        const records: UserAccessOperation[] = [
          {
            op: 'remove',
            uid: user2Id,
          },
        ];
        const messages: IBackendEvent[] = [];
        const client = await ws.createAndConnect(`${baseUriWs}/spaces`, user2Token);
        client.on('message', (data: RawData) => {
          messages.push(JSON.parse(data.toString()));
        });
        await http.patch(`${baseUri}/spaces/${key}/users`, {
          token: user1Token,
          body: JSON.stringify(records),
        });
        await ws.disconnect(client);
        assert.lengthOf(messages, 1, 'received one event');
        const [ev] = messages;
        assert.equal(ev.type, 'event');
        assert.equal(ev.operation, 'access-removed');
        assert.equal(ev.kind, 'ARC#Space');
        assert.equal(ev.id, key);
      });
    });
  });
});
