const assert = require('node:assert/strict');
const { test } = require('node:test');
const express = require('express');

test('follow and both unfollow routes reach authentication rather than 404', async () => {
  const app = express();
  app.use('/api/users', require('../routes/users'));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try {
    for (const [method, action] of [['POST', 'follow'], ['PUT', 'follow'], ['POST', 'unfollow'], ['DELETE', 'follow']]) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/users/507f1f77bcf86cd799439011/${action}`, { method });
      assert.equal(response.status, 401, `${method} /${action}`);
      assert.equal((await response.json()).message, 'Authentication token is missing.');
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
