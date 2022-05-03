/* eslint-disable import/no-named-as-default-member */
import { assert } from 'chai';
import { 
  IWorkspace, IUser, AccessOperation, 
  HttpProject, HttpProjectKind, WorkspaceKind, RouteBuilder, StoreSdk,
  Workspace, ProjectKind, IHttpProject, ApiError, IPatchInfo, IAccessPatchInfo, Project, DataFile, DataNamespace,
} from '@api-client/core';
import { JsonPatch } from '@api-client/json';
import getConfig from '../helpers/getSetup.js';
import HttpHelper from '../helpers/HttpHelper.js';

describe('http', () => {
  describe('/files/file', () => {
    let baseUri: string;
    const http = new HttpHelper();

    describe('Multi-user', () => {
      let sdk: StoreSdk;

      before(async () => {
        const cnf = await getConfig();
        baseUri = cnf.multiUserBaseUri;
        sdk = new StoreSdk(cnf.multiUserBaseUri);
        sdk.silent = true;
      });

      describe('GET', () => {
        before(async () => {
          sdk.token = await http.createUserToken(baseUri);
        });

        after(async () => {
          await http.delete(`${baseUri}/test/reset/files`);
          await http.delete(`${baseUri}/test/reset/users`);
          await http.delete(`${baseUri}/test/reset/sessions`);
        });

        it('reads a space meta', async () => {
          const space = Workspace.fromName('test');
          const id = await sdk.file.createMeta(space.toJSON());
          const result = await sdk.file.read(id, false);
          assert.equal(result.key, id);
          assert.equal(result.kind, WorkspaceKind);
        });

        it('reads a project meta', async () => {
          const hp = HttpProject.fromName('p1');
          const pf1 = Project.fromProject(hp).toJSON();
          const id = await sdk.file.create(pf1, hp.toJSON());
          const result = await sdk.file.read(id, false);
          assert.equal(result.key, id);
          assert.equal(result.kind, ProjectKind);
        });

        it('reads a project content', async () => {
          const hp = HttpProject.fromName('p1');
          const pf1 = Project.fromProject(hp).toJSON();
          const id = await sdk.file.create(pf1, hp.toJSON());
          const result = await sdk.file.read(id, true) as IHttpProject;
          assert.equal(result.key, id);
          assert.equal(result.kind, HttpProjectKind);
        });

        it('returns 404 when no file', async () => {
          try {
            await sdk.file.read('1234567890', false);
          } catch (cause) {
            const e = cause as ApiError;
            assert.equal(e.code, 404, 'has 404 status code')
            assert.equal(e.message, 'Not found.');
            return;
          }
          throw new Error(`File is accessible`);
        });

        it('returns 401 when invalid credentials', async () => {
          const space = Workspace.fromName('test');
          const id = await sdk.file.createMeta(space.toJSON());
          try {
            await sdk.file.read(id, false, { token: 'test' });
          } catch (cause) {
            const e = cause as ApiError;
            assert.equal(e.code, 401, 'has 401 status code')
            assert.equal(e.message, 'The client is not authorized to access this resource.');
            return;
          }
          throw new Error(`File is accessible`);
        });
      });

      describe('PATCH', () => {
        before(async () => {
          sdk.token = await http.createUserToken(baseUri);
        });

        after(async () => {
          await http.delete(`${baseUri}/test/reset/files`);
          await http.delete(`${baseUri}/test/reset/users`);
          await http.delete(`${baseUri}/test/reset/sessions`);
        });

        it('patches a file meta (workspace)', async () => {
          const space = Workspace.fromName('test');
          const id = await sdk.file.createMeta(space.toJSON());
          const patch: JsonPatch = [
            {
              op: 'replace',
              path: '/info/name',
              value: 'New name',
            }
          ];
          const info: IPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch,
          };
          const result = await sdk.file.patch(id, info, false);
          assert.typeOf(result, 'object', 'returns the patch info');
          assert.equal(result.app, 'x1', 'returns the app');
          assert.typeOf(result.patch, 'array', 'returns the revert patch');
          const read = await sdk.file.read(id, false);
          assert.equal(read.info.name, 'New name', 'persists the meta');
        });

        it('patches a file meta (project)', async () => {
          const hp = HttpProject.fromName('p1');
          const pf1 = Project.fromProject(hp).toJSON();
          const id = await sdk.file.create(pf1, hp.toJSON());
          const patch: JsonPatch = [
            {
              op: 'replace',
              path: '/info/name',
              value: 'New name',
            }
          ];
          const info: IPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch,
          };
          const result = await sdk.file.patch(id, info, false);
          assert.typeOf(result, 'object', 'returns the patch info');
          const read = await sdk.file.read(id, false);
          assert.equal(read.info.name, 'New name', 'persists the meta');
        });

        it('patches a file content (project)', async () => {
          const hp = HttpProject.fromName('p1');
          const pf1 = Project.fromProject(hp).toJSON();
          const id = await sdk.file.create(pf1, hp.toJSON());
          const patch: JsonPatch = [
            {
              op: 'replace',
              path: '/info/name',
              value: 'New name',
            }
          ];
          const info: IPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch,
          };
          const result = await sdk.file.patch(id, info, true);
          assert.typeOf(result, 'object', 'returns the patch info');
          const read = await sdk.file.read(id, true) as IHttpProject;
          assert.equal(read.info.name, 'New name', 'persists the meta');
        });

        it('returns 404 when no space', async () => {
          const patch: JsonPatch = [
            {
              op: 'replace',
              path: '/info/name',
              value: 'Other name',
            }
          ];
          const info: IPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch,
          };
          try {
            await sdk.file.patch('1234567890', info, false);
          } catch (cause) {
            const e = cause as ApiError;
            assert.equal(e.code, 404, 'has 404 status code')
            assert.equal(e.message, 'Not found.');
            return;
          }
          throw new Error(`The file is patched`);
        });

        it('returns 404 when accessing a workspace without access', async () => {
          const rawOther = await http.post(`${baseUri}/test/generate/spaces?size=1&owner=test`);
          const other = JSON.parse(rawOther.body as string)[0] as IWorkspace;
          const patch: JsonPatch = [
            {
              op: 'replace',
              path: '/info/name',
              value: 'Other name',
            }
          ];
          const info: IPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch,
          };
          try {
            await sdk.file.patch(other.key, info, false);
          } catch (cause) {
            const e = cause as ApiError;
            assert.equal(e.code, 404, 'has 404 status code')
            assert.equal(e.message, 'Not found.');
            return;
          }
          throw new Error(`The file is patched`);
        });

        it('returns 400 when invalid patch data', async () => {
          const space = Workspace.fromName('test');
          const id = await sdk.file.createMeta(space.toJSON());
          const patch = [
            {
              test: "hello"
            }
          ];
          const info: IPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            // @ts-ignore
            patch,
          };
          try {
            await sdk.file.patch(id, info, false);
          } catch (cause) {
            const e = cause as ApiError;
            assert.equal(e.code, 400, 'has 400 status code')
            assert.equal(e.message, 'Malformed patch information.');
            return;
          }
          throw new Error(`The file is patched`);
        });

        it('returns 400 when patching file media on a non-media file', async () => {
          const space = Workspace.fromName('test');
          const id = await sdk.file.createMeta(space.toJSON());
          const patch: JsonPatch = [
            {
              op: 'replace',
              path: '/info/name',
              value: 'New name',
            }
          ];
          const info: IPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch,
          };
          try {
            await sdk.file.patch(id, info, true);
          } catch (cause) {
            const e = cause as ApiError;
            assert.equal(e.code, 400, 'has 400 status code')
            assert.equal(e.message, 'Spaces have no media. Remove the "alt" parameter.');
            return;
          }
          throw new Error(`The file is patched`);
        });
      });

      describe('PATCH (adding users)', () => {
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

          const user2 = await sdk.user.me({ token: user2Token });
          const user3 = await sdk.user.me({ token: user3Token });
          
          user2Id = user2.key;
          user3Id = user3.key;
        });

        after(async () => {
          await http.delete(`${baseUri}/test/reset/files`);
          await http.delete(`${baseUri}/test/reset/users`);
          await http.delete(`${baseUri}/test/reset/sessions`);
        });

        it('adds a user to a space', async () => {
          const space = Workspace.fromName('test');
          const id = await sdk.file.createMeta(space.toJSON(), {}, { token: user1Token });

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
          await sdk.file.patchUsers(id, info, { token: user1Token });
          const read = await sdk.file.read(id, false, { token: user1Token });
          
          const { permissions } = read;
          assert.typeOf(permissions, 'array', 'has the permissions array')
          assert.lengthOf(permissions, 1, 'has the added permission')
          const [p] = permissions;
          
          assert.equal(p.role, 'reader', 'has the set access level');
          assert.deepEqual(p.owner, user2Id, 'has the user on the workspace users');
        });

        it('returns error when has no access to the space', async () => {
          const space = Workspace.fromName('test');
          const id = await sdk.file.createMeta(space.toJSON(), {}, { token: user1Token });
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
          try {
            await sdk.file.patchUsers(id, info, { token: user2Token });
          } catch (cause) {
            const e = cause as ApiError;
            assert.equal(e.code, 404, 'has 404 status code')
            assert.equal(e.message, 'Not found.');
            return;
          }
          throw new Error(`The file is patched`);
        });

        it('returns error when the user does not exist', async () => {
          const space = Workspace.fromName('test');
          const id = await sdk.file.createMeta(space.toJSON(), {}, { token: user1Token });
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
          const info: IAccessPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch: records,
          };
          try {
            await sdk.file.patchUsers(id, info, { token: user1Token });
          } catch (cause) {
            const e = cause as ApiError;
            assert.equal(e.code, 400, 'has 400 status code')
            assert.equal(e.message, 'User "other" not found.');
            return;
          }
          throw new Error(`The file is patched`);
        });

        it('returns error when has no access to write to the space', async () => {
          // step 1. Add read access to the user #2
          const space = Workspace.fromName('test');
          const id = await sdk.file.createMeta(space.toJSON(), {}, { token: user1Token });
          const a1records: AccessOperation[] = [{
            op: 'add',
            id: user2Id,
            value: 'reader',
            type: 'user',
          }];
          const a1info: IAccessPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch: a1records,
          };
          await sdk.file.patchUsers(id, a1info, { token: user1Token });

          // step 1. Add any access to the user #3
          const a2records: AccessOperation[] = [{
            op: 'add',
            id: user3Id,
            value: 'commenter',
            type: 'user',
          }];
          const a2info: IAccessPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch: a2records,
          };
          
          try {
            await sdk.file.patchUsers(id, a2info, { token: user2Token });
          } catch (cause) {
            const e = cause as ApiError;
            assert.equal(e.code, 403, 'has 403 status code')
            assert.equal(e.message, 'Insufficient permissions to access this resource.');
            return;
          }
          throw new Error(`The file is patched`);
        });

        it('returns error when the space does not exist', async () => {
          const a1records: AccessOperation[] = [{
            op: 'add',
            id: user2Id,
            value: 'reader',
            type: 'user',
          }];
          const a1info: IAccessPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch: a1records,
          };
          try {
            await sdk.file.patchUsers('something', a1info, { token: user1Token });
          } catch (cause) {
            const e = cause as ApiError;
            assert.equal(e.code, 404, 'has 404 status code')
            assert.equal(e.message, 'Not found.');
            return;
          }
          throw new Error(`The file is patched`);
        });
      });

      describe('PATCH (removing users)', () => {
        let user1Token: string;
        let user2Token: string;
        let user2Id: string;

        after(async () => {
          await http.delete(`${baseUri}/test/reset/files`);
          await http.delete(`${baseUri}/test/reset/users`);
          await http.delete(`${baseUri}/test/reset/sessions`);
        });

        beforeEach(async () => {
          user1Token = await http.createUserToken(baseUri);
          user2Token = await http.createUserToken(baseUri);
          
          const user2 = await sdk.user.me({ token: user2Token });
          user2Id = user2.key;
        });

        async function grantSpace(spaceId: string, id: string, token?: string): Promise<void> {
          const records: AccessOperation[] = [{
            op: 'add',
            id,
            value: 'reader',
            type: 'user',
          }];
          const info: IAccessPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch: records,
          };
          await sdk.file.patchUsers(spaceId, info, { token });
        }

        it('removes a user from the working space', async () => {
          const space = Workspace.fromName('test');
          const id = await sdk.file.createMeta(space.toJSON(), {}, { token: user1Token });
          await grantSpace(id, user2Id, user1Token);
          const patches: AccessOperation[] = [
            {
              op: 'remove',
              id: user2Id,
              type: 'user',
            },
          ];
          const info: IAccessPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch: patches,
          };
          await sdk.file.patchUsers(id, info, { token: user1Token });
          const getResponse = await http.get(`${baseUri}${RouteBuilder.file(id)}`, { token: user2Token });
          assert.equal(getResponse.status, 404, 'has the 404 status code');
        });
      });

      describe('DELETE', () => {
        let spaceKey: string;
        let user1Token: string;
        before(async () => {
          user1Token = await http.createUserToken(baseUri);
        });

        after(async () => {
          await http.delete(`${baseUri}/test/reset/files`);
          await http.delete(`${baseUri}/test/reset/sessions`);
        });

        beforeEach(async () => {
          const space = Workspace.fromName('test');
          spaceKey = await sdk.file.createMeta(space.toJSON(), {}, { token: user1Token });
        });

        it('deletes the space', async () => {
          await sdk.file.delete(spaceKey, { token: user1Token });

          try {
            await sdk.file.read(spaceKey, false, { token: user1Token });
          } catch (cause) {
            const e = cause as ApiError;
            assert.equal(e.code, 404, 'has 404 status code')
            assert.equal(e.message, 'Not found.');
            return;
          }
          throw new Error(`The file is patched`);
        });
      });

      describe('PUT', () => {
        before(async () => {
          sdk.token = await http.createUserToken(baseUri);
        });

        after(async () => {
          await http.delete(`${baseUri}/test/reset/files`);
          await http.delete(`${baseUri}/test/reset/users`);
          await http.delete(`${baseUri}/test/reset/sessions`);
        });

        it('creates a new file media', async () => {
          const media = DataNamespace.fromName('dn1');
          const file = DataFile.fromDataNamespace(media)
          const id = await sdk.file.createMeta(file.toJSON());

          await sdk.file.createMedia(media.toJSON(), id);

          const read = await sdk.file.read(id, true);
          assert.deepEqual(read, media.toJSON());
        });

        it('creates file media only once', async () => {
          const media = DataNamespace.fromName('dn1');
          const file = DataFile.fromDataNamespace(media)
          const id = await sdk.file.createMeta(file.toJSON());

          await sdk.file.createMedia(media.toJSON(), id);

          let err: ApiError | undefined;
          try {
            await sdk.file.createMedia(media.toJSON(), id);
          } catch (e) {
            err = e as ApiError;
          }
          assert.ok(err, 'the sdk throws the error');
          if (err) {
            assert.equal(err.code, 400, 'has the 400 status code');
            assert.equal(err.message, `A file with the identifier ${id} already exists.`);
          }
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
          const s1Access: IAccessPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch: space1records,
          };
          await sdk.file.patchUsers(spaces[0].key, s1Access, { token: user1Token });
          // add user 3 to space #2
          const space2records: AccessOperation[] = [{
            op: 'add',
            id: user3Id,
            value: 'writer',
            type: 'user',
          }];
          const s2Access: IAccessPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch: space2records,
          };
          await sdk.file.patchUsers(spaces[1].key, s2Access, { token: user1Token });
        });

        after(async () => {
          await http.delete(`${baseUri}/test/reset/files`);
          await http.delete(`${baseUri}/test/reset/users`);
          await http.delete(`${baseUri}/test/reset/sessions`);
        });

        it('lists space users', async () => {
          const list = await sdk.file.listUsers(spaces[0].key, { token: user1Token });
          assert.isUndefined(list.cursor, 'has no cursor');
          assert.typeOf(list.data, 'array', 'has the data array');
          assert.lengthOf(list.data, 2, 'has all users');
          const [u1, u2] = list.data as IUser[];
          assert.equal(u1.key, user2Id, 'has the user #1');
          assert.equal(u2.key, user4Id, 'has the user #2');
        });

        it('returns an empty list when no added users', async () => {
          const list = await sdk.file.listUsers(spaces[2].key, { token: user1Token });
          assert.isUndefined(list.cursor, 'has no cursor');
          assert.typeOf(list.data, 'array', 'has the data array');
          assert.lengthOf(list.data, 0, 'has no users');
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

      describe('GET', () => {
        before(async () => {
          sdk.token = await http.createUserToken(baseUri);
        });

        after(async () => {
          await http.delete(`${baseUri}/test/reset/files`);
          await http.delete(`${baseUri}/test/reset/sessions`);
        });

        it('reads a space meta', async () => {
          const space = Workspace.fromName('test');
          const id = await sdk.file.createMeta(space.toJSON());
          const result = await sdk.file.read(id, false);
          assert.equal(result.key, id);
          assert.equal(result.kind, WorkspaceKind);
        });

        it('reads a project meta', async () => {
          const hp = HttpProject.fromName('p1');
          const pf1 = Project.fromProject(hp).toJSON();
          const id = await sdk.file.create(pf1, hp.toJSON());
          const result = await sdk.file.read(id, false);
          assert.equal(result.key, id);
          assert.equal(result.kind, ProjectKind);
        });

        it('reads a project content', async () => {
          const hp = HttpProject.fromName('p1');
          const pf1 = Project.fromProject(hp).toJSON();
          const id = await sdk.file.create(pf1, hp.toJSON());
          const result = await sdk.file.read(id, true) as IHttpProject;
          assert.equal(result.key, id);
          assert.equal(result.kind, HttpProjectKind);
        });

        it('returns 404 when no file', async () => {
          try {
            await sdk.file.read('1234567890', false);
          } catch (cause) {
            const e = cause as ApiError;
            assert.equal(e.code, 404, 'has 404 status code')
            assert.equal(e.message, 'Not found.');
            return;
          }
          throw new Error(`File is accessible`);
        });

        it('returns 401 when invalid credentials', async () => {
          const space = Workspace.fromName('test');
          const id = await sdk.file.createMeta(space.toJSON());
          try {
            await sdk.file.read(id, false, { token: 'test' });
          } catch (cause) {
            const e = cause as ApiError;
            assert.equal(e.code, 401, 'has 401 status code')
            assert.equal(e.message, 'The client is not authorized to access this resource.');
            return;
          }
          throw new Error(`File is accessible`);
        });

        it('returns 400 when reading media for a non-media file', async () => {
          const space = Workspace.fromName('test');
          const id = await sdk.file.createMeta(space.toJSON());
          try {
            await sdk.file.read(id, true);
          } catch (cause) {
            const e = cause as ApiError;
            assert.equal(e.code, 400, 'has 400 status code')
            assert.equal(e.message, 'Spaces have no media. Remove the "alt" parameter.');
            return;
          }
          throw new Error(`File is accessible`);
        });
      });

      describe('PATCH', () => {
        before(async () => {
          sdk.token = await http.createUserToken(baseUri);
        });

        after(async () => {
          await http.delete(`${baseUri}/test/reset/files`);
          await http.delete(`${baseUri}/test/reset/users`);
          await http.delete(`${baseUri}/test/reset/sessions`);
        });

        it('patches a file meta (workspace)', async () => {
          const space = Workspace.fromName('test');
          const id = await sdk.file.createMeta(space.toJSON());
          const patch: JsonPatch = [
            {
              op: 'replace',
              path: '/info/name',
              value: 'New name',
            }
          ];
          const info: IPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch,
          };
          const result = await sdk.file.patch(id, info, false);
          assert.typeOf(result, 'object', 'returns the patch info');
          assert.equal(result.app, 'x1', 'returns the app');
          assert.typeOf(result.patch, 'array', 'returns the revert patch');
          const read = await sdk.file.read(id, false);
          assert.equal(read.info.name, 'New name', 'persists the meta');
        });

        it('patches a file meta (project)', async () => {
          const hp = HttpProject.fromName('p1');
          const pf1 = Project.fromProject(hp).toJSON();
          const id = await sdk.file.create(pf1, hp.toJSON());
          const patch: JsonPatch = [
            {
              op: 'replace',
              path: '/info/name',
              value: 'New name',
            }
          ];
          const info: IPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch,
          };
          const result = await sdk.file.patch(id, info, false);
          assert.typeOf(result, 'object', 'returns the patch info');
          const read = await sdk.file.read(id, false);
          assert.equal(read.info.name, 'New name', 'persists the meta');
        });

        it('patches a file content (project)', async () => {
          const hp = HttpProject.fromName('p1');
          const pf1 = Project.fromProject(hp).toJSON();
          const id = await sdk.file.create(pf1, hp.toJSON());
          const patch: JsonPatch = [
            {
              op: 'replace',
              path: '/info/name',
              value: 'New name',
            }
          ];
          const info: IPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch,
          };
          const result = await sdk.file.patch(id, info, true);
          assert.typeOf(result, 'object', 'returns the patch info');
          const read = await sdk.file.read(id, true) as IHttpProject;
          assert.equal(read.info.name, 'New name', 'persists the meta');
        });

        it('returns 404 when no space', async () => {
          const patch: JsonPatch = [
            {
              op: 'replace',
              path: '/info/name',
              value: 'Other name',
            }
          ];
          const info: IPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch,
          };
          try {
            await sdk.file.patch('1234567890', info, false);
          } catch (cause) {
            const e = cause as ApiError;
            assert.equal(e.code, 404, 'has 404 status code')
            assert.equal(e.message, 'Not found.');
            return;
          }
          throw new Error(`The file is patched`);
        });

        it('returns 400 when invalid patch data', async () => {
          const space = Workspace.fromName('test');
          const id = await sdk.file.createMeta(space.toJSON());
          const patch = [
            {
              test: "hello"
            }
          ];
          const info: IPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            // @ts-ignore
            patch,
          };
          try {
            await sdk.file.patch(id, info, false);
          } catch (cause) {
            const e = cause as ApiError;
            assert.equal(e.code, 400, 'has 400 status code')
            assert.equal(e.message, 'Malformed patch information.');
            return;
          }
          throw new Error(`The file is patched`);
        });
      });

      describe('DELETE', () => {
        let spaceKey: string;
        let user1Token: string;
        before(async () => {
          user1Token = await http.createUserToken(baseUri);
        });

        after(async () => {
          await http.delete(`${baseUri}/test/reset/files`);
          await http.delete(`${baseUri}/test/reset/sessions`);
        });

        beforeEach(async () => {
          const space = Workspace.fromName('test');
          spaceKey = await sdk.file.createMeta(space.toJSON(), {}, { token: user1Token });
        });

        it('deletes the space', async () => {
          await sdk.file.delete(spaceKey, { token: user1Token });

          try {
            await sdk.file.read(spaceKey, false, { token: user1Token });
          } catch (cause) {
            const e = cause as ApiError;
            assert.equal(e.code, 404, 'has 404 status code')
            assert.equal(e.message, 'Not found.');
            return;
          }
          throw new Error(`The file is patched`);
        });
      });
    });
  });
});
