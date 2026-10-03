/** rsa.mjs 的类型声明 */

export function parseRsaPublicKey(pem: string): { n: bigint; e: bigint };

export function randomBytes(len: number): Uint8Array;

export function rsaEncrypt(
  pem: string,
  text: string,
  rng?: (len: number) => Uint8Array
): string;
