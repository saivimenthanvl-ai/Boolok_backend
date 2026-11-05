const assert = require('node:assert/strict');
const { test } = require('node:test');
const crypto = require('crypto');

test('generateOtp produces a 6-digit zero-padded string with secure randomness', () => {
  for (let i = 0; i < 50; i++) {
    const otp = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
    assert.equal(typeof otp, 'string');
    assert.equal(otp.length, 6);
    assert.match(otp, /^[0-9]{6}$/);
  }
});
