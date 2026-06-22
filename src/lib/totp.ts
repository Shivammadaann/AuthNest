export function base32ToBuffer(base32: string): ArrayBuffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = base32.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  let index = 0;
  const output = new Uint8Array((cleaned.length * 5) / 8 | 0);

  for (let i = 0; i < cleaned.length; i++) {
    const charIndex = alphabet.indexOf(cleaned[i]);
    if (charIndex === -1) {
      throw new Error('Invalid Base32 character: ' + cleaned[i]);
    }
    value = (value << 5) | charIndex;
    bits += 5;

    if (bits >= 8) {
      output[index++] = (value >>> (bits - 8)) & 255;
      bits -= 8;
    }
  }
  return output.buffer;
}

export async function generateTOTP(secret: string): Promise<string> {
  try {
    const keyBuffer = base32ToBuffer(secret);
    const key = await crypto.subtle.importKey(
      'raw',
      keyBuffer,
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    );

    const timeStep = 30;
    const counter = Math.floor(Date.now() / 1000 / timeStep);
    const counterBuffer = new ArrayBuffer(8);
    const counterView = new DataView(counterBuffer);
    // DataView setUint32 is used twice to set 64-bit integer
    // Since counter is usually small enough, upper 32 bits are 0
    counterView.setUint32(0, Math.floor(counter / 0x100000000), false);
    counterView.setUint32(4, counter % 0x100000000, false);

    const signature = await crypto.subtle.sign('HMAC', key, counterBuffer);
    const signatureArray = new Uint8Array(signature);

    const offset = signatureArray[signatureArray.length - 1] & 0xf;
    const code = (
      ((signatureArray[offset] & 0x7f) << 24) |
      ((signatureArray[offset + 1] & 0xff) << 16) |
      ((signatureArray[offset + 2] & 0xff) << 8) |
      (signatureArray[offset + 3] & 0xff)
    ) % 1000000;

    return code.toString().padStart(6, '0');
  } catch (error) {
    console.error('Error generating TOTP:', error);
    return '000000';
  }
}

export function getRemainingSeconds(): number {
  const timeStep = 30;
  const currentSeconds = Math.floor(Date.now() / 1000);
  return timeStep - (currentSeconds % timeStep);
}
