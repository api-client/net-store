import { randomBytes, scryptSync, createCipheriv, CipherGCM, CipherGCMTypes, CipherKey, createDecipheriv } from 'crypto';
import { Buffer } from 'buffer';

const ALGORITHM = {
  // GCM is an authenticated encryption mode that not only provides confidentiality but also provides integrity in a secured way
  BLOCK_CIPHER: "aes-256-gcm",
  // 128 bit auth tag is recommended for GCM
  AUTH_TAG_BYTE_LEN: 16,
  // NIST recommends 96 bits or 12 bytes IV for GCM to promote interoperability, efficiency, and simplicity of design
  IV_BYTE_LEN: 12,
  // NOTE: 256 (in algorithm name) is key size (block size for AES is always 128)
  KEY_BYTE_LEN: 32,
  // to prevent rainbow table attacks
  SALT_BYTE_LEN: 16
};

/**
 * All credits to: https://stackoverflow.com/a/62640781/1127848
 */
export class Encryption {
  /**
   * To prevent rainbow table attacks
   */
  private getSalt(): Buffer {
    return randomBytes(ALGORITHM.SALT_BYTE_LEN);
  }

  /**
   *
   * @param password - The password to be used for generating key
   *
   * To be used when key needs to be generated based on password.
   * The caller of this function has the responsibility to clear
   * the Buffer after the key generation to prevent the password
   * from lingering in the memory
   */
  private getKeyFromPassword(password: Buffer, salt: Buffer): Buffer {
    return scryptSync(password, salt, ALGORITHM.KEY_BYTE_LEN);
  }

  encrypt(message: string, secret: string): string {
    const salt = this.getSalt();
    const password = this.getKeyFromPassword(Buffer.from(secret), salt);
    const result = this._encrypt(Buffer.from(message), password);
    return Buffer.concat([result, salt]).toString('base64url');
  }

  decrypt(message: string, secret: string): string {
    const buffer = Buffer.from(message, 'base64url');
    const salt = buffer.slice(-ALGORITHM.SALT_BYTE_LEN);
    const data = buffer.slice(0, buffer.byteLength - ALGORITHM.SALT_BYTE_LEN);
    const password = this.getKeyFromPassword(Buffer.from(secret), salt);
    const result = this._decrypt(data, password);
    return result.toString('utf8');
  }

  /**
   * @param message - The clear text message to be encrypted
   * @param key - The key to be used for encryption
   */
  private _encrypt(message: Buffer, key: CipherKey): Buffer {
    const iv = randomBytes(ALGORITHM.IV_BYTE_LEN);
    const cipher = createCipheriv(ALGORITHM.BLOCK_CIPHER as CipherGCMTypes, key, iv, {
      authTagLength: ALGORITHM.AUTH_TAG_BYTE_LEN
    }) as CipherGCM;
    let encrypted = cipher.update(message);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return Buffer.concat([iv, encrypted, cipher.getAuthTag()]);
  }

  /**
   * @param encoded - The text to encode.
   * @param key - The key to be used for decryption
   */
  private _decrypt(encoded: Buffer, key: CipherKey): Buffer {
    const authTag = encoded.slice(-16);
    const iv = encoded.slice(0, 12);
    const encryptedMessage = encoded.slice(12, -16);
    const decipher = createDecipheriv(ALGORITHM.BLOCK_CIPHER as CipherGCMTypes, key, iv, {
      authTagLength: ALGORITHM.AUTH_TAG_BYTE_LEN
    });
    decipher.setAuthTag(authTag);
    const txt = decipher.update(encryptedMessage);
    return Buffer.concat([txt, decipher.final()]);
  }
}
