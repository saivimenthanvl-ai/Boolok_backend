const express = require('express');
const fs = require('fs');
const path = require('path');
const { createRateLimiter } = require('../middleware/rateLimiter');
const optionalAuth = require('../middleware/optionalAuth');
const BlueprintProject = require('../models/BlueprintProject');
const { getArchitecturalInsights, DEFAULT_MODEL } = require('../lib/openRouterService');
const {
  buildCanonicalLayout,
  renderTechnicalCadSvg,
  render2DFloorPlanSvg,
  render3DCutawaySvg,
  buildCoherentSummary,
  synthesizeCanonicalBlueprint,
} = require('../lib/canonicalBlueprintEngine');

// Rate limiter for CPU-intensive house plan generation: 15 requests per minute per IP
const planGenLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 15,
  message: 'Too many house plan generations requested. Please wait a moment before generating another plan.',
});

const router = express.Router();

/**
 * POST /api/blueprint/generate
 * Validates the user's residential brief and returns a coherent furnished 2D Floor Plan,
 * realistic 3D Isometric Cutaway Preview, Technical CAD Sheet, Canonical Layout Model, and Executive Summary.
 * Also persists the project into MongoDB.
 */
router.post('/generate', planGenLimiter, optionalAuth, async (req, res) => {
  try {
    const { jsonData, mode = 'both' } = req.body || {};
    const canonicalModel = buildCanonicalLayout(jsonData);

    const svg2D = render2DFloorPlanSvg(canonicalModel);
    const svg3D = render3DCutawaySvg(canonicalModel);
    const svgCad = renderTechnicalCadSvg(canonicalModel);

    // Persist generated SVG files under /uploads/posts so both direct URL downloads
    // and data URI rendering work seamlessly across Web and clients.
    const uploadsDir = path.join(__dirname, '..', 'uploads', 'posts');
    try {
      fs.mkdirSync(uploadsDir, { recursive: true });
    } catch (_) {}

    const timestamp = Date.now();
    const stamp = `${canonicalModel.plot.rawWidth}x${canonicalModel.plot.rawDepth}_${canonicalModel.program.bedrooms}bhk_${timestamp}`;
    const file2d = `blueprint_2d_${stamp}.svg`;
    const file3d = `blueprint_3d_${stamp}.svg`;
    const fileCad = `blueprint_cad_${stamp}.svg`;

    try {
      fs.writeFileSync(path.join(uploadsDir, file2d), svg2D, 'utf8');
      fs.writeFileSync(path.join(uploadsDir, file3d), svg3D, 'utf8');
      fs.writeFileSync(path.join(uploadsDir, fileCad), svgCad, 'utf8');
    } catch (writeErr) {
      console.warn('[blueprint] Could not write SVG file to disk, using data URI only:', writeErr.message);
    }

    const dataUri2D = `data:image/svg+xml;utf8,${encodeURIComponent(svg2D)}`;
    const dataUri3D = `data:image/svg+xml;utf8,${encodeURIComponent(svg3D)}`;
    const dataUriCad = `data:image/svg+xml;utf8,${encodeURIComponent(svgCad)}`;

    const summary = buildCoherentSummary(canonicalModel);
    const projectId = `bp-${canonicalModel.plot.rawWidth}x${canonicalModel.plot.rawDepth}-${timestamp}`;

    // Persist into MongoDB
    let savedProject = null;
    try {
      const viewerId = req.user?.id || req.user?._id || null;
      savedProject = await BlueprintProject.create({
        owner: viewerId,
        projectId,
        title: `${canonicalModel.plot.rawWidth} × ${canonicalModel.plot.rawDepth} ft ${canonicalModel.program.bedrooms} BHK Floor Plan`,
        plot: {
          width: canonicalModel.plot.rawWidth,
          depth: canonicalModel.plot.rawDepth,
          unit: canonicalModel.plot.displayUnit,
          facing: canonicalModel.plot.facing,
          shape: canonicalModel.plot.shape,
          areaSqFt: canonicalModel.areas.plotAreaSqFt,
          roadWidth: canonicalModel.plot.roadWidth,
        },
        requirements: {
          stories: canonicalModel.program.stories,
          bedrooms: canonicalModel.program.bedrooms,
          bathrooms: canonicalModel.program.bathrooms,
          kitchenType: canonicalModel.program.kitchenType,
          parkingType: canonicalModel.program.parkingType,
          cars: canonicalModel.program.cars,
          vastuEnabled: canonicalModel.program.vastuEnabled,
        },
        canonicalLayout: canonicalModel,
        geometryVersion: '2026.4',
        summary,
        plan2dFileUrl: `/uploads/posts/${file2d}`,
        plan3dFileUrl: `/uploads/posts/${file3d}`,
        technicalCadFileUrl: `/uploads/posts/${fileCad}`,
        aiModelUsed: req.body?.useAiInsights ? DEFAULT_MODEL : null,
        aiInsights: null,
        isPublic: !viewerId,
      });
    } catch (dbErr) {
      console.warn('[blueprint] MongoDB project save non-fatal error:', dbErr.message);
    }

    return res.status(200).json({
      success: true,
      mode,
      projectId: savedProject ? savedProject.projectId : projectId,
      plan2dUrl: mode === '3d' ? null : dataUri2D,
      plan3dUrl: mode === '2d' ? null : dataUri3D,
      plan2dSvg: mode === '3d' ? null : svg2D,
      plan3dSvg: mode === '2d' ? null : svg3D,
      technicalCadSvg: svgCad,
      technicalCadUrl: dataUriCad,
      plan2dFileUrl: `/uploads/posts/${file2d}`,
      plan3dFileUrl: `/uploads/posts/${file3d}`,
      technicalCadFileUrl: `/uploads/posts/${fileCad}`,
      summary,
      canonicalLayout: canonicalModel,
    });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({
      success: false,
      message: err.message || 'Unable to generate house plan layout.',
    });
  }
});

