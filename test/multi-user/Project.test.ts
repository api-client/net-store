/* eslint-disable import/no-named-as-default-member */
import { assert } from 'chai';
import { 
  IRevisionInfo, IBackendEvent, IWorkspace, IListResponse, 
  IHttpProjectListItem, HttpProject, IHttpProject, AccessOperation, IUser, 
  PermissionRole, HttpProjectKind, HttpProjectListItemKind, RouteBuilder,
  Workspace,
} from '@api-client/core';
import ooPatch, { JsonPatch } from 'json8-patch';
import getConfig from '../helpers/getSetup.js';
import HttpHelper from '../helpers/HttpHelper.js';
import WsHelper, { RawData } from '../helpers/WsHelper.js';

describe('Multi user', () => {
  let baseUri: string;
  let baseUriWs: string;
  const http = new HttpHelper();
  const ws = new WsHelper();

  before(async () => {
    const cnf = await getConfig();
    baseUri = cnf.multiUserBaseUri;
    baseUriWs = cnf.multiUserWsBaseUri;
  });

  describe('/spaces/space/projects/project', () => {
    describe('GET', () => {
      let spaceKey: string;
      let projectKey: string;
      let refProject: IHttpProject;
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
        await http.delete(`${baseUri}/test/reset/projects`);
        await http.delete(`${baseUri}/test/reset/users`);
        await http.delete(`${baseUri}/test/reset/sessions`);
      });

      beforeEach(async () => {
        const rawSpaces = await http.post(`${baseUri}/test/generate/spaces?size=1`, { token: user1Token });
        spaceKey = (JSON.parse(rawSpaces.body as string)[0] as IWorkspace).key;
        const rawProjects = await http.post(`${baseUri}/test/generate/projects/${spaceKey}?size=1`, { token: user1Token });
        refProject = JSON.parse(rawProjects.body as string)[0] as IHttpProject;
        projectKey = refProject.key;
      });

      it('reads project data', async () => {
        const path = RouteBuilder.spaceProject(spaceKey, projectKey);
        const result = await http.get(`${baseUri}${path}`, { token: user1Token });
        assert.equal(result.status, 200, 'has 200 status code');
        const info = JSON.parse(result.body as string) as IHttpProject;
        assert.deepEqual(info, refProject, 'returns the project');
      });

      it('returns 404 when no space', async () => {
        const path = RouteBuilder.spaceProject('abcdef', projectKey);
        const result = await http.get(`${baseUri}${path}`, { token: user1Token });
        assert.equal(result.status, 404, 'has 404 status code');
        const info = JSON.parse(result.body as string);
        assert.equal(info.message, 'Not found.');
      });

      it('returns 404 when no project', async () => {
        const path = RouteBuilder.spaceProject(spaceKey, 'abcdef');
        const result = await http.get(`${baseUri}${path}`, { token: user1Token });
        assert.equal(result.status, 404, 'has 404 status code');
        const info = JSON.parse(result.body as string);
        assert.equal(info.message, 'Not found.');
      });

      it('returns 401 when no auth token', async () => {
        const path = RouteBuilder.spaceProject(spaceKey, projectKey);
        const result = await http.get(`${baseUri}${path}`);
        assert.equal(result.status, 401, 'has 401 status code');
        const info = JSON.parse(result.body as string);
        assert.equal(info.message, 'The client is not authorized to access this resource.');
      });

      const levels: PermissionRole[] = [
        'reader',
        'commenter',
        'writer',
        'owner',
      ];
      
      levels.forEach((access) => {
        it(`can read shared space project with ${access} level`, async () => {
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
          const path = RouteBuilder.spaceProject(spaceKey, projectKey);
          const result = await http.get(`${baseUri}${path}`, { token: user2Token });
          assert.equal(result.status, 200, 'has 200 status code');
        });
      });

      it('reads a project from a space with an implicit access', async () => {
        // add user 2 to the space
        const records: AccessOperation[] = [{
          op: 'add',
          id: user2Id,
          value: 'writer',
          type: 'user',
        }];
        const body = JSON.stringify(records);
        const usersPath = RouteBuilder.spaceUsers(spaceKey);
        const response = await http.patch(`${baseUri}${usersPath}`, {
          token: user1Token,
          body,
        });
        assert.equal(response.status, 204, 'has the 204 status code');

        // create child space in the shared space by user 1.
        const space = Workspace.fromName('child');
        const response2 = await http.post(`${baseUri}${RouteBuilder.space(spaceKey)}`, {
          token: user1Token,
          body: JSON.stringify(space),
        });
        assert.equal(response2.status, 204, 'created child space');

        // create a project in the child space by user 1
        const project = HttpProject.fromName('child');
        const response3 = await http.post(`${baseUri}${RouteBuilder.spaceProjects(space.key)}`, {
          token: user1Token,
          body: JSON.stringify(project),
        });
        assert.equal(response3.status, 204, 'created child project');
        // read the project by user 2.
        const result = await http.get(`${baseUri}${RouteBuilder.spaceProject(space.key, project.key)}`, { token: user2Token });
        assert.equal(result.status, 200, 'read the child project');
      });
    });

    describe('PATCH', () => {
      let user1Token: string;
      let spaceKey: string;
      let projectKey: string;
      let refProject: IHttpProject;
      before(async () => {
        user1Token = await http.createUserToken(baseUri);
        const rawSpaces = await http.post(`${baseUri}/test/generate/spaces?size=1`, { token: user1Token });
        spaceKey = (JSON.parse(rawSpaces.body as string)[0] as IWorkspace).key;
      });

      after(async () => {
        await http.delete(`${baseUri}/test/reset/spaces`);
        await http.delete(`${baseUri}/test/reset/users`);
        await http.delete(`${baseUri}/test/reset/sessions`);
      });

      beforeEach(async () => {
        const rawProjects = await http.post(`${baseUri}/test/generate/projects/${spaceKey}?size=1`, { token: user1Token });
        refProject = JSON.parse(rawProjects.body as string)[0] as IHttpProject;
        projectKey = refProject.key;
      });

      afterEach(async () => {
        await http.delete(`${baseUri}/test/reset/projects`);
      });

      it('patches the project', async () => {
        const patch: JsonPatch = [
          {
            op: 'replace',
            path: '/info/name',
            value: 'New name',
          }
        ];
        const path = RouteBuilder.spaceProject(spaceKey, projectKey);
        const result = await http.patch(`${baseUri}${path}`, {
          body: JSON.stringify(patch),
          token: user1Token,
        });
        assert.equal(result.status, 200, 'has 200 status code');
        const body = JSON.parse(result.body as string);
        assert.equal(body.status, 'OK', 'has the OK status');
        assert.typeOf(body.revert, 'array', 'has the revert patch');
      });

      it('persists the data', async () => {
        const patch: JsonPatch = [
          {
            op: 'replace',
            path: '/info/name',
            value: 'Other name',
          }
        ];
        const path = RouteBuilder.spaceProject(spaceKey, projectKey);
        await http.patch(`${baseUri}${path}`, {
          body: JSON.stringify(patch),
          token: user1Token,
        });
        const result = await http.get(`${baseUri}${path}`, { token: user1Token });
        assert.equal(result.status, 200, 'has 200 status code');
        const space = JSON.parse(result.body as string) as IHttpProject;
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
        const path = RouteBuilder.spaceProject('abcdef', projectKey);
        const result = await http.patch(`${baseUri}${path}`, {
          body: JSON.stringify(patch),
          token: user1Token,
        });
        assert.equal(result.status, 404, 'has 404 status code');
        const info = JSON.parse(result.body as string);
        assert.equal(info.message, 'Not found.');
      });

      it('returns 404 when no project', async () => {
        const patch: JsonPatch = [
          {
            op: 'replace',
            path: '/info/name',
            value: 'Other name',
          }
        ];
        const path = RouteBuilder.spaceProject(spaceKey, 'abcdef');
        const result = await http.patch(`${baseUri}${path}`, {
          body: JSON.stringify(patch),
          token: user1Token,
        });
        assert.equal(result.status, 404, 'has 404 status code');
        const info = JSON.parse(result.body as string);
        assert.equal(info.message, 'Not found.');
      });

      it('returns 400 when invalid patch', async () => {
        const path = RouteBuilder.spaceProject(spaceKey, projectKey);
        const result = await http.patch(`${baseUri}${path}`, {
          body: JSON.stringify({}),
          token: user1Token,
        });
        assert.equal(result.status, 400, 'has 400 status code');
        const info = JSON.parse(result.body as string);
        assert.equal(info.message, 'Invalid patch information.');
      });

      it('notifies clients about the project change', async () => {
        const patch: JsonPatch = [
          {
            op: 'replace',
            path: '/info/name',
            value: 'Other name 5',
          }
        ];
        const path = RouteBuilder.spaceProject(spaceKey, projectKey);
        const messages: IBackendEvent[] = [];
        const client = await ws.createAndConnect(`${baseUriWs}${path}`, user1Token);
        client.on('message', (data: RawData) => {
          messages.push(JSON.parse(data.toString()));
        });
        await http.patch(`${baseUri}${path}`, {
          body: JSON.stringify(patch),
          token: user1Token,
        });
        await ws.disconnect(client);
        assert.lengthOf(messages, 1, 'received one event');
        const [ev] = messages;
        assert.equal(ev.type, 'event');
        assert.equal(ev.operation, 'patch');
        assert.equal(ev.kind, HttpProjectKind);
        assert.equal(ev.id, projectKey);
        assert.deepEqual(ev.data, [
          {
            "op": "replace",
            "path": "/info/name",
            "value": 'Other name 5'
          }
        ]);
      });

      it('changes index name when changing the name', async () => {
        const patch: JsonPatch = [
          {
            op: 'replace',
            path: '/info/name',
            value: 'Changed name 6',
          }
        ];
        const path = RouteBuilder.spaceProject(spaceKey, projectKey);
        await http.patch(`${baseUri}${path}`, {
          body: JSON.stringify(patch),
          token: user1Token,
        });
        const httpPath = RouteBuilder.spaceProjects(spaceKey);
        const result = await http.get(`${baseUri}${httpPath}`, { token: user1Token });
        const list = JSON.parse(result.body as string) as IListResponse;
        
        // projects list is ordered by last update time.
        const item = list.data[0] as IHttpProjectListItem;
        assert.equal(item.name, 'Changed name 6', 'changed the name');
      });

      it('creates a revision history', async () => {
        const patch: JsonPatch = [
          {
            op: 'replace',
            path: '/info/name',
            value: 'Changed name',
          }
        ];
        const path = RouteBuilder.spaceProject(spaceKey, projectKey);
        const revPath = RouteBuilder.projectRevisions(spaceKey, projectKey);
        await http.patch(`${baseUri}${path}`, {
          body: JSON.stringify(patch),
          token: user1Token,
        });
        const result = await http.get(`${baseUri}${revPath}`, { token: user1Token });
        const list = JSON.parse(result.body as string) as IListResponse;
        const item = list.data[0] as IRevisionInfo;
        // the id includes the timestamp
        assert.include(item.id, `project~${projectKey}~`);
        assert.equal(item.key, projectKey);
        assert.equal(item.kind, HttpProjectKind);
        assert.typeOf(item.created, 'number');
        assert.isFalse(item.deleted);
        assert.typeOf(item.patch, 'array');
        // @ts-ignore
        const isValid = ooPatch.valid(patch);
        assert.isTrue(isValid, 'has the valid patch')
      });

      it('creates ordered revision history', async () => {
        const patch1: JsonPatch = [
          {
            op: 'add',
            path: '/info/description',
            value: 'Change #1',
          }
        ];
        const patch2: JsonPatch = [
          {
            op: 'replace',
            path: '/info/description',
            value: 'Change #2',
          }
        ];
        const path = RouteBuilder.spaceProject(spaceKey, projectKey);
        const revPath = RouteBuilder.projectRevisions(spaceKey, projectKey);
        await http.patch(`${baseUri}${path}`, { body: JSON.stringify(patch1), token: user1Token, });
        await http.patch(`${baseUri}${path}`, { body: JSON.stringify(patch2), token: user1Token, });
        const result = await http.get(`${baseUri}${revPath}`, { token: user1Token, });
        const list = JSON.parse(result.body as string) as IListResponse;
        assert.lengthOf(list.data, 2, 'has 2 patches');
        const [p1, p2] = (list.data as IRevisionInfo[]);
        assert.equal(p1.patch[0][0].op, 'replace', 'the last operation is listed first');
        assert.equal(p2.patch[0][0].op, 'add', 'the first operation is listed last');
      });

      it('updates project update time', async () => {
        const httpPath = RouteBuilder.spaceProjects(spaceKey);
        const r1 = await http.get(`${baseUri}${httpPath}`, { token: user1Token, });
        const listBefore = JSON.parse(r1.body as string) as IListResponse;
        const patch: JsonPatch = [
          {
            op: 'replace',
            path: '/info/name',
            value: 'X name',
          }
        ];
        const path = RouteBuilder.spaceProject(spaceKey, projectKey);
        await http.patch(`${baseUri}${path}`, {
          body: JSON.stringify(patch),
          token: user1Token,
        });
        const r2 = await http.get(`${baseUri}${httpPath}`, { token: user1Token, });
        const listAfter = JSON.parse(r2.body as string) as IListResponse;
        // projects list is ordered by last update time.
        const itemBefore = listBefore.data[0] as IHttpProjectListItem;
        const itemAfter = listAfter.data[0] as IHttpProjectListItem;
        assert.isAbove(itemAfter.updated, itemBefore.updated);
      });
    });

    describe('DELETE', () => {
      let spaceKey: string;
      let projectKey: string;
      let refProject: IHttpProject;
      let user1Token: string;

      before(async () => {
        user1Token = await http.createUserToken(baseUri);
      });

      after(async () => {
        await http.delete(`${baseUri}/test/reset/spaces`);
        await http.delete(`${baseUri}/test/reset/projects`);
        await http.delete(`${baseUri}/test/reset/bin`);
        await http.delete(`${baseUri}/test/reset/users`);
        await http.delete(`${baseUri}/test/reset/sessions`);
      });

      beforeEach(async () => {
        const rawSpaces = await http.post(`${baseUri}/test/generate/spaces?size=1`, { token: user1Token, });
        spaceKey = (JSON.parse(rawSpaces.body as string)[0] as IWorkspace).key;
        const rawProjects = await http.post(`${baseUri}/test/generate/projects/${spaceKey}?size=1`, { token: user1Token, });
        refProject = JSON.parse(rawProjects.body as string)[0] as IHttpProject;
        projectKey = refProject.key;
      });

      it('returns the 204 status code', async () => {
        const path = RouteBuilder.spaceProject(spaceKey, projectKey);
        const result = await http.delete(`${baseUri}${path}`, { token: user1Token, });
        assert.equal(result.status, 204);
      });

      it('cannot iterate the project', async () => {
        const path = RouteBuilder.spaceProject(spaceKey, projectKey);
        await http.delete(`${baseUri}${path}`, { token: user1Token, });

        const readPath = RouteBuilder.spaceProjects(spaceKey);
        const readResult = await http.get(`${baseUri}${readPath}`, { token: user1Token, });
        const list = JSON.parse(readResult.body as string) as IListResponse;
        assert.lengthOf(list.data, 0);
      });

      it('cannot read the project', async () => {
        const path = RouteBuilder.spaceProject(spaceKey, projectKey);
        await http.delete(`${baseUri}${path}`, { token: user1Token });
        const readResult = await http.get(`${baseUri}${path}`, { token: user1Token, });
        assert.equal(readResult.status, 404);
      });

      it('notifies space clients about the project delete', async () => {
        const messages: IBackendEvent[] = [];
        const wsPath = RouteBuilder.space(spaceKey);
        const client = await ws.createAndConnect(`${baseUriWs}${wsPath}`, user1Token);
        client.on('message', (data: RawData) => {
          messages.push(JSON.parse(data.toString()));
        });

        const path = RouteBuilder.spaceProject(spaceKey, projectKey);
        await http.delete(`${baseUri}${path}`, { token: user1Token, });
        
        await ws.disconnect(client);
        assert.lengthOf(messages, 1, 'received one event');
        const [ev] = messages;
        assert.equal(ev.type, 'event');
        assert.equal(ev.operation, 'deleted');
        assert.equal(ev.kind, HttpProjectListItemKind);
        assert.equal(ev.id, projectKey);
      });

      it('notifies project clients about the project delete', async () => {
        const messages: IBackendEvent[] = [];
        const wsPath = RouteBuilder.spaceProject(spaceKey, projectKey);
        const client = await ws.createAndConnect(`${baseUriWs}${wsPath}`, user1Token);
        client.on('message', (data: RawData) => {
          messages.push(JSON.parse(data.toString()));
        });

        const path = RouteBuilder.spaceProject(spaceKey, projectKey);
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
  });

  describe('/spaces/space/projects/project/revisions', () => {
    describe('GET', () => {
      let spaceKey: string;
      let user1Token: string;
      let projectKey: string;
      let refProject: IHttpProject;

      before(async () => {
        user1Token = await http.createUserToken(baseUri);
      });

      after(async () => {
        await http.delete(`${baseUri}/test/reset/spaces`);
        await http.delete(`${baseUri}/test/reset/projects`);
        await http.delete(`${baseUri}/test/reset/revisions`);
        await http.delete(`${baseUri}/test/reset/users`);
        await http.delete(`${baseUri}/test/reset/sessions`);
      });

      beforeEach(async () => {
        const rawSpaces = await http.post(`${baseUri}/test/generate/spaces?size=1`, { token: user1Token, });
        spaceKey = (JSON.parse(rawSpaces.body as string)[0] as IWorkspace).key;
        const rawProjects = await http.post(`${baseUri}/test/generate/projects/${spaceKey}?size=1`, { token: user1Token, });
        refProject = JSON.parse(rawProjects.body as string)[0] as IHttpProject;
        projectKey = refProject.key;
        await http.post(`${baseUri}/test/generate/revisions/pr/${projectKey}?size=40`, { token: user1Token, });
      });

      it('returns results and the page token', async () => {
        const httpPath = RouteBuilder.projectRevisions(spaceKey, projectKey);
        const result = await http.get(`${baseUri}${httpPath}`, { token: user1Token, });
        assert.equal(result.status, 200, 'has the 200 status');
        const list = JSON.parse(result.body as string) as IListResponse;
        assert.typeOf(list.cursor as string, 'string', 'has the cursor');
        assert.typeOf(list.data, 'array', 'has the data array');
        assert.lengthOf(list.data, 35, 'has the default list size');
      });

      it('supports the limit parameter', async () => {
        const httpPath = RouteBuilder.projectRevisions(spaceKey, projectKey);
        const result = await http.get(`${baseUri}${httpPath}?limit=4`, { token: user1Token, });
        assert.equal(result.status, 200, 'has the 200 status');
        const list = JSON.parse(result.body as string) as IListResponse;
        assert.typeOf(list.cursor as string, 'string', 'has the cursor');
        assert.typeOf(list.data, 'array', 'has the data array');
        assert.lengthOf(list.data, 4, 'has the default list size');
      });

      it('paginates to the next page', async () => {
        const httpPath = RouteBuilder.projectRevisions(spaceKey, projectKey);
        const result1 = await http.get(`${baseUri}${httpPath}?limit=2`, { token: user1Token, });
        assert.equal(result1.status, 200, '(request1): has the 200 status');
        const list1 = JSON.parse(result1.body as string) as IListResponse;
        const result2 = await http.get(`${baseUri}${httpPath}?cursor=${list1.cursor}`, { token: user1Token, });
        assert.equal(result2.status, 200, '(request2) has the 200 status');
        const list2 = JSON.parse(result2.body as string) as IListResponse;
        assert.lengthOf(list2.data, 2, 'uses the page cursor limit param');
        assert.notDeepEqual(list1.data[0], list2.data[0], 'arrays are not equal');
        assert.notDeepEqual(list1.data[1], list2.data[0], 'has the next element');
      });

      it('reaches the end of pagination', async () => {
        const httpPath = RouteBuilder.projectRevisions(spaceKey, projectKey);
        const result1 = await http.get(`${baseUri}${httpPath}?limit=35`, { token: user1Token, });
        assert.equal(result1.status, 200, 'has the 200 status');
        const list1 = JSON.parse(result1.body as string) as IListResponse;
        const result2 = await http.get(`${baseUri}${httpPath}?cursor=${list1.cursor}`, { token: user1Token, });
        assert.equal(result2.status, 200, 'has the 200 status');
        const list2 = JSON.parse(result2.body as string) as IListResponse;
        assert.lengthOf(list2.data, 5, 'has only remaining entires');
      });
    });
  });
});
