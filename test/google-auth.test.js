const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

const User = require('../models/User');

let app, server, baseUrl;
let originalVerifyIdToken;
let testUser;

before(async () => {
  process.env.JWT_SECRET = 'test_jwt_secret_key_12345';
  process.env.GOOGLE_CLIENT_ID = '166853460121-jdlugm3ncga9qu4vk3b45lda5onusup2.apps.googleusercontent.com';

  // Mock OAuth2Client.prototype.verifyIdToken
  originalVerifyIdToken = OAuth2Client.prototype.verifyIdToken;
  OAuth2Client.prototype.verifyIdToken = async function ({ idToken, audience }) {
    if (idToken === 'valid-mock-google-token') {
      return {
        getPayload: () => ({
          sub: 'google-sub-sai-123456789',
          email: 'saivimenthanvl@gmail.com',
          name: 'Sai Vimenthan V L',
          picture: 'https://lh3.googleusercontent.com/test-avatar.jpg',
          email_verified: true,
        }),
      };
    }
    throw new Error('Invalid mock Google token');
  };

  // Mock User queries in routes/auth.js
  const existingUserDoc = {
    _id: new mongoose.Types.ObjectId('6ab67b7fa948cf929a483963'),
    fullName: 'Sai Vimenthan V L',
    username: 'saivimenthanvl',
    email: 'saivimenthanvl@gmail.com',
    authProvider: 'google',
    googleSubject: 'google-sub-sai-123456789',
    profilePicture: 'https://lh3.googleusercontent.com/test-avatar.jpg',
    isEmailVerified: true,
    save: async function () { return this; },
    toObject: function () { return this; },
  };

  User.findOne = async function (query) {
    if (query.googleSubject === 'google-sub-sai-123456789' || query.email === 'saivimenthanvl@gmail.com') {
      return existingUserDoc;
    }
    return null;
  };

  app = express();
  app.use(express.json());
  app.use('/api/auth', require('../routes/auth'));

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  if (originalVerifyIdToken) {
    OAuth2Client.prototype.verifyIdToken = originalVerifyIdToken;
  }
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Google auth endpoint succeeds with verified token and generates application session token without jwt errors', async () => {
  const res = await fetch(`${baseUrl}/api/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: 'valid-mock-google-token' }),
  });

  assert.equal(res.status, 200, `Expected 200 but got ${res.status}`);
  const body = await res.json();

  assert.ok(body.token, 'Response must include an application session token');
  assert.equal(typeof body.token, 'string');
  assert.ok(body.user, 'Response must include user details');
  assert.equal(body.user.email, 'saivimenthanvl@gmail.com');
  assert.equal(body.user.username, 'saivimenthanvl');

  // Verify that the token is a valid signed JWT with expected claims and issuer/audience
  const decoded = jwt.verify(body.token, process.env.JWT_SECRET, {
    issuer: 'boolok-gpt-api',
    audience: 'boolok-gpt-client',
  });
  assert.equal(decoded.email, 'saivimenthanvl@gmail.com');
  assert.equal(decoded.userId, '6ab67b7fa948cf929a483963');
});

test('Google auth endpoint rejects invalid Google identity tokens with 401 and clean message', async () => {
  const res = await fetch(`${baseUrl}/api/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: 'definitely-invalid-token' }),
  });

  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.message, 'Invalid Google identity token.');
  assert.ok(body.error);
});