/**
 * GET /api/blueprint/history
 * Retrieve previously generated house plans for the authenticated user, or public plans.
 */
router.get('/history', optionalAuth, async (req, res) => {
  try {
    const viewerId = req.user?.id || req.user?._id || null;
    let query = {};
    if (viewerId) {
      query = {
        $or: [
          { owner: viewerId },
          { isPublic: true },
        ],
      };
    } else {
      query = { isPublic: true };
    }

    const projects = await BlueprintProject.find(query)
      .sort({ createdAt: -1 })
      .limit(30)
      .select('projectId title plot requirements summary plan2dFileUrl plan3dFileUrl createdAt updatedAt')
      .lean();

    return res.status(200).json({
      success: true,
      projects,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/blueprint/projects/:projectId
 * Retrieve a previously saved project by ID with canonical geometry and file references.
 */
router.get('/projects/:projectId', optionalAuth, async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = await BlueprintProject.findOne({ projectId }).lean();
    if (!project) {
      return res.status(404).json({ success: false, message: 'Blueprint project not found' });
    }

    const viewerId = req.user?.id || req.user?._id || null;
    if (project.owner && !project.isPublic && String(project.owner) !== String(viewerId)) {
      return res.status(403).json({ success: false, message: 'Unauthorized to view this private blueprint.' });
    }

    return res.status(200).json({
      success: true,
      project,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/blueprint/ai-consult
 * Optional AI architectural consultation powered by backend OpenRouter.
 * Securely uses process.env.OPENROUTER_API_KEY on the server.
 */
router.post('/ai-consult', planGenLimiter, optionalAuth, async (req, res) => {
  try {
    const { requirements, question } = req.body || {};
    if (!question && !requirements) {
      return res.status(400).json({ success: false, message: 'Requirements or consultation question is required.' });
    }

    const promptText = `User requirements: ${JSON.stringify(requirements || {})}\n\nArchitectural question / consultation: ${question || 'Review the spatial schedule and suggest optimal flow improvements.'}`;
    const result = await getArchitecturalInsights({
      prompt: promptText,
      systemPrompt: 'You are an elite residential architect. Provide actionable, concise advice on spatial efficiency, circulation, lighting, and Vastu mandala harmony.',
      maxTokens: 250,
    });

    if (!result.success) {
      return res.status(502).json({ success: false, message: result.message });
    }

    return res.status(200).json({
      success: true,
      model: result.model,
      advice: result.content,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
