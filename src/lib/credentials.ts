/**
 * 账号凭据的安全存储。
 *
 * ⚠️ 密码绝不能明文存 AsyncStorage。
 * 这里用 expo-secure-store：iOS 存钥匙串（Keychain）、安卓用 Keystore 加密，
 * 是本机加密存储，其它 App 读不到。
 *
 * 用途：志愿云网站本身每次关闭再进入都要重新登录，
 * 所以 App 需要「记住密码 + 自动登录」。用户也可以关掉这个开关。
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const KEY_USER = 'volunteer-watch.cred.user';
const KEY_PASS = 'volunteer-watch.cred.pass';

/** Web 上 expo-secure-store 不可用，用内存兜底（仅本次会话有效） */
const memory = new Map<string, string>();
const isWeb = Platform.OS === 'web';

async function setItem(key: string, value: string) {
  if (isWeb) { memory.set(key, value); return; }
  await SecureStore.setItemAsync(key, value);
}

async function getItem(key: string): Promise<string | null> {
  if (isWeb) return memory.get(key) ?? null;
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function removeItem(key: string) {
  if (isWeb) { memory.delete(key); return; }
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // 忽略
  }
}

export interface SavedCredentials {
  username: string;
  password: string;
}

/** 保存凭据（用于自动登录） */
export async function saveCredentials(c: SavedCredentials): Promise<void> {
  await setItem(KEY_USER, c.username);
  await setItem(KEY_PASS, c.password);
}

/** 读取已保存的凭据，没有则返回 null */
export async function loadCredentials(): Promise<SavedCredentials | null> {
  const username = await getItem(KEY_USER);
  const password = await getItem(KEY_PASS);
  if (!username || !password) return null;
  return { username, password };
}

/** 只读取用户名（用于预填输入框） */
export async function loadSavedUsername(): Promise<string | null> {
  return getItem(KEY_USER);
}

/** 清除凭据 */
export async function clearCredentials(): Promise<void> {
  await removeItem(KEY_USER);
  await removeItem(KEY_PASS);
}
