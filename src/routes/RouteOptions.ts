export interface IAddSpaceOptions {
  /**
   * The parent space where to put the space.
   * The `parents` array is always cleared from the space object
   * before adding it to the store.
   */
  parent?: string;
}
