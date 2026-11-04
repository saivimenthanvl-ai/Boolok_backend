const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { randomBytes } = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const Post = require('../models/Post');
const User = require('../models/User');

const oid = () => new mongoose.Types.ObjectId();
let server, baseUrl;
const saiId = oid(), shreeId = oid(), likerA = oid(), likerB = oid();
const tokenFor = (id) => jwt.sign({ userId: id.toString() }, process.env.JWT_SECRET, { issuer: 'boolok-gpt-api', audience: 'boolok-gpt-client', expiresIn: '5m' });

// In-memory persisted posts (stands in for MongoDB)
const store = new Map();
const mkPost = (author, extra = {}) => {
  const _id = oid();
  const doc = { _id, author, content: 'Persisted post', mediaUrl: 'https://example.com/a.jpg', likes: [], comments: [], createdAt: new Date(), updatedAt: new Date(), ...extra };
  store.set(String(_id), doc);
  return doc;
};
const view = (d) => {
  const authors = { [saiId]: { fullName: 'Sai Vimenthan V L', username: 'saivimenthanvl' }, [shreeId]: { fullName: 'Shreekutti', username: 'shreekutti' } };
  const a = authors[d.author] || { fullName: 'Member', username: 'member' };
  return { ...d, author: { _id: d.author, ...a }, toObject() { return this; } };
};
const query = (docs) => { const q = { populate: () => q, sort: () => q, select: () => q, limit: () => q, then: (res, rej) => Promise.resolve(docs).then(res, rej) }; return q; };

before(async () => {
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  Post.find = () => query([...store.values()].map(view));
  Post.findById = (id) => { const d = store.get(String(id)); return Object.assign(query(d ? [view(d)][0] : null), { }); };
  Post.findByIdAndUpdate = (id, upd) => {
    const d = store.get(String(id));
    if (upd.$pull) d.likes = d.likes.filter((l) => String(l) !== String(upd.$pull.likes));
    if (upd.$addToSet && !d.likes.some((l) => String(l) === String(upd.$addToSet.likes))) d.likes.push(upd.$addToSet.likes);
    return query(view(d));
  };
  User.find = () => query([{ _id: saiId, fullName: 'Sai Vimenthan V L', username: 'saivimenthanvl', headline: '', location: '', followers: [], following: [], profilePicture: null }]);

  const app = express();
  app.use(express.json());
  app.use('/api/feed', require('../routes/feedRoutes'));
  app.use('/api/users', require('../routes/users'));
  server = await new Promise((r) => { const l = app.listen(0, '127.0.0.1', () => r(l)); });
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => { if (server) await new Promise((r) => server.close(r)); });

test('feed renders each canonical post once and never shows fabricated engagement', async () => {
  const shreePost = mkPost(shreeId, { content: 'Real Shreekutti post', mediaUrl: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200' });
  store.set(String(shreePost._id) + 'dup', { ...shreePost }); // same record surfaced twice (overlapping fetch)
  const res = await fetch(`${baseUrl}/feed`);
  const { posts } = await res.json();
  const ids = posts.map((p) => p._id);
  assert.equal(new Set(ids).size, ids.length, 'ids must be unique');
  assert.equal(ids.filter((i) => i === String(shreePost._id)).length, 1);
  // static fallback for an author with a persisted post must not be a second card
  assert.ok(!posts.some((p) => p._id === 'shree-p-1'));
  // every static fallback that remains has zero invented engagement
  for (const p of posts.filter((x) => !/^[a-f\d]{24}$/i.test(x._id))) {
    assert.equal(p.likesCount, 0);
    assert.deepEqual(p.likes, []);
    assert.equal(p.likesSummary, '0 likes');
  }
});

test('likes come from persisted reactions: count, liker list agree; unlike removes the reaction', async () => {
  const post = mkPost(saiId);
  const like = (uid) => fetch(`${baseUrl}/feed/${post._id}/like`, { method: 'PUT', headers: { Authorization: `Bearer ${tokenFor(uid)}` } }).then((r) => r.json());
  let r = await like(likerA);
  assert.equal(r.likesCount, 1);
  r = await like(likerB);
  assert.equal(r.likesCount, 2);
  assert.equal(new Set(r.likes).size, 2);
  r = await like(likerA); // unlike
  assert.equal(r.likesCount, 1);
  assert.deepEqual(r.likes, [String(likerB)]);
  assert.equal(r.isLiked, false);
  const unauth = await fetch(`${baseUrl}/feed/${post._id}/like`, { method: 'PUT' });
  assert.equal(unauth.status, 401);
});

test('search for "sai" returns the canonical account exactly once with the full display name', async () => {
  for (const q of ['sai', 'Sai', 'sai vimenthan']) {
    const res = await fetch(`${baseUrl}/users/search?q=${encodeURIComponent(q)}`);
    const { results } = await res.json();
    const mine = results.filter((u) => String(u.id) === String(saiId) || u.username === 'saivimenthanvl');
    assert.equal(mine.length, 1, `query "${q}" must yield one entry`);
    assert.equal(mine[0].fullName, 'Sai Vimenthan V L');
  }
  const bad = await fetch(`${baseUrl}/users/search?q=${encodeURIComponent('sai(')}`);
  assert.equal(bad.status, 200, 'regex metacharacters must not crash search');
});
