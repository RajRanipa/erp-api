import crypto from 'crypto';

export const INVENTORY_SERIAL_DIGITS = 16;

export function luhnCheckDigit(digits) {
  const value = String(digits || '');
  if (!/^\d+$/.test(value)) {
    throw new TypeError('Luhn input must contain digits only');
  }
  let sum = 0;
  let doubleDigit = true;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    let digit = Number(value[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return String((10 - (sum % 10)) % 10);
}

export function isValidInventorySerial(value) {
  const serial = String(value || '').trim();
  if (!new RegExp(`^\\d{${INVENTORY_SERIAL_DIGITS}}$`).test(serial)) return false;
  return luhnCheckDigit(serial.slice(0, -1)) === serial.slice(-1);
}

export function generateInventorySerial() {
  let body = '';
  for (let index = 0; index < INVENTORY_SERIAL_DIGITS - 1; index += 1) {
    body += String(crypto.randomInt(0, 10));
  }
  return `${body}${luhnCheckDigit(body)}`;
}

export function generateInventorySerialBatch(count) {
  const quantity = Number(count);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) {
    throw new RangeError('Serial batch count must be an integer between 1 and 1000');
  }
  const serials = new Set();
  while (serials.size < quantity) serials.add(generateInventorySerial());
  return [...serials];
}
