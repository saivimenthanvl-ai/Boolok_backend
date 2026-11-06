const express = require('express');
const router = express.Router();

// Service health endpoint used by Title & Legal Verification screen
router.get('/service-status', (req, res) => {
  return res.status(200).json({
    online: true,
    engine: 'Boolok Institutional Title & Legal Verification Engine',
    message: 'Title & Legal Verification Engine is online.',
  });
});

// Past audits endpoint
router.get('/audits', (req, res) => {
  return res.status(200).json({
    success: true,
    audits: [],
  });
});

module.exports = router;
