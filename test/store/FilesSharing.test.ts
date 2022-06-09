import { assert } from 'chai';
import fs from 'fs/promises';
import path from 'path';
import { 
  DefaultLogger, IWorkspace, ProjectMock,  Workspace, AccessOperation, HttpProject, WorkspaceKind,
  ApiError, ICapabilities, IAccessPatchInfo,
} from '@api-client/core';
import { StoreLevelUp } from '../../src/persistence/StoreLevelUp.js';
import { DataHelper } from '../helpers/DataHelper.js';

const storePath = path.join('test', 'data', 'units', 'store', 'sharing-integration');

describe('Unit tests', () => {
  let store: StoreLevelUp;
  const mock = new ProjectMock();

  before(async () => {
    await fs.mkdir(storePath, { recursive: true });
    store = new StoreLevelUp(new DefaultLogger(), storePath);
    await store.initialize();
  });

  after(async () => {
    await store.cleanup();
    await fs.rm(storePath, { recursive: true, force: true });
  });

  describe('StoreLevelUp', () => {
    describe('Sharing files', () => {
      describe('reading a shared file', () => {
        const user1 = mock.user.user();
        const user2 = mock.user.user();
        const user3 = mock.user.user();
        let s1: IWorkspace;

        before(async () => {
          await store.user.add(user1.key, user1);
          await store.user.add(user2.key, user2);
          await store.user.add(user3.key, user3);
        });

        after(async () => {
          await store.user.db.clear();
          await store.file.db.clear();
        });

        beforeEach(async () => {
          s1 = Workspace.fromName('s1').toJSON();
          await store.file.add(s1.key, s1, user1);
        });

        async function addUserToFile(fileId: string, userId = user2.key, addingUser = user1): Promise<void> {
          const info: IAccessPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch: [{
              op: 'add',
              type: 'user',
              value: 'reader',
              id: userId,
            } as AccessOperation],
          };
          await store.file.patchAccess(fileId, info, addingUser);
        } 

        it('reads a shared root level file', async () => {
          await addUserToFile(s1.key);
          const file = await store.file.read(s1.key, user2);
          assert.typeOf(file, 'object');
        });

        it('reads a sub-file from a shared file', async () => {
          await addUserToFile(s1.key);
          const s2 = Workspace.fromName('s2').toJSON();
          await store.file.add(s2.key, s2, user1, { parent: s1.key });

          const file = await store.file.read(s2.key, user2);
          assert.typeOf(file, 'object');
        });

        it('reads a sub-file', async () => {
          const s2 = Workspace.fromName('s2').toJSON();
          await store.file.add(s2.key, s2, user1);
          await addUserToFile(s2.key);
          const file = await store.file.read(s2.key, user2);
          assert.typeOf(file, 'object');
        });

        it('does not read shared file by 3rd user', async () => {
          await addUserToFile(s1.key);
          let error: ApiError | undefined;
          try {
            await store.file.read(s1.key, user3);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Not found.`);
            assert.equal(error.code, 404);
          }
        });

        it('does not read not-shared file by 3rd user', async () => {
          let error: ApiError | undefined;
          try {
            await store.file.read(s1.key, user3);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Not found.`);
            assert.equal(error.code, 404);
          }
        });

        it('read the file shared with anyone', async () => {
          const info: IAccessPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch: [{
              op: 'add',
              type: 'anyone',
              value: 'reader',
            } as AccessOperation],
          };
          await store.file.patchAccess(s1.key, info, user1);
          const file = await store.file.read(s1.key, user3);
          assert.typeOf(file, 'object');
        });

        // TODO: group sharing
      });

      describe('listing shared files', () => {
        const user1 = mock.user.user();
        const user2 = mock.user.user();
        const user3 = mock.user.user();
        let files: IWorkspace[];

        before(async () => {
          await store.user.add(user1.key, user1);
          await store.user.add(user2.key, user2);
          await store.user.add(user3.key, user3);

          files = await DataHelper.generateSharedSpaces(store, { size: 40, owner: user1.key, target: user2.key, type: 'user' });
          await DataHelper.generateSharedSpaces(store, { size: 15, owner: user1.key, target: user3.key, type: 'user' });
        });

        after(async () => {
          await store.user.db.clear();
          await store.permission.db.clear();
          await store.shared.db.clear();
        });

        it('lists the files shared with the user', async () => {
          const list = await store.shared.list(user2);
          assert.typeOf(list.cursor, 'string', 'has the cursor');
          assert.typeOf(list.items, 'array', 'has the items');
          assert.lengthOf(list.items, 35, 'has the default list size');
        });

        it('lists files only shared with the user', async () => {
          const list = await store.shared.list(user2, [], { limit: 100 });
          assert.lengthOf(list.items, 40, 'has the default list size');
        });

        it('does not list files that have a parent', async () => {
          const parent = files[0].key;
          const file = Workspace.fromName('s2', user1.key).toJSON();
          await store.file.add(file.key, file, user1, { parent });
          const info: IAccessPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch: [{
              op: 'add',
              type: 'user',
              value: 'reader',
              id: user2.key,
            } as AccessOperation],
          };
          await store.file.patchAccess(file.key, info, user1);

          const list = await store.shared.list(user2, [], { limit: 100 });
          assert.lengthOf(list.items, 40, 'has all records');
        });

        it('lists files for a parent', async () => {
          const parent = files[0].key;
          const file = Workspace.fromName('s2', user1.key).toJSON();
          await store.file.add(file.key, file, user1, { parent });
          const info: IAccessPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch: [{
              op: 'add',
              type: 'user',
              value: 'reader',
              id: user3.key,
            } as AccessOperation],
          };
          await store.file.patchAccess(file.key, info, user1);
          const list = await store.shared.list(user3, [WorkspaceKind], { parent });
          assert.lengthOf(list.items, 1, 'has all parent records');
        });

        it('respects the limit parameter', async () => {
          const list = await store.shared.list(user2, [WorkspaceKind], { limit: 4 });
          assert.typeOf(list.cursor, 'string', 'has the cursor');
          assert.typeOf(list.items, 'array', 'has the items');
          assert.lengthOf(list.items, 4, 'has the default list size');
        });

        it('respects the page cursor', async () => {
          const list1 = await store.shared.list(user2, [WorkspaceKind], { limit: 2 });
          assert.lengthOf(list1.items, 2, 'original list has 2 items');
          const list2 = await store.shared.list(user2, [WorkspaceKind], { cursor: list1.cursor });
          assert.lengthOf(list2.items, 2, 'uses the page cursor limit param');
          assert.notDeepEqual(list1.items[0], list2.items[0], 'arrays are not equal');
          assert.notDeepEqual(list1.items[1], list2.items[0], 'has the next element');
        });

        it('adds the permissions list', async () => {
          const list = await store.shared.list(user2, [WorkspaceKind], { limit: 1 });
          const [file] = list.items;
          assert.typeOf(file.permissions, 'array');
          assert.lengthOf(file.permissions, 1);
        });

        it('adds the capabilities map', async () => {
          const list = await store.shared.list(user2, [WorkspaceKind], { limit: 1 });
          const [file] = list.items;
          const c = file.capabilities as ICapabilities;
          assert.typeOf(c, 'object', 'has capabilities');
        });

        it('sets the byMe values', async () => {
          const list = await store.shared.list(user2, [WorkspaceKind], { limit: 1 });
          const [file] = list.items;
          assert.isFalse(file.lastModified.byMe);
        });
      });

      describe('removing access', () => {
        const user1 = mock.user.user();
        const user2 = mock.user.user();
        const user3 = mock.user.user();
        let files: IWorkspace[];

        before(async () => {
          await store.user.add(user1.key, user1);
          await store.user.add(user2.key, user2);
          await store.user.add(user3.key, user3);

          files = await DataHelper.generateSharedSpaces(store, { size: 40, owner: user1.key, target: user2.key, type: 'user' });
          await DataHelper.generateSharedSpaces(store, { size: 15, owner: user1.key, target: user3.key, type: 'user' });
        });

        after(async () => {
          await store.user.db.clear();
          await store.permission.db.clear();
          await store.shared.db.clear();
          await store.file.db.clear();
          await store.media.db.clear();
        });

        it('removes the access to the file', async () => {
          const file = files[0];
          const info: IAccessPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch: [{
              op: 'remove',
              type: 'user',
              id: user2.key,
            } as AccessOperation],
          };
          await store.file.patchAccess(file.key, info, user1);

          const readFile = await store.file.read(file.key, user1) as IWorkspace;
          
          assert.deepEqual(readFile.permissionIds, [], 'file has empty permissionIds');
          assert.deepEqual(readFile.permissions, [], 'file has empty permissions');

          let error: ApiError | undefined;
          try {
            await store.file.read(file.key, user3);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Not found.`);
            assert.equal(error.code, 404);
          }
        });

        it('removes the access to a project inside the space', async () => {
          const file = files[1];
          const p = HttpProject.fromName('test');
          await DataHelper.addProject(store, p, user1, file.key);
          const info: IAccessPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch: [{
              op: 'remove',
              type: 'user',
              id: user2.key,
            } as AccessOperation],
          };
          await store.file.patchAccess(file.key, info, user1);

          let error: ApiError | undefined;
          try {
            await store.file.read(p.key, user3);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Not found.`);
            assert.equal(error.code, 404);
          }
        });

        it('throws when the file does not exist', async () => {
          let error: ApiError | undefined;
          const info: IAccessPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch: [{
              op: 'remove',
              type: 'user',
              id: user2.key,
            } as AccessOperation],
          };

          try {
            await store.file.patchAccess('invalid', info, user1);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Not found.`);
            assert.equal(error.code, 404);
          }
        });

        it('ignores the operation when permission does not exist', async () => {
          const file = files[2];
          const ids = [...file.permissionIds];
          const info: IAccessPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch: [{
              op: 'remove',
              type: 'user',
              id: 'invalid',
            } as AccessOperation],
          };
          await store.file.patchAccess(file.key, info, user1);
          const readFile = await store.file.read(file.key, user1) as IWorkspace;
          assert.deepEqual(readFile.permissionIds, ids, 'space keeps the permissionIds');
        });
      });

      describe('updating a shared space', () => {
        const user1 = mock.user.user();
        const user2 = mock.user.user();
        const user3 = mock.user.user();
        const user4 = mock.user.user();

        before(async () => {
          await store.user.add(user1.key, user1);
          await store.user.add(user2.key, user2);
          await store.user.add(user3.key, user3);
          await store.user.add(user4.key, user4);
        });

        after(async () => {
          await store.user.db.clear();
          await store.file.db.clear();
          await store.media.db.clear();
          await store.shared.db.clear();
        });

        let parent: IWorkspace;

        beforeEach(async () => {
          parent = (await DataHelper.generateSharedSpaces(store, { 
            size: 1, 
            owner: user1.key, 
            target: user2.key, 
            type: 'user', 
            role: 'writer',
          }))[0];
        });

        it('can add a file to a shared file', async () => {
          const file = Workspace.fromName('child').toJSON();
          await store.file.add(file.key, file, user2, { parent: parent.key });

          const readOwner = await store.file.read(file.key, user2);
          assert.typeOf(readOwner, 'object');

          const readFileOwner = await store.file.read(file.key, user1);
          assert.typeOf(readFileOwner, 'object');

          assert.equal(readOwner.key, readFileOwner.key);
        });

        it('can add a project to a shared file', async () => {
          const p = HttpProject.fromName('test');
          await DataHelper.addProject(store, p, user2, parent.key);

          const readOwner = await store.file.read(p.key, user2);
          assert.typeOf(readOwner, 'object');

          const readFileOwner = await store.file.read(p.key, user1);
          assert.typeOf(readFileOwner, 'object');

          assert.deepEqual(readOwner.key, readFileOwner.key);
        });

        it('can share a shared file with write role', async () => {
          const info: IAccessPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch: [{
              op: 'add',
              type: 'user',
              value: 'reader',
              id: user3.key,
            } as AccessOperation],
          };
          await store.file.patchAccess(parent.key, info, user2);

          const file = await store.file.read(parent.key, user3) as IWorkspace;
          assert.lengthOf(file.permissions, 2, 'has both permissions');
        });

        it('can not share a shared file with write reading role', async () => {
          const info1: IAccessPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch: [{
              op: 'add',
              type: 'user',
              value: 'reader',
              id: user3.key,
            } as AccessOperation],
          };
          const info2: IAccessPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch: [{
              op: 'add',
              type: 'user',
              value: 'reader',
              id: user4.key,
            } as AccessOperation],
          };

          await store.file.patchAccess(parent.key, info1, user2);

          let error: ApiError | undefined;
          try {
            await store.file.patchAccess(parent.key, info2, user3);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Insufficient permissions to access this resource.`);
            assert.equal(error.code, 403);
          }
        });

        it('overrides the reading permission with writing permissions on a child', async () => {
          const s1 = Workspace.fromName('s1').toJSON();
          const s2 = Workspace.fromName('s2').toJSON();
          await store.file.add(s1.key, s1, user2, { parent: parent.key });
          await store.file.add(s2.key, s2, user2, { parent: s1.key });
          const info1: IAccessPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch: [{
              op: 'add',
              type: 'user',
              value: 'reader',
              id: user3.key,
            } as AccessOperation],
          };
          const info2: IAccessPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch: [{
              op: 'add',
              type: 'user',
              value: 'writer',
              id: user3.key,
            } as AccessOperation],
          };
          await store.file.patchAccess(s1.key, info1, user2);
          await store.file.patchAccess(s2.key, info2, user2);

          const s3 = Workspace.fromName('s3').toJSON();
          await store.file.add(s3.key, s3, user3, { parent: s2.key });
        });

        it('refuses to create a file by a non-writing user', async () => {
          const s1 = Workspace.fromName('s1').toJSON();
          const s2 = Workspace.fromName('s2').toJSON();
          await store.file.add(s1.key, s1, user2, { parent: parent.key });
          const patch: IAccessPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch: [{
              op: 'add',
              type: 'user',
              value: 'reader',
              id: user3.key,
            } as AccessOperation],
          };
          await store.file.patchAccess(s1.key, patch, user2);

          let error: ApiError | undefined;
          try {
            await store.file.add(s2.key, s2, user3, { parent: s1.key });
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Insufficient permissions to access this resource.`);
            assert.equal(error.code, 403);
          }
        });

        it('refuses to create a project by a non-writing user', async () => {
          const s1 = Workspace.fromName('s1').toJSON();
          const p = HttpProject.fromName('test');
          await store.file.add(s1.key, s1, user2, { parent: parent.key });
          const patch: IAccessPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch: [{
              op: 'add',
              type: 'user',
              value: 'reader',
              id: user3.key,
            } as AccessOperation],
          };
          await store.file.patchAccess(s1.key, patch, user2);

          let error: ApiError | undefined;
          try {
            await DataHelper.addProject(store, p, user3, s1.key);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Insufficient permissions to access this resource.`);
            assert.equal(error.code, 403);
          }
        });

        it('allows creating a file when shared with anyone with write role', async () => {
          const s1 = Workspace.fromName('s1').toJSON();
          const s2 = Workspace.fromName('s2').toJSON();
          await store.file.add(s1.key, s1, user1, { parent: parent.key });
          const patch: IAccessPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch: [{
              op: 'add',
              type: 'anyone',
              value: 'writer',
            } as AccessOperation],
          };
          await store.file.patchAccess(s1.key, patch, user1);
          await store.file.add(s2.key, s2, user3, { parent: s1.key });
        });

        it('refuses creating a project when shared with anyone with commenting role', async () => {
          const s1 = Workspace.fromName('s1').toJSON();
          const s2 = Workspace.fromName('s2').toJSON();
          await store.file.add(s1.key, s1, user1, { parent: parent.key });
          const patch: IAccessPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch: [{
              op: 'add',
              type: 'anyone',
              value: 'reader',
            } as AccessOperation],
          };
          await store.file.patchAccess(s1.key, patch, user1);
          let error: ApiError | undefined;
          try {
            await store.file.add(s2.key, s2, user3, { parent: s1.key });
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Insufficient permissions to access this resource.`);
            assert.equal(error.code, 403);
          }
        });

        it('refuses deleting a file without writing role', async () => {
          const s1 = Workspace.fromName('s1').toJSON();
          await store.file.add(s1.key, s1, user1, { parent: parent.key });
          const patch: IAccessPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch: [{
              op: 'add',
              type: 'anyone',
              value: 'reader',
            } as AccessOperation],
          };
          await store.file.patchAccess(s1.key, patch, user1);
          let error: ApiError | undefined;
          try {
            await store.file.delete(s1.key, user3);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Insufficient permissions to access this resource.`);
            assert.equal(error.code, 403);
          }
        });

        it('refuses deleting a file with writing role', async () => {
          let error: ApiError | undefined;
          try {
            await store.file.delete(parent.key, user2);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Unauthorized to delete the object.`);
            assert.equal(error.code, 403);
          }
        });
      });
    });
  });
});
