import { join } from 'path';
import { fs } from '@api-client/core';
import { randomBytes } from 'crypto';

export const Kind = 'Store#Config';

/**
 * The store configuration.
 */
export class Config {
  private data?: IConfig;
  /**
   * The expected result is:
   * - OS X - '/Users/user/Library/Preferences'
   * - Windows >= 8 - 'C:\Users\user\AppData\Roaming'
   * - Windows XP - 'C:\Documents and Settings\user\Application Data'
   * - Linux - '/home/user/.local/share'
   * 
   * @returns The path to the user config directory depending on the system.
   */
  configPath(): string {
    return process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Preferences' : process.env.HOME + "/.local/share");
  }

  /**
   * @returns The path to the user configuration folder relative to the system's config path.
   */
  appPath(): string {
    return join('api-client', 'user-config');
  }

  /**
   * @returns Absolute path to the application user configuration folder.
   */
  configRoot(): string {
    return join(this.configPath(), this.appPath());
  }

  /**
   * @returns The absolute location of the main configuration file.
   */
  configFilePath(): string {
    return join(this.configRoot(), 'api-store.json');
  }

  /**
   * Reads the configuration, if it wasn't read before.
   * Note, this caches the configuration in memory and returns the on-memory copy 
   * when requested. The configuration file may change while the server is running but it won't 
   * affect the running instance.
   */
  async read(): Promise<IConfig> {
    if (this.data) {
      return this.data;
    }
    const file = this.configFilePath();
    const exists = await fs.pathExists(file);
    if (!exists) {
      this.data = this.create();
      await this.write();
      return this.data;
    }
    const readable = await fs.canRead(file);
    if (!readable) {
      throw new Error(`[Access error]: The store configuration file cannot be read.`);
    }
    const contents = await fs.readJson(file) as IConfig;
    this.data = contents;
    return contents;
  }

  private async write(): Promise<void> {
    if (!this.data) {
      throw new Error(`Nothing to write.`);
    }
    const file = this.configFilePath();
    await fs.writeJson(file, this.data);
  }

  /**
   * @returns The default configuration schema
   */
  private create(): IConfig {
    return {
      kind: Kind,
      version: 1,
      secret: randomBytes(9).toString('base64'),
    };
  }
}

/**
 * The Store configuration schema.
 */
export interface IConfig {
  kind: typeof Kind;
  /**
   * The version of this configuration.
   */
  version: 1;
  /**
   * A secret generated when this configuration first runs.
   * It is a secret used to encode data (like cursors) that are sent to the client
   * and returned back to the store. The encryption method must ensure integrity.
   */
  secret: string;
}
