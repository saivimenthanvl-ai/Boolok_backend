const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const Reel = require('../models/Reel');
const auth = require('../middleware/auth');
const optionalAuth = require('../middleware/optionalAuth');

// ── Storage ──────────────────────────────────────────────────────────────────
// NOTE: local disk is wiped on every redeploy/restart on hosts like Render's free
// tier. Videos uploaded here will disappear while their DB records stay. For reels
// that must survive, move uploads to Cloudinary / S3 / Supabase Storage and store
// the returned HTTPS URL in `videoUrl`.
const uploadDir = path.join(__dirname, '..', 'uploads', 'reels');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const VIDEO_EXTS = ['.mp4', '.mov', '.webm', '.m4v', '.mkv', '.avi'];
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

const CONTENT_TYPES = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    let ext = path.extname(file.originalname || '').toLowerCase().replace(/[^a-z0-9.]/g, '');
    if (!ext || ext.length > 6) {
      ext = file.mimetype && file.mimetype.startsWith('image/') ? '.jpg' : '.mp4';
    }
    cb(null, `${unique}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024, files: 3 }, // 200 MB per file
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mime = file.mimetype || '';
    const ok =
      mime.startsWith('video/') ||
      mime.startsWith('image/') ||
      VIDEO_EXTS.includes(ext) ||
      IMAGE_EXTS.includes(ext);
    if (ok) cb(null, true);
    else cb(new Error('Only video and image files are allowed'));
  },
});

const handleMulterUpload = (req, res, next) => {
  upload.any()(req, res, (err) => {
    if (err) {
      console.error('[reels] Multer error:', err.message);
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'Video is too large. Maximum size is 200 MB.'
          : err.message || 'Video upload failed. Check the file size (<200MB) and format.';
      return res.status(400).json({ message });
    }
    next();
  });
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const removeUploadedFiles = (files) => {
  (files || []).forEach((f) => {
    if (f && f.path) fs.unlink(f.path, () => {});
  });
};

// Delete a stored file only if it lives inside our uploads dir (no path traversal)
const removeStoredMedia = (url) => {
  if (!url || typeof url !== 'string') return;
  const m = url.match(/\/uploads\/reels\/([^/?#]+)/);
  if (!m) return;
  const filePath = path.join(uploadDir, path.basename(m[1]));
  fs.unlink(filePath, (err) => {
    if (err && err.code !== 'ENOENT') console.warn('Could not delete media file:', err.message);
  });
};

const CONFIRMED_STATIC_REEL_VIDEOS = {
  'margaret_river_vineyard.mp4': 'https://boolokgpt.vercel.app/videos/margaret_river_vineyard.mp4',
  'Margaret River Vineyard.mp4': 'https://boolokgpt.vercel.app/videos/margaret_river_vineyard.mp4',
  'house_routing_silent.mp4': 'https://boolokgpt.vercel.app/videos/house_routing_silent.mp4',
  'house_routing_original.mp4': 'https://boolokgpt.vercel.app/videos/house_routing_silent.mp4',
  'kyoto.mp4': 'https://boolokgpt.vercel.app/videos/kyoto.mp4',
  'uluwatu_cliffside.mp4': 'https://boolokgpt.vercel.app/videos/uluwatu_cliffside.mp4',
  'Uluwatu Cliffside.mp4': 'https://boolokgpt.vercel.app/videos/uluwatu_cliffside.mp4',
};

const resolveDurableVideoUrl = (rawUrl) => {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const clean = rawUrl.trim();
  if (!clean || clean === 'null' || clean === 'undefined') return '';
  const m = clean.match(/\/uploads\/reels\/([^/?#]+)/);
  if (m && CONFIRMED_STATIC_REEL_VIDEOS[m[1]]) {
    return CONFIRMED_STATIC_REEL_VIDEOS[m[1]];
  }
  return clean;
};

const sanitizeAvatarUrl = (url, userObj = null) => {
  if (userObj && typeof userObj === 'object') {
    const uid = String(userObj._id || userObj.id || '').toLowerCase().trim();
    const uname = String(userObj.username || '').toLowerCase().trim();
    const fname = String(userObj.fullName || '').toLowerCase().trim();
    if (
      uid === '6a7a0dbb51a42123f22c4edf' ||
      uid === '6ab67b7fa948cf929a483963' ||
      uname === 'saivimenthanvl' ||
      uname === 'saivimenthan' ||
      fname.includes('sai vimenthan')
    ) {
      return null;
    }
  }
  if (!url || typeof url !== 'string') return null;
  // Filter out known solid dark-brown Google placeholder image
  if (
    url.includes('ACg8ocJ_TV7-lpSTfRAQI0wc76yPHoIWaWg_5lgW-i9RxbiPx4tlFk0r') ||
    url.includes('ACg8ocK0o5SZUMa-JTOuTUTxS6t1Bl20HPwVkbFAz98dCG6e1rbpGA')
  ) {
    return null;
  }
  return url;
};

const mapUser = (u) => ({
  _id: u?._id || u?.id || null,
  fullName: u?.fullName || 'Boolok Member',
  username: u?.username || 'member',
  profilePicture: sanitizeAvatarUrl(u?.profilePicture, u),
});

const mapComment = (c) => {
  const createdDate = c.createdAt || new Date();
  const user = mapUser(c.user || {});
  return {
    _id: c._id,
    user,
    author: user,
    text: c.text,
    createdAt: createdDate,
    time: new Date(createdDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    date: new Date(createdDate).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }),
  };
};

const formatReel = (reel, viewerId = null) => {
  const r = reel.toObject ? reel.toObject() : reel;
  const likesArray = (r.likes || []).map((l) => (l?._id ? l._id.toString() : String(l)));
  const isLiked = viewerId ? likesArray.includes(viewerId.toString()) : false;
  const comments = (r.comments || []).map(mapComment);

  const poster = r.poster || r.thumbnail || null;
  const thumbnail = r.thumbnail || r.poster || null;
  const authorDisplayName = r.authorName || r.author?.fullName || 'Boolok Member';

  const authorObj = r.author && r.author._id
    ? {
        _id: r.author._id.toString(),
        fullName: authorDisplayName,
        username: r.author.username || 'member',
        profilePicture: sanitizeAvatarUrl(r.author.profilePicture, r.author),
      }
    : {
        // author not populated (plain ObjectId) or user deleted
        _id: r.author ? r.author.toString() : null,
        fullName: authorDisplayName,
        username: 'member',
        profilePicture: null,
      };

  const titleStr = r.title || '';
  let priceStr = r.price !== undefined && r.price !== null ? String(r.price).trim() : '';
  if (priceStr === 'undefined' || priceStr === 'null') {
    priceStr = '';
  }
  if (!priceStr && titleStr.toLowerCase().includes('coventry')) {
    priceStr = '£12,242,788';
  }

  let insightStr = r.insight || '';
  if (titleStr.toLowerCase().includes('coventry')) {
    insightStr = insightStr.replace(/\$16,?500,000/, '£12,242,788');
  }

  return {
    _id: r._id.toString(),
    author: authorObj,
    videoUrl: resolveDurableVideoUrl(r.videoUrl),
    poster,
    thumbnail,
    caption: r.caption || '',
    title: titleStr,
    authorName: r.authorName || '',
    location: r.location || '',
    price: priceStr,
    aiMatch: typeof r.aiMatch === 'number' ? r.aiMatch : null,
    insight: insightStr,
    views: r.views || 0,
    likes: likesArray,
    likesCount: likesArray.length,
    isLiked,
    comments,
    commentsCount: comments.length,
    createdAt: r.createdAt,
  };
};

// Parse a single "Range: bytes=..." header. Returns {start,end} or null if unsatisfiable.
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;

  let start;
  let end;
  if (m[1] === '') {
    // suffix range: last N bytes
    const suffix = parseInt(m[2], 10);
    if (!suffix) return null;
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = parseInt(m[1], 10);
    end = m[2] === '' ? size - 1 : Math.min(parseInt(m[2], 10), size - 1);
  }
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) return null;
  return { start, end };
}

// ── GET /api/reels/stream/:filename : Video streaming with HTTP 206 ranges ───
router.get('/stream/:filename', async (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(uploadDir, filename);

  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'public, max-age=86400');

  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch (_) {
    if (CONFIRMED_STATIC_REEL_VIDEOS[filename]) {
      return res.redirect(302, CONFIRMED_STATIC_REEL_VIDEOS[filename]);
    }
    // File is gone (e.g. host disk was wiped). Report it honestly so the app can
    // show a proper "couldn't load" state instead of silently playing a different video.
    return res.status(404).json({ message: 'Video file not found' });
  }

  const fileSize = stat.size;
  const ext = path.extname(filename).toLowerCase();
  const contentType = CONTENT_TYPES[ext] || 'video/mp4';
  const rangeHeader = req.headers.range;

  let status = 200;
  let start = 0;
  let end = fileSize - 1;

  // Multi-range requests are rare; serve the whole file for those.
  if (rangeHeader && !rangeHeader.includes(',')) {
    const range = parseRange(rangeHeader, fileSize);
    if (!range) {
      res.setHeader('Content-Range', `bytes */${fileSize}`);
      return res.status(416).end();
    }
    ({ start, end } = range);
    status = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
  }

  res.status(status);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', end - start + 1);

  if (req.method === 'HEAD' || fileSize === 0) return res.end();

  const stream = fs.createReadStream(filePath, { start, end });
  stream.on('error', (err) => {
    console.error('[reels] Stream read error:', err.message);
    if (!res.headersSent) res.status(500).end();
    else res.destroy();
  });
  // Stop reading when the player seeks/aborts, otherwise file handles leak
  res.on('close', () => stream.destroy());
  stream.pipe(res);
});

// ── GET /api/reels : Fetch reels (supports ?limit=&skip=&author=) ──────────
router.get('/', optionalAuth, async (req, res) => {
  try {
    const viewerId = req.user?.id || req.user?._id || null;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 100);
    const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);

    const query = {
      isDeleted: { $ne: true },
      isArchived: { $ne: true },
      videoUrl: { $nin: ['', null, 'null', 'undefined'] },
    };

    if (req.query.author && mongoose.Types.ObjectId.isValid(req.query.author)) {
      query.author = new mongoose.Types.ObjectId(req.query.author);
    }

    const reels = await Reel.find(query)
      .populate('author', 'fullName username profilePicture')
      .populate('comments.user', 'fullName username profilePicture')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const seenIds = new Set();
    const formatted = [];
    for (const r of reels) {
      const idStr = r._id ? r._id.toString() : '';
      if (!idStr || seenIds.has(idStr)) continue;
      seenIds.add(idStr);
      formatted.push(formatReel(r, viewerId));
    }

    res.json(formatted);
  } catch (error) {
    console.error('FETCH REELS ERROR:', error);
    res.status(500).json({ message: 'Server error fetching reels' });
  }
});

// ── POST /api/reels : Create a new reel ──────────────────────────────────────
router.post('/', auth, handleMulterUpload, async (req, res) => {
  const files = req.files || (req.file ? [req.file] : []);
  try {
    const isVideoFile = (f) =>
      (f.mimetype && f.mimetype.startsWith('video/')) ||
      VIDEO_EXTS.includes(path.extname(f.originalname || '').toLowerCase());
    const isImageFile = (f) =>
      (f.mimetype && f.mimetype.startsWith('image/')) ||
      IMAGE_EXTS.includes(path.extname(f.originalname || '').toLowerCase());

    const videoFile =
      files.find((f) => f.fieldname === 'video' && !isImageFile(f)) ||
      files.find(isVideoFile) ||
      null;
    const thumbFile = files.find((f) => f !== videoFile && isImageFile(f)) || null;

    let videoUrl = null;
    if (videoFile) {
      videoUrl = `/uploads/reels/${videoFile.filename}`;
    } else if (typeof req.body.videoUrl === 'string' && /^https?:\/\//i.test(req.body.videoUrl.trim())) {
      videoUrl = req.body.videoUrl.trim();
    } else {
      removeUploadedFiles(files); // don't leave an orphan cover image behind
      return res.status(400).json({ message: 'A video file or video URL is required.' });
    }

    // Unused extra files (anything that is neither the chosen video nor cover)
    removeUploadedFiles(files.filter((f) => f !== videoFile && f !== thumbFile));

    let thumbnail = null;
    if (thumbFile) {
      thumbnail = `/uploads/reels/${thumbFile.filename}`;
    } else if (typeof req.body.thumbnail === 'string' && req.body.thumbnail.trim()) {
      thumbnail = req.body.thumbnail.trim();
    } else if (typeof req.body.poster === 'string' && req.body.poster.trim()) {
      thumbnail = req.body.poster.trim();
    }

    const { caption, title, location, authorName, price } = req.body;

    // Do NOT fabricate placeholder AI Match scores or insights.
    let aiMatch = null;
    if (req.body.aiMatch !== undefined && req.body.aiMatch !== null && req.body.aiMatch !== '') {
      const parsedMatch = Number(req.body.aiMatch);
      if (Number.isFinite(parsedMatch) && parsedMatch >= 0 && parsedMatch <= 100) {
        aiMatch = Math.round(parsedMatch);
      }
    }

    const cleanCaption = caption ? String(caption).trim().slice(0, 2200) : '';
    const cleanInsight = req.body.insight ? String(req.body.insight).trim().slice(0, 500) : cleanCaption;
    const cleanPrice = price !== undefined && price !== null ? String(price).trim().slice(0, 80) : '';

    const newReel = new Reel({
      author: req.user.id,
      videoUrl,
      thumbnail,
      poster: thumbnail,
      caption: cleanCaption,
      title: title ? String(title).trim().slice(0, 150) : '',
      authorName: authorName ? String(authorName).trim().slice(0, 100) : '',
      location: location ? String(location).trim().slice(0, 150) : '',
      price: cleanPrice,
      aiMatch,
      insight: cleanInsight,
      likes: [],
      comments: [],
    });

    const savedReel = await newReel.save();
    await savedReel.populate('author', 'fullName username profilePicture');
    res.status(201).json(formatReel(savedReel, req.user.id));
  } catch (error) {
    console.error('CREATE REEL ERROR:', error);
    removeUploadedFiles(files); // DB save failed -> don't keep orphaned uploads
    res.status(500).json({ message: 'Server error creating reel', error: error.message });
  }
});

// ── PUT /api/reels/:id/like : Toggle like (atomic, no read-then-write race) ──
router.put('/:id/like', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid reel ID' });
    }

    // Try to un-like first; if nothing matched, like it.
    let updated = await Reel.findOneAndUpdate(
      { _id: req.params.id, likes: userId },
      { $pull: { likes: userId } },
      { new: true }
    );
    if (!updated) {
      updated = await Reel.findOneAndUpdate(
        { _id: req.params.id },
        { $addToSet: { likes: userId } },
        { new: true }
      );
    }
    if (!updated) return res.status(404).json({ message: 'Reel not found' });

    await updated.populate([
      { path: 'author', select: 'fullName username profilePicture' },
      { path: 'comments.user', select: 'fullName username profilePicture' },
    ]);
    res.json(formatReel(updated, userId));
  } catch (error) {
    console.error('LIKE REEL ERROR:', error);
    res.status(500).json({ message: 'Server error updating reel like' });
  }
});

// ── POST /api/reels/:id/comments : Add comment ──────────────────────────────
router.post('/:id/comments', auth, async (req, res) => {
  try {
    const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
    if (!text) return res.status(400).json({ message: 'Comment text is required.' });
    if (text.length > 1000) return res.status(400).json({ message: 'Comment is too long (max 1000 characters).' });
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid reel ID' });
    }

    const updated = await Reel.findByIdAndUpdate(
      req.params.id,
      { $push: { comments: { user: req.user.id, text, createdAt: new Date() } } },
      { new: true }
    )
      .populate('author', 'fullName username profilePicture')
      .populate('comments.user', 'fullName username profilePicture');

    if (!updated) return res.status(404).json({ message: 'Reel not found.' });
    res.status(201).json(formatReel(updated, req.user.id));
  } catch (error) {
    console.error('ADD REEL COMMENT ERROR:', error);
    res.status(500).json({ message: 'Server error adding comment.' });
  }
});

// ── GET /api/reels/:id/comments ─────────────────────────────────────────────
router.get('/:id/comments', optionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid reel ID' });
    }
    const reel = await Reel.findById(req.params.id).populate('comments.user', 'fullName username profilePicture');
    if (!reel) return res.status(404).json({ message: 'Reel not found.' });
    res.json((reel.comments || []).map((c) => mapComment(c.toObject ? c.toObject() : c)));
  } catch (error) {
    console.error('GET REEL COMMENTS ERROR:', error);
    res.status(500).json({ message: 'Server error fetching comments.' });
  }
});

// ── DELETE /api/reels/:id : Delete a reel (owner or admin only) ─────────────
router.delete('/:id', auth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid reel ID' });
    }
    const reel = await Reel.findById(req.params.id);
    if (!reel) return res.status(404).json({ message: 'Reel not found' });

    const isOwner = reel.author && reel.author.toString() === String(req.user.id);
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: 'You can only delete your own reels' });
    }

    removeStoredMedia(reel.videoUrl);
    removeStoredMedia(reel.thumbnail);
    if (reel.poster !== reel.thumbnail) removeStoredMedia(reel.poster);

    await reel.deleteOne();
    res.json({ message: 'Reel deleted successfully' });
  } catch (error) {
    console.error('DELETE REEL ERROR:', error);
    res.status(500).json({ message: 'Server error deleting reel' });
  }
});

module.exports = router;
