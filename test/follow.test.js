const assert = require('node:assert/strict');
const { before, after, beforeEach, test } = require('node:test');
const { randomBytes } = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const User = require('../models/User');
const Notification = require('../models/Notification');

let replicaSet, server, baseUrl, viewer, target, token;

before(async () => {
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  // Never load .env or use an externally supplied database URI.
  const uri = replicaSet.getUri();
  assert.equal(new URL(uri).hostname, '127.0.0.1');
  await mongoose.connect(uri);
  const app = express();
  app.use(express.json());
  app.use('/api/users', require('../routes/users'));
  server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/users`;
});

beforeEach(async () => {
  await User.deleteMany({});
  await Notification.deleteMany({});
  [viewer, target] = await User.create([
    { fullName: 'Test Viewer', email: 'viewer@example.test', password: 'unused', username: 'test_viewer' },
    { fullName: 'Test Target', email: 'target@example.test', password: 'unused', username: 'test_target' },
  ]);
  token = jwt.sign({ userId: viewer.id }, process.env.JWT_SECRET, {
    issuer: 'boolok-gpt-api', audience: 'boolok-gpt-client', expiresIn: '5m',
  });
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (replicaSet) await replicaSet.stop();
});

async function request(method, action, authenticated = true, id = target.id) {
  const response = await fetch(`${baseUrl}/${id}/${action}`, {
    method, headers: authenticated ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: response.status, body: await response.json() };
}

async function assertRelationship(following) {
  const [savedViewer, savedTarget] = await Promise.all([
    User.findById(viewer.id), User.findById(target.id),
  ]);
  assert.deepEqual(savedViewer.following.map(String), following ? [target.id] : []);
  assert.deepEqual(savedTarget.followers.map(String), following ? [viewer.id] : []);
  assert.equal(await Notification.countDocuments({ type: 'follow' }), following ? 1 : 0);
}

test('all relationship routes require authentication', async () => {
  for (const [method, action] of [['POST', 'follow'], ['PUT', 'follow'], ['POST', 'unfollow'], ['DELETE', 'follow']]) {
    assert.equal((await request(method, action, false)).status, 401);
  }
  await assertRelationship(false);
});

test('explicit unfollow routes remain unfollowed on retries', async () => {
  for (const [method, action] of [['POST', 'unfollow'], ['DELETE', 'follow']]) {
    assert.equal((await request('PUT', 'follow')).body.isFollowing, true);
    await assertRelationship(true);
    for (let retry = 0; retry < 3; retry++) {
      const result = await request(method, action);
      assert.equal(result.status, 200);
      assert.equal(result.body.isFollowing, false);
      assert.equal(result.body.followerCount, 0);
      assert.equal(result.body.followingCount, 0);
      await assertRelationship(false);
    }
  }
});

test('legacy POST follow still toggles and profile reads persist the result', async () => {
  for (let cycle = 0; cycle < 3; cycle++) {
    assert.equal((await request('POST', 'follow')).body.isFollowing, true);
    await assertRelationship(true);
    const profile = await fetch(`${baseUrl}/${target.id}`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal((await profile.json()).isFollowing, true);
    assert.equal((await request('POST', 'follow')).body.isFollowing, false);
    await assertRelationship(false);
  }
});

test('PUT follow and concurrent retries never duplicate the relationship', async () => {
  const results = await Promise.all(Array.from({ length: 4 }, () => request('PUT', 'follow')));
  for (const result of results) {
    assert.equal(result.status, 200);
    assert.equal(result.body.isFollowing, true);
    assert.equal(result.body.followerCount, 1);
  }
  await assertRelationship(true);
});

test('self-follow and missing targets are rejected', async () => {
  assert.equal((await request('POST', 'follow', true, viewer.id)).status, 400);
  assert.equal((await request('POST', 'unfollow', true, new mongoose.Types.ObjectId().toString())).status, 404);
  await assertRelationship(false);
});

test('second write failure rolls back follow and unfollow', async () => {
  const originalUpdate = User.updateOne;
  const originalError = console.error;
  for (const [method, action, initialState] of [['PUT', 'follow', false], ['POST', 'unfollow', true]]) {
    if (initialState) await request('PUT', 'follow');
    let calls = 0;
    User.updateOne = function (...args) {
      if (++calls === 2) throw new Error('Injected second-write failure');
      return originalUpdate.apply(this, args);
    };
    console.error = () => {};
    try {
      assert.equal((await request(method, action)).status, 500);
    } finally {
      User.updateOne = originalUpdate;
      console.error = originalError;
    }
    await assertRelationship(initialState);
  }
});
