import CryptoJS from 'crypto-js';

export function hmacSHA256Hex(secret, message) {
  const hash = CryptoJS.HmacSHA256(message, secret);
  return CryptoJS.enc.Hex.stringify(hash);
}
