/* eslint-disable import/no-named-as-default-member */
import { assert } from 'chai';
import { 
  Workspace, IWorkspace, WorkspaceKind, IBackendEvent, RouteBuilder, AccessOperation, 
  StoreSdk, HttpProject, IHttpProject, ProjectKind, ICapabilities, IAccessPatchInfo, Project, DataNamespace, DataFile, DataFileKind, IDataNamespace,
} from '@api-client/core';
import getConfig from '../helpers/getSetup.js';
import HttpHelper from '../helpers/HttpHelper.js';
import WsHelper, { RawData } from '../helpers/WsHelper.js';

describe('http', () => {
  describe('/files', () => {
    let baseUri: string;
    let baseUriWs: string;
    let sdk: StoreSdk;
    const http = new HttpHelper();
    const ws = new WsHelper();

    describe('Multi-user', () => {
      before(async () => {
        const cnf = await getConfig();
        baseUri = cnf.multiUserBaseUri;
        baseUriWs = cnf.multiUserWsBaseUri;
        sdk = new StoreSdk(cnf.multiUserBaseUri);
        sdk.silent = true;
      });

      describe('POST', () => {
        let user1Token: string;
        before(async () => {
          user1Token = await http.createUserToken(baseUri);
          sdk.token = user1Token;
        });

        after(async () => {
          await http.delete(`${baseUri}/test/reset/files`);
          await http.delete(`${baseUri}/test/reset/users`);
          await http.delete(`${baseUri}/test/reset/sessions`);
          await http.delete(`${baseUri}/test/reset/revisions`);
        });

        it('creates a space file and contents', async () => {
          const space = Workspace.fromName('test');
          const id = await sdk.file.createMeta(space.toJSON());
          assert.typeOf(id, 'string');

          const meta = await sdk.file.read(id, false);
          assert.ok(meta, 'reads the created file meta');
          assert.equal(meta.key, space.key, 'has the file meta');
          assert.equal(meta.kind, space.kind, 'has the meta file kind');
        });

        it('creates a project file and contents', async () => {
          const project = HttpProject.fromName('p1');
          const file = Project.fromProject(project).toJSON();
          const id = await sdk.file.create(file, project.toJSON());
          assert.typeOf(id, 'string');

          const meta = await sdk.file.read(id, false);
          assert.ok(meta, 'reads the created file meta');
          assert.equal(meta.key, project.key, 'has the file meta');
          assert.equal(meta.kind, ProjectKind, 'has the meta file kind');

          const contents = await sdk.file.read(id, true) as IHttpProject;
          assert.ok(meta, 'reads the created file contents');
          assert.equal(contents.key, project.key, 'has the file contents');
          assert.equal(contents.kind, project.kind, 'has the contents file kind');
        });

        it('creates a DataNamespace file and contents', async () => {
          const media = DataNamespace.fromName('p1');
          const file = DataFile.fromDataNamespace(media).toJSON();
          const id = await sdk.file.create(file, media.toJSON());
          assert.typeOf(id, 'string');

          const meta = await sdk.file.read(id, false);
          assert.ok(meta, 'reads the created file meta');
          assert.equal(meta.key, media.key, 'has the file meta');
          assert.equal(meta.kind, DataFileKind, 'has the meta file kind');

          const contents = await sdk.file.read(id, true) as IDataNamespace;
          assert.ok(meta, 'reads the created file contents');
          assert.equal(contents.key, media.key, 'has the file contents');
          assert.equal(contents.kind, media.kind, 'has the contents file kind');
        });

        it('returns an error when no content-type', async () => {
          const result = await http.post(`${baseUri}${RouteBuilder.files()}`, {
            token: user1Token,
            body: JSON.stringify({}),
          });
          assert.equal(result.status, 400, 'has 400 status');
          const body = result.body as string;
          const error = JSON.parse(body);
          assert.equal(error.message, 'The media content-type header is missing.', 'has the error message');
        });

        it('returns an error when invalid file meta', async () => {
          const result = await http.post(`${baseUri}${RouteBuilder.files()}`, {
            token: user1Token,
            body: JSON.stringify({}),
            headers: {
              'content-type': 'application/json',
            }
          });
          assert.equal(result.status, 400, 'has 400 status');
          const body = result.body as string;
          const error = JSON.parse(body);
          assert.equal(error.message, 'Invalid file meta definition. Missing "kind" property.', 'has the error message');
        });

        it('returns an error when invalid mime type for a meta file', async () => {
          const result = await http.post(`${baseUri}${RouteBuilder.files()}`, {
            token: user1Token,
            body: JSON.stringify({}),
            headers: {
              'content-type': 'other',
            }
          });
          assert.equal(result.status, 400, 'has 400 status');
          const body = result.body as string;
          const error = JSON.parse(body);
          assert.equal(error.message, 'Expected application/json mime type for a file meta but got other.', 'has the error message');
        });

        it('informs clients about the new file', async () => {
          const messages: IBackendEvent[] = [];
          const client = await ws.createAndConnect(`${baseUriWs}${RouteBuilder.files()}`, user1Token);
          client.on('message', (data: RawData) => {
            messages.push(JSON.parse(data.toString()));
          });
          await http.post(`${baseUri}${RouteBuilder.files()}`, {
            token: user1Token,
            body: JSON.stringify(Workspace.fromName('test')),
            headers: {
              'content-type': 'application/json',
            }
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

      describe('GET', () => {
        let user1Token: string;
        before(async () => {
          user1Token = await http.createUserToken(baseUri);
          sdk.token = user1Token;
          await http.post(`${baseUri}/test/generate/spaces?size=40`, {
            token: user1Token,
          });
          await http.post(`${baseUri}/test/generate/spaces?size=5&owner=123er`);
        });

        after(async () => {
          await http.delete(`${baseUri}/test/reset/files`);
          await http.delete(`${baseUri}/test/reset/users`);
          await http.delete(`${baseUri}/test/reset/sessions`);
        });

        it('returns results and the page token', async () => {
          const list = await sdk.file.list([WorkspaceKind]);
          assert.typeOf(list.cursor as string, 'string', 'has the cursor');
          assert.typeOf(list.items, 'array', 'has the items array');
          assert.lengthOf(list.items, 35, 'has the default list size');
          const item = list.items[0] as IWorkspace;
          assert.equal(item.kind, WorkspaceKind, 'has the space object');
          assert.typeOf(item.owner, 'string', 'has an owner');
          assert.notEqual(item.owner, 'default', 'has other than the default owner');
        });

        it('supports the limit parameter', async () => {
          const list = await sdk.file.list([WorkspaceKind], { limit: 4 });
          assert.typeOf(list.cursor as string, 'string', 'has the cursor');
          assert.typeOf(list.items, 'array', 'has the items array');
          assert.lengthOf(list.items, 4, 'has the default list size');
        });

        it('paginates to the next page', async () => {
          const list1 = await sdk.file.list([WorkspaceKind], { limit: 2 });
          const list2 = await sdk.file.list([WorkspaceKind], { cursor: list1.cursor });
          assert.lengthOf(list2.items, 2, 'uses the page cursor limit param');
          assert.notDeepEqual(list1.items[0], list2.items[0], 'arrays are not equal');
          assert.notDeepEqual(list1.items[1], list2.items[0], 'has the next element');
        });

        it('reaches the end of pagination', async () => {
          const list1 = await sdk.file.list([WorkspaceKind], { limit: 35 });
          const list2 = await sdk.file.list([WorkspaceKind], { cursor: list1.cursor });
          assert.lengthOf(list2.items, 5, 'has only remaining entires');
        });
      });

      describe('Spaces tree', () => {
        let user1Token: string;
        let user2Token: string;
        let user1Id: string;
        let user2Id: string;
        let parentSpace: string;
        before(async () => {
          user1Token = await http.createUserToken(baseUri);
          user2Token = await http.createUserToken(baseUri);
          const user1 = await sdk.user.me({ token: user1Token });
          const user2 = await sdk.user.me({ token: user2Token });
          user1Id = user1.key;
          user2Id = user2.key;
        });

        after(async () => {
          await http.delete(`${baseUri}/test/reset/users`);
          await http.delete(`${baseUri}/test/reset/sessions`);
        });

        beforeEach(async () => {
          const space = Workspace.fromName('parent');
          await sdk.file.createMeta(space.toJSON(), {},  { token: user1Token });
          parentSpace = space.key;
        });

        afterEach(async () => {
          await http.delete(`${baseUri}/test/reset/files`);
        });

        it('creates a sub space', async () => {
          const srcSpace = Workspace.fromName('child');
          await sdk.file.createMeta(srcSpace.toJSON(), { parent: parentSpace },  { token: user1Token });
          
          const read = await sdk.file.read(srcSpace.key, false, { token: user1Token }) as IWorkspace;
          assert.equal(read.owner, user1Id, 'sets the owner');
          assert.deepEqual(read.parents, [parentSpace], 'sets the parents');
          assert.deepEqual(read.permissionIds, [], 'sets the empty permissionIds');
          assert.deepEqual(read.permissions, [], 'sets the empty permissions');
        });

        it('creates a deep tree', async () => {
          const s1 = Workspace.fromName('s1');
          const s2 = Workspace.fromName('s2');
          const s3 = Workspace.fromName('s2');
          const s4 = Workspace.fromName('s4');
          await sdk.file.createMeta(s1.toJSON(), { parent: parentSpace }, { token: user1Token });
          await sdk.file.createMeta(s2.toJSON(), { parent: s1.key }, { token: user1Token });
          await sdk.file.createMeta(s3.toJSON(), { parent: s2.key }, { token: user1Token });
          await sdk.file.createMeta(s4.toJSON(), { parent: s3.key }, { token: user1Token });

          const read = await sdk.file.read(s4.key, false, { token: user1Token }) as IWorkspace;
          assert.equal(read.owner, user1Id, 'sets the owner');
          assert.deepEqual(read.parents, [parentSpace, s1.key, s2.key, s3.key], 'sets the parents');
        });

        it('lists only for root spaces without a parent', async () => {
          const s1 = Workspace.fromName('s1');
          const s2 = Workspace.fromName('s2');
          const s3 = Workspace.fromName('s2');
          const s4 = Workspace.fromName('s4');
          await sdk.file.createMeta(s1.toJSON(), { parent: parentSpace }, { token: user1Token });
          await sdk.file.createMeta(s2.toJSON(), { parent: parentSpace }, { token: user1Token });
          await sdk.file.createMeta(s3.toJSON(), { parent: s1.key }, { token: user1Token });
          await sdk.file.createMeta(s4.toJSON(), { parent: s1.key }, { token: user1Token });

          const list = await sdk.file.list([WorkspaceKind], {}, { token: user1Token });
          assert.typeOf(list.cursor as string, 'string', 'has the cursor');
          assert.typeOf(list.items, 'array', 'has the items array');
          assert.lengthOf(list.items, 1, 'has all spaces');
          assert.equal(list.items[0].key, parentSpace);
        });

        it('lists only spaces of a parent', async () => {
          const s1 = Workspace.fromName('s1');
          const s2 = Workspace.fromName('s2');
          const s3 = Workspace.fromName('s2');
          const s4 = Workspace.fromName('s4');
          await sdk.file.createMeta(s1.toJSON(), { parent: parentSpace }, { token: user1Token });
          await sdk.file.createMeta(s2.toJSON(), { parent: parentSpace }, { token: user1Token });
          await sdk.file.createMeta(s3.toJSON(), { parent: s1.key }, { token: user1Token });
          await sdk.file.createMeta(s4.toJSON(), { parent: s1.key }, { token: user1Token });

          const list = await sdk.file.list([WorkspaceKind], { parent: parentSpace }, { token: user1Token });
          assert.typeOf(list.cursor as string, 'string', 'has the cursor');
          assert.typeOf(list.items, 'array', 'has the items array');
          assert.lengthOf(list.items, 2, 'has all spaces');
          const readIds = [list.items[0].key, list.items[1].key];
          assert.include(readIds, s1.key);
          assert.include(readIds, s2.key);
        });

        it('lists only spaces of a deep parent', async () => {
          const s1 = Workspace.fromName('s1');
          const s2 = Workspace.fromName('s2');
          const s3 = Workspace.fromName('s2');
          const s4 = Workspace.fromName('s4');
          await sdk.file.createMeta(s1.toJSON(), { parent: parentSpace }, { token: user1Token });
          await sdk.file.createMeta(s2.toJSON(), { parent: parentSpace }, { token: user1Token });
          await sdk.file.createMeta(s3.toJSON(), { parent: s1.key }, { token: user1Token });
          await sdk.file.createMeta(s4.toJSON(), { parent: s1.key }, { token: user1Token });

          const list = await sdk.file.list([WorkspaceKind], { parent: s1.key }, { token: user1Token });
          assert.typeOf(list.cursor as string, 'string', 'has the cursor');
          assert.typeOf(list.items, 'array', 'has the items array');
          assert.lengthOf(list.items, 2, 'has all spaces');
          const readIds = [list.items[0].key, list.items[1].key];
          assert.include(readIds, s3.key);
          assert.include(readIds, s4.key);
        });

        it('does not list shared spaces from the root level', async () => {
          const s1 = Workspace.fromName('s1');
          const s2 = Workspace.fromName('s2');
          const s3 = Workspace.fromName('s2');
          const s4 = Workspace.fromName('s4');
          await sdk.file.createMeta(s1.toJSON(), { parent: parentSpace }, { token: user1Token });
          await sdk.file.createMeta(s2.toJSON(), { parent: parentSpace }, { token: user1Token });
          await sdk.file.createMeta(s3.toJSON(), { parent: s1.key }, { token: user1Token });
          await sdk.file.createMeta(s4.toJSON(), { parent: s1.key }, { token: user1Token });
          
          const records: AccessOperation[] = [{
            op: 'add',
            id: user2Id,
            value: 'reader',
            type: 'user',
          }];
          const info: IAccessPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch: records,
          };
          await sdk.file.patchUsers(parentSpace, info, { token: user1Token });
          
          const list = await sdk.file.list([WorkspaceKind], {}, { token: user2Token });
          assert.lengthOf(list.items, 0, 'has no root space');
        });
      });

      describe('bulk read', () => {
        let user1Token: string;
        let generated: IWorkspace[];
        let other: IWorkspace[];

        before(async () => {
          user1Token = await http.createUserToken(baseUri);
          sdk.token = user1Token;
          const ownResult = await http.post(`${baseUri}/test/generate/spaces?size=4`, {
            token: user1Token,
          });
          generated = JSON.parse(ownResult.body as string) as IWorkspace[];

          const otherResult = await http.post(`${baseUri}/test/generate/spaces?size=2&owner=123er`);
          other = JSON.parse(otherResult.body as string) as IWorkspace[];
        });

        after(async () => {
          await http.delete(`${baseUri}/test/reset/files`);
          await http.delete(`${baseUri}/test/reset/users`);
          await http.delete(`${baseUri}/test/reset/sessions`);
        });

        it('reads all requested files in order', async () => {
          const [f1, f2, f3, f4] = generated;
          const ids = [f2.key, f1.key, f4.key, f3.key];
          const result = await sdk.file.readBulk(ids);
          assert.typeOf(result.items, 'array', 'has the items');
          assert.lengthOf(result.items, 4, 'has all files');
          const [r1, r2, r3, r4] = result.items;
          assert.equal(r1!.key, f2.key);
          assert.equal(r2!.key, f1.key);
          assert.equal(r3!.key, f4.key);
          assert.equal(r4!.key, f3.key);
        });

        it('returns undefined for unknown files', async () => {
          const [, f2, f3] = generated;
          const ids = [f2.key, 'f1', 'f4', f3.key];
          const result = await sdk.file.readBulk(ids);
          assert.typeOf(result.items, 'array', 'has the items');
          assert.lengthOf(result.items, 4, 'has all files');
          const [r1, r2, r3, r4] = result.items;
          assert.equal(r1!.key, f2.key);
          assert.notOk(r2);
          assert.notOk(r3);
          assert.equal(r4!.key, f3.key);
        });

        it('returns undefined for files without access', async () => {
          const [, f2, f3] = generated;
          const [f1, f4] = other;
          const ids = [f2.key, f1.key, f4.key, f3.key];
          const result = await sdk.file.readBulk(ids);
          assert.typeOf(result.items, 'array', 'has the items');
          assert.lengthOf(result.items, 4, 'has all files');
          const [r1, r2, r3, r4] = result.items;
          assert.equal(r1!.key, f2.key);
          assert.notOk(r2);
          assert.notOk(r3);
          assert.equal(r4!.key, f3.key);
        });

        it('inserts file capabilities', async () => {
          const [f1] = generated;
          const ids = [f1.key];
          const result = await sdk.file.readBulk(ids);
          const [file] = result.items;
          const c = file!.capabilities as ICapabilities;
          assert.typeOf(c, 'object', 'has capabilities');
          assert.isTrue(c.canEdit);
        });
      });
    });

    describe('Single-user', () => {
      before(async () => {
        const cnf = await getConfig();
        baseUri = cnf.singleUserBaseUri;
        sdk = new StoreSdk(cnf.singleUserBaseUri);
      });
  
      describe('POST', () => {
        let user1Token: string;
        before(async () => {
          user1Token = await http.createUserToken(baseUri);
          sdk.token = user1Token;
        });
  
        after(async () => {
          await http.delete(`${baseUri}/test/reset/files`);
          await http.delete(`${baseUri}/test/reset/sessions`);
        });

        it('creates a space file and contents', async () => {
          const space = Workspace.fromName('test');
          const id = await sdk.file.createMeta(space.toJSON());
          assert.typeOf(id, 'string');

          const meta = await sdk.file.read(id, false);
          assert.ok(meta, 'reads the created file meta');
          assert.equal(meta.key, space.key, 'has the file meta');
          assert.equal(meta.kind, space.kind, 'has the meta file kind');
        });

        it('creates a project file and contents', async () => {
          const project = HttpProject.fromName('p1');
          const file = Project.fromProject(project).toJSON();
          const id = await sdk.file.create(file, project.toJSON());
          assert.typeOf(id, 'string');

          const meta = await sdk.file.read(id, false);
          assert.ok(meta, 'reads the created file meta');
          assert.equal(meta.key, project.key, 'has the file meta');
          assert.equal(meta.kind, ProjectKind, 'has the meta file kind');

          const contents = await sdk.file.read(id, true) as IHttpProject;
          assert.ok(meta, 'reads the created file contents');
          assert.equal(contents.key, project.key, 'has the file contents');
          assert.equal(contents.kind, project.kind, 'has the contents file kind');
        });

        it('creates a DataNamespace file and contents', async () => {
          const media = DataNamespace.fromName('p1');
          const file = DataFile.fromDataNamespace(media).toJSON();
          const id = await sdk.file.create(file, media.toJSON());
          assert.typeOf(id, 'string');

          const meta = await sdk.file.read(id, false);
          assert.ok(meta, 'reads the created file meta');
          assert.equal(meta.key, media.key, 'has the file meta');
          assert.equal(meta.kind, DataFileKind, 'has the meta file kind');

          const contents = await sdk.file.read(id, true) as IDataNamespace;
          assert.ok(meta, 'reads the created file contents');
          assert.equal(contents.key, media.key, 'has the file contents');
          assert.equal(contents.kind, media.kind, 'has the contents file kind');
        });
  
        it('returns an error when invalid workspace', async () => {
          const result = await http.post(`${baseUri}${RouteBuilder.files()}`, {
            body: JSON.stringify({}),
            token: user1Token,
            headers: {
              'content-type': 'application/json',
            }
          });
          assert.equal(result.status, 400, 'has 400 status');
          const body = result.body as string;
          const error = JSON.parse(body);
          assert.equal(error.message, 'Invalid file meta definition. Missing "kind" property.', 'has the error message');
        });
  
        it('adds the default user as the owner', async () => {
          const space = Workspace.fromName('test');
          const id = await sdk.file.createMeta(space.toJSON());
          const read = await sdk.file.read(id, false);
          assert.equal(read.owner, 'default');
        });
      });
  
      describe('GET', () => {
        let user1Token: string;
        before(async () => {
          user1Token = await http.createUserToken(baseUri);
          await http.post(`${baseUri}/test/generate/spaces?size=40`, { token: user1Token });
          sdk.token = user1Token;
        });
  
        after(async () => {
          await http.delete(`${baseUri}/test/reset/files`, { token: user1Token });
          await http.delete(`${baseUri}/test/reset/sessions`);
        });
  
        it('returns results and the page token', async () => {
          const list = await sdk.file.list([WorkspaceKind]);
          assert.typeOf(list.cursor as string, 'string', 'has the cursor');
          assert.typeOf(list.items, 'array', 'has the items array');
          assert.lengthOf(list.items, 35, 'has the default list size');
          const item = list.items[0] as IWorkspace;
          assert.equal(item.kind, WorkspaceKind, 'has the space object');
          assert.equal(item.owner, 'default', 'has the default owner');
        });
  
        it('supports the limit parameter', async () => {
          const list = await sdk.file.list([WorkspaceKind], { limit: 4 });
          assert.typeOf(list.cursor as string, 'string', 'has the cursor');
          assert.typeOf(list.items, 'array', 'has the items array');
          assert.lengthOf(list.items, 4, 'has the default list size');
          const item = list.items[0] as IWorkspace;
          assert.equal(item.kind, WorkspaceKind, 'has the space object');
          assert.equal(item.owner, 'default', 'has the default owner');
        });
  
        it('paginates to the next page', async () => {
          const list1 = await sdk.file.list([WorkspaceKind], { limit: 2 });
          const list2 = await sdk.file.list([WorkspaceKind], { cursor: list1.cursor });
          assert.lengthOf(list2.items, 2, 'uses the page cursor limit param');
          assert.notDeepEqual(list1.items[0], list2.items[0], 'arrays are not equal');
          assert.notDeepEqual(list1.items[1], list2.items[0], 'has the next element');
        });
  
        it('reaches the end of pagination', async () => {
          const list1 = await sdk.file.list([WorkspaceKind], { limit: 35 });
          const list2 = await sdk.file.list([WorkspaceKind], { cursor: list1.cursor });
          assert.lengthOf(list2.items, 5, 'has only remaining entires');
        });
      });
    });
  });
});
