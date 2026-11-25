const express = require('express');
const router = express.Router();
const SavedBlueprint = require('../models/SavedBlueprint');
const authMiddleware = require('../middleware/auth');

/**
 * POST /api/blueprint-history
 * Save a generated blueprint snapshot to the user's history.
 */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const owner = req.user.id || req.user._id;
    const {
      generationId,
      mode,
      form,
      plan2dUrl,
      plan3dUrl,
      plan2dSvg,
      plan3dSvg,
      technicalCadSvg,
      summary,
    } = req.body;

    if (!generationId || !form) {
      return res.status(400).json({ success: false, message: 'generationId and form are required.' });
    }

    const saved = await SavedBlueprint.create({
      owner,
      generationId,
      mode: mode || 'both',
      form,
      plan2dUrl: plan2dUrl || null,
      plan3dUrl: plan3dUrl || null,
      plan2dSvg: plan2dSvg || null,
      plan3dSvg: plan3dSvg || null,
      technicalCadSvg: technicalCadSvg || null,
      summary: summary || null,
    });

    return res.status(201).json({
      success: true,
      id: saved._id.toString(),
      plan: saved,
    });
  } catch (err) {
    console.error('Error saving blueprint history:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to save blueprint history.' });
  }
});

/**
 * GET /api/blueprint-history
 * List user's saved blueprint plans.
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const owner = req.user.id || req.user._id;
    const docs = await SavedBlueprint.find({ owner })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const plans = docs.map((doc) => ({
      _id: doc._id.toString(),
      createdAt: doc.createdAt,
      mode: doc.mode,
      form: {
        plotWidth: doc.form?.plotWidth || 30,
        plotDepth: doc.form?.plotDepth || 40,
        plotUnit: doc.form?.plotUnit || 'feet',
        bedrooms: doc.form?.bedrooms || 2,
        stories: doc.form?.stories || 1,
      },
    }));

    return res.status(200).json({
      success: true,
      plans,
    });
  } catch (err) {
    console.error('Error fetching blueprint history:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to fetch blueprint history.' });
  }
});

/**
 * GET /api/blueprint-history/:id
 * Retrieve a specific saved blueprint plan.
 */
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const owner = req.user.id || req.user._id;
    const doc = await SavedBlueprint.findOne({ _id: req.params.id, owner }).lean();

    if (!doc) {
      return res.status(404).json({ success: false, message: 'Saved plan not found.' });
    }

    return res.status(200).json({
      success: true,
      plan: {
        _id: doc._id.toString(),
        createdAt: doc.createdAt,
        generationId: doc.generationId,
        mode: doc.mode,
        form: doc.form,
        plan2dUrl: doc.plan2dUrl,
        plan3dUrl: doc.plan3dUrl,
        plan2dSvg: doc.plan2dSvg,
        plan3dSvg: doc.plan3dSvg,
        technicalCadSvg: doc.technicalCadSvg,
        summary: doc.summary,
      },
    });
  } catch (err) {
    console.error('Error fetching saved blueprint plan:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to fetch plan details.' });
  }
});

module.exports = router;
