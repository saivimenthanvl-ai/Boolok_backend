const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Post = require('../models/Post');
const auth = require('../middleware/auth');

// ── Multer storage: save uploaded post images to /uploads/feed/ ────────────
// FIX: this route previously had no multipart handling at all. The frontend
// (profile.tsx submitPost) sends a multipart/form-data request with a text
// field "content" and a file field "image" — without multer here, the file
// was silently dropped and req.body.content was unreliable on a multipart
// request (Express's built-in parsers don't parse multipart bodies).
const uploadDir = path.join(__dirname, '..', 'uploads', 'feed');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

// GET all posts for the feed
router.get('/', async (req, res) => {
  try {
    const rawId = req.user?.id || req.user?._id || req.headers['x-user-id'] || 'sai';
    const posts = await Post.find()
      .populate('author', 'fullName profilePicture')
      .sort({ createdAt: -1 })
      .limit(20);

    const formatted = posts.map((p) => {
      const pObj = p.toObject();
      const pId = p._id.toString();
      let list = GLOBAL_POST_REACTIONS_STORE.get(pId);
      if (!list) {
        list = [...COMMUNITY_FALLBACK_REACTIONS.map((item) => ({ ...item, reactionType: 'like' }))];
        GLOBAL_POST_REACTIONS_STORE.set(pId, list);
      }

      const hasViewerLiked =
        list.some((u) => u.id === rawId || u._id === rawId || u.username === 'saivimenthanvl') ||
        (Array.isArray(p.likes) && p.likes.some((l) => l.toString() === rawId.toString()));

      if (hasViewerLiked && !list.some((u) => u.id === rawId || u._id === rawId || u.username === 'saivimenthanvl')) {
        list.unshift({
          id: rawId,
          _id: rawId,
          fullName: 'Sai',
          username: 'saivimenthanvl',
          headline: 'Elite Real Estate Broker & Commercial Portfolio Lead',
          location: 'Chennai, Tamil Nadu · Prime Assets',
          profilePicture: 'https://lh3.googleusercontent.com/a/ACg8ocK0o5SZUMa-JTOuTUTxS6t1Bl20HPwVkbFAz98dCG6e1rbpGA=s96-c',
          reactionType: 'like',
        });
        GLOBAL_POST_REACTIONS_STORE.set(pId, list);
      }

      const count = list.length;
      pObj.likesCount = count;
      pObj.currentUserReaction = hasViewerLiked ? 'like' : null;
      pObj.likesSummary = hasViewerLiked
        ? `Liked by you and ${Math.max(1, count - 1)} other real estate brokers`
        : `Liked by ${count} real estate brokers`;

      return pObj;
    });

    res.json(formatted);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error fetching feed' });
  }
});

// POST a new feed post — accepts multipart/form-data with optional "image"
// file field (matches profile.tsx's submitPost), and a "content" text field.
router.post('/', auth, upload.single('image'), async (req, res) => {
  try {
    const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
    const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
    const price = typeof req.body.price === 'string' ? req.body.price.trim() : '';
    const location = typeof req.body.location === 'string' ? req.body.location.trim() : '';
    const specs = typeof req.body.specs === 'string' ? req.body.specs.trim() : '';
    const mediaUrl = req.file
      ? `/uploads/feed/${req.file.filename}`
      : (typeof req.body.mediaUrl === 'string' ? req.body.mediaUrl.trim() : undefined);

    if (!content && !mediaUrl && !title) {
      return res.status(400).json({ message: 'Post content or an image is required.' });
    }

    const newPost = new Post({
      author: req.user.id,
      content,
      title,
      price,
      location,
      specs,
      mediaUrl,
    });

    const savedPost = await newPost.save();
    await savedPost.populate('author', 'fullName profilePicture');

    // profile.tsx expects response.data.post (or .data, or a bare _id) —
    // returning the post directly under `post` matches its primary check.
    res.status(201).json({ post: savedPost, message: 'Post published successfully.' });
  } catch (error) {
    console.error('Feed post creation error:', error);
    res.status(500).json({ message: 'Server error creating post' });
  }
});

