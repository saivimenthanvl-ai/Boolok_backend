const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { randomBytes } = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const Reel = require('../models/Reel');

let server, baseUrl, viewerId, token;
const savedReels = [];

before(async () => {
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  viewerId = new mongoose.Types.ObjectId();

  // Stub Mongoose model operations for isolated unit testing without external MongoDB
  Reel.prototype.save = async function () {
    if (!this._id) this._id = new mongoose.Types.ObjectId();
    this.createdAt = new Date();
    savedReels.push(this);
    return this;
  };
  Reel.prototype.populate = async function () {
    this.author = {
      _id: viewerId,
      fullName: 'Logeshwaran A',
      username: 'logeshwarana',
      profilePicture: 'https://lh3.googleusercontent.com/a/ACg8ocJ_TV7-lpSTfRAQI0wc76yPHoIWaWg_5lgW-i9RxbiPx4tlFk0r=s96-c',
    };
    return this;
  };

  const app = express();
  app.use(express.json());
  app.use('/api/reels', require('../routes/reels'));
  server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  token = jwt.sign({ userId: viewerId.toString() }, process.env.JWT_SECRET, {
    issuer: 'boolok-gpt-api',
    audience: 'boolok-gpt-client',
    expiresIn: '5m',
  });
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

test('POST /api/reels does not fabricate aiMatch or placeholder insights and preserves UTF-8 and price', async () => {
  const res = await fetch(`${baseUrl}/reels`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
      title: 'Coventry Corporate Headquarters · தமிழ் · 🏢',
      location: 'Coventry, United Kingdom · Prime Assets',
      price: '$16,500,000',
      caption: 'Grade-A institutional office headquarters with 100% occupancy.',
    }),
  });
  assert.equal(res.status, 201);
  const created = await res.json();
  assert.equal(created.aiMatch, null);
  assert.equal(created.price, '$16,500,000');
  assert.equal(created.title, 'Coventry Corporate Headquarters · தமிழ் · 🏢');
  assert.equal(created.location, 'Coventry, United Kingdom · Prime Assets');
  assert.equal(created.insight, 'Grade-A institutional office headquarters with 100% occupancy.');
  // Known solid dark-brown Google avatar URL is sanitized to null so initials render cleanly
  assert.equal(created.author.profilePicture, null);
});
