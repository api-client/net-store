import { LevelUp } from 'levelup';
import { LevelDownIterator, Bytes } from 'leveldown';
import { AbstractLevelDOWN } from 'abstract-leveldown';
import { StoreLevelUp } from './StoreLevelUp.js';

export abstract class SubStore {
  /**
   * @param parent The parent data store object
   * @param db The parent database to use to store the data into.
   */
  constructor(protected parent: StoreLevelUp, public db: LevelUp<AbstractLevelDOWN<Bytes, Bytes>, LevelDownIterator>) {}
  /**
   * Cleans up before shut down.
   */
  abstract cleanup(): Promise<void>;
}
