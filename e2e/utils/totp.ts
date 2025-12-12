/**
 * TOTP (Time-based One-Time Password) generation for GitHub 2FA
 */

import * as OTPAuth from 'otpauth'

/**
 * Generate a TOTP code from a base32-encoded secret
 * 
 * @param secret - Base32-encoded TOTP secret (from GitHub 2FA setup)
 * @returns 6-digit TOTP code
 */
export function generateTOTP(secret: string): string {
  const totp = new OTPAuth.TOTP({
    issuer: 'GitHub',
    label: 'E2E Test',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret.replace(/\s/g, '').toUpperCase()),
  })

  return totp.generate()
}

/**
 * Validate that a TOTP secret is properly formatted
 */
export function isValidTOTPSecret(secret: string): boolean {
  try {
    // Remove spaces and validate base32
    const cleaned = secret.replace(/\s/g, '').toUpperCase()
    OTPAuth.Secret.fromBase32(cleaned)
    return true
  } catch {
    return false
  }
}
