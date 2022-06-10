export interface IListState {
  /**
   * Number of items in the result.
   */
  limit?: number;
  /**
   * The key of the last item returned by the query.
   * Used with pagination.
   */
  lastKey?: string;
  /**
   * The start key to use.
   */
  start?: string;
  /**
   * The last key to use.
   */
  end?: string;
  /**
   * Supported by some endpoints. When set it performs a query on the data store.
   */
  query?: string;
  /**
   * Only with the `query` property. Tells the system in which fields to search for the query term.
   */
  queryField?: string[];
  /**
   * Whether the list should contain children of a parent.
   * This is a key of the parent.
   */
  parent?: string;
  /**
   * Used when synchronizing data in the local store with the data stored in the net-store.
   * The timestamp when the last synchronization was performed. The resulting array will contain only items that 
   * have been updated since that date.
   */
  since?: number;
}