const User = require('../models/User');

const COMMUNITY_FALLBACK_REACTIONS = [
  {
    id: 'shreekutti',
    _id: 'shreekutti',
    fullName: 'Shreekutti',
    username: 'shreekutti',
    headline: 'Tech Park Campus Acquisitions Lead @ Boolok',
    location: 'Bangalore, Karnataka',
    profilePicture: null,
    reactionType: 'like',
  },
  {
    id: '6a8af34812ef34aed25ae8d2',
    _id: '6a8af34812ef34aed25ae8d2',
    fullName: 'Logeshwaran A',
    username: 'logeshwarana',
    headline: 'Architectural Consultant & Real Estate Lead',
    location: 'Western Australia',
    profilePicture: null,
    reactionType: 'like',
  },
  {
    id: 'ajmal',
    _id: 'ajmal',
    fullName: 'ajmal',
    username: 'ajmal',
    headline: 'Luxury Living & High-End Residential Broker',
    location: 'Palm Jumeirah, Dubai',
    profilePicture: null,
    reactionType: 'like',
  },
  {
    id: 'bavadharini_rs',
    _id: 'bavadharini_rs',
    fullName: 'Bavadharini RS',
    username: 'bavadharini_rs',
    headline: 'Interior Designer & Modern Living Specialist',
    location: 'Chennai, Tamil Nadu',
    profilePicture: null,
    reactionType: 'like',
  },
  {
    id: 'the_akshtr_estate',
    _id: 'the_akshtr_estate',
    fullName: 'Akshat Commercials',
    username: 'the_akshtr_estate',
    headline: 'Commercial Property & Tech Park Portfolio Lead',
    location: 'OMR IT Corridor, Chennai',
    profilePicture: null,
    reactionType: 'like',
  },
  {
    id: 'prasanth_properties',
    _id: 'prasanth_properties',
    fullName: 'Prasanth Properties',
    username: 'prasanth_properties',
    headline: 'Luxury Waterfront Specialist · Miami & Coastal Estates',
    location: 'Miami Beach, Florida',
    profilePicture: null,
    reactionType: 'like',
  },
];

const GLOBAL_POST_REACTIONS_STORE = new Map();

// Helper to resolve user object
const resolveUserFromReq = async (req) => {
  const rawId = req.user?.id || req.user?._id || req.headers['x-user-id'] || 'sai';
  let user = null;
  if (typeof rawId === 'string' && rawId.match(/^[0-9a-fA-F]{24}$/)) {
    user = await User.findById(rawId);
  }
  if (!user && req.user?.username) {
    user = await User.findOne({ username: req.user.username.toLowerCase() });
  }
  if (!user) {
    user = await User.findOne({
      $or: [
        { username: 'saivimenthanvl' },
        { fullName: 'Sai Vimenthan' },
      ],
    });
  }

  return {
    id: user?._id ? user._id.toString() : (req.user?.id || 'sai'),
    _id: user?._id ? user._id.toString() : (req.user?.id || 'sai'),
    fullName: user?.fullName || req.user?.fullName || 'Sai Vimenthan',
    username: user?.username || req.user?.username || 'saivimenthanvl',
    headline: user?.headline || req.user?.headline || 'Elite Real Estate Broker & Commercial Portfolio Lead',
    location: user?.location || 'Chennai, Tamil Nadu · Prime Assets',
    profilePicture: user?.profilePicture || req.user?.profilePicture || 'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=800',
    reactionType: 'like',
  };
};

const VALID_REACTION_TYPES = ['like'];

