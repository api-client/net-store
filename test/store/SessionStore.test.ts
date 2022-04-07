import { assert } from 'chai';
import fs from 'fs/promises';
import path from 'path';
import { DefaultLogger } from '@api-client/core';
import { StoreLevelUp } from '../../src/persistence/StoreLevelUp.js';

const storePath = path.join('test', 'data', 'units', 'store', 'session');

describe('Unit tests', () => {
  let store: StoreLevelUp;

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
    describe('#session', () => {
      describe('set()', () => {
        after(async () => {
          await store.session.db.clear();
        });

        it('sets the item', async () => {
          const item = { test: true };
          await store.session.set('a', item);
          const raw = await store.session.db.get('a');
          assert.deepEqual(raw.toString(), JSON.stringify(item));
        });

        it('overwrites the item', async () => {
          const item1 = { test: true };
          const item2 = { other: true };
          await store.session.set('b', item1);
          await store.session.set('b', item2);
          const raw = await store.session.db.get('b');
          assert.deepEqual(raw.toString(), JSON.stringify(item2));
        });
      });

      describe('delete()', () => {
        after(async () => {
          await store.session.db.clear();
        });

        it('deletes the item', async () => {
          const item = { test: true };
          await store.session.set('a', item);
          await store.session.delete('a');
          const items = await store.session.db.getMany(['a']);
          assert.isUndefined(items[0]);
        });

        it('ignores non-existing items', async () => {
          await store.session.delete('b');
        });
      });

      describe('read()', () => {
        after(async () => {
          await store.session.db.clear();
        });

        it('reads from the store', async () => {
          const item = { test: true };
          await store.session.set('c', item);
          const result = await store.session.read('c');
          assert.deepEqual(result, item);
        });

        it('returns undefined when missing', async () => {
          const result = await store.session.read('d');
          assert.isUndefined(result);
        });
      });
    });
  });
});
