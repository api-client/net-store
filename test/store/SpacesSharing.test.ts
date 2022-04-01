import { assert } from 'chai';
import fs from 'fs/promises';
import path from 'path';
import { 
  DefaultLogger, IWorkspace, ProjectMock,  Workspace, AccessOperation, HttpProject,
} from '@api-client/core';
import { StoreLevelUp } from '../../src/persistence/StoreLevelUp.js';
import { ApiError } from '../../src/ApiError.js';
import { DataHelper } from '../helpers/DataHelper.js';

const storePath = path.join('test', 'data', 'units', 'store', 'sharing-integration');

describe('LevelSpaceStore', () => {
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

  describe('Sharing spaces', () => {
    describe('reading a shared space', () => {
      const user1 = mock.user.user();
      const user2 = mock.user.user();
      const user3 = mock.user.user();
      let s1: IWorkspace;

      before(async () => {
        await store.user.add(user1.key, user1);
        await store.user.add(user2.key, user3);
      });

      after(async () => {
        await store.user.db.clear();
        await store.space.db.clear();
      });

      beforeEach(async () => {
        s1 = Workspace.fromName('s1').toJSON();
        await store.space.add(s1.key, s1, user1);
      });

      async function addUserToSpace(space: string, user = user2.key, addingUser = user1): Promise<void> {
        await store.space.patchAccess(space, [{
          op: 'add',
          type: 'user',
          value: 'reader',
          id: user,
        } as AccessOperation], addingUser);
      } 

      it('reads a shared root level space', async () => {
        await addUserToSpace(s1.key);
        const space = await store.space.read(s1.key, user2);
        assert.typeOf(space, 'object');
      });

      it('reads a sub-space from a shared space', async () => {
        await addUserToSpace(s1.key);
        const s2 = Workspace.fromName('s2').toJSON();
        await store.space.add(s2.key, s2, user1, { parent: s1.key });

        const space = await store.space.read(s2.key, user2);
        assert.typeOf(space, 'object');
      });

      it('reads a sub-space', async () => {
        const s2 = Workspace.fromName('s2').toJSON();
        await store.space.add(s2.key, s2, user1);
        await addUserToSpace(s2.key);
        const space = await store.space.read(s2.key, user2);
        assert.typeOf(space, 'object');
      });

      it('does not read shared space by 3rd user', async () => {
        await addUserToSpace(s1.key);
        let error: ApiError | undefined;
        try {
          await store.space.read(s1.key, user3);
        } catch (e) {
          error = e as ApiError;
        }
        assert.ok(error, 'has the error');
        if (error) {
          assert.equal(error.message, `Not found.`);
          assert.equal(error.code, 404);
        }
      });

      it('does not read not-shared space by 3rd user', async () => {
        let error: ApiError | undefined;
        try {
          await store.space.read(s1.key, user3);
        } catch (e) {
          error = e as ApiError;
        }
        assert.ok(error, 'has the error');
        if (error) {
          assert.equal(error.message, `Not found.`);
          assert.equal(error.code, 404);
        }
      });

      it('read the space shared with anyone', async () => {
        await store.space.patchAccess(s1.key, [{
          op: 'add',
          type: 'anyone',
          value: 'reader',
        } as AccessOperation], user1);
        const space = await store.space.read(s1.key, user3);
        assert.typeOf(space, 'object');
      });

      // todo: group sharing
    });

    describe('listing shared spaces', () => {
      const user1 = mock.user.user();
      const user2 = mock.user.user();
      const user3 = mock.user.user();
      let spaces: IWorkspace[];

      before(async () => {
        await store.user.add(user1.key, user1);
        await store.user.add(user2.key, user2);
        await store.user.add(user3.key, user3);

        spaces = await DataHelper.generateSharedSpaces(store, { size: 40, owner: user1.key, target: user2.key, type: 'user' });
        await DataHelper.generateSharedSpaces(store, { size: 15, owner: user1.key, target: user3.key, type: 'user' });
      });

      after(async () => {
        await store.user.db.clear();
        await store.permission.db.clear();
        await store.shared.db.clear();
      });

      it('lists the spaces shared with the user', async () => {
        const list = await store.shared.listSpaces(user2);
        assert.typeOf(list.cursor, 'string', 'has the cursor');
        assert.typeOf(list.data, 'array', 'has the data');
        assert.lengthOf(list.data, 35, 'has the default list size');
      });

      it('lists spaces only shared with the user', async () => {
        const list = await store.shared.listSpaces(user2, { limit: 100 });
        assert.lengthOf(list.data, 40, 'has the default list size');
      });

      it('does not list spaces that have a parent', async () => {
        const parent = spaces[0].key;
        const space = Workspace.fromName('s2', user1.key).toJSON();
        await store.space.add(space.key, space, user1, { parent });
        await store.space.patchAccess(space.key, [{
          op: 'add',
          type: 'user',
          value: 'reader',
          id: user2.key,
        }], user1);

        const list = await store.shared.listSpaces(user2, { limit: 100 });
        assert.lengthOf(list.data, 40, 'has all records');
      });

      it('lists spaces for a parent', async () => {
        const parent = spaces[0].key;
        const space = Workspace.fromName('s2', user1.key).toJSON();
        await store.space.add(space.key, space, user1, { parent });
        await store.space.patchAccess(space.key, [{
          op: 'add',
          type: 'user',
          value: 'reader',
          id: user3.key,
        }], user1);
        const list = await store.shared.listSpaces(user3, { parent });
        assert.lengthOf(list.data, 1, 'has all parent records');
      });

      it('respects the limit parameter', async () => {
        const list = await store.shared.listSpaces(user2, { limit: 4 });
        assert.typeOf(list.cursor, 'string', 'has the cursor');
        assert.typeOf(list.data, 'array', 'has the data');
        assert.lengthOf(list.data, 4, 'has the default list size');
      });

      it('respects the page cursor', async () => {
        const list1 = await store.shared.listSpaces(user2, { limit: 2 });
        assert.lengthOf(list1.data, 2, 'original list has 2 items');
        const list2 = await store.shared.listSpaces(user2, { cursor: list1.cursor });
        assert.lengthOf(list2.data, 2, 'uses the page cursor limit param');
        assert.notDeepEqual(list1.data[0], list2.data[0], 'arrays are not equal');
        assert.notDeepEqual(list1.data[1], list2.data[0], 'has the next element');
      });
    });

    describe('removing access', () => {
      const user1 = mock.user.user();
      const user2 = mock.user.user();
      const user3 = mock.user.user();
      let spaces: IWorkspace[];

      before(async () => {
        await store.user.add(user1.key, user1);
        await store.user.add(user2.key, user2);
        await store.user.add(user3.key, user3);

        spaces = await DataHelper.generateSharedSpaces(store, { size: 40, owner: user1.key, target: user2.key, type: 'user' });
        await DataHelper.generateSharedSpaces(store, { size: 15, owner: user1.key, target: user3.key, type: 'user' });
      });

      after(async () => {
        await store.user.db.clear();
        await store.permission.db.clear();
        await store.shared.db.clear();
      });

      it('removes the access to the space', async () => {
        const space = spaces[0];
        await store.space.patchAccess(space.key, [{
          op: 'remove',
          type: 'user',
          id: user2.key,
        }], user1);

        const readSpace = await store.space.read(space.key, user1) as IWorkspace;
        
        assert.deepEqual(readSpace.permissionIds, [], 'space has empty permissionIds');
        assert.deepEqual(readSpace.permissions, [], 'space has empty permissions');

        let error: ApiError | undefined;
        try {
          await store.space.read(space.key, user3);
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
        const space = spaces[1];
        const p = HttpProject.fromName('test').toJSON();
        await store.project.add(space.key, p.key, p, user1);

        await store.space.patchAccess(space.key, [{
          op: 'remove',
          type: 'user',
          id: user2.key,
        }], user1);

        let error: ApiError | undefined;
        try {
          await store.project.read(space.key, p.key, user3);
        } catch (e) {
          error = e as ApiError;
        }
        assert.ok(error, 'has the error');
        if (error) {
          assert.equal(error.message, `Not found.`);
          assert.equal(error.code, 404);
        }
      });

      it('throws when the space does not exist', async () => {
        let error: ApiError | undefined;
        try {
          await store.space.patchAccess('invalid', [{
            op: 'remove',
            type: 'user',
            id: user2.key,
          }], user1);
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
        const space = spaces[2];
        const ids = [...space.permissionIds];
        await store.space.patchAccess(space.key, [{
          op: 'remove',
          type: 'user',
          id: 'invalid',
        }], user1);
        const readSpace = await store.space.read(space.key, user1) as IWorkspace;
        assert.deepEqual(readSpace.permissionIds, ids, 'space keeps the permissionIds');
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
        await store.space.db.clear();
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

      it('can add a space to a shared space', async () => {
        const space = Workspace.fromName('child').toJSON();
        await store.space.add(space.key, space, user2, { parent: parent.key });

        const readOwner = await store.space.read(space.key, user2);
        assert.typeOf(readOwner, 'object');

        const readSpaceOwner = await store.space.read(space.key, user1);
        assert.typeOf(readSpaceOwner, 'object');

        assert.deepEqual(readOwner, readSpaceOwner);
      });

      it('can add a project to a shared space', async () => {
        const p = HttpProject.fromName('test').toJSON();
        await store.project.add(parent.key, p.key, p, user2);

        const readOwner = await store.project.read(parent.key, p.key, user2);
        assert.typeOf(readOwner, 'object');

        const readSpaceOwner = await store.project.read(parent.key, p.key, user1);
        assert.typeOf(readSpaceOwner, 'object');

        assert.deepEqual(readOwner, readSpaceOwner);
      });

      it('can share a shared space with write role', async () => {
        await store.space.patchAccess(parent.key, [{
          op: 'add',
          type: 'user',
          value: 'reader',
          id: user3.key,
        } as AccessOperation], user2);

        const space = await store.space.read(parent.key, user3) as IWorkspace;
        assert.lengthOf(space.permissions, 2, 'has both permissions');
      });

      it('can not share a shared space with write reading role', async () => {
        await store.space.patchAccess(parent.key, [{
          op: 'add',
          type: 'user',
          value: 'reader',
          id: user3.key,
        } as AccessOperation], user2);

        let error: ApiError | undefined;
        try {
          await store.space.patchAccess(parent.key, [{
            op: 'add',
            type: 'user',
            value: 'reader',
            id: user4.key,
          } as AccessOperation], user3);
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
        await store.space.add(s1.key, s1, user2, { parent: parent.key });
        await store.space.add(s2.key, s2, user2, { parent: s1.key });
        await store.space.patchAccess(s1.key, [{
          op: 'add',
          type: 'user',
          value: 'reader',
          id: user3.key,
        } as AccessOperation], user2);
        await store.space.patchAccess(s2.key, [{
          op: 'add',
          type: 'user',
          value: 'writer',
          id: user3.key,
        } as AccessOperation], user2);

        const s3 = Workspace.fromName('s3').toJSON();
        await store.space.add(s3.key, s3, user3, { parent: s2.key });
      });

      it('refuses to create a space by a non-writing user', async () => {
        const s1 = Workspace.fromName('s1').toJSON();
        const s2 = Workspace.fromName('s2').toJSON();
        await store.space.add(s1.key, s1, user2, { parent: parent.key });
        await store.space.patchAccess(s1.key, [{
          op: 'add',
          type: 'user',
          value: 'reader',
          id: user3.key,
        } as AccessOperation], user2);

        let error: ApiError | undefined;
        try {
          await store.space.add(s2.key, s2, user3, { parent: s1.key });
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
        const p = HttpProject.fromName('test').toJSON();
        await store.space.add(s1.key, s1, user2, { parent: parent.key });
        await store.space.patchAccess(s1.key, [{
          op: 'add',
          type: 'user',
          value: 'reader',
          id: user3.key,
        } as AccessOperation], user2);

        let error: ApiError | undefined;
        try {
          await store.project.add(s1.key, p.key, p, user3);
        } catch (e) {
          error = e as ApiError;
        }
        assert.ok(error, 'has the error');
        if (error) {
          assert.equal(error.message, `Insufficient permissions to access this resource.`);
          assert.equal(error.code, 403);
        }
      });

      it('allows creating a space when shared with anyone with write role', async () => {
        const s1 = Workspace.fromName('s1').toJSON();
        const s2 = Workspace.fromName('s2').toJSON();
        await store.space.add(s1.key, s1, user1, { parent: parent.key });
        await store.space.patchAccess(s1.key, [{
          op: 'add',
          type: 'anyone',
          value: 'writer',
        } as AccessOperation], user1);
        await store.space.add(s2.key, s2, user3, { parent: s1.key });
      });

      it('refuses creating a project when shared with anyone with commenting role', async () => {
        const s1 = Workspace.fromName('s1').toJSON();
        const s2 = Workspace.fromName('s2').toJSON();
        await store.space.add(s1.key, s1, user1, { parent: parent.key });
        await store.space.patchAccess(s1.key, [{
          op: 'add',
          type: 'anyone',
          value: 'reader',
        } as AccessOperation], user1);
        let error: ApiError | undefined;
        try {
          await store.space.add(s2.key, s2, user3, { parent: s1.key });
        } catch (e) {
          error = e as ApiError;
        }
        assert.ok(error, 'has the error');
        if (error) {
          assert.equal(error.message, `Insufficient permissions to access this resource.`);
          assert.equal(error.code, 403);
        }
      });

      it('refuses deleting a space without writing role', async () => {
        const s1 = Workspace.fromName('s1').toJSON();
        await store.space.add(s1.key, s1, user1, { parent: parent.key });
        await store.space.patchAccess(s1.key, [{
          op: 'add',
          type: 'anyone',
          value: 'reader',
        } as AccessOperation], user1);
        let error: ApiError | undefined;
        try {
          await store.space.delete(s1.key, user3);
        } catch (e) {
          error = e as ApiError;
        }
        assert.ok(error, 'has the error');
        if (error) {
          assert.equal(error.message, `Insufficient permissions to access this resource.`);
          assert.equal(error.code, 403);
        }
      });

      it('refuses deleting a space with writing role', async () => {
        let error: ApiError | undefined;
        try {
          await store.space.delete(parent.key, user2);
        } catch (e) {
          error = e as ApiError;
        }
        assert.ok(error, 'has the error');
        if (error) {
          assert.equal(error.message, `Unauthorized to delete the space.`);
          assert.equal(error.code, 403);
        }
      });
    });
  });
});
