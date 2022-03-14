import { join } from 'path';

export class UserPaths {
  /**
   * The expected result is:
   * - OS X - '/Users/user/Library/Preferences'
   * - Windows >= 8 - 'C:\Users\user\AppData\Roaming'
   * - Windows XP - 'C:\Documents and Settings\user\Application Data'
   * - Linux - '/home/user/.local/share'
   * 
   * @returns The path to the user config directory depending on the system.
   */
  static configPath(): string {
    return process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Preferences' : process.env.HOME + "/.local/share");
  }

  /**
   * @returns The path to the user data folder relative to the system's config path.
   */
  static dataPath(): string {
    return join('api-client', 'data');
  }

  /**
   * @returns Absolute path to the application user configuration folder.
   */
  static dataRoot(): string {
    return join(this.configPath(), this.dataPath());
  }
}
