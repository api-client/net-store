export interface ISessionStore {
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  read(key: string): Promise<unknown | undefined>;
}
