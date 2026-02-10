/**
 * 加密工具
 */

import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const AUTH_TAG_LENGTH = 16;

/**
 * 使用密码加密私钥
 */
export async function encryptPrivateKey(
  privateKey: string,
  password: string
): Promise<{ encrypted: string; salt: string }> {
  const salt = randomBytes(SALT_LENGTH);
  const key = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(privateKey, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  // 格式: iv:authTag:encrypted
  const encryptedData = `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;

  return {
    encrypted: encryptedData,
    salt: salt.toString("hex"),
  };
}

/**
 * 使用密码解密私钥
 */
export async function decryptPrivateKey(
  encryptedData: string,
  password: string,
  salt: string
): Promise<string> {
  const saltBuffer = Buffer.from(salt, "hex");
  const key = (await scryptAsync(password, saltBuffer, KEY_LENGTH)) as Buffer;

  const [ivHex, authTagHex, encrypted] = encryptedData.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * 生成随机 session ID
 */
export function generateSessionId(): string {
  return randomBytes(32).toString("hex");
}

/**
 * 生成随机设备 ID
 */
export function generateDeviceId(): string {
  return randomBytes(16).toString("hex");
}

/**
 * 哈希密码（用于验证）
 */
export async function hashPassword(password: string, salt: string): Promise<string> {
  const saltBuffer = Buffer.from(salt, "hex");
  const hash = (await scryptAsync(password, saltBuffer, 64)) as Buffer;
  return hash.toString("hex");
}

/**
 * 验证密码
 */
export async function verifyPassword(
  password: string,
  salt: string,
  expectedHash: string
): Promise<boolean> {
  const hash = await hashPassword(password, salt);
  return hash === expectedHash;
}

// ============================================================
// EIP-712 签名验证
// ============================================================

import { verifyTypedData, type Address, type Hex } from "viem";
import { EIP712_DOMAIN, ORDER_TYPES } from "../config";

/**
 * 验证订单签名 (EIP-712)
 */
export async function verifyOrderSignature(
  trader: Address,
  token: Address,
  isLong: boolean,
  size: bigint,
  leverage: bigint,
  price: bigint,
  deadline: bigint,
  nonce: bigint,
  orderType: number,
  signature: Hex
): Promise<boolean> {
  try {
    const isValid = await verifyTypedData({
      address: trader,
      domain: EIP712_DOMAIN,
      types: ORDER_TYPES,
      primaryType: "Order",
      message: {
        trader,
        token,
        isLong,
        size,
        leverage,
        price,
        deadline,
        nonce,
        orderType,
      },
      signature,
    });
    return isValid;
  } catch (e) {
    console.error("[Crypto] Signature verification failed:", e);
    return false;
  }
}
