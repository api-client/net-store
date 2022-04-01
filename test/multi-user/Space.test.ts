/* eslint-disable import/no-named-as-default-member */
import { assert } from 'chai';
import { 
  IWorkspace, IUser, IListResponse, AccessOperation, PermissionRole, PermissionKind,
  IBackendEvent, HttpProject, HttpProjectKind, WorkspaceKind, RouteBuilder,
} from '@api-client/core';
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

    describe('GET', () => {
      let created: IWorkspace[];
      let user1Token: string;

      before(async () => {
        user1Token = await http.createUserToken(baseUri);
        await http.post(`${baseUri}/test/generate/spaces?size=4`, {
          token: user1Token,
        });
        const basePath = RouteBuilder.spaces();
        const result = await http.get(`${baseUri}${basePath}`, {
          token: user1Token,
        });
        assert.equal(result.status, 200, 'has the 200 status');
        const list = JSON.parse(result.body as string) as IListResponse;
        created = list.data as IWorkspace[];
      });

      after(async () => {
        await http.delete(`${baseUri}/test/reset/spaces`);
        await http.delete(`${baseUri}/test/reset/users`);
        await http.delete(`${baseUri}/test/reset/sessions`);
      });

      it('reads a space info', async () => {
        const srcSpace = created[0]; 
        const basePath = RouteBuilder.space(srcSpace.key);
        const result = await http.get(`${baseUri}${basePath}`, {
          token: user1Token,
        });
        assert.equal(result.status, 200, 'has 200 status code');
        const space = JSON.parse(result.body as string) as IWorkspace;
        assert.deepEqual(space, srcSpace, 'returns the space');
      });

      it('returns 404 when no space', async () => {
        const basePath = RouteBuilder.space('1234567890');
        const result = await http.get(`${baseUri}${basePath}`, {
          token: user1Token,
        });
        assert.equal(result.status, 404, 'has 404 status code');
        const info = JSON.parse(result.body as string);
        assert.equal(info.message, 'Not found.');
      });

      it('returns 401 when no credentials', async () => {
        const srcSpace = created[0];
        const basePath = RouteBuilder.space(srcSpace.key);
        const result = await http.get(`${baseUri}${basePath}`);
        assert.equal(result.status, 401, 'has 401 status code');
        const info = JSON.parse(result.body as string);
        assert.equal(info.message, 'The client is not authorized to access this resource.');
      });
    });

    describe('PATCH', () => {
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
        await http.delete(`${baseUri}/test/reset/sessions`);
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
        const basePath = RouteBuilder.space(srcSpace.key);
        const result = await http.patch(`${baseUri}${basePath}`, {
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
        const basePath = RouteBuilder.space(srcSpace.key);
        await http.patch(`${baseUri}${basePath}`, {
          body: JSON.stringify(patch),
          token: user1Token,
        });
        const result = await http.get(`${baseUri}${basePath}`, {
          token: user1Token,
        });
        
        assert.equal(result.status, 200, 'has 200 status code');
        const space = JSON.parse(result.body as string) as IWorkspace;
        assert.equal(space.info.name, 'Other name', 'has the applied patch');
      });

      it('returns 404 when no space', async () => {
        const patch: JsonPatch = [
          {
            op: 'replace',
            path: '/info/name',
            value: 'Other name',
          }
        ];
        const basePath = RouteBuilder.space('1234567890');
        const result = await http.patch(`${baseUri}${basePath}`, {
          body: JSON.stringify(patch),
          token: user1Token,
        });
        assert.equal(result.status, 404, 'has 404 status code');
        const info = JSON.parse(result.body as string);
        assert.equal(info.message, 'Not found.');
      });

      it('returns 404 when accessing a workspace without access', async () => {
        const patch: JsonPatch = [
          {
            op: 'replace',
            path: '/info/name',
            value: 'Other name',
          }
        ];
        const basePath = RouteBuilder.space(other[0].key);
        const result = await http.patch(`${baseUri}${basePath}`, {
          body: JSON.stringify(patch),
          token: user1Token,
        });
        assert.equal(result.status, 404, 'has 404 status code');
        const info = JSON.parse(result.body as string);
        assert.equal(info.message, 'Not found.');
      });

      it('returns 400 when invalid patch dta', async () => {
        const srcSpace = created[1];
        const patch = [
          {
            test: "hello"
          }
        ];
        const basePath = RouteBuilder.space(srcSpace.key);
        const result = await http.patch(`${baseUri}${basePath}`, {
          body: JSON.stringify(patch),
          token: user1Token,
        });
        assert.equal(result.status, 400, 'has 404 status code');
        const info = JSON.parse(result.body as string);
        assert.equal(info.message, 'Malformed patch information.');
      });
    });

    describe('PATCH (adding users)', () => {
      let u1spaces: IWorkspace[];
      let u2spaces: IWorkspace[];
      let user1Token: string;
      let user2Token: string;
      let user3Token: string;
      let user1Id: string;
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
        const user1Response = await http.get(`${baseUri}/users/me`, { token: user1Token });
        const user2Response = await http.get(`${baseUri}/users/me`, { token: user2Token });
        const user3Response = await http.get(`${baseUri}/users/me`, { token: user3Token });
        u1spaces = JSON.parse(rawCreated.body as string);
        u2spaces = JSON.parse(rawOther.body as string);
        user1Id = (JSON.parse(user1Response.body as string) as IUser).key;
        user2Id = (JSON.parse(user2Response.body as string) as IUser).key;
        user3Id = (JSON.parse(user3Response.body as string) as IUser).key;
      });

      after(async () => {
        await http.delete(`${baseUri}/test/reset/spaces`);
        await http.delete(`${baseUri}/test/reset/users`);
        await http.delete(`${baseUri}/test/reset/sessions`);
      });

      it('adds the user to the space', async () => {
        const { key } = u1spaces[0];
        const records: AccessOperation[] = [{
          op: 'add',
          id: user2Id,
          value: 'reader',
          type: 'user',
        }];
        const response = await http.patch(`${baseUri}/spaces/${key}/users`, {
          token: user1Token,
          body: JSON.stringify(records),
        });
        
        assert.equal(response.status, 204, 'has the 204 status code');
        const spaceResponse = await http.get(`${baseUri}/spaces/${key}`, {
          token: user2Token,
        });
        
        assert.equal(spaceResponse.status, 200, 'has the 200 status code');
        const added = JSON.parse(spaceResponse.body as string) as IWorkspace;

        const { permissions } = added;
        assert.typeOf(permissions, 'array', 'has the permissions array')
        assert.lengthOf(permissions, 1, 'has the added permission')
        const [p] = permissions;
        
        assert.equal(p.role, 'reader', 'has the set access level');
        assert.deepEqual(p.owner, user2Id, 'has the user on the workspace users');
      });

      it('returns error when has no access to the space', async () => {
        const { key } = u2spaces[0];
        const records: AccessOperation[] = [{
          op: 'add',
          id: user2Id,
          value: 'reader',
          type: 'user',
        }];
        const body = JSON.stringify(records);
        const response = await http.patch(`${baseUri}/spaces/${key}/users`, {
          token: user1Token,
          body,
        });
        assert.equal(response.status, 404, 'has the 404 status code');
        const info = JSON.parse(response.body as string);
        assert.equal(info.message, 'Not found.');
      });

      it('returns error the user does not exist', async () => {
        const { key } = u1spaces[1];
        const records: AccessOperation[] = [{
          op: 'add',
          id: user2Id,
          value: 'reader',
          type: 'user',
        }, {
          op: 'add',
          id: 'other',
          value: 'reader',
          type: 'user',
        }];
        const body = JSON.stringify(records);
        const response = await http.patch(`${baseUri}/spaces/${key}/users`, {
          token: user1Token,
          body,
        });
        assert.equal(response.status, 400, 'has the 400 status code');
        const info = JSON.parse(response.body as string);
        assert.equal(info.message, 'User "other" not found.');
      });

      it('returns error when has no access to write to the space', async () => {
        // step 1. Add read access to the user #2
        const { key } = u1spaces[1];
        const a1records: AccessOperation[] = [{
          op: 'add',
          id: user2Id,
          value: 'reader',
          type: 'user',
        }];
        const a1response = await http.patch(`${baseUri}/spaces/${key}/users`, {
          token: user1Token,
          body: JSON.stringify(a1records),
        });
        assert.equal(a1response.status, 204, 'has the 204 status code');

        // step 1. Add any access to the user #3
        const a2records: AccessOperation[] = [{
          op: 'add',
          id: user3Id,
          value: 'commenter',
          type: 'user',
        }];
        const a2response = await http.patch(`${baseUri}/spaces/${key}/users`, {
          token: user2Token,
          body: JSON.stringify(a2records),
        });
        assert.equal(a2response.status, 403, 'has the 403 status code');
        const info = JSON.parse(a2response.body as string);
        assert.equal(info.message, 'Insufficient permissions to access this resource.');
      });

      it('returns error when the space does not exist', async () => {
        const a1records: AccessOperation[] = [{
          op: 'add',
          id: user2Id,
          value: 'reader',
          type: 'user',
        }];
        const a1response = await http.patch(`${baseUri}/spaces/something/users`, {
          token: user1Token,
          body: JSON.stringify(a1records),
        });
        assert.equal(a1response.status, 404, 'has the 404 status code');
        const info = JSON.parse(a1response.body as string);
        assert.equal(info.message, 'Not found.');
      });

      it('informs space change via the web socket', async () => {
        const { key } = u1spaces[3];
        const records: AccessOperation[] = [{
          op: 'add',
          id: user2Id,
          value: 'reader',
          type: 'user',
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
        assert.equal(ev.kind, WorkspaceKind);
        assert.equal(ev.id, key);

        const patches = ev.data as JsonPatch;

        // expecting 2 patches: #1 for permissionIds and #2 for permissions

        assert.typeOf(patches, 'array', 'has the patches');
        assert.lengthOf(patches, 2, 'has both patches');

        const idsPatch = patches.find(i => i.path === '/permissionIds') as any;
        const permsPatch = patches.find(i => i.path === '/permissions') as any;

        assert.equal(idsPatch.op, 'replace', 'permissionIds patch has the operation');
        assert.lengthOf(idsPatch.value, 1, 'permissionIds patch has the value');
        
        assert.deepEqual(permsPatch, {
          op: "replace",
          path: "/permissions",
          value: [
            {
              addingUser: user1Id,
              key: idsPatch.value[0],
              kind: PermissionKind,
              owner: user2Id,
              role: "reader",
              type: "user",
            }
          ]
        });
      });

      it('informs the added user about new permission', async () => {
        const { key } = u1spaces[4];
        const records: AccessOperation[] = [{
          op: 'add',
          id: user2Id,
          value: 'reader',
          type: 'user',
        }];
        const messages: IBackendEvent[] = [];
        const wsPath = RouteBuilder.spaces();
        const client = await ws.createAndConnect(`${baseUriWs}${wsPath}`, user2Token);
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
        assert.equal(ev.kind, WorkspaceKind);
        assert.equal(ev.id, key);
      });

      it('adds the user only once', async () => {
        const { key } = u1spaces[5];

        // step 1. Add read access to the user #2
        const a1records: AccessOperation[] = [{
          op: 'add',
          id: user2Id,
          value: 'reader',
          type: 'user',
        }];
        const a1response = await http.patch(`${baseUri}/spaces/${key}/users`, {
          token: user1Token,
          body: JSON.stringify(a1records),
        });
        assert.equal(a1response.status, 204, 'has the 204 status code');

        // step 2. Add write access to the user #2
        const a2records: AccessOperation[] = [{
          op: 'add',
          id: user2Id,
          value: 'writer',
          type: 'user',
        }];
        const a2response = await http.patch(`${baseUri}/spaces/${key}/users`, {
          token: user1Token,
          body: JSON.stringify(a2records),
        });
        assert.equal(a2response.status, 204, 'has the 204 status code');
        
        // step 3. Should have write access.
        const getResponse = await http.get(`${baseUri}/spaces/${key}`, { token: user2Token });
        assert.equal(getResponse.status, 200, 'has the 200 status code');
        const body = JSON.parse(getResponse.body as string) as IWorkspace;

        const { permissions } = body;
        assert.typeOf(permissions, 'array', 'has the permissions array')
        assert.lengthOf(permissions, 1, 'has the added permission')
        const [p] = permissions;

        assert.equal(p.role, 'writer', 'has the set access level');
        assert.deepEqual(p.owner, user2Id, 'has the user on the workspace users');
      });
    });

    describe('PATCH (removing users)', () => {
      let u1spaces: IWorkspace[];
      // let u2spaces: IWorkspace[];
      let user1Token: string;
      let user2Token: string;
      let user2Id: string;

      after(async () => {
        await http.delete(`${baseUri}/test/reset/spaces`);
        await http.delete(`${baseUri}/test/reset/users`);
        await http.delete(`${baseUri}/test/reset/sessions`);
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

      async function grantSpace(spaceId: string, id: string, token?: string): Promise<void> {
        const records: AccessOperation[] = [{
          op: 'add',
          id,
          value: 'reader',
          type: 'user',
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
        const patches: AccessOperation[] = [
          {
            op: 'remove',
            id: user2Id,
            type: 'user',
          },
        ];
        const response = await http.patch(`${baseUri}/spaces/${key}/users`, {
          token: user1Token,
          body: JSON.stringify(patches),
        });
        assert.equal(response.status, 204, 'has the 204 status code');
        const getResponse = await http.get(`${baseUri}/spaces/${key}`, { token: user2Token });
        assert.equal(getResponse.status, 404, 'has the 404 status code');
      });

      it('informs about space change via the web socket', async () => {
        const { key } = u1spaces[0];
        await grantSpace(key, user2Id, user1Token);
        const ops: AccessOperation[] = [
          {
            op: 'remove',
            id: user2Id,
            type: 'user',
          },
        ];
        const messages: IBackendEvent[] = [];
        const client = await ws.createAndConnect(`${baseUriWs}/spaces/${key}`, user1Token);
        client.on('message', (data: RawData) => {
          messages.push(JSON.parse(data.toString()));
        });
        await http.patch(`${baseUri}/spaces/${key}/users`, {
          token: user1Token,
          body: JSON.stringify(ops),
        });
        await ws.disconnect(client);
        assert.lengthOf(messages, 1, 'received one event');
        const [ev] = messages;
        assert.equal(ev.type, 'event');
        assert.equal(ev.operation, 'updated');
        assert.equal(ev.kind, WorkspaceKind);
        assert.equal(ev.id, key);

        const patches = ev.data as JsonPatch;

        // expecting 2 patches: #1 for permissionIds and #2 for permissions

        assert.typeOf(patches, 'array', 'has the patches');
        assert.lengthOf(patches, 2, 'has both patches');

        const idsPatch = patches.find(i => i.path === '/permissionIds') as any;
        const permsPatch = patches.find(i => i.path === '/permissions') as any;

        assert.equal(idsPatch.op, 'replace', 'permissionIds patch has the operation');
        assert.deepEqual(idsPatch.value, [], 'permissionIds patch has the value');
        
        assert.deepEqual(permsPatch, {
          op: "replace",
          path: "/permissions",
          value: [],
        });
      });

      it('informs the removed user about updated permission', async () => {
        const { key } = u1spaces[0];
        await grantSpace(key, user2Id, user1Token);
        const records: AccessOperation[] = [
          {
            op: 'remove',
            id: user2Id,
            type: 'user',
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
        assert.equal(ev.kind, WorkspaceKind);
        assert.equal(ev.id, key);
      });
    });

    describe('DELETE', () => {
      let spaceKey: string;
      let user1Token: string;
      let user2Token: string;
      let user2Id: string;
      before(async () => {
        user1Token = await http.createUserToken(baseUri);
        user2Token = await http.createUserToken(baseUri);
        const user2Response = await http.get(`${baseUri}/users/me`, { token: user2Token });
        user2Id = (JSON.parse(user2Response.body as string) as IUser).key;
      });

      after(async () => {
        await http.delete(`${baseUri}/test/reset/spaces`);
        await http.delete(`${baseUri}/test/reset/sessions`);
      });

      beforeEach(async () => {
        const rawSpaces = await http.post(`${baseUri}/test/generate/spaces?size=1`, { token: user1Token });
        spaceKey = (JSON.parse(rawSpaces.body as string) as IWorkspace[])[0].key;
      });

      it('deletes the space', async () => {
        const basePath = RouteBuilder.space(spaceKey);
        const result = await http.delete(`${baseUri}${basePath}`, {
          token: user1Token,
        });
        assert.equal(result.status, 204, 'has the 204 status code.');
        const readResult = await http.get(`${baseUri}${basePath}`, {
          token: user1Token,
        });
        assert.equal(readResult.status, 404, 'the read has the 404 status code.');
      });

      it('deletes space projects from the cache', async () => {
        const project = HttpProject.fromName('test');
        const httpPath = RouteBuilder.spaceProjects(spaceKey);
        const createResult = await http.post(`${baseUri}${httpPath}`, {
          body: JSON.stringify(project),
          token: user1Token,
        });
        assert.equal(createResult.status, 204, 'has project create status')
        const projectUrl = `${baseUri}${createResult.headers.location}`;
        const firstRead = await http.get(projectUrl, { token: user1Token });
        assert.equal(firstRead.status, 200, 'can read the project');

        const basePath = RouteBuilder.space(spaceKey);
        const result = await http.delete(`${baseUri}${basePath}`, {
          token: user1Token,
        });
        assert.equal(result.status, 204, 'has the 204 status code.');
        const secondRead = await http.get(projectUrl, { token: user1Token });
        assert.equal(secondRead.status, 404, 'the project cannot be read.');
      });

      it('deletes the space by a shared user as owner', async () => {
        const records: AccessOperation[] = [{
          op: 'add',
          id: user2Id,
          value: 'owner',
          type: 'user',
        }];
        const body = JSON.stringify(records);
        const usersPath = RouteBuilder.spaceUsers(spaceKey);
        const response = await http.patch(`${baseUri}${usersPath}`, {
          token: user1Token,
          body,
        });
        assert.equal(response.status, 204, 'has the 204 status code');
        const basePath = RouteBuilder.space(spaceKey);
        const result = await http.delete(`${baseUri}${basePath}`, {
          token: user2Token,
        });
        assert.equal(result.status, 204, 'has the 204 status code.');
      });

      const levels: PermissionRole[] = [
        'reader',
        'commenter',
        'writer',
      ];

      levels.forEach((access) => {
        it(`does not delete the space by a shared user with ${access} access`, async () => {
          const records: AccessOperation[] = [{
            op: 'add',
            id: user2Id,
            value: access,
            type: 'user',
          }];
          const body = JSON.stringify(records);
          const usersPath = RouteBuilder.spaceUsers(spaceKey);
          const response = await http.patch(`${baseUri}${usersPath}`, {
            token: user1Token,
            body,
          });
          assert.equal(response.status, 204, 'has the 204 status code');
          const basePath = RouteBuilder.space(spaceKey);
          const result = await http.delete(`${baseUri}${basePath}`, {
            token: user2Token,
          });
          assert.equal(result.status, 403, 'has the 403 status code.');
        });
      });

      it('notifies spaces clients about the space delete', async () => {
        const messages: IBackendEvent[] = [];
        const wsPath = RouteBuilder.spaces();
        const client = await ws.createAndConnect(`${baseUriWs}${wsPath}`, user1Token);
        client.on('message', (data: RawData) => {
          messages.push(JSON.parse(data.toString()));
        });

        const path = RouteBuilder.space(spaceKey);
        await http.delete(`${baseUri}${path}`, { token: user1Token, });
        
        await ws.disconnect(client);
        assert.lengthOf(messages, 1, 'received one event');
        const [ev] = messages;
        assert.equal(ev.type, 'event');
        assert.equal(ev.operation, 'deleted');
        assert.equal(ev.kind, WorkspaceKind);
        assert.equal(ev.id, spaceKey);
      });

      it('notifies project clients about the space delete', async () => {
        const project = HttpProject.fromName('test');
        const httpPath = RouteBuilder.spaceProjects(spaceKey);
        const createResult = await http.post(`${baseUri}${httpPath}`, {
          body: JSON.stringify(project),
          token: user1Token,
        });
        assert.equal(createResult.status, 204, 'has project create status')
        const projectKey = project.key;

        const messages: IBackendEvent[] = [];
        const wsPath = RouteBuilder.spaceProject(spaceKey, projectKey);
        
        const client = await ws.createAndConnect(`${baseUriWs}${wsPath}`, user1Token);
        client.on('message', (data: RawData) => {
          messages.push(JSON.parse(data.toString()));
        });

        const path = RouteBuilder.space(spaceKey);
        await http.delete(`${baseUri}${path}`, { token: user1Token, });
        
        await ws.disconnect(client);
        assert.lengthOf(messages, 1, 'received one event');
        const [ev] = messages;
        assert.equal(ev.type, 'event');
        assert.equal(ev.operation, 'deleted');
        assert.equal(ev.kind, HttpProjectKind);
        assert.equal(ev.id, projectKey);
      });
    });

    describe('List users', () => {
      let spaces: IWorkspace[];
      let user1Token: string;
      let user2Token: string;
      let user3Token: string;
      let user4Token: string;
      let user2Id: string;
      let user3Id: string;
      let user4Id: string;

      // note: generate as many spaces as tests you perform
      // not have a "fresh" (or rather consistent) records in the data store.
      before(async () => {
        user1Token = await http.createUserToken(baseUri);
        user2Token = await http.createUserToken(baseUri);
        user3Token = await http.createUserToken(baseUri);
        user4Token = await http.createUserToken(baseUri);
        const rawCreated = await http.post(`${baseUri}/test/generate/spaces?size=3`, { token: user1Token });
        const user2Response = await http.get(`${baseUri}/users/me`, { token: user2Token });
        const user3Response = await http.get(`${baseUri}/users/me`, { token: user3Token });
        const user4Response = await http.get(`${baseUri}/users/me`, { token: user4Token });
        spaces = JSON.parse(rawCreated.body as string);
        user2Id = (JSON.parse(user2Response.body as string) as IUser).key;
        user3Id = (JSON.parse(user3Response.body as string) as IUser).key;
        user4Id = (JSON.parse(user4Response.body as string) as IUser).key;
        // add user 2 and 4 to space #1
        const space1records: AccessOperation[] = [{
          op: 'add',
          id: user2Id,
          value: 'reader',
          type: 'user',
        }, {
          op: 'add',
          id: user4Id,
          value: 'commenter',
          type: 'user',
        }];
        await http.patch(`${baseUri}/spaces/${spaces[0].key}/users`, {
          token: user1Token,
          body: JSON.stringify(space1records),
        });
        // add user 3 to space #2
        const space2records: AccessOperation[] = [{
          op: 'add',
          id: user3Id,
          value: 'writer',
          type: 'user',
        }];
        await http.patch(`${baseUri}/spaces/${spaces[1].key}/users`, {
          token: user1Token,
          body: JSON.stringify(space2records),
        });
      });

      after(async () => {
        await http.delete(`${baseUri}/test/reset/spaces`);
        await http.delete(`${baseUri}/test/reset/users`);
        await http.delete(`${baseUri}/test/reset/sessions`);
      });

      it('lists space users', async () => {
        const response = await http.get(`${baseUri}/spaces/${spaces[0].key}/users`, {
          token: user1Token,
        });
        assert.equal(response.status, 200, 'has the 200 status code');
        const list = JSON.parse(response.body as string) as IListResponse;
        assert.isUndefined(list.cursor, 'has no cursor');
        assert.typeOf(list.data, 'array', 'has the data array');
        assert.lengthOf(list.data, 2, 'has all users');
        const [u1, u2] = list.data as IUser[];
        assert.equal(u1.key, user2Id, 'has the user #1');
        assert.equal(u2.key, user4Id, 'has the user #2');
      });

      it('returns an empty list when no added users', async () => {
        const response = await http.get(`${baseUri}/spaces/${spaces[2].key}/users`, {
          token: user1Token,
        });
        assert.equal(response.status, 200, 'has the 200 status code');
        const list = JSON.parse(response.body as string) as IListResponse;
        assert.isUndefined(list.cursor, 'has no cursor');
        assert.typeOf(list.data, 'array', 'has the data array');
        assert.lengthOf(list.data, 0, 'has no users');
      });
    });
  });
});
