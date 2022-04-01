import { assert } from 'chai';
import fs from 'fs/promises';
import path from 'path';
import sinon from 'sinon';
import { 
  DefaultLogger, IWorkspace, ProjectMock, IBackendEvent, Workspace, 
  RouteBuilder, AccessOperation, WorkspaceKind, IPermission,
} from '@api-client/core';
import { StoreLevelUp } from '../../src/persistence/StoreLevelUp.js';
import { ISharedLink } from '../../src/persistence/LevelSharedStore.js';
import { KeyGenerator } from '../../src/persistence/KeyGenerator.js';
import Clients, { IClientFilterOptions } from '../../src/routes/WsClients.js';
import { ApiError } from '../../src/ApiError.js';

const storePath = path.join('test', 'data', 'units', 'store', 'spaces');

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

  describe('LevelSpaceStore', () => {
    describe('#space', () => {
      describe('defaultSpace()', () => {
        it('returns a default workspace', () => {
          const result = store.space.defaultSpace();
          assert.typeOf(result, 'object', 'returns an object');
          assert.equal(result.info.name, 'Drafts', 'sets the name');
        });

        it('adds the owner', () => {
          const result = store.space.defaultSpace('test');
          assert.typeOf(result, 'object', 'returns an object');
          assert.equal(result.owner, 'test', 'sets the owner');
        });
      });

      describe('add() and read()', () => {
        const user1 = mock.user.user();
        const user2 = mock.user.user();

        before(async () => {
          await store.user.add(user1.key, user1);
          await store.user.add(user2.key, user2);
        });

        after(async () => {
          await store.user.db.clear();
          await store.space.db.clear();
        });

        it('creates a new space', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.space.add(space.key, space, user1);

          const readResult = await store.space.read(space.key, user1);
          assert.deepEqual(readResult, space);
        });

        it('adds default values', async () => {
          const space = Workspace.fromName('s1').toJSON();
          // these fields are ignored
          space.owner = 'o1';
          space.permissionIds = ['p1'];
          space.parents = ['p2'];
          space.permissions = [{ key: 'p1', addingUser: '1', kind: 'Core#Permission', role: 'commenter', type: 'anyone' }];
          await store.space.add(space.key, space, user1);

          const readResult = await store.space.read(space.key, user1) as IWorkspace;
          assert.deepEqual(readResult.permissions, []);
          assert.deepEqual(readResult.permissionIds, []);
          assert.deepEqual(readResult.parents, []);
          assert.equal(readResult.owner, user1.key);
        });

        it('throws when re-creating the space', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.space.add(space.key, space, user1);

          let error: ApiError | undefined;
          try {
            await store.space.add(space.key, space, user1);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `A space with the identifier ${space.key} already exists`);
            assert.equal(error.code, 400);
          }
        });

        it('adds sub-spaces', async () => {
          const s1 = Workspace.fromName('s1').toJSON();
          const s2 = Workspace.fromName('s2').toJSON();
          const s3 = Workspace.fromName('s2').toJSON();
          const s4 = Workspace.fromName('s4').toJSON();
          await store.space.add(s1.key, s1, user1);
          await store.space.add(s2.key, s2, user1, { parent: s1.key });
          await store.space.add(s3.key, s3, user1, { parent: s2.key });
          await store.space.add(s4.key, s4, user1, { parent: s3.key });

          const r1 = await store.space.read(s1.key, user1) as IWorkspace;
          const r2 = await store.space.read(s2.key, user1) as IWorkspace;
          const r3 = await store.space.read(s3.key, user1) as IWorkspace;
          const r4 = await store.space.read(s4.key, user1) as IWorkspace;

          assert.equal(r1.key, s1.key, 'creates the root parent');
          assert.equal(r2.key, s2.key, 'creates a child #1');
          assert.equal(r3.key, s3.key, 'creates a child #2');
          assert.equal(r4.key, s4.key, 'creates a child #4');
          
          assert.deepEqual(r1.parents, [], 'root parents are empty');
          assert.deepEqual(r2.parents, [r1.key], 'child #1 parents are set');
          assert.deepEqual(r3.parents, [r1.key, r2.key], 'child #2 parents are set');
          assert.deepEqual(r4.parents, [r1.key, r2.key, r3.key], 'child #2 parents are set');
        });

        it('throws when the user has no access to the parent', async () => {
          const parent = Workspace.fromName('parent').toJSON();
          await store.space.add(parent.key, parent, user1);
          const child = Workspace.fromName('child').toJSON();

          let error: ApiError | undefined;
          try {
            await store.space.add(child.key, child, user2, { parent: parent.key });
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Not found.`);
            assert.equal(error.code, 404);
          }
        });

        it('throws when the user has insufficient access to the parent', async () => {
          const parent = Workspace.fromName('parent').toJSON();
          await store.space.add(parent.key, parent, user1);
          await store.space.patchAccess(parent.key, [{
            op: 'add',
            type: 'user',
            value: 'commenter',
            id: user2.key,
          } as AccessOperation], user1);
          const child = Workspace.fromName('child').toJSON();

          let error: ApiError | undefined;
          try {
            await store.space.add(child.key, child, user2, { parent: parent.key });
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Insufficient permissions to access this resource.`);
            assert.equal(error.code, 403);
          }
        });

        it('adds when user has write access to the parent', async () => {
          const parent = Workspace.fromName('parent').toJSON();
          await store.space.add(parent.key, parent, user1);
          await store.space.patchAccess(parent.key, [{
            op: 'add',
            type: 'user',
            value: 'writer',
            id: user2.key,
          } as AccessOperation], user1);
          const child = Workspace.fromName('child').toJSON();
          await store.space.add(child.key, child, user2, { parent: parent.key });
          const readResult = await store.space.read(child.key, user2) as IWorkspace;
          assert.equal(readResult.owner, user2.key, 'the space has the owner');
        });

        it('throws when the parent space does not exist', async () => {
          const child = Workspace.fromName('child').toJSON();

          let error: ApiError | undefined;
          try {
            await store.space.add(child.key, child, user2, { parent: 'other' });
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Not found.`);
            assert.equal(error.code, 404);
          }
        });

        it('informs the WS client', async () => {
          const spy = sinon.spy(Clients, 'notify');
          const space = Workspace.fromName('s1').toJSON();
          try {
            await store.space.add(space.key, space, user1);
          } finally {
            spy.restore();
          }
          assert.isTrue(spy.calledOnce, 'Calls the notify function');
          const event = spy.args[0][0] as IBackendEvent;
          const filter = spy.args[0][1] as IClientFilterOptions;
          assert.equal(event.type, 'event');
          assert.equal(event.operation, 'created');
          assert.typeOf(event.data, 'object');
          assert.equal(event.kind, WorkspaceKind);
          const apiPath = RouteBuilder.spaces();
          assert.equal(filter.url, apiPath);
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
          await store.space.db.clear();
        });

        it('adds another user to the space', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.space.add(space.key, space, user1);

          await store.space.patchAccess(space.key, [{
            op: 'add',
            type: 'user',
            value: 'commenter',
            id: user2.key,
          } as AccessOperation], user1);

          const read = await store.space.read(space.key, user1) as IWorkspace;
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
          await store.space.add(space.key, space, user1);

          await store.space.patchAccess(space.key, [{
            op: 'add',
            type: 'user',
            value: 'commenter',
            id: user2.key,
          } as AccessOperation], user1);

          const read = await store.space.read(space.key, user1) as IWorkspace;
          assert.lengthOf(read.permissionIds, 1,' has a new permission id');
          const p = await store.permission.read(read.permissionIds[0]) as IPermission;
          assert.equal(p.addingUser, user1.key, 'adds the addingUser');
          assert.equal(p.owner, user2.key, 'adds the owner');
          assert.equal(p.role, 'commenter', 'adds the role');
          assert.equal(p.type, 'user', 'adds the type');
        });

        it('adds access to anyone', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.space.add(space.key, space, user1);

          await store.space.patchAccess(space.key, [{
            op: 'add',
            type: 'anyone',
            value: 'commenter',
          } as AccessOperation], user1);

          const read = await store.space.read(space.key, user1) as IWorkspace;
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
          await store.space.add(space.key, space, user1);

          await store.space.patchAccess(space.key, [{
            op: 'add',
            type: 'group',
            value: 'commenter',
            id: 'a-group'
          } as AccessOperation], user1);

          const read = await store.space.read(space.key, user1) as IWorkspace;
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
          await store.space.add(space.key, space, user1);

          await store.space.patchAccess(space.key, [{
            op: 'add',
            type: 'user',
            value: 'commenter',
            id: user2.key,
          } as AccessOperation], user1);

          await store.space.patchAccess(space.key, [{
            op: 'add',
            type: 'user',
            value: 'reader',
            id: user2.key,
          } as AccessOperation], user1);

          const read = await store.space.read(space.key, user1) as IWorkspace;
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
          await store.space.add(space.key, space, user1);

          await store.space.patchAccess(space.key, [{
            op: 'add',
            type: 'group',
            value: 'commenter',
            id: 'a-group',
          } as AccessOperation], user1);

          await store.space.patchAccess(space.key, [{
            op: 'add',
            type: 'group',
            value: 'reader',
            id: 'a-group',
          } as AccessOperation], user1);

          const read = await store.space.read(space.key, user1) as IWorkspace;
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
          await store.space.add(space.key, space, user1);

          await store.space.patchAccess(space.key, [{
            op: 'add',
            type: 'anyone',
            value: 'commenter',
          } as AccessOperation], user1);

          await store.space.patchAccess(space.key, [{
            op: 'add',
            type: 'anyone',
            value: 'reader',
          } as AccessOperation], user1);

          const read = await store.space.read(space.key, user1) as IWorkspace;
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
          await store.space.add(space.key, space, user1);

          let error: ApiError | undefined;
          try {
            await store.space.patchAccess(space.key, [{
              op: 'add',
              type: 'user',
              value: 'commenter',
              id: 'invalid',
            } as AccessOperation], user1);
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
          await store.space.add(space.key, space, user1);

          let error: ApiError | undefined;
          try {
            await store.space.patchAccess(space.key, [{
              op: 'add',
              type: 'user',
              value: 'commenter',
              id: user2.key,
              expirationTime: Date.now() - 1000000,
            } as AccessOperation], user1);
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
          await store.space.add(space.key, space, user1);

          let error: ApiError | undefined;
          try {
            await store.space.patchAccess(space.key, [{
              op: 'add',
              type: 'group',
              value: 'commenter',
              id: 'a-group',
              expirationTime: Date.now() - 1000000,
            } as AccessOperation], user1);
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
          await store.space.add(space.key, space, user1);

          let error: ApiError | undefined;
          try {
            await store.space.patchAccess(space.key, [{
              op: 'add',
              type: 'anyone',
              value: 'commenter',
              expirationTime: Date.now() - 1000000,
            } as AccessOperation], user1);
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
          await store.space.add(space.key, space, user1);
          const time = Date.now() + 10000000;
          await store.space.patchAccess(space.key, [{
            op: 'add',
            type: 'user',
            value: 'commenter',
            id: user2.key,
            expirationTime: time,
          } as AccessOperation], user1);

          const read = await store.space.read(space.key, user1) as IWorkspace;
          assert.lengthOf(read.permissionIds, 1,' has a new permission id');
          assert.lengthOf(read.permissions, 1,' has a new permission');

          const [p] = read.permissions;
          assert.equal(p.expirationTime, time, 'adds the expirationTime');
        });

        it('throws when the id is missing when adding a user', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.space.add(space.key, space, user1);

          let error: ApiError | undefined;
          try {
            await store.space.patchAccess(space.key, [{
              op: 'add',
              type: 'user',
              value: 'commenter',
              expirationTime: Date.now() - 1000000,
            } as AccessOperation], user1);
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
          await store.space.add(space.key, space, user1);

          let error: ApiError | undefined;
          try {
            await store.space.patchAccess(space.key, [{
              op: 'add',
              type: 'group',
              value: 'commenter',
              expirationTime: Date.now() - 1000000,
            } as AccessOperation], user1);
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
          await store.space.add(space.key, space, user1);
          
          const spy = sinon.spy(Clients, 'notify');
          try {
            await store.space.patchAccess(space.key, [{
              op: 'add',
              type: 'user',
              value: 'commenter',
              id: user2.key,
            } as AccessOperation], user1);
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
          assert.equal(filter.url, RouteBuilder.spaces());
        });

        it('removes a permission from a user', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.space.add(space.key, space, user1);

          await store.space.patchAccess(space.key, [{
            op: 'add',
            type: 'user',
            value: 'commenter',
            id: user2.key,
          } as AccessOperation], user1);

          await store.space.patchAccess(space.key, [{
            op: 'remove',
            type: 'user',
            id: user2.key,
          } as AccessOperation], user1);

          const read = await store.space.read(space.key, user1) as IWorkspace;
          assert.lengthOf(read.permissionIds, 0,' has no permission ids');
          assert.lengthOf(read.permissions, 0,' has no permissions');
        });

        it('ignores when user permission does not exist', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.space.add(space.key, space, user1);

          await store.space.patchAccess(space.key, [{
            op: 'add',
            type: 'user',
            value: 'commenter',
            id: user2.key,
          } as AccessOperation], user1);

          await store.space.patchAccess(space.key, [{
            op: 'remove',
            type: 'user',
            id: 'another',
          } as AccessOperation], user1);

          const read = await store.space.read(space.key, user1) as IWorkspace;
          assert.lengthOf(read.permissionIds, 1,' has original permission ids');
          assert.lengthOf(read.permissions, 1,' has original permissions');
        });

        it('throws when the id is missing when removing a user', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.space.add(space.key, space, user1);

          await store.space.patchAccess(space.key, [{
            op: 'add',
            type: 'user',
            value: 'commenter',
            id: user2.key,
          } as AccessOperation], user1);

          let error: ApiError | undefined;
          try {
            await store.space.patchAccess(space.key, [{
              op: 'remove',
              type: 'user',
            } as AccessOperation], user1);
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
          await store.space.add(space.key, space, user1);

          await store.space.patchAccess(space.key, [{
            op: 'add',
            type: 'user',
            value: 'commenter',
            id: user2.key,
          } as AccessOperation], user1);
          
          const spy = sinon.spy(Clients, 'notify');
          try {
            await store.space.patchAccess(space.key, [{
              op: 'remove',
              type: 'user',
              id: user2.key,
            } as AccessOperation], user1);
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
          assert.equal(event.kind, WorkspaceKind);
          assert.equal(filter.url, RouteBuilder.spaces());
        });

        it('removes a permission from a group', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.space.add(space.key, space, user1);

          await store.space.patchAccess(space.key, [{
            op: 'add',
            type: 'group',
            value: 'commenter',
            id: 'group-a',
          } as AccessOperation], user1);

          await store.space.patchAccess(space.key, [{
            op: 'remove',
            type: 'group',
            id: 'group-a',
          } as AccessOperation], user1);

          const read = await store.space.read(space.key, user1) as IWorkspace;
          assert.lengthOf(read.permissionIds, 0,' has no permission ids');
          assert.lengthOf(read.permissions, 0,' has no permissions');
        });

        it('ignores when group permission does not exist', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.space.add(space.key, space, user1);

          await store.space.patchAccess(space.key, [{
            op: 'add',
            type: 'group',
            value: 'commenter',
            id: 'group-a',
          } as AccessOperation], user1);

          await store.space.patchAccess(space.key, [{
            op: 'remove',
            type: 'group',
            id: 'another',
          } as AccessOperation], user1);

          const read = await store.space.read(space.key, user1) as IWorkspace;
          assert.lengthOf(read.permissionIds, 1,' has original permission ids');
          assert.lengthOf(read.permissions, 1,' has original permissions');
        });

        it('throws when the id is missing when removing a group', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.space.add(space.key, space, user1);

          await store.space.patchAccess(space.key, [{
            op: 'add',
            type: 'group',
            value: 'commenter',
            id: 'group-a',
          } as AccessOperation], user1);

          let error: ApiError | undefined;
          try {
            await store.space.patchAccess(space.key, [{
              op: 'remove',
              type: 'group',
            } as AccessOperation], user1);
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
          await store.space.add(space.key, space, user1);

          await store.space.patchAccess(space.key, [{
            op: 'add',
            type: 'anyone',
            value: 'commenter',
          } as AccessOperation], user1);

          await store.space.patchAccess(space.key, [{
            op: 'remove',
            type: 'anyone',
          } as AccessOperation], user1);

          const read = await store.space.read(space.key, user1) as IWorkspace;
          assert.lengthOf(read.permissionIds, 0,' has no permission ids');
          assert.lengthOf(read.permissions, 0,' has no permissions');
        });

        it('ignores when the "anyone" permission does not exist', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.space.add(space.key, space, user1);

          await store.space.patchAccess(space.key, [{
            op: 'add',
            type: 'user',
            value: 'commenter',
            id: user2.key,
          } as AccessOperation], user1);

          await store.space.patchAccess(space.key, [{
            op: 'remove',
            type: 'anyone',
          } as AccessOperation], user1);

          const read = await store.space.read(space.key, user1) as IWorkspace;
          assert.lengthOf(read.permissionIds, 1,' has original permission ids');
          assert.lengthOf(read.permissions, 1,' has original permissions');
        });

        it('adds the shared user store entry', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.space.add(space.key, space, user1);

          await store.space.patchAccess(space.key, [{
            op: 'add',
            type: 'user',
            value: 'commenter',
            id: user2.key,
          } as AccessOperation], user1);

          const key = KeyGenerator.sharedSpace(space.key, user2.key);
          const rawItem = await store.shared.db.get(key);
          const item = JSON.parse(rawItem.toString()) as ISharedLink;
          assert.equal(item.id, space.key, 'has the space key');
          assert.equal(item.uid, user2.key, 'has the user key');
          assert.isUndefined(item.parent, 'has no parent');
        });

        it('adds the shared user store entry for a sub-space', async () => {
          const s1 = Workspace.fromName('s1').toJSON();
          const s2 = Workspace.fromName('s2').toJSON();
          await store.space.add(s1.key, s1, user1);
          await store.space.add(s2.key, s2, user1, { parent: s1.key });

          await store.space.patchAccess(s2.key, [{
            op: 'add',
            type: 'user',
            value: 'commenter',
            id: user2.key,
          } as AccessOperation], user1);

          const key = KeyGenerator.sharedSpace(s2.key, user2.key);
          const rawItem = await store.shared.db.get(key);
          const item = JSON.parse(rawItem.toString()) as ISharedLink;
          assert.equal(item.id, s2.key, 'has the space key');
          assert.equal(item.uid, user2.key, 'has the user key');
          assert.equal(item.parent, s1.key, 'has the parent');
        });

        it('removes the shared user store entry for a space', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.space.add(space.key, space, user1);

          await store.space.patchAccess(space.key, [{
            op: 'add',
            type: 'user',
            value: 'commenter',
            id: user2.key,
          } as AccessOperation], user1);

          await store.space.patchAccess(space.key, [{
            op: 'remove',
            type: 'user',
            id: user2.key,
          } as AccessOperation], user1);

          let raw: any;
          const key = KeyGenerator.sharedSpace(space.key, user2.key);
          try {
            raw = await store.shared.db.get(key);
          } catch (e) {
            // ...
          }
          assert.isUndefined(raw);
        });

        it('removes the shared user store entry when deleting a space', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.space.add(space.key, space, user1);

          await store.space.patchAccess(space.key, [{
            op: 'add',
            type: 'user',
            value: 'commenter',
            id: user2.key,
          } as AccessOperation], user1);

          await store.space.delete(space.key, user1);

          let raw: any;
          const key = KeyGenerator.sharedSpace(space.key, user2.key);
          try {
            raw = await store.shared.db.get(key);
          } catch (e) {
            // ...
          }
          assert.isUndefined(raw);
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
          await store.space.db.clear();
        });

        it('returns the role when the user has read permission with read minimum', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.space.add(space.key, space, user1);

          await store.space.patchAccess(space.key, [{
            op: 'add',
            type: 'user',
            value: 'reader',
            id: user2.key,
          } as AccessOperation], user1);

          const result = await store.space.checkAccess('reader', space.key, user2);
          assert.equal(result, 'reader');
        });

        it('returns the higher role when the requesting lower minimum', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.space.add(space.key, space, user1);

          await store.space.patchAccess(space.key, [{
            op: 'add',
            type: 'user',
            value: 'commenter',
            id: user2.key,
          } as AccessOperation], user1);

          const result = await store.space.checkAccess('reader', space.key, user2);
          assert.equal(result, 'commenter');
        });

        it('returns the inherited from the parent role', async () => {
          const s1 = Workspace.fromName('s1').toJSON();
          const s2 = Workspace.fromName('s2').toJSON();
          await store.space.add(s1.key, s1, user1);
          await store.space.add(s2.key, s2, user1, {
            parent: s1.key,
          });

          await store.space.patchAccess(s1.key, [{
            op: 'add',
            type: 'user',
            value: 'commenter',
            id: user2.key,
          } as AccessOperation], user1);

          const result = await store.space.checkAccess('reader', s2.key, user2);
          assert.equal(result, 'commenter');
        });

        it('returns the first inherited role from the parents tree', async () => {
          const s1 = Workspace.fromName('s1').toJSON();
          const s2 = Workspace.fromName('s2').toJSON();
          const s3 = Workspace.fromName('s3').toJSON();
          await store.space.add(s1.key, s1, user1);
          await store.space.add(s2.key, s2, user1, {
            parent: s1.key,
          });
          await store.space.add(s3.key, s3, user1, {
            parent: s2.key,
          });

          await store.space.patchAccess(s1.key, [{
            op: 'add',
            type: 'user',
            value: 'commenter',
            id: user2.key,
          } as AccessOperation], user1);
          await store.space.patchAccess(s2.key, [{
            op: 'add',
            type: 'user',
            value: 'writer',
            id: user2.key,
          } as AccessOperation], user1);

          const result = await store.space.checkAccess('reader', s3.key, user2);
          assert.equal(result, 'writer');
        });

        it('returns the owner role', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.space.add(space.key, space, user1);

          await store.space.patchAccess(space.key, [{
            op: 'add',
            type: 'user',
            value: 'reader',
            id: user2.key,
          } as AccessOperation], user1);

          const result = await store.space.checkAccess('reader', space.key, user1);
          assert.equal(result, 'owner');
        });

        it('throws when no user', async () => {
          const space = Workspace.fromName('s1').toJSON();
          await store.space.add(space.key, space, user1);

          await store.space.patchAccess(space.key, [{
            op: 'add',
            type: 'user',
            value: 'reader',
            id: user2.key,
          } as AccessOperation], user1);

          let error: ApiError | undefined;
          try {
            // @ts-ignore
            await store.space.checkAccess('reader', space.key, undefined);
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
          await store.space.add(space.key, space, user1);

          let error: ApiError | undefined;
          try {
            await store.space.checkAccess('reader', space.key, user2);
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
          await store.space.add(space.key, space, user1);

          await store.space.patchAccess(space.key, [{
            op: 'add',
            type: 'user',
            value: 'reader',
            id: user2.key,
          } as AccessOperation], user1);

          let error: ApiError | undefined;
          try {
            await store.space.checkAccess('writer', space.key, user2);
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
    });
  });
});
