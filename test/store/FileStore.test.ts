import { assert } from 'chai';
import fs from 'fs/promises';
import path from 'path';
import sinon from 'sinon';
import { 
  DefaultLogger, ProjectMock, IBackendEvent, Workspace, HttpProject, IPermission,
  RouteBuilder, Project, WorkspaceKind, AccessOperation, IFile, Timers, ProjectKind,
  ApiError, ICapabilities, IPatchInfo, IAccessPatchInfo, IUser, IPatchRevision,
} from '@api-client/core';
import { JsonPatch } from '@api-client/json';
import { StoreLevelUp } from '../../src/persistence/StoreLevelUp.js';
import { KeyGenerator } from '../../src/persistence/KeyGenerator.js';
import Clients, { IClientFilterOptions } from '../../src/routes/WsClients.js';
import { ISharedLink } from '../../src/persistence/level/AbstractShared.js';
import { DataHelper } from '../helpers/DataHelper.js';

const storePath = path.join('test', 'data', 'units', 'store', 'file');

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
    async function patchFileAccess(file: string, user: IUser, records: AccessOperation[]): Promise<void> {
      const info: IAccessPatchInfo = {
        app: 'x1',
        appVersion: '1',
        id: '123',
        patch: records,
      };
      await store.file.patchAccess(file, info, user);
    }

    describe('#file', () => {
      describe('add()', () => {
        const user1 = mock.user.user();
        const user2 = mock.user.user();
        
        before(async () => {
          await store.user.add(user1.key, user1);
          await store.user.add(user2.key, user2);
        });

        after(async () => {
          await store.file.db.clear();
          await store.user.db.clear();
          await store.permission.db.clear();
        });

        it('returns the created file with updated properties', async () => {
          const s1 = Workspace.fromName('s1').toJSON();
          s1.parents = ['pr1'];
          s1.permissionIds = ['p1'];
          s1.permissions = [{ addingUser: '1', key: '2', kind: 'Core#Permission', role: 'commenter', type: 'user' }];
          s1.owner = 'test-id';
          // @ts-ignore
          s1.capabilities = { canEdit: false };
          
          const result = await store.file.add(s1.key, s1, user1);
          assert.equal(result.owner, user1.key);
          assert.deepEqual(result.permissionIds, []);
          assert.deepEqual(result.permissions, []);
          assert.deepEqual(result.parents, []);
          assert.typeOf(result.lastModified, 'object');
          assert.equal(result.lastModified.user, user1.key);
          assert.typeOf(result.lastModified.time, 'number');
          assert.equal(result.lastModified.name, user1.name);
        });

        it('adds the file to the parent', async () => {
          const s1 = Workspace.fromName('s1');
          const s2 = Workspace.fromName('s2');
          await store.file.add(s1.key, s1.toJSON(), user1);
          const result = await store.file.add(s2.key, s2.toJSON(), user1, { parent: s1.key });
          assert.deepEqual(result.parents, [s1.key]);
        });

        it('adds the file to multiple parents', async () => {
          const s1 = Workspace.fromName('s1');
          const s2 = Workspace.fromName('s2');
          const s3 = Workspace.fromName('s3');
          const s4 = Workspace.fromName('s4');
          const s5 = Workspace.fromName('s5');
          const project = HttpProject.fromName('p1');
          const p1 = Project.fromProject(project);

          await store.file.add(s1.key, s1.toJSON(), user1);
          await store.file.add(s2.key, s2.toJSON(), user1, { parent: s1.key });
          await store.file.add(s3.key, s3.toJSON(), user1, { parent: s2.key });
          await store.file.add(s4.key, s4.toJSON(), user1, { parent: s3.key });
          await store.file.add(s5.key, s5.toJSON(), user1, { parent: s4.key });
          const result = await store.file.add(p1.key, p1.toJSON(), user1, { parent: s5.key });
          assert.deepEqual(result.parents, [s1.key, s2.key, s3.key, s4.key, s5.key]);
        });

        it('persists the data', async () => {
          const s1 = Workspace.fromName('s1');
          const result = await store.file.add(s1.key, s1.toJSON(), user1);
          const raw = await store.file.db.get(s1.key);
          assert.deepEqual(result.key, JSON.parse(raw as string).key);
        });

        it('informs the WS client', async () => {
          const s1 = Workspace.fromName('s1');
          const spy = sinon.spy(Clients, 'notify');
          let result: any;
          try {
            result = await store.file.add(s1.key, s1.toJSON(), user1);
          } finally {
            spy.restore();
          }
          assert.isTrue(spy.calledOnce, 'Calls the notify function');
          const event = spy.args[0][0] as IBackendEvent;
          const filter = spy.args[0][1] as IClientFilterOptions;
          assert.equal(event.type, 'event');
          assert.equal(event.operation, 'created');
          assert.deepEqual(event.data, result);
          assert.equal(event.kind, WorkspaceKind);
          assert.equal(filter.url, RouteBuilder.files());
          assert.deepEqual(filter.users, [user1.key]);
        });

        it('throws when the file already exists', async () => {
          const s1 = Workspace.fromName('s1');
          await store.file.add(s1.key, s1.toJSON(), user1);
          let error: ApiError | undefined;
          try {
            await store.file.add(s1.key, s1.toJSON(), user1);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `An object with the identifier ${s1.key} already exists.`);
            assert.equal(error.code, 400);
          }
        });

        it('throws when the parent does not exist', async () => {
          const s1 = Workspace.fromName('s1');
          let error: ApiError | undefined;
          try {
            await store.file.add(s1.key, s1.toJSON(), user1, { parent: 'unknown' });
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Not found.`);
            assert.equal(error.code, 404);
          }
        });

        it('throws when has no write access to the parent', async () => {
          const s1 = Workspace.fromName('s1');
          const s2 = Workspace.fromName('s2');
          await store.file.add(s1.key, s1.toJSON(), user1);
          await patchFileAccess(s1.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'reader',
            id: user2.key,
          } as AccessOperation]);

          let error: ApiError | undefined;
          try {
            await store.file.add(s2.key, s2.toJSON(), user2, { parent: s1.key });
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Insufficient permissions to access this resource.`);
            assert.equal(error.code, 403);
          }
        });

        it('returns file with updated capabilities for the owner', async () => {
          const s1 = Workspace.fromName('s1').toJSON();
          const result = await store.file.add(s1.key, s1, user1);
          const c = result.capabilities as ICapabilities;
          assert.isTrue(c.canEdit);
          assert.isTrue(c.canComment);
          assert.isTrue(c.canShare);
          assert.isFalse(c.canCopy);
          assert.isTrue(c.canReadRevisions);
          assert.isTrue(c.canAddChildren);
          assert.isTrue(c.canDelete);
          assert.isTrue(c.canListChildren);
          assert.isTrue(c.canRename);
          assert.isTrue(c.canTrash);
          assert.isTrue(c.canUntrash);
        });
      });

      describe('read()', () => {
        const user1 = mock.user.user();
        const user2 = mock.user.user();
        let s1: IFile;
        
        before(async () => {
          await store.user.add(user1.key, user1);
          await store.user.add(user2.key, user2);
        });

        after(async () => {
          await store.file.db.clear();
          await store.user.db.clear();
          await store.bin.db.clear();
          await store.permission.db.clear();
        });

        beforeEach(async () => {
          const space = Workspace.fromName('s1');
          s1 = await store.file.add(space.key, space.toJSON(), user1);
        });

        it('reads the file by the owner', async () => {
          const result = await store.file.read(s1.key, user1);
          // we don't test for deep equal because of "capabilities" and "lastModified"
          assert.equal(result.key, s1.key);
        });

        it('reads the file by the user with permissions', async () => {
          await patchFileAccess(s1.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'reader',
            id: user2.key,
          } as AccessOperation]);

          const result = await store.file.read(s1.key, user2) as IFile;
          assert.ok(result);
          assert.equal(result.key, s1.key);
        });

        it('throws when the user has no permission to the file', async () => {
          let error: ApiError | undefined;
          try {
            await store.file.read(s1.key, user2);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Not found.`);
            assert.equal(error.code, 404);
          }
        });

        it('throws when no file', async () => {
          let error: ApiError | undefined;
          try {
            await store.file.read('unknown', user1);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Not found.`);
            assert.equal(error.code, 404);
          }
        });

        it('throws when while was deleted', async () => {
          await store.file.delete(s1.key, user1);
          let error: ApiError | undefined;
          try {
            await store.file.read('unknown', user1);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Not found.`);
            assert.equal(error.code, 404);
          }
        });

        it('sets file capabilities for the owner', async () => {
          const result = await store.file.read(s1.key, user1);
          const c = result.capabilities as ICapabilities;
          assert.typeOf(c, 'object', 'has capabilities')
          assert.isTrue(c.canEdit);
          assert.isTrue(c.canComment);
          assert.isTrue(c.canShare);
          assert.isFalse(c.canCopy);
          assert.isTrue(c.canReadRevisions);
          assert.isTrue(c.canAddChildren);
          assert.isTrue(c.canDelete);
          assert.isTrue(c.canListChildren);
          assert.isTrue(c.canRename);
          assert.isTrue(c.canTrash);
          assert.isTrue(c.canUntrash);
        });

        it('sets file capabilities for a shared user', async () => {
          await patchFileAccess(s1.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'commenter',
            id: user2.key,
          } as AccessOperation]);

          const result = await store.file.read(s1.key, user2);
          const c = result.capabilities as ICapabilities;
          assert.typeOf(c, 'object', 'has capabilities');
          assert.isFalse(c.canEdit);
          assert.isTrue(c.canComment);
          assert.isFalse(c.canShare);
          assert.isFalse(c.canCopy);
          assert.isFalse(c.canRename);
        });
      });

      describe('get()', () => {
        const user1 = mock.user.user();
        const user2 = mock.user.user();
        let s1: IFile;
        
        before(async () => {
          await store.user.add(user1.key, user1);
          await store.user.add(user2.key, user2);
        });

        after(async () => {
          await store.file.db.clear();
          await store.user.db.clear();
          await store.permission.db.clear();
        });

        beforeEach(async () => {
          const space = Workspace.fromName('s1');
          s1 = await store.file.add(space.key, space.toJSON(), user1);
        });

        it('returns the file', async () => {
          const result = await store.file.get(s1.key) as IFile;
          assert.deepEqual(result.key, s1.key);
        });

        it('returns undefined when file does not exist', async () => {
          const result = await store.file.get('unknown');
          assert.isUndefined(result);
        });

        it('adds permissions by default', async () => {
          await patchFileAccess(s1.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'reader',
            id: user2.key,
          } as AccessOperation]);

          const result = await store.file.get(s1.key) as IFile;
          assert.lengthOf(result.permissions, 1);
        });

        it('does not add permissions when requested', async () => {
          await patchFileAccess(s1.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'reader',
            id: user2.key,
          } as AccessOperation]);

          const result = await store.file.get(s1.key, false) as IFile;
          assert.lengthOf(result.permissions, 0);
        });
      });

      describe('access and permissions', () => {
        const user1 = mock.user.user();
        const user2 = mock.user.user();

        before(async () => {
          await store.user.add(user1.key, user1);
          await store.user.add(user2.key, user2);
        });

        after(async () => {
          await store.user.db.clear();
          await store.file.db.clear();
          await store.permission.db.clear();
          await store.shared.db.clear();
        });

        it('adds another user to the space', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.file.add(space.key, space, user1);

          await patchFileAccess(space.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'commenter',
            id: user2.key,
          } as AccessOperation]);

          const read = await store.file.read(space.key, user1) as IFile;
          assert.lengthOf(read.permissionIds, 1,' has a new permission id');
          assert.lengthOf(read.permissions, 1,' has a new permission');

          const [p] = read.permissions;
          assert.equal(p.addingUser, user1.key, 'adds the addingUser');
          assert.equal(p.owner, user2.key, 'adds the owner');
          assert.equal(p.role, 'commenter', 'adds the role');
          assert.equal(p.type, 'user', 'adds the type');
        });

        it('creates a permission object', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.file.add(space.key, space, user1);

          await patchFileAccess(space.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'commenter',
            id: user2.key,
          } as AccessOperation]);

          const read = await store.file.read(space.key, user1) as IFile;
          assert.lengthOf(read.permissionIds, 1,' has a new permission id');
          const p = await store.permission.read(read.permissionIds[0]) as IPermission;
          assert.equal(p.addingUser, user1.key, 'adds the addingUser');
          assert.equal(p.owner, user2.key, 'adds the owner');
          assert.equal(p.role, 'commenter', 'adds the role');
          assert.equal(p.type, 'user', 'adds the type');
        });

        it('adds access to anyone', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.file.add(space.key, space, user1);

          await patchFileAccess(space.key, user1, [{
            op: 'add',
            type: 'anyone',
            value: 'commenter',
          } as AccessOperation]);

          const read = await store.file.read(space.key, user1) as IFile;
          assert.lengthOf(read.permissionIds, 1,' has a new permission id');
          assert.lengthOf(read.permissions, 1,' has a new permission');

          const [p] = read.permissions;
          assert.equal(p.addingUser, user1.key, 'adds the addingUser');
          assert.isUndefined(p.owner, 'does not add the owner');
          assert.equal(p.role, 'commenter', 'adds the role');
          assert.equal(p.type, 'anyone', 'adds the type');
        });

        it('adds access to a group', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.file.add(space.key, space, user1);

          await patchFileAccess(space.key, user1, [{
            op: 'add',
            type: 'group',
            value: 'commenter',
            id: 'a-group'
          } as AccessOperation]);

          const read = await store.file.read(space.key, user1) as IFile;
          assert.lengthOf(read.permissionIds, 1,' has a new permission id');
          assert.lengthOf(read.permissions, 1,' has a new permission');

          const [p] = read.permissions;
          assert.equal(p.addingUser, user1.key, 'adds the addingUser');
          assert.equal(p.owner, 'a-group', 'adds the owner');
          assert.equal(p.role, 'commenter', 'adds the role');
          assert.equal(p.type, 'group', 'adds the type');
        });

        it('creates a permission only once per user', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.file.add(space.key, space, user1);

          await patchFileAccess(space.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'commenter',
            id: user2.key,
          } as AccessOperation]);

          await patchFileAccess(space.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'reader',
            id: user2.key,
          } as AccessOperation]);

          const read = await store.file.read(space.key, user1) as IFile;
          assert.lengthOf(read.permissionIds, 1,' has a new permission id');
          assert.lengthOf(read.permissions, 1,' has a new permission');

          const [p] = read.permissions;
          assert.equal(p.addingUser, user1.key, 'adds the addingUser');
          assert.equal(p.owner, user2.key, 'adds the owner');
          assert.equal(p.role, 'reader', 'adds the role');
          assert.equal(p.type, 'user', 'adds the type');
        });

        it('creates a permission only once per group', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.file.add(space.key, space, user1);

          await patchFileAccess(space.key, user1, [{
            op: 'add',
            type: 'group',
            value: 'commenter',
            id: 'a-group',
          } as AccessOperation]);

          await patchFileAccess(space.key, user1, [{
            op: 'add',
            type: 'group',
            value: 'reader',
            id: 'a-group',
          } as AccessOperation]);

          const read = await store.file.read(space.key, user1) as IFile;
          assert.lengthOf(read.permissionIds, 1,' has a new permission id');
          assert.lengthOf(read.permissions, 1,' has a new permission');

          const [p] = read.permissions;
          assert.equal(p.addingUser, user1.key, 'adds the addingUser');
          assert.equal(p.owner, 'a-group', 'adds the owner');
          assert.equal(p.role, 'reader', 'adds the role');
          assert.equal(p.type, 'group', 'adds the type');
        });

        it('creates a permission only once per anyone', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.file.add(space.key, space, user1);

          await patchFileAccess(space.key, user1, [{
            op: 'add',
            type: 'anyone',
            value: 'commenter',
          } as AccessOperation]);

          await patchFileAccess(space.key, user1, [{
            op: 'add',
            type: 'anyone',
            value: 'reader',
          } as AccessOperation]);

          const read = await store.file.read(space.key, user1) as IFile;
          assert.lengthOf(read.permissionIds, 1,' has a new permission id');
          assert.lengthOf(read.permissions, 1,' has a new permission');

          const [p] = read.permissions;
          assert.equal(p.addingUser, user1.key, 'adds the addingUser');
          assert.isUndefined(p.owner, 'does not add the owner');
          assert.equal(p.role, 'reader', 'adds the role');
          assert.equal(p.type, 'anyone', 'adds the type');
        });

        it('throws when the user does not exist', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.file.add(space.key, space, user1);

          let error: ApiError | undefined;
          try {
            await patchFileAccess(space.key, user1, [{
              op: 'add',
              type: 'user',
              value: 'commenter',
              id: 'invalid',
            } as AccessOperation]);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `User "invalid" not found.`);
            assert.equal(error.code, 400);
          }
        });

        it('throws when the expiration time is in the past when adding a user', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.file.add(space.key, space, user1);

          let error: ApiError | undefined;
          try {
            await patchFileAccess(space.key, user1, [{
              op: 'add',
              type: 'user',
              value: 'commenter',
              id: user2.key,
              expirationTime: Date.now() - 1000000,
            } as AccessOperation]);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `The permission expiration date is in the past.`);
            assert.equal(error.code, 400);
          }
        });

        it('throws when the expiration time is in the past when adding a group', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.file.add(space.key, space, user1);

          let error: ApiError | undefined;
          try {
            await patchFileAccess(space.key, user1, [{
              op: 'add',
              type: 'group',
              value: 'commenter',
              id: 'a-group',
              expirationTime: Date.now() - 1000000,
            } as AccessOperation]);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `The permission expiration date is in the past.`);
            assert.equal(error.code, 400);
          }
        });

        it('throws when the expiration time is in the past when adding "anyone""', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.file.add(space.key, space, user1);

          let error: ApiError | undefined;
          try {
            await patchFileAccess(space.key, user1, [{
              op: 'add',
              type: 'anyone',
              value: 'commenter',
              expirationTime: Date.now() - 1000000,
            } as AccessOperation]);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `The permission expiration date is in the past.`);
            assert.equal(error.code, 400);
          }
        });

        it('adds the expiration date', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.file.add(space.key, space, user1);
          const time = Date.now() + 10000000;
          await patchFileAccess(space.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'commenter',
            id: user2.key,
            expirationTime: time,
          } as AccessOperation]);

          const read = await store.file.read(space.key, user1) as IFile;
          assert.lengthOf(read.permissionIds, 1,' has a new permission id');
          assert.lengthOf(read.permissions, 1,' has a new permission');

          const [p] = read.permissions;
          assert.equal(p.expirationTime, time, 'adds the expirationTime');
        });

        it('throws when the id is missing when adding a user', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.file.add(space.key, space, user1);

          let error: ApiError | undefined;
          try {
            await patchFileAccess(space.key, user1, [{
              op: 'add',
              type: 'user',
              value: 'commenter',
              expirationTime: Date.now() - 1000000,
            } as AccessOperation]);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Missing "id" parameter when adding the permission to a user.`);
            assert.equal(error.code, 400);
          }
        });

        it('throws when the id is missing when adding a group', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.file.add(space.key, space, user1);

          let error: ApiError | undefined;
          try {
            await patchFileAccess(space.key, user1, [{
              op: 'add',
              type: 'group',
              value: 'commenter',
              expirationTime: Date.now() - 1000000,
            } as AccessOperation]);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Missing "id" parameter when adding the permission to a group.`);
            assert.equal(error.code, 400);
          }
        });

        it('informs the WS client when adding a user', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.file.add(space.key, space, user1);
          
          const spy = sinon.spy(Clients, 'notify');
          try {
            await patchFileAccess(space.key, user1, [{
              op: 'add',
              type: 'user',
              value: 'commenter',
              id: user2.key,
            } as AccessOperation]);
          } finally {
            spy.restore();
          }
          // the first is the access event, 2nd is the space change event
          assert.equal(spy.callCount, 2, 'Calls the notify function');
          const event = spy.args[0][0] as IBackendEvent;
          const filter = spy.args[0][1] as IClientFilterOptions;
          assert.equal(event.type, 'event');
          assert.equal(event.operation, 'access-granted');
          assert.equal(event.id, space.key, 'has the space id');
          assert.equal(event.kind, WorkspaceKind);
          assert.equal(filter.url, RouteBuilder.files());
          assert.deepEqual(filter.users, [user2.key], 'informs only the user which gained the permission');
        });

        it('removes a permission from a user', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.file.add(space.key, space, user1);

          await patchFileAccess(space.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'commenter',
            id: user2.key,
          } as AccessOperation]);

          await patchFileAccess(space.key, user1, [{
            op: 'remove',
            type: 'user',
            id: user2.key,
          } as AccessOperation]);

          const read = await store.file.read(space.key, user1) as IFile;
          assert.lengthOf(read.permissionIds, 0,' has no permission ids');
          assert.lengthOf(read.permissions, 0,' has no permissions');
        });

        it('ignores when user permission does not exist', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.file.add(space.key, space, user1);

          await patchFileAccess(space.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'commenter',
            id: user2.key,
          } as AccessOperation]);

          await patchFileAccess(space.key, user1, [{
            op: 'remove',
            type: 'user',
            id: 'another',
          } as AccessOperation]);

          const read = await store.file.read(space.key, user1) as IFile;
          assert.lengthOf(read.permissionIds, 1,' has original permission ids');
          assert.lengthOf(read.permissions, 1,' has original permissions');
        });

        it('throws when the id is missing when removing a user', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.file.add(space.key, space, user1);

          await patchFileAccess(space.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'commenter',
            id: user2.key,
          } as AccessOperation]);

          let error: ApiError | undefined;
          try {
            await patchFileAccess(space.key, user1, [{
              op: 'remove',
              type: 'user',
            } as AccessOperation]);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Missing "id" parameter when removing a user permission.`);
            assert.equal(error.code, 400);
          }
        });

        it('informs the WS client when removing a user', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.file.add(space.key, space, user1);

          await patchFileAccess(space.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'commenter',
            id: user2.key,
          } as AccessOperation]);
          
          const spy = sinon.spy(Clients, 'notify');
          try {
            await patchFileAccess(space.key, user1, [{
              op: 'remove',
              type: 'user',
              id: user2.key,
            } as AccessOperation]);
          } finally {
            spy.restore();
          }
          // the first is the access event, 2nd is the space change event
          assert.equal(spy.callCount, 2, 'Calls the notify function');
          const event = spy.args[0][0] as IBackendEvent;
          const filter = spy.args[0][1] as IClientFilterOptions;
          assert.equal(event.type, 'event');
          assert.equal(event.operation, 'access-removed');
          assert.equal(event.id, space.key, 'has the space id');
          assert.equal(event.kind, WorkspaceKind, 'has the kind');
          assert.equal(filter.url, RouteBuilder.files());
          assert.deepEqual(filter.users, [user2.key], 'only informs the user that has lost the access to the file');
        });

        it('removes a permission from a group', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.file.add(space.key, space, user1);

          await patchFileAccess(space.key, user1, [{
            op: 'add',
            type: 'group',
            value: 'commenter',
            id: 'group-a',
          } as AccessOperation]);

          await patchFileAccess(space.key, user1, [{
            op: 'remove',
            type: 'group',
            id: 'group-a',
          } as AccessOperation]);

          const read = await store.file.read(space.key, user1) as IFile;
          assert.lengthOf(read.permissionIds, 0,' has no permission ids');
          assert.lengthOf(read.permissions, 0,' has no permissions');
        });

        it('ignores when group permission does not exist', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.file.add(space.key, space, user1);

          await patchFileAccess(space.key, user1, [{
            op: 'add',
            type: 'group',
            value: 'commenter',
            id: 'group-a',
          } as AccessOperation]);

          await patchFileAccess(space.key, user1, [{
            op: 'remove',
            type: 'group',
            id: 'another',
          } as AccessOperation]);

          const read = await store.file.read(space.key, user1) as IFile;
          assert.lengthOf(read.permissionIds, 1,' has original permission ids');
          assert.lengthOf(read.permissions, 1,' has original permissions');
        });

        it('throws when the id is missing when removing a group', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.file.add(space.key, space, user1);

          await patchFileAccess(space.key, user1, [{
            op: 'add',
            type: 'group',
            value: 'commenter',
            id: 'group-a',
          } as AccessOperation]);

          let error: ApiError | undefined;
          try {
            await patchFileAccess(space.key, user1, [{
              op: 'remove',
              type: 'group',
            } as AccessOperation]);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Missing "id" parameter when removing a group permission.`);
            assert.equal(error.code, 400);
          }
        });

        it('removes the "anyone" permission', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.file.add(space.key, space, user1);

          await patchFileAccess(space.key, user1, [{
            op: 'add',
            type: 'anyone',
            value: 'commenter',
          } as AccessOperation]);

          await patchFileAccess(space.key, user1, [{
            op: 'remove',
            type: 'anyone',
          } as AccessOperation]);

          const read = await store.file.read(space.key, user1) as IFile;
          assert.lengthOf(read.permissionIds, 0,' has no permission ids');
          assert.lengthOf(read.permissions, 0,' has no permissions');
        });

        it('ignores when the "anyone" permission does not exist', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.file.add(space.key, space, user1);

          await patchFileAccess(space.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'commenter',
            id: user2.key,
          } as AccessOperation]);

          await patchFileAccess(space.key, user1, [{
            op: 'remove',
            type: 'anyone',
          } as AccessOperation]);

          const read = await store.file.read(space.key, user1) as IFile;
          assert.lengthOf(read.permissionIds, 1,' has original permission ids');
          assert.lengthOf(read.permissions, 1,' has original permissions');
        });

        it('adds the shared user store entry', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.file.add(space.key, space, user1);

          await patchFileAccess(space.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'commenter',
            id: user2.key,
          } as AccessOperation]);

          const key = KeyGenerator.sharedFile(space.kind, space.key, user2.key);
          const rawItem = await store.shared.db.get(key);
          const item = JSON.parse(rawItem.toString()) as ISharedLink;
          assert.equal(item.id, space.key, 'has the space key');
          assert.equal(item.uid, user2.key, 'has the user key');
          assert.isUndefined(item.parent, 'has no parent');
        });

        it('adds the shared user store entry for a sub-space', async () => {
          const s1 = Workspace.fromName('s1').toJSON();
          const s2 = Workspace.fromName('s2').toJSON();
          await store.file.add(s1.key, s1, user1);
          await store.file.add(s2.key, s2, user1, { parent: s1.key });

          await patchFileAccess(s2.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'commenter',
            id: user2.key,
          } as AccessOperation]);

          const key = KeyGenerator.sharedFile(s2.kind, s2.key, user2.key);
          const rawItem = await store.shared.db.get(key);
          const item = JSON.parse(rawItem.toString()) as ISharedLink;
          assert.equal(item.id, s2.key, 'has the space key');
          assert.equal(item.uid, user2.key, 'has the user key');
          assert.equal(item.parent, s1.key, 'has the parent');
        });

        it('removes the shared user store entry for a space', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.file.add(space.key, space, user1);

          await patchFileAccess(space.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'commenter',
            id: user2.key,
          } as AccessOperation]);

          await patchFileAccess(space.key, user1, [{
            op: 'remove',
            type: 'user',
            id: user2.key,
          } as AccessOperation]);

          let raw: any;
          const key = KeyGenerator.sharedFile(space.kind, space.key, user2.key);
          try {
            raw = await store.shared.db.get(key);
          } catch (e) {
            // ...
          }
          assert.isUndefined(raw);
        });

        it('removes the shared user store entry when deleting a space', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.file.add(space.key, space, user1);

          await patchFileAccess(space.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'commenter',
            id: user2.key,
          } as AccessOperation]);

          await store.file.delete(space.key, user1);

          let raw: any;
          const key = KeyGenerator.sharedFile(space.kind, space.key, user2.key);
          try {
            raw = await store.shared.db.get(key);
          } catch (e) {
            // ...
          }
          assert.isUndefined(raw);
        });

        it('informs the WS client about the space change', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.file.add(space.key, space, user1);
          
          const spy = sinon.spy(Clients, 'notify');
          try {
            await patchFileAccess(space.key, user1, [{
              op: 'add',
              type: 'user',
              value: 'commenter',
              id: user2.key,
            } as AccessOperation]);
          } finally {
            spy.restore();
          }
          // the first is the access event, 2nd is the space change event
          assert.equal(spy.callCount, 2, 'Calls the notify function');
          const event = spy.args[1][0] as IBackendEvent;
          const filter = spy.args[1][1] as IClientFilterOptions;
          assert.equal(event.type, 'event');
          assert.equal(event.operation, 'patch');
          assert.equal(event.id, space.key, 'has the space id');
          assert.equal(event.kind, WorkspaceKind);
          assert.equal(filter.url, RouteBuilder.files());
          assert.deepEqual(filter.users, [user1.key, user2.key]);
          const data = event.data as IPatchRevision;
          assert.typeOf(data, 'object', 'has the data object');
          assert.equal(data.app, 'x1', 'has the data.app');
          assert.equal(data.appVersion, '1', 'has the data.appVersion');
          assert.equal(data.id, '123', 'has the data.id');
          assert.typeOf(data.patch, 'array', 'has the data.patch');
          assert.typeOf(data.revert, 'array', 'has the data.revert');
        });

        it('updates the lastModified', async () => {
          const space = Workspace.fromName('s1').toJSON();
          const created = await store.file.add(space.key, space, user1);
          await Timers.sleep(1);
          await patchFileAccess(space.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'commenter',
            id: user2.key,
          } as AccessOperation]);
          const updated = await store.file.get(space.key, false) as IFile;
          assert.notEqual(created.lastModified.time, updated.lastModified.time);
        });
      });

      describe('checkAccess()', () => {
        const user1 = mock.user.user();
        const user2 = mock.user.user();

        before(async () => {
          await store.user.add(user1.key, user1);
          await store.user.add(user2.key, user2);
        });

        after(async () => {
          await store.user.db.clear();
          await store.file.db.clear();
          await store.permission.db.clear();
        });

        it('returns the role when the user has read permission with read minimum', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.file.add(space.key, space, user1);

          await patchFileAccess(space.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'reader',
            id: user2.key,
          } as AccessOperation]);

          const result = await store.file.checkAccess('reader', space.key, user2);
          assert.equal(result, 'reader');
        });

        it('returns the higher role when the requesting lower minimum', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.file.add(space.key, space, user1);

          await patchFileAccess(space.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'commenter',
            id: user2.key,
          } as AccessOperation]);

          const result = await store.file.checkAccess('reader', space.key, user2);
          assert.equal(result, 'commenter');
        });

        it('returns the inherited from the parent role', async () => {
          const s1 = Workspace.fromName('s1').toJSON();
          const s2 = Workspace.fromName('s2').toJSON();
          await store.file.add(s1.key, s1, user1);
          await store.file.add(s2.key, s2, user1, {
            parent: s1.key,
          });

          await patchFileAccess(s1.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'commenter',
            id: user2.key,
          } as AccessOperation]);

          const result = await store.file.checkAccess('reader', s2.key, user2);
          assert.equal(result, 'commenter');
        });

        it('returns the first inherited role from the parents tree', async () => {
          const s1 = Workspace.fromName('s1').toJSON();
          const s2 = Workspace.fromName('s2').toJSON();
          const s3 = Workspace.fromName('s3').toJSON();
          await store.file.add(s1.key, s1, user1);
          await store.file.add(s2.key, s2, user1, {
            parent: s1.key,
          });
          await store.file.add(s3.key, s3, user1, {
            parent: s2.key,
          });

          await patchFileAccess(s1.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'commenter',
            id: user2.key,
          } as AccessOperation]);
          await patchFileAccess(s2.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'writer',
            id: user2.key,
          } as AccessOperation]);

          const result = await store.file.checkAccess('reader', s3.key, user2);
          assert.equal(result, 'writer');
        });

        it('returns the owner role', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.file.add(space.key, space, user1);

          await patchFileAccess(space.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'reader',
            id: user2.key,
          } as AccessOperation]);

          const result = await store.file.checkAccess('reader', space.key, user1);
          assert.equal(result, 'owner');
        });

        it('throws when no user', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.file.add(space.key, space, user1);

          await patchFileAccess(space.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'reader',
            id: user2.key,
          } as AccessOperation]);

          let error: ApiError | undefined;
          try {
            // @ts-ignore
            await store.file.checkAccess('reader', space.key, undefined);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Authentication required.`);
            assert.equal(error.code, 401);
          }
        });

        it('throws when the user has no role in the resource', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.file.add(space.key, space, user1);

          let error: ApiError | undefined;
          try {
            await store.file.checkAccess('reader', space.key, user2);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Not found.`);
            assert.equal(error.code, 404);
          }
        });

        it('throws when the user has insufficient access', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.file.add(space.key, space, user1);

          await patchFileAccess(space.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'reader',
            id: user2.key,
          } as AccessOperation]);

          let error: ApiError | undefined;
          try {
            await store.file.checkAccess('writer', space.key, user2);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Insufficient permissions to access this resource.`);
            assert.equal(error.code, 403);
          }
        });
      });

      describe('list()', () => {
        const user1 = mock.user.user();
        const user2 = mock.user.user();
        
        before(async () => {
          await store.user.add(user1.key, user1);
          await store.user.add(user2.key, user2);

          await DataHelper.generateFiles(store, user1.key, 20);
          await DataHelper.generateProjects(store, user1.key, 20);
        });

        after(async () => {
          await store.file.db.clear();
          await store.user.db.clear();
          await store.project.db.clear();
          await store.permission.db.clear();
        });

        it('lists spaces and projects for the owner', async () => {
          const list = await store.file.list([ProjectKind], user1);
          assert.typeOf(list.cursor as string, 'string', 'has the cursor');
          assert.typeOf(list.data, 'array', 'has the data array');
          assert.lengthOf(list.data, 35, 'has the default list size');
          const projectKind = list.data.find(i => i.kind === ProjectKind);
          const spaceKind = list.data.find(i => i.kind === WorkspaceKind);
          assert.ok(projectKind, 'has a project kind');
          assert.ok(spaceKind, 'has a workspace kind');
        });

        it('supports the limit parameter', async () => {
          const list = await store.file.list([ProjectKind], user1, { limit: 4 });
          assert.typeOf(list.cursor as string, 'string', 'has the cursor');
          assert.typeOf(list.data, 'array', 'has the data array');
          assert.lengthOf(list.data, 4, 'has the set list size');
        });

        it('paginates to the next page', async () => {
          const list1 = await store.file.list([ProjectKind], user1, { limit: 2 });
          const list2 = await store.file.list([ProjectKind], user1, { cursor: list1.cursor });
          assert.lengthOf(list2.data, 2, 'uses the page cursor limit param');
          assert.notDeepEqual(list1.data[0], list2.data[0], 'arrays are not equal');
          assert.notDeepEqual(list1.data[1], list2.data[0], 'has the next element');
        });

        it('reaches the end of pagination', async () => {
          const list1 = await store.file.list([ProjectKind], user1, { limit: 35 });
          const list2 = await store.file.list([ProjectKind], user1, { cursor: list1.cursor });
          assert.lengthOf(list2.data, 5, 'has only remaining entires');
        });

        it('does not include other kinds', async () => {
          const list = await store.file.list(['unknown'], user1);
          assert.lengthOf(list.data, 20, 'has no root space'); // only projects
        });

        it('returns empty result when no sub-files', async () => {
          const s1 = Workspace.fromName('s1');
          await store.file.add(s1.key, s1.toJSON(), user1);
          const list = await store.file.list([ProjectKind], user1, { parent: s1.key });
          assert.typeOf(list.cursor as string, 'string', 'has the cursor');
          assert.typeOf(list.data, 'array', 'has the data array');
          assert.lengthOf(list.data, 0, 'has no results');
        });

        it('lists only files of a parent', async () => {
          const parent = Workspace.fromName('parent');
          const s1 = Workspace.fromName('s1');
          const s2 = Workspace.fromName('s2');
          const s3 = Workspace.fromName('s2');
          const s4 = Workspace.fromName('s4');
          await store.file.add(parent.key, parent.toJSON(), user1);
          await store.file.add(s1.key, s1.toJSON(), user1, { parent: parent.key });
          await store.file.add(s2.key, s2.toJSON(), user1, { parent: parent.key });
          await store.file.add(s3.key, s3.toJSON(), user1, { parent: s1.key });
          await store.file.add(s4.key, s4.toJSON(), user1, { parent: s1.key });

          const list = await store.file.list([ProjectKind], user1, { parent: parent.key });
          assert.typeOf(list.cursor as string, 'string', 'has the cursor');
          assert.typeOf(list.data, 'array', 'has the data array');
          assert.lengthOf(list.data, 2, 'has all spaces');
          const readIds = [list.data[0].key, list.data[1].key];
          assert.include(readIds, s1.key);
          assert.include(readIds, s2.key);
        });

        it('lists only files of a deep parent', async () => {
          const parent = Workspace.fromName('parent');
          const s1 = Workspace.fromName('s1');
          const s2 = Workspace.fromName('s2');
          const s3 = Workspace.fromName('s2');
          const s4 = Workspace.fromName('s4');
          await store.file.add(parent.key, parent.toJSON(), user1);
          await store.file.add(s1.key, s1.toJSON(), user1, { parent: parent.key });
          await store.file.add(s2.key, s2.toJSON(), user1, { parent: parent.key });
          await store.file.add(s3.key, s3.toJSON(), user1, { parent: s1.key });
          await store.file.add(s4.key, s4.toJSON(), user1, { parent: s1.key });

          const list = await store.file.list([ProjectKind], user1, { parent: s1.key });
          assert.typeOf(list.cursor as string, 'string', 'has the cursor');
          assert.typeOf(list.data, 'array', 'has the data array');
          assert.lengthOf(list.data, 2, 'has all spaces');
          const readIds = [list.data[0].key, list.data[1].key];
          assert.include(readIds, s3.key);
          assert.include(readIds, s4.key);
        });

        it('does not list shared spaces from the root level', async () => {
          const parent = Workspace.fromName('parent');
          const s1 = Workspace.fromName('s1');
          const s2 = Workspace.fromName('s2');
          const s3 = Workspace.fromName('s2');
          const s4 = Workspace.fromName('s4');
          await store.file.add(parent.key, parent.toJSON(), user1);
          await store.file.add(s1.key, s1.toJSON(), user1, { parent: parent.key });
          await store.file.add(s2.key, s2.toJSON(), user1, { parent: parent.key });
          await store.file.add(s3.key, s3.toJSON(), user1, { parent: s1.key });
          await store.file.add(s4.key, s4.toJSON(), user1, { parent: s1.key });

          await patchFileAccess(parent.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'reader',
            id: user2.key,
          } as AccessOperation]);

          const list = await store.file.list([ProjectKind], user2);
          assert.lengthOf(list.data, 0, 'has no root space');
        });

        it('modifies the "lastModified.byMe"', async () => {
          const parent = Workspace.fromName('parent');
          await store.file.add(parent.key, parent.toJSON(), user1);
          const list = await store.file.list(['test'], user1);
          const item = list.data.find(i => i.key === parent.key) as IFile;
          assert.ok(item, 'has the owner item');
          assert.isTrue(item.lastModified.byMe, 'owner item is modified by the owner');
        });

        it('adds the file permissions', async () => {
          const parent = Workspace.fromName('parent');
          await store.file.add(parent.key, parent.toJSON(), user1);

          await patchFileAccess(parent.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'reader',
            id: user2.key,
          } as AccessOperation]);

          const list = await store.file.list(['test'], user1);
          const item = list.data.find(i => i.key === parent.key) as IFile;
          assert.ok(item, 'has the owner item');
          assert.lengthOf(item.permissions, 1);
        });

        it('lists shared files for a parent', async () => {
          const parent = Workspace.fromName('parent');
          const s1 = Workspace.fromName('s1');
          const s2 = Workspace.fromName('s2');
          const s3 = Workspace.fromName('s2');
          const s4 = Workspace.fromName('s4');
          await store.file.add(parent.key, parent.toJSON(), user1);
          await store.file.add(s1.key, s1.toJSON(), user1, { parent: parent.key });
          await store.file.add(s2.key, s2.toJSON(), user1, { parent: parent.key });
          await store.file.add(s3.key, s3.toJSON(), user1, { parent: s1.key });
          await store.file.add(s4.key, s4.toJSON(), user1, { parent: s1.key });

          await patchFileAccess(parent.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'reader',
            id: user2.key,
          } as AccessOperation]);

          const list = await store.file.list(['test'], user2, { parent: parent.key });
          assert.lengthOf(list.data, 2);
        });

        it('sets files capabilities for the owner', async () => {
          const list = await store.file.list([ProjectKind], user1, { limit: 1 });
          const [file] = list.data;
          const c = file.capabilities as ICapabilities;
          assert.typeOf(c, 'object', 'has capabilities')
          assert.isTrue(c.canEdit);
        });

        it('sets files capabilities for a shared user', async () => {
          const parent = Workspace.fromName('parent');
          const s1 = Workspace.fromName('s1');
          await store.file.add(parent.key, parent.toJSON(), user1);
          await store.file.add(s1.key, s1.toJSON(), user1, { parent: parent.key });

          await patchFileAccess(parent.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'reader',
            id: user2.key,
          } as AccessOperation]);

          const list = await store.file.list(['test'], user2, { parent: parent.key });
          const [file] = list.data;
          const c = file.capabilities as ICapabilities;
          assert.typeOf(c, 'object', 'has capabilities')
          assert.isFalse(c.canEdit);
        });
      });

      describe('applyPatch()', () => {
        const user1 = mock.user.user();
        const user2 = mock.user.user();
        let s1: IFile;
        
        before(async () => {
          await store.user.add(user1.key, user1);
          await store.user.add(user2.key, user2);

          await DataHelper.generateFiles(store, user1.key, 20);
          await DataHelper.generateProjects(store, user1.key, 20);
        });

        after(async () => {
          await store.file.db.clear();
          await store.user.db.clear();
          await store.project.db.clear();
          await store.permission.db.clear();
        });

        beforeEach(async () => {
          const space = Workspace.fromName('s1');
          s1 = await store.file.add(space.key, space.toJSON(), user1);
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
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch,
          };
          const data = await store.file.applyPatch(s1.key, info, user1);
          
          assert.typeOf(data, 'object', 'has the data object');
          assert.equal(data.app, 'x1', 'has the data.app');
          assert.equal(data.appVersion, '1', 'has the data.appVersion');
          assert.equal(data.id, '123', 'has the data.id');
          assert.deepEqual(data.patch, patch, 'has the data.patch');
          assert.typeOf(data.revert, 'array', 'has the data.revert');
        });

        it('persists the data', async () => {
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
          await store.file.applyPatch(s1.key, info, user1);
          const space = await store.file.get(s1.key) as IFile;
          assert.equal(space.info.name, 'Other name', 'has the applied patch');
        });

        it('throws when invalid patch', async () => {
          const patch: any = [
            {
              test: "hello"
            }
          ];
          const info: IPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch,
          };
          let error: ApiError | undefined;
          try {
            await store.file.applyPatch(s1.key, info, user1);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Malformed patch information.`);
            assert.equal(error.code, 400);
          }
        });

        [
          '/permissions', '/permissionIds', '/deleted', '/deletedInfo', '/parents', '/key', 
          '/kind', '/owner', '/lastModified', '/capabilities'
        ].forEach((key) => {
          it(`ignores patch path ${key}`, async () => {
            const patch: JsonPatch = [
              { op: 'replace', path: key, value: 'test' }
            ];
            const info: IPatchInfo = {
              app: 'x1',
              appVersion: '1',
              id: '123',
              patch,
            };
            const result = await store.file.applyPatch(s1.key, info, user1);
            assert.deepEqual(result.revert, []);
          });
        });

        it('throws when not found', async () => {
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
          let error: ApiError | undefined;
          try {
            await store.file.applyPatch('unknown', info, user1);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Not found.`);
            assert.equal(error.code, 404);
          }
        });

        it('throws when the user does not have the write access', async () => {
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
          await patchFileAccess(s1.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'reader',
            id: user2.key,
          } as AccessOperation]);

          let error: ApiError | undefined;
          try {
            await store.file.applyPatch(s1.key, info, user2);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Insufficient permissions to access this resource.`);
            assert.equal(error.code, 403);
          }
        });

        it('patches by the user with the write access', async () => {
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
          await patchFileAccess(s1.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'writer',
            id: user2.key,
          } as AccessOperation]);
          await store.file.applyPatch(s1.key, info, user2);
        });

        it('informs the WS client', async () => {
          await patchFileAccess(s1.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'writer',
            id: user2.key,
          } as AccessOperation]);

          const spy = sinon.spy(Clients, 'notify');
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
            await store.file.applyPatch(s1.key, info, user1);
          } finally {
            spy.restore();
          }
          assert.equal(spy.callCount, 1, 'Calls the notify function');
          const event = spy.args[0][0] as IBackendEvent;
          const filter = spy.args[0][1] as IClientFilterOptions;
          assert.equal(event.type, 'event');
          assert.equal(event.operation, 'patch');
          assert.equal(event.kind, s1.kind);
          assert.equal(event.id, s1.key);

          const data = event.data as IPatchRevision;
          
          assert.typeOf(data, 'object', 'has the data object');
          assert.equal(data.app, 'x1', 'has the data.app');
          assert.equal(data.appVersion, '1', 'has the data.appVersion');
          assert.equal(data.id, '123', 'has the data.id');
          assert.typeOf(data.patch, 'array', 'has the data.patch');
          assert.typeOf(data.revert, 'array', 'has the data.revert');

          const apiPath = RouteBuilder.files();
          assert.equal(filter.url, apiPath);
          assert.deepEqual(filter.users, [user1.key, user2.key]);
        });

        it('updates the lastUpdated', async () => {
          await Timers.sleep(1);
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
          await store.file.applyPatch(s1.key, info, user1);
          const updated = await store.file.get(s1.key) as IFile;
          assert.notEqual(s1.lastModified.time, updated.lastModified.time);
        });
      });

      describe('delete()', () => {
        const user1 = mock.user.user();
        const user2 = mock.user.user();
        let s1: IFile;
        
        before(async () => {
          await store.user.add(user1.key, user1);
          await store.user.add(user2.key, user2);

          await DataHelper.generateFiles(store, user1.key, 20);
          await DataHelper.generateProjects(store, user1.key, 20);
        });

        after(async () => {
          await store.file.db.clear();
          await store.user.db.clear();
          await store.project.db.clear();
          await store.permission.db.clear();
        });

        beforeEach(async () => {
          const space = Workspace.fromName('s1');
          s1 = await store.file.add(space.key, space.toJSON(), user1);
        });

        it('marks the project as deleted', async () => {
          await store.file.delete(s1.key, user1);
          const data = await store.file.get(s1.key) as IFile;
          assert.isTrue(data.deleted);
        });

        it('adds the deletedInfo', async () => {
          await store.file.delete(s1.key, user1);
          const data = await store.file.get(s1.key) as IFile;
          assert.typeOf(data.deletedInfo, 'object');
          // this "if" is for types, line above tests whether property exists
          if (data.deletedInfo) {
            assert.equal(data.deletedInfo.user, user1.key);
            assert.typeOf(data.deletedInfo.time, 'number');
          }
        });

        it('adds the space to the bin', async () => {
          await store.file.delete(s1.key, user1);
          const deletedKey = KeyGenerator.deletedSpaceKey(s1.key);
          const raw = await store.bin.db.get(deletedKey);
          assert.ok(raw);
        });

        it('throws when no file', async () => {
          let error: ApiError | undefined;
          try {
            await store.file.delete('unknown', user1);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Not found.`);
            assert.equal(error.code, 404);
          }
        });

        it('throws when no access rights', async () => {
          let error: ApiError | undefined;
          try {
            await store.file.delete(s1.key, user2);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Not found.`);
            assert.equal(error.code, 404);
          }
        });

        it('throws when has no owner access', async () => {
          await patchFileAccess(s1.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'writer',
            id: user2.key,
          } as AccessOperation]);

          let error: ApiError | undefined;
          try {
            await store.file.delete(s1.key, user2);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Unauthorized to delete the object.`);
            assert.equal(error.code, 403);
          }
        });

        it('deletes by the user with an owner access', async () => {
          await patchFileAccess(s1.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'owner',
            id: user2.key,
          } as AccessOperation]);
          await store.file.delete(s1.key, user2);
        });

        it('informs the WS client', async () => {
          const spy = sinon.spy(Clients, 'notify');
          try {
            await store.file.delete(s1.key, user1);
          } finally {
            spy.restore();
          }
          assert.isTrue(spy.calledOnce, 'Calls the notify function');
          const event = spy.args[0][0] as IBackendEvent;
          const filter = spy.args[0][1] as IClientFilterOptions;
          assert.equal(event.type, 'event');
          assert.equal(event.operation, 'deleted');
          assert.equal(event.kind, WorkspaceKind);
          assert.equal(event.id, s1.key);
          assert.equal(filter.url, RouteBuilder.files());
        });
      });

      describe('listUsers()', () => {
        const user1 = mock.user.user();
        const user2 = mock.user.user();
        let s1: IFile;
        
        before(async () => {
          await store.user.add(user1.key, user1);
          await store.user.add(user2.key, user2);

          await DataHelper.generateFiles(store, user1.key, 20);
          await DataHelper.generateProjects(store, user1.key, 20);
        });

        after(async () => {
          await store.file.db.clear();
          await store.user.db.clear();
          await store.project.db.clear();
          await store.permission.db.clear();
        });

        beforeEach(async () => {
          const space = Workspace.fromName('s1');
          s1 = await store.file.add(space.key, space.toJSON(), user1);
        });

        it('returns empty list when file is not shared', async () => {
          const result = await store.file.listUsers(s1.key, user1);
          assert.deepEqual(result.data, []);
        });

        it('lists users with the "user" permission', async () => {
          await patchFileAccess(s1.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'reader',
            id: user2.key,
          } as AccessOperation]);

          await patchFileAccess(s1.key, user1, [{
            op: 'add',
            type: 'group',
            value: 'writer',
            id: 'some-group',
          } as AccessOperation]);

          await patchFileAccess(s1.key, user1, [{
            op: 'add',
            type: 'anyone',
            value: 'commenter',
          } as AccessOperation]);

          const result = await store.file.listUsers(s1.key, user1);
          const cp = { ...user2 };
          delete cp.provider;
          // Note, this will fail when adding full support to groups.
          assert.deepEqual(result.data, [cp]);
        });
      });

      describe('fileUserIds()', () => {
        const user1 = mock.user.user();
        const user2 = mock.user.user();
        const user3 = mock.user.user();
        const user4 = mock.user.user();
        let s1: IFile;
        
        before(async () => {
          await store.user.add(user1.key, user1);
          await store.user.add(user2.key, user2);
          await store.user.add(user3.key, user3);
          await store.user.add(user4.key, user4);

          await DataHelper.generateFiles(store, user1.key, 20);
          await DataHelper.generateProjects(store, user1.key, 20);
        });

        after(async () => {
          await store.file.db.clear();
          await store.user.db.clear();
          await store.project.db.clear();
          await store.permission.db.clear();
        });

        beforeEach(async () => {
          const space = Workspace.fromName('s1');
          s1 = await store.file.add(space.key, space.toJSON(), user1);
        });

        it('returns only the owner when the file is not shared', async () => {
          const result = await store.file.fileUserIds(s1.key);
          assert.deepEqual(result, [user1.key]);
        });

        it('lists users with the "user" permission', async () => {
          await patchFileAccess(s1.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'reader',
            id: user2.key,
          } as AccessOperation]);

          await patchFileAccess(s1.key, user1, [{
            op: 'add',
            type: 'group',
            value: 'writer',
            id: 'some-group',
          } as AccessOperation]);

          await patchFileAccess(s1.key, user1, [{
            op: 'add',
            type: 'anyone',
            value: 'commenter',
          } as AccessOperation]);

          const result = await store.file.fileUserIds(s1.key);
          // Note, this will fail when adding full support to groups.
          assert.deepEqual(result, [user1.key, user2.key]);
        });

        it('includes parents users', async () => {
          const s2 = Workspace.fromName('s2');
          await store.file.add(s2.key, s2.toJSON(), user1, { parent: s1.key });
          const project = HttpProject.fromName('p1');
          await DataHelper.addProject(store, project, user1, s2.key);
          await patchFileAccess(s1.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'reader',
            id: user2.key,
          } as AccessOperation]);
          await patchFileAccess(s2.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'reader',
            id: user3.key,
          } as AccessOperation]);
          await patchFileAccess(project.key, user1, [{
            op: 'add',
            type: 'user',
            value: 'reader',
            id: user4.key,
          } as AccessOperation]);
          const result = await store.file.fileUserIds(project.key);
          assert.deepEqual(result, [user1.key, user4.key, user3.key, user2.key]);
        });
      });
    });
  });
});
