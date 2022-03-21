/* eslint-disable import/no-named-as-default-member */
import { assert } from 'chai';
import { HttpProject, IBackendEvent, IWorkspace, IListResponse, IHttpProjectListItem, HttpProjectListItemKind, RouteBuilder } from '@api-client/core';
import getConfig from '../helpers/getSetup.js';
import HttpHelper from '../helpers/HttpHelper.js';
import WsHelper, { RawData } from '../helpers/WsHelper.js';

describe('Multi user', () => {
  describe('/spaces/space/projects', () => {
    let baseUri: string;
    let baseUriWs: string;
    const http = new HttpHelper();
    const ws = new WsHelper();

    before(async () => {
      const cnf = await getConfig();
      baseUri = cnf.multiUserBaseUri;
      baseUriWs = cnf.multiUserWsBaseUri;
    });

    describe('POST', () => {
      let spaceKey: string;
      let user1Token: string;
      
      before(async () => {
        user1Token = await http.createUserToken(baseUri);
      });

      after(async () => {
        await http.delete(`${baseUri}/test/reset/spaces`);
        await http.delete(`${baseUri}/test/reset/users`);
        await http.delete(`${baseUri}/test/reset/sessions`);
      });

      beforeEach(async () => {
        const rawCreated = await http.post(`${baseUri}/test/generate/spaces?size=1`, { token: user1Token });
        spaceKey = (JSON.parse(rawCreated.body as string) as IWorkspace[])[0].key;
      });

      it('creates a new project', async () => {
        const project = HttpProject.fromName('test');
        const httpPath = RouteBuilder.spaceProjects(spaceKey);
        const result = await http.post(`${baseUri}${httpPath}`, {
          body: JSON.stringify(project),
          token: user1Token,
        });
        assert.equal(result.status, 204, 'has 204 status');
        assert.include(result.headers.location, `${httpPath}/`, 'has the location');
        assert.equal(result.body, '', 'has no body');
      });

      it('returns an error when invalid workspace', async () => {
        const httpPath = RouteBuilder.spaceProjects(spaceKey);
        const result = await http.post(`${baseUri}${httpPath}`, {
          body: JSON.stringify({}),
          token: user1Token,
        });
        assert.equal(result.status, 400, 'has 400 status');
        const body = result.body as string;
        const error = JSON.parse(body);
        assert.equal(error.message, 'Invalid project definition.', 'has the error message');
      });

      it('returns an error when no user token', async () => {
        const httpPath = RouteBuilder.spaceProjects(spaceKey);
        const result = await http.post(`${baseUri}${httpPath}`, {
          body: JSON.stringify({}),
        });
        assert.equal(result.status, 401, 'has 401 status');
        const body = result.body as string;
        const error = JSON.parse(body);
        assert.equal(error.message, 'The client is not authorized to access this resource.', 'has the error message');
      });

      it('returns an error when invalid user token', async () => {
        const httpPath = RouteBuilder.spaceProjects(spaceKey);
        const result = await http.post(`${baseUri}${httpPath}`, {
          body: JSON.stringify({}),
          token: 'abc',
        });
        assert.equal(result.status, 401, 'has 401 status');
        const body = result.body as string;
        const error = JSON.parse(body);
        assert.equal(error.message, 'The client is not authorized to access this resource.', 'has the error message');
      });

      it('informs clients about new project', async () => {
        const messages: IBackendEvent[] = [];
        const wsPath = RouteBuilder.space(spaceKey);
        const client = await ws.createAndConnect(`${baseUriWs}${wsPath}?token=${user1Token}`);
        client.on('message', (data: RawData) => {
          messages.push(JSON.parse(data.toString()));
        });
        const httpPath = RouteBuilder.spaceProjects(spaceKey);
        await http.post(`${baseUri}${httpPath}`, {
          body: JSON.stringify(HttpProject.fromName('test')),
          token: user1Token,
        });
        await ws.disconnect(client);
        assert.lengthOf(messages, 1, 'received one event');
        const [ev] = messages;
        
        assert.equal(ev.type, 'event');
        assert.equal(ev.operation, 'created');
        assert.equal(ev.kind, HttpProjectListItemKind);
        const item = ev.data as IHttpProjectListItem;
        assert.equal(item.name, 'test');
      });

      it('lists over created project', async () => {
        const project = HttpProject.fromName('test');
        const httpPath = RouteBuilder.spaceProjects(spaceKey);
        const createResult = await http.post(`${baseUri}${httpPath}`, {
          body: JSON.stringify(project),
          token: user1Token,
        });
        assert.equal(createResult.status, 204, 'has 204 status');
        const listPath = RouteBuilder.spaceProjects(spaceKey);
        const listResult = await http.get(`${baseUri}${listPath}`, {
          token: user1Token,
        });
        const info = JSON.parse(listResult.body as string) as IListResponse;
        
        assert.lengthOf(info.data, 1, 'has a project');
        const item = info.data[0] as IHttpProjectListItem;
        assert.equal(item.key, project.key, 'has the created project');
      });
    });

    describe('GET', () => {
      let spaceKey: string;
      let user1Token: string;
      before(async () => {
        user1Token = await http.createUserToken(baseUri);
        const rawSpaces = await http.post(`${baseUri}/test/generate/spaces?size=1`, { token: user1Token });
        spaceKey = (JSON.parse(rawSpaces.body as string)[0] as IWorkspace).key;
        await http.post(`${baseUri}/test/generate/projects/${spaceKey}?size=40`);
      });

      after(async () => {
        await http.delete(`${baseUri}/test/reset/spaces`);
        await http.delete(`${baseUri}/test/reset/projects`);
        await http.delete(`${baseUri}/test/reset/users`);
        await http.delete(`${baseUri}/test/reset/sessions`);
      });

      it('returns results and the page token', async () => {
        const httpPath = RouteBuilder.spaceProjects(spaceKey);
        const result = await http.get(`${baseUri}${httpPath}`, { token: user1Token });
        assert.equal(result.status, 200, 'has the 200 status');
        const list = JSON.parse(result.body as string) as IListResponse;
        assert.typeOf(list.cursor as string, 'string', 'has the cursor');
        assert.typeOf(list.data, 'array', 'has the data array');
        assert.lengthOf(list.data, 35, 'has the default list size');
        const item = list.data[0] as IHttpProjectListItem;
        assert.typeOf(item.name, 'string', 'has the project name');
        assert.typeOf(item.key, 'string', 'has the project key');
      });

      it('supports the limit parameter', async () => {
        const httpPath = RouteBuilder.spaceProjects(spaceKey);
        const result = await http.get(`${baseUri}${httpPath}?limit=4`, { token: user1Token });
        assert.equal(result.status, 200, 'has the 200 status');
        const list = JSON.parse(result.body as string) as IListResponse;
        assert.typeOf(list.cursor as string, 'string', 'has the cursor');
        assert.typeOf(list.data, 'array', 'has the data array');
        assert.lengthOf(list.data, 4, 'has the default list size');
      });

      it('paginates to the next page', async () => {
        const httpPath = RouteBuilder.spaceProjects(spaceKey);
        const result1 = await http.get(`${baseUri}${httpPath}?limit=2`, { token: user1Token });
        assert.equal(result1.status, 200, '(request1): has the 200 status');
        const list1 = JSON.parse(result1.body as string) as IListResponse;
        const result2 = await http.get(`${baseUri}${httpPath}?cursor=${list1.cursor}`, { token: user1Token });
        assert.equal(result2.status, 200, '(request2) has the 200 status');
        const list2 = JSON.parse(result2.body as string) as IListResponse;
        assert.lengthOf(list2.data, 2, 'uses the page cursor limit param');
        assert.notDeepEqual(list1.data[0], list2.data[0], 'arrays are not equal');
        assert.notDeepEqual(list1.data[1], list2.data[0], 'has the next element');
      });

      it('reaches the end of pagination', async () => {
        const httpPath = RouteBuilder.spaceProjects(spaceKey);
        const result1 = await http.get(`${baseUri}${httpPath}?limit=35`, { token: user1Token });
        assert.equal(result1.status, 200, 'has the 200 status');
        const list1 = JSON.parse(result1.body as string) as IListResponse;
        const result2 = await http.get(`${baseUri}${httpPath}?cursor=${list1.cursor}`, { token: user1Token });
        assert.equal(result2.status, 200, 'has the 200 status');
        const list2 = JSON.parse(result2.body as string) as IListResponse;
        assert.lengthOf(list2.data, 5, 'has only remaining entires');
      });

      it('returns an error when no user token', async () => {
        const httpPath = RouteBuilder.spaceProjects(spaceKey);
        const result = await http.get(`${baseUri}${httpPath}`);
        assert.equal(result.status, 401, 'has 401 status');
        const body = result.body as string;
        const error = JSON.parse(body);
        assert.equal(error.message, 'The client is not authorized to access this resource.', 'has the error message');
      });

      it('returns an error when invalid user token', async () => {
        const httpPath = RouteBuilder.spaceProjects(spaceKey);
        const result = await http.get(`${baseUri}${httpPath}`, { token: 'abc' });
        assert.equal(result.status, 401, 'has 401 status');
        const body = result.body as string;
        const error = JSON.parse(body);
        assert.equal(error.message, 'The client is not authorized to access this resource.', 'has the error message');
      });
    });
  });
});