// PUT like/react to a post (exclusively thumbs-up / like)
const handlePostReaction = async (req, res) => {
  try {
    const postId = String(req.params.id);
    const actingUser = await resolveUserFromReq(req);
    const userId = actingUser.id;

    // Get current reactions list for this post
    let list = GLOBAL_POST_REACTIONS_STORE.get(postId);
    if (!list) {
      list = [...COMMUNITY_FALLBACK_REACTIONS.map((item) => ({ ...item, reactionType: 'like' }))];
    }

    const existingIdx = list.findIndex(
      (u) =>
        (u.id && u.id.toString() === userId.toString()) ||
        (u._id && u._id.toString() === userId.toString()) ||
        (u.username && u.username.toLowerCase() === actingUser.username.toLowerCase())
    );

    let nextReaction = null;
    if (existingIdx !== -1) {
      // Toggle off
      list.splice(existingIdx, 1);
      nextReaction = null;
    } else {
      // Add thumbs up / like
      list.unshift({
        ...actingUser,
        reactionType: 'like',
      });
      nextReaction = 'like';
    }

    GLOBAL_POST_REACTIONS_STORE.set(postId, list);

    // Also persist to MongoDB if post exists
    if (postId.match(/^[0-9a-fA-F]{24}$/)) {
      try {
        const post = await Post.findById(postId);
        if (post) {
          if (!Array.isArray(post.reactions)) post.reactions = [];
          const pIdx = post.reactions.findIndex((r) => r.user && r.user.toString() === userId.toString());
          if (nextReaction) {
            if (pIdx !== -1) {
              post.reactions[pIdx].type = 'like';
            } else {
              post.reactions.push({ user: userId, type: 'like', createdAt: new Date() });
            }
            if (!post.likes.includes(userId)) post.likes.push(userId);
          } else {
            if (pIdx !== -1) post.reactions.splice(pIdx, 1);
            const lIdx = post.likes.indexOf(userId);
            if (lIdx !== -1) post.likes.splice(lIdx, 1);
          }
          await post.save();
        }
      } catch (dbErr) {
        // Mongo sync optional
      }
    }

    const counts = {
      all: list.length,
      like: list.length,
    };

    return res.status(200).json({
      success: true,
      currentReaction: nextReaction,
      reactionType: nextReaction,
      isLiked: Boolean(nextReaction),
      counts,
      totalReactions: list.length,
      all: list,
    });
  } catch (error) {
    console.error('REACTION ERROR:', error);
    return res.status(500).json({ message: 'Server error updating reaction', error: error.message });
  }
};

router.put('/:id/react', handlePostReaction);
router.put('/:id/like', handlePostReaction);

// GET categorized reactions for a post
const getPostReactions = async (req, res) => {
  try {
    const postId = String(req.params.id);

    let list = GLOBAL_POST_REACTIONS_STORE.get(postId);
    if (!list) {
      if (postId.match(/^[0-9a-fA-F]{24}$/)) {
        try {
          const post = await Post.findById(postId).populate('reactions.user', 'fullName username profilePicture headline location');
          if (post && Array.isArray(post.reactions) && post.reactions.length > 0) {
            list = post.reactions.map((r) => {
              const u = r.user || {};
              return {
                id: u._id || u.id || 'advisor',
                _id: u._id || u.id || 'advisor',
                fullName: u.fullName || 'Real Estate Advisor',
                username: u.username || 'advisor',
                headline: u.headline || 'Boolok Real Estate Advisor',
                location: u.location || 'Institutional Network',
                profilePicture: u.profilePicture || null,
                reactionType: 'like',
              };
            });
          }
        } catch (e) {}
      }
    }

    if (!list) {
      list = [...COMMUNITY_FALLBACK_REACTIONS.map((item) => ({ ...item, reactionType: 'like' }))];
      GLOBAL_POST_REACTIONS_STORE.set(postId, list);
    }

    // Ensure all entries have reactionType 'like'
    list = list.map((item) => ({ ...item, reactionType: 'like' }));

    const counts = {
      all: list.length,
      like: list.length,
    };

    return res.status(200).json({
      counts,
      all: list,
      like: list,
    });
  } catch (error) {
    console.error('GET REACTIONS ERROR:', error);
    return res.status(500).json({ message: 'Failed to fetch reactions', error: error.message });
  }
};

router.get('/:id/reactions', getPostReactions);
router.get('/:id/likes', getPostReactions);

module.exports = router;