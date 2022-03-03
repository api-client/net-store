/* eslint-disable import/no-named-as-default-member */
import { assert } from 'chai';
import { IRevisionInfo, IBackendEvent, IWorkspace, IListResponse, IHttpProjectListItem, IHttpProject } from '@advanced-rest-client/core';
import ooPatch, { JsonPatch } from 'json8-patch';
import getConfig from '../helpers/getSetup.js';
import HttpHelper from '../helpers/HttpHelper.js';
import WsHelper, { RawData } from '../helpers/WsHelper.js';
import { RouteBuilder } from '../../index.js';

describe('Single user', () => {
  describe('/spaces/space/projects/project', () => {
    let baseUri: string;
    let baseUriWs: string;
    const http = new HttpHelper();
    const ws = new WsHelper();

    before(async () => {
      const cnf = await getConfig();
      baseUri = cnf.singleUserBaseUri;
      baseUriWs = cnf.singleUserWsBaseUri;
    });

    describe('GET /spaces/space/projects/project', () => {
      let spaceKey: string;
      let projectKey: string;
      let refProject: IHttpProject;
      before(async () => {
        const rawSpaces = await http.post(`${baseUri}/test/generate/spaces?size=1`);
        spaceKey = (JSON.parse(rawSpaces.body as string)[0] as IWorkspace).key;
        const rawProjects = await http.post(`${baseUri}/test/generate/projects/${spaceKey}?size=1`);
        refProject = JSON.parse(rawProjects.body as string)[0] as IHttpProject;
        projectKey = refProject.key;
      });

      after(async () => {
        await http.delete(`${baseUri}/test/reset/spaces`);
        await http.delete(`${baseUri}/test/reset/projects`);
      });

      it('reads project data', async () => {
        const path = RouteBuilder.buildSpaceProjectRoute(spaceKey, projectKey);
        const result = await http.get(`${baseUri}${path}`);
        assert.equal(result.status, 200, 'has 200 status code');
        const info = JSON.parse(result.body as string) as IHttpProject;
        assert.deepEqual(info, refProject, 'returns the project');
      });

      it('returns 404 when no space', async () => {
        const path = RouteBuilder.buildSpaceProjectRoute('abcdef', projectKey);
        const result = await http.get(`${baseUri}${path}`);
        assert.equal(result.status, 404, 'has 404 status code');
        const info = JSON.parse(result.body as string);
        assert.equal(info.message, 'Space not found.');
      });

      it('returns 404 when no project', async () => {
        const path = RouteBuilder.buildSpaceProjectRoute(spaceKey, 'abcdef');
        const result = await http.get(`${baseUri}${path}`);
        assert.equal(result.status, 404, 'has 404 status code');
        const info = JSON.parse(result.body as string);
        assert.equal(info.message, 'Not found.');
      });
    });

    describe('PATCH /spaces/space/projects/project', () => {
      let spaceKey: string;
      let projectKey: string;
      let refProject: IHttpProject;
      before(async () => {
        const rawSpaces = await http.post(`${baseUri}/test/generate/spaces?size=1`);
        spaceKey = (JSON.parse(rawSpaces.body as string)[0] as IWorkspace).key;
      });

      after(async () => {
        await http.delete(`${baseUri}/test/reset/spaces`);
        await http.delete(`${baseUri}/test/reset/projects`);
      });

      beforeEach(async () => {
        const rawProjects = await http.post(`${baseUri}/test/generate/projects/${spaceKey}?size=1`);
        refProject = JSON.parse(rawProjects.body as string)[0] as IHttpProject;
        projectKey = refProject.key;
      });

      it('patches the project', async () => {
        const patch: JsonPatch = [
          {
            op: 'replace',
            path: '/info/name',
            value: 'New name',
          }
        ];
        const path = RouteBuilder.buildSpaceProjectRoute(spaceKey, projectKey);
        const result = await http.patch(`${baseUri}${path}`, {
          body: JSON.stringify(patch),
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
        const path = RouteBuilder.buildSpaceProjectRoute(spaceKey, projectKey);
        await http.patch(`${baseUri}${path}`, {
          body: JSON.stringify(patch),
        });
        const result = await http.get(`${baseUri}${path}`);
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
        const path = RouteBuilder.buildSpaceProjectRoute('abcdef', projectKey);
        const result = await http.patch(`${baseUri}${path}`, {
          body: JSON.stringify(patch),
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
        const path = RouteBuilder.buildSpaceProjectRoute(spaceKey, 'abcdef');
        const result = await http.patch(`${baseUri}${path}`, {
          body: JSON.stringify(patch),
        });
        assert.equal(result.status, 404, 'has 404 status code');
        const info = JSON.parse(result.body as string);
        assert.equal(info.message, 'Not found.');
      });

      it('returns 400 when invalid patch', async () => {
        const path = RouteBuilder.buildSpaceProjectRoute(spaceKey, projectKey);
        const result = await http.patch(`${baseUri}${path}`, {
          body: JSON.stringify({}),
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
        const path = RouteBuilder.buildSpaceProjectRoute(spaceKey, projectKey);
        const messages: IBackendEvent[] = [];
        const client = await ws.createAndConnect(`${baseUriWs}${path}`);
        client.on('message', (data: RawData) => {
          messages.push(JSON.parse(data.toString()));
        });
        await http.patch(`${baseUri}${path}`, {
          body: JSON.stringify(patch),
        });
        await ws.disconnect(client);
        assert.lengthOf(messages, 1, 'received one event');
        const [ev] = messages;
        assert.equal(ev.type, 'event');
        assert.equal(ev.operation, 'patch');
        assert.equal(ev.kind, 'ARC#HttpProject');
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
            value: 'Changed name',
          }
        ];
        const path = RouteBuilder.buildSpaceProjectRoute(spaceKey, projectKey);
        await http.patch(`${baseUri}${path}`, {
          body: JSON.stringify(patch),
        });
        const result = await http.get(`${baseUri}/spaces/${spaceKey}/projects`);
        const list = JSON.parse(result.body as string) as IListResponse;
        // projects list is ordered by last update time.
        const item = list.data[0] as IHttpProjectListItem;
        assert.equal(item.name, 'Changed name');
      });

      it('creates a revision history', async () => {
        const patch: JsonPatch = [
          {
            op: 'replace',
            path: '/info/name',
            value: 'Changed name',
          }
        ];
        const path = RouteBuilder.buildSpaceProjectRoute(spaceKey, projectKey);
        const revPath = RouteBuilder.buildProjectRevisionsRoute(spaceKey, projectKey);
        await http.patch(`${baseUri}${path}`, {
          body: JSON.stringify(patch),
        });
        const result = await http.get(`${baseUri}${revPath}`);
        const list = JSON.parse(result.body as string) as IListResponse;
        const item = list.data[0] as IRevisionInfo;
        // the id includes the timestamp
        assert.include(item.id, `project~${projectKey}~`);
        assert.equal(item.key, projectKey);
        assert.equal(item.kind, 'ARC#HttpProject');
        assert.typeOf(item.created, 'number');
        assert.isFalse(item.deleted);
        assert.typeOf(item.patch, 'array');
        const isValid = ooPatch.valid(patch);
        assert.isTrue(isValid, 'has the valid patch')
      });

      it('creates ordered revision history', async () => {
        const patch1: JsonPatch = [
          {
            op: 'replace',
            path: '/info/name',
            value: 'Changed name',
          }
        ];
        const patch2: JsonPatch = [
          {
            op: 'add',
            path: '/info/description',
            value: 'Hello',
          }
        ];
        const path = RouteBuilder.buildSpaceProjectRoute(spaceKey, projectKey);
        const revPath = RouteBuilder.buildProjectRevisionsRoute(spaceKey, projectKey);
        await http.patch(`${baseUri}${path}`, { body: JSON.stringify(patch1) });
        await http.patch(`${baseUri}${path}`, { body: JSON.stringify(patch2) });
        const result = await http.get(`${baseUri}${revPath}`);
        const list = JSON.parse(result.body as string) as IListResponse;
        assert.lengthOf(list.data, 2, 'has 2 patches');
        const [p1, p2] = (list.data as IRevisionInfo[]);
        assert.equal(p1.patch[0][0].op, 'add', 'the last operation is listed first');
        assert.equal(p2.patch[0][0].op, 'replace', 'the first operation is listed last');
      });
    });
  });
});
