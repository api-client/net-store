/* eslint-disable import/no-named-as-default-member */
import jwt from 'jsonwebtoken';
import { UUID } from '@advanced-rest-client/core';
import { ISessionConfiguration } from '../definitions.js';
import { StorePersistence } from '../persistence/StorePersistence.js';

export interface ITokenContents {
  /**
   * THe key of the user session, whether authenticated or not
   */
  sid: string;
}

export interface IUnauthenticatedSession {
  authenticated: false;
  /**
   * The state parameter used with OAuth2
   */
  state?: string;
  /**
   * The nonce parameter used with OAuth2
   */
  nonce?: string;
  /** 
   * Additional properties to be stored with the session.
   */
  [x: string]: unknown;
}

export interface IAuthenticatedSession {
  authenticated: true;
  /**
   * The user id.
   */
  uid: string;
}

/**
 * A class that stores in-memory user session data.
 */
class GlobalSession {
  /**
   * The session store.
   * The keys are unique identifiers 
   */
  protected cache = new Map<string, IUnauthenticatedSession | IAuthenticatedSession>();
  /**
   * Special store to handle authorization.
   * The key is the `state` parameter and the value if the key of the session.
   */
  protected auth = new Map<string, string>();

  /**
   * This MUST be replaces by a secret that doesn't change at the initialization time.
   * This is a part of the authorization initialization.
   */
  secret = 'PmNjbkh2K3';
  /**
   * Token expiration date.
   */
  expiresIn: string | number = '7d';

  protected store?: StorePersistence;

  /**
   * Applies the configuration passed to the server.
   */
  applyConfig(config: ISessionConfiguration): void {
    if (config.secret) {
      this.secret = config.secret;
    }
    if (config.expiresIn) {
      this.expiresIn = config.expiresIn;
    }
  }

  setStore(store: StorePersistence): void {
    this.store = store;
  }

  /**
   * @returns The unauthenticated token that allows the client to talk to some APIs.
   */
  async generateUnauthenticatedSession(): Promise<string> {
    const sid = UUID.default();
    const info: ITokenContents = {
      sid,
    };
    const options = this.getSignOptions();
    const token = jwt.sign(info, this.secret, options);
    this.cache.set(sid, { authenticated: false });
    await this.commit(sid);
    return token;
  }

  async generateAuthenticatedSession(sid: string, uid: string): Promise<string> {
    const info: ITokenContents = {
      sid,
    };
    const options = this.getSignOptions();
    const token = jwt.sign(info, this.secret, options);
    this.cache.set(sid, { authenticated: true, uid });
    await this.commit(sid);
    return token;
  }

  /**
   * A helper function to add the OAuth 2 params to the session.
   * 
   * @param token The client issued token.
   * @param state The OAuth2 state parameter
   * @param nonce The OAuth2 nonce parameter
   */
  async addOAuthSession(key: string, state: string, nonce: string): Promise<void> {
    const info = await this.get(key) as IUnauthenticatedSession | undefined;
    if (!info) {
      throw new Error(`No session exists for this client.`);
    }
    info.nonce = nonce;
    info.state = state;
    this.auth.set(state, key);
  }
  
  /**
   * A helper function to reads the session from the OAuth2 state parameter.
   * 
   * @param state The OAuth2 state parameter
   */
  async getOAuthSession(state: string): Promise<IUnauthenticatedSession> {
    const id = this.auth.get(state);
    if (!id) {
      throw new Error(`The authentication session not established.`);
    }
    const info = await this.get(id);
    if (!info) {
      throw new Error(`Session not initialized.`);
    }
    return info as IUnauthenticatedSession;
  }

  async getOAuthSessionId(state: string): Promise<string> {
    const id = this.auth.get(state);
    if (!id) {
      throw new Error(`The authentication session not established.`);
    }
    return id;
  }

  async deleteOauthSession(state: string): Promise<void> {
    this.auth.delete(state);
  }

  protected getSignOptions(): jwt.SignOptions {
    const result: jwt.SignOptions = {
      expiresIn: this.expiresIn,
      audience: 'urn:api-client',
      issuer: 'urn:arc-store',
    };
    return result;
  }

  /**
   * Reads the session data from the cache. When cache does not have the session info
   * then it reads the data from the storage and updates the cache.
   * 
   * @param sid The session key.
   * @returns Values for the session.
   */
  async get(sid: string): Promise<IUnauthenticatedSession | IAuthenticatedSession | undefined> {
    const cached = this.cache.get(sid);
    if (cached) {
      return cached;
    }
    const dbData = await this.read(sid) as IUnauthenticatedSession | IAuthenticatedSession | undefined;
    if (dbData) {
      this.cache.set(sid, dbData)
    }
    return dbData;
  }

  /**
   * Updates the session cache and commits the data to the data store.
   * 
   * @param sid Session key
   * @param value The value to set.
   */
  async set(sid: string, value: IUnauthenticatedSession | IAuthenticatedSession): Promise<void> {
    this.cache.set(sid, value);
    await this.commit(sid);
  }

  protected async commit(sid: string): Promise<void> {
    const { store } = this;
    if (!store) {
      return;
    }
    const data = this.cache.get(sid);
    if (data) {
      await store.setSessionData(sid, data);
    } else {
      await store.deleteSessionData(sid);
    }
  }

  protected async read(sid: string): Promise<unknown | undefined> {
    const { store } = this;
    if (!store) {
      return;
    }
    let result: unknown | undefined;
    try {
      result = await store.readSessionData(sid);
    } catch (e) {
      // ...
    }
    return result;
  }
}

const instance = new GlobalSession();
export default instance;
