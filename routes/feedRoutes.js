const fs = require('fs');
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const Post = require('../models/Post');
const User = require('../models/User');
const upload = require('../config/localUpload');
const authMiddleware = require('../middleware/auth');
const optionalAuth = require('../middleware/optionalAuth');

const router = express.Router();

const getAuthenticatedUserId = (req) =>
  req.user?.id || req.user?._id || req.userId || null;

// Format a single post document into a clean, consistent response
const formatPost = (post, viewerId = null) => {
  const p = post.toObject ? post.toObject() : post;
  const likesArray = (p.likes || []).map((l) => (l?._id ? l._id.toString() : String(l)));
  const isLiked = viewerId ? likesArray.includes(viewerId.toString()) : false;

  const comments = (p.comments || []).map((c) => {
    const userObj = c.user || {};
    const createdDate = c.createdAt || new Date();
    return {
      _id: c._id,
      author: {
        _id: userObj._id || userObj.id || null,
        fullName: userObj.fullName || 'Boolok Member',
        username: userObj.username || 'member',
        profilePicture: userObj.profilePicture || null,
      },
      user: {
        _id: userObj._id || userObj.id || null,
        fullName: userObj.fullName || 'Boolok Member',
        username: userObj.username || 'member',
        profilePicture: userObj.profilePicture || null,
      },
      text: c.text,
      createdAt: createdDate,
      time: new Date(createdDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      date: new Date(createdDate).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }),
    };
  });

  let resolvedMedia = p.mediaUrl || null;
  if (resolvedMedia && typeof resolvedMedia === 'string' && resolvedMedia.startsWith('/uploads/')) {
    const localDiskPath = path.join(__dirname, '..', resolvedMedia);
    if (!fs.existsSync(localDiskPath)) {
      resolvedMedia = 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1200';
    }
  }

  return {
    _id: p._id.toString(),
    content: (p.content || '').trim() || (resolvedMedia ? 'Exclusive Real Estate Showcase' : ''),
    mediaUrl: resolvedMedia,
    author: p.author
      ? {
          _id: p.author._id?.toString() || p.author.id?.toString(),
          fullName: p.author.fullName || 'Boolok Member',
          username: p.author.username || 'member',
          profilePicture: p.author.profilePicture || null,
          headline: p.author.headline || 'Real Estate Professional & Boolok Member',
          location: p.author.location || 'Global Real Estate Network',
        }
      : null,
    likes: likesArray,
    likesCount: likesArray.length,
    isLiked,
    currentUserReaction: isLiked ? 'like' : null,
    likesSummary: likesArray.length > 0
      ? (isLiked
          ? (likesArray.length === 1 ? 'Liked by you' : `Liked by you and ${likesArray.length - 1} other${likesArray.length > 2 ? 's' : ''}`)
          : `Liked by ${likesArray.length} member${likesArray.length > 1 ? 's' : ''}`)
      : '0 likes',
    comments,
    commentsCount: comments.length,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
};

// ── Community fallback posts (shown when DB is empty) ───────────────────────
const FALLBACK_COMMUNITY_POSTS = [
  {
    _id: 'shree-p-1',
    content: 'Fully leased Grade-A Tech Park development with pre-verified institutional efficiency ratings. 8.4% Cap Rate · 92,000 sq ft · Outer Ring Road, Bangalore.',
    mediaUrl: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200',
    author: { _id: 'shreekutti', fullName: 'Shreekutti', username: 'shreekutti', profilePicture: null, headline: 'Tech Park Campus Acquisitions Lead @ Boolok', location: 'Bangalore, Karnataka' },
    likes: ['logeshwarana', 'ajmal', 'sai'],
    likesCount: 3,
    isLiked: false,
    currentUserReaction: null,
    likesSummary: 'Liked by 3 members',
    comments: [
      { _id: 'sc-1', author: { fullName: 'Logeshwaran A', username: 'logeshwarana', profilePicture: null }, text: '8.4% cap rate on Outer Ring Road is top quartile! 🏢🚀', time: '04:15 pm', createdAt: new Date('2026-09-10T10:45:00.000Z') },
      { _id: 'sc-2', author: { fullName: 'Akshat Commercials', username: 'the_akshtr_estate' }, text: 'Strong institutional covenants on this campus.', time: '05:30 pm', createdAt: new Date('2026-09-10T12:00:00.000Z') },
    ],
    commentsCount: 2,
    createdAt: new Date('2026-09-10T09:00:00.000Z'),
    updatedAt: new Date('2026-09-10T09:00:00.000Z'),
  },
  {
    _id: 'ajmal-p-1',
    content: 'Direct beach access, smart home automation, infinity pool overlooking Dubai Marina. Palm Jumeirah Signature Mansion — 7 Beds · Private Beach · $24,000,000.',
    mediaUrl: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=1200',
    author: { _id: 'ajmal', fullName: 'Mohammed Ajmal', username: 'ajmal', profilePicture: null, headline: 'Luxury Living & High-End Residential Broker', location: 'Palm Jumeirah, Dubai' },
    likes: ['sai', 'logeshwarana', 'shreekutti', 'the_akshtr_estate'],
    likesCount: 4,
    isLiked: false,
    currentUserReaction: null,
    likesSummary: 'Liked by 4 members',
    comments: [
      { _id: 'ac-1', author: { fullName: 'Shreekutti', username: 'shreekutti' }, text: 'Unrivaled private beach frontage!', time: '10:00 am', createdAt: new Date('2026-09-09T04:30:00.000Z') },
      { _id: 'ac-2', author: { fullName: 'Logeshwaran A', username: 'logeshwarana', profilePicture: null }, text: 'Bespoke marble and high ceiling elevation.', time: '11:15 am', createdAt: new Date('2026-09-09T05:45:00.000Z') },
    ],
    commentsCount: 2,
    createdAt: new Date('2026-09-09T04:00:00.000Z'),
    updatedAt: new Date('2026-09-09T04:00:00.000Z'),
  },
  {
    _id: 'logesh-p-1',
    content: 'World-class vineyard estate with high soil suitability index and pre-approved zoning. Margaret River Commercial Vineyard — 140 Acres · Pre-Verified Water Rights · $18,500,000.',
    mediaUrl: 'https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=1200',
    author: { _id: 'logeshwarana', fullName: 'Logeshwaran A', username: 'logeshwarana', profilePicture: null, headline: 'Architectural Consultant & Real Estate Lead', location: 'Western Australia' },
    likes: ['sai', 'shreekutti', 'bavadharini_rs'],
    likesCount: 3,
    isLiked: false,
    currentUserReaction: null,
    likesSummary: 'Liked by 3 members',
    comments: [
      { _id: 'lc-1', author: { fullName: 'Akshat Commercials', username: 'the_akshtr_estate' }, text: 'Soil analysis and water rights are pristine.', time: '02:00 pm', createdAt: new Date('2026-09-08T08:30:00.000Z') },
      { _id: 'lc-2', author: { fullName: 'Bavadharini RS', username: 'bavadharini_rs' }, text: 'Architectural layout is stunning.', time: '03:10 pm', createdAt: new Date('2026-09-08T09:40:00.000Z') },
    ],
    commentsCount: 2,
    createdAt: new Date('2026-09-08T08:00:00.000Z'),
    updatedAt: new Date('2026-09-08T08:00:00.000Z'),
  },
  {
    _id: 'akshat-p-1',
    content: 'Modern commercial tower with multi-level parking, 100% power backup, and prime expressway frontage. Institutional Grade-A Office Hub — 120,000 sq ft · 8.9% Yield · OMR IT Corridor.',
    mediaUrl: 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=1200',
    author: { _id: 'the_akshtr_estate', fullName: 'Akshat Commercials', username: 'the_akshtr_estate', profilePicture: null, headline: 'Commercial Property & Tech Park Portfolio Lead @ Boolok Network', location: 'OMR IT Corridor, Chennai' },
    likes: ['sai', 'shreekutti', 'logeshwarana'],
    likesCount: 3,
    isLiked: false,
    currentUserReaction: null,
    likesSummary: 'Liked by 3 members',
    comments: [
      { _id: 'akc-1', author: { fullName: 'Logeshwaran A', username: 'logeshwarana', profilePicture: null }, text: 'Triple net lease with institutional covenants is top tier!', time: '06:00 pm', createdAt: new Date('2026-09-07T12:30:00.000Z') },
    ],
    commentsCount: 1,
    createdAt: new Date('2026-09-07T12:00:00.000Z'),
    updatedAt: new Date('2026-09-07T12:00:00.000Z'),
  },
  {
    _id: 'prasanth-p-1',
    content: 'Bespoke modern architecture with floor-to-ceiling glass, sunset views, and private yacht slip. Star Island Waterfront Estate — 6 Beds · 8 Baths · Private Mega-Yacht Dock · $19,800,000.',
    mediaUrl: 'https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=1200',
    author: { _id: 'prasanth_properties', fullName: 'Prasanth Properties', username: 'prasanth_properties', profilePicture: null, headline: 'Luxury Waterfront Specialist · Miami & Coastal Estates', location: 'Miami Beach, Florida' },
    likes: ['sai', 'ajmal', 'bavadharini_rs'],
    likesCount: 3,
    isLiked: false,
    currentUserReaction: null,
    likesSummary: 'Liked by 3 members',
    comments: [
      { _id: 'pc-1', author: { fullName: 'Mohammed Ajmal', username: 'ajmal' }, text: 'Deepwater dock specs and yacht clearance are remarkable.', time: '09:00 am', createdAt: new Date('2026-09-06T03:30:00.000Z') },
    ],
    commentsCount: 1,
    createdAt: new Date('2026-09-06T03:00:00.000Z'),
    updatedAt: new Date('2026-09-06T03:00:00.000Z'),
  },
  {
    _id: 'bava-p-1',
    content: 'Double-height glass living room, customized Italian joinery, panoramic sea view balcony. High-Ceiling Ultra Penthouse — 5,800 sq ft · Private Elevator · Poes Garden, Chennai · $6,200,000.',
    mediaUrl: 'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?w=1200',
    author: { _id: 'bavadharini_rs', fullName: 'Bavadharini RS', username: 'bavadharini_rs', profilePicture: null, headline: 'Interior Designer & Modern Living Specialist', location: 'Chennai, Tamil Nadu' },
    likes: ['sai', 'ajmal', 'logeshwarana'],
    likesCount: 3,
    isLiked: false,
    currentUserReaction: null,
    likesSummary: 'Liked by 3 members',
    comments: [
      { _id: 'bc-1', author: { fullName: 'Akshat Commercials', username: 'the_akshtr_estate' }, text: 'Incredible acoustic zoning and clean lines!', time: '07:30 pm', createdAt: new Date('2026-09-05T14:00:00.000Z') },
    ],
    commentsCount: 1,
    createdAt: new Date('2026-09-05T14:00:00.000Z'),
    updatedAt: new Date('2026-09-05T14:00:00.000Z'),
  },
  {
    _id: 'vignesh-p-1',
    content: 'New architectural masterpiece in Beverly Hills. 8 Bedrooms, 11 Baths, custom Italian marble, and zero-edge cascading pool. 🏆✨ Beverly Hills Modern Architectural Masterpiece — $12.5M.',
    mediaUrl: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1200',
    author: { _id: 'vignesh', fullName: 'Vigneshwaran', username: 'vignesh', profilePicture: null, headline: 'Prime Architectural Estates & Beverly Hills Luxury Specialist', location: 'Beverly Hills, California' },
    likes: ['sai', 'logeshwarana', 'shreekutti'],
    likesCount: 3,
    isLiked: false,
    currentUserReaction: null,
    likesSummary: 'Liked by 3 members',
    comments: [
      { _id: 'vc-1', author: { fullName: 'Sophia Sterling', username: 'sophia_luxury' }, text: 'Are 1/8th fractional house share syndicate slots still available for European co-owners? 🏡✨', time: '09:15 am', createdAt: new Date('2026-09-04T03:45:00.000Z') },
    ],
    commentsCount: 1,
    createdAt: new Date('2026-09-04T03:00:00.000Z'),
    updatedAt: new Date('2026-09-04T03:00:00.000Z'),
  },
  {
    _id: 'sai-p-1',
    content: 'Grade-A institutional office headquarters with 100% occupancy and blue-chip covenants. Coventry Corporate Headquarters — 52,000 sq ft · 8.2% Cap Rate · $16,500,000.',
    mediaUrl: 'https://images.unsplash.com/photo-1577495508048-b635879837f1?w=1200',
    author: { _id: 'saivimenthanvl', fullName: 'Sai Vimenthan', username: 'saivimenthanvl', profilePicture: 'https://lh3.googleusercontent.com/a/ACg8ocK0o5SZUMa-JTOuTUTxS6t1Bl20HPwVkbFAz98dCG6e1rbpGA=s96-c', headline: 'Elite Real Estate Broker & Commercial Portfolio Lead', location: 'Chennai, Tamil Nadu' },
    likes: ['logeshwarana', 'shreekutti'],
    likesCount: 2,
    isLiked: false,
    currentUserReaction: null,
    likesSummary: 'Liked by 2 members',
    comments: [
      { _id: 'spc-1', author: { fullName: 'Logeshwaran A', username: 'logeshwarana', profilePicture: null }, text: 'Prime UK corporate covenants. Solid institutional deal!', time: '04:00 pm', createdAt: new Date('2026-09-03T10:30:00.000Z') },
    ],
    commentsCount: 1,
    createdAt: new Date('2026-09-03T10:00:00.000Z'),
    updatedAt: new Date('2026-09-03T10:00:00.000Z'),
  },
];

// ── GET /api/feed : Fetch all posts ──────────────────────────────────────────
router.get('/', optionalAuth, async (req, res) => {
  try {
    const viewerId = getAuthenticatedUserId(req);
    const dbPosts = await Post.find({})
      .populate('author', 'fullName username profilePicture headline location email')
      .populate('comments.user', 'fullName username profilePicture')
      .sort({ createdAt: -1 });

    let formatted = dbPosts
      .filter((p) => {
        const text = (p.content || '').trim();
        const media = (p.mediaUrl || '').trim();
        // Discard corrupted empty posts
        return text.length > 0 || (media.length > 0 && !media.includes('google.com/imgres'));
      })
      .map((p) => formatPost(p, viewerId));

    // Ensure fallback community posts are always available and merged seamlessly
    const dbIds = new Set(formatted.map((p) => p._id.toString()));
    const fallbackExtras = FALLBACK_COMMUNITY_POSTS
      .filter((p) => !dbIds.has(p._id))
      .map((p) => ({
        ...p,
        isLiked: viewerId ? (p.likes || []).includes(viewerId.toString()) : false,
        currentUserReaction: viewerId && (p.likes || []).includes(viewerId.toString()) ? 'like' : null,
      }));

    formatted = [...formatted, ...fallbackExtras];

    return res.status(200).json({ posts: formatted });
  } catch (error) {
    console.error('FETCH POSTS ERROR:', error);
    // On any error, return fallback posts so feed is never empty
    return res.status(200).json({ posts: FALLBACK_COMMUNITY_POSTS });
  }
});

// ── POST /api/feed : Create a new post ───────────────────────────────────────
router.post('/', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    const userId = getAuthenticatedUserId(req);
    if (!userId) return res.status(401).json({ message: 'Authentication required.' });

    const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
    let mediaUrl = null;

    if (req.file) {
      try {
        const fileBuffer = fs.readFileSync(req.file.path);
        const mime = req.file.mimetype || 'image/jpeg';
        mediaUrl = `data:${mime};base64,${fileBuffer.toString('base64')}`;
        try { fs.unlinkSync(req.file.path); } catch (_) {}
      } catch (readErr) {
        mediaUrl = `/uploads/posts/${req.file.filename}`;
      }
    } else if (req.body.mediaUrl && typeof req.body.mediaUrl === 'string') {
      mediaUrl = req.body.mediaUrl.trim();
    }

    if (!content && !mediaUrl) {
      return res.status(400).json({ message: 'Add text or upload an image.' });
    }

    const createdPost = await Post.create({
      author: userId,
      content,
      mediaUrl,
      likes: [],
      comments: [],
    });

    const populated = await Post.findById(createdPost._id)
      .populate('author', 'fullName username profilePicture headline location email');

    return res.status(201).json({
      message: 'Post published successfully',
      post: formatPost(populated, userId),
    });
  } catch (error) {
    console.error('CREATE POST ERROR:', error);
    return res.status(500).json({ message: 'Failed to publish post.', error: error.message });
  }
});

// ── GET /api/feed/user/:userId : Fetch posts by specific user ────────────────
router.get('/user/:userId', authMiddleware, async (req, res) => {
  try {
    const viewerId = getAuthenticatedUserId(req);
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: 'Invalid user ID.' });
    }

    const posts = await Post.find({ author: userId })
      .populate('author', 'fullName username profilePicture headline location email')
      .populate('comments.user', 'fullName username profilePicture')
      .sort({ createdAt: -1 });

    return res.status(200).json({ posts: posts.map((p) => formatPost(p, viewerId)) });
  } catch (error) {
    console.error('FETCH USER POSTS ERROR:', error);
    return res.status(500).json({ message: 'Failed to fetch user posts.', error: error.message });
  }
});

// ── PUT /api/feed/:id/like or react : Toggle like on a post ─────────────────
const toggleLikeHandler = async (req, res) => {
  try {
    const userId = getAuthenticatedUserId(req);
    const { id } = req.params;

    if (!userId) return res.status(401).json({ message: 'Authentication required.' });
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid post ID.' });
    }

    const post = await Post.findById(id);
    if (!post) return res.status(404).json({ message: 'Post not found.' });

    const alreadyLiked = post.likes.some((u) => u.toString() === userId.toString());
    const updateQuery = alreadyLiked
      ? { $pull: { likes: userId } }
      : { $addToSet: { likes: userId } };

    const updated = await Post.findByIdAndUpdate(id, updateQuery, { new: true })
      .populate('author', 'fullName username profilePicture')
      .populate('comments.user', 'fullName username profilePicture');

    const formatted = formatPost(updated, userId);
    return res.status(200).json({
      likes: formatted.likes,
      likesCount: formatted.likesCount,
      isLiked: formatted.isLiked,
      currentUserReaction: formatted.currentUserReaction,
      post: formatted,
    });
  } catch (error) {
    console.error('TOGGLE LIKE ERROR:', error);
    return res.status(500).json({ message: 'Failed to update like.', error: error.message });
  }
};

router.put('/:id/like', authMiddleware, toggleLikeHandler);
router.put('/:id/react', authMiddleware, toggleLikeHandler);

// ── POST /api/feed/:id/comment : Add comment to post ────────────────────────
router.post('/:id/comment', authMiddleware, async (req, res) => {
  try {
    const userId = getAuthenticatedUserId(req);
    const { id } = req.params;
    const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';

    if (!userId) return res.status(401).json({ message: 'Authentication required.' });
    if (!text) return res.status(400).json({ message: 'Comment text cannot be empty.' });
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid post ID.' });
    }

    const post = await Post.findById(id);
    if (!post) return res.status(404).json({ message: 'Post not found.' });

    post.comments.push({ user: userId, text, createdAt: new Date() });
    await post.save();

    const populated = await Post.findById(id)
      .populate('comments.user', 'fullName username profilePicture');

    const formatted = formatPost(populated, userId);
    return res.status(201).json({
      comments: formatted.comments,
      commentsCount: formatted.commentsCount,
      post: formatted,
    });
  } catch (error) {
    console.error('ADD COMMENT ERROR:', error);
    return res.status(500).json({ message: 'Failed to add comment.', error: error.message });
  }
});

// ── GET /api/feed/:id/reactions / likes : List users who liked the post ─────
const getReactionsHandler = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid post ID.' });
    }

    const post = await Post.findById(id).populate('likes', 'fullName username profilePicture headline location');
    if (!post) return res.status(404).json({ message: 'Post not found.' });

    const users = (post.likes || []).map((u) => ({
      id: u._id.toString(),
      _id: u._id.toString(),
      fullName: u.fullName,
      username: u.username,
      profilePicture: u.profilePicture,
      headline: u.headline || 'Boolok Member',
      location: u.location || '',
      reactionType: 'like',
    }));

    return res.status(200).json({ all: users, like: users, count: users.length });
  } catch (error) {
    console.error('GET REACTIONS ERROR:', error);
    return res.status(500).json({ message: 'Failed to fetch reactions.', error: error.message });
  }
};

router.get('/:id/reactions', authMiddleware, getReactionsHandler);
router.get('/:id/likes', authMiddleware, getReactionsHandler);

// ── GET /api/feed/user/:userId : Fetch all posts by a specific user ──────────
router.get('/user/:userId', optionalAuth, async (req, res) => {
  try {
    const viewerId = getAuthenticatedUserId(req);
    const { userId } = req.params;

    let query = {};
    if (mongoose.Types.ObjectId.isValid(userId)) {
      query = { author: userId };
    } else {
      const u = await User.findOne({ username: userId });
      if (u) {
        query = { author: u._id };
      } else {
        return res.status(200).json({ posts: [] });
      }
    }

    const dbPosts = await Post.find(query)
      .populate('author', 'fullName username profilePicture headline location email')
      .populate('comments.user', 'fullName username profilePicture')
      .sort({ createdAt: -1 });

    const formatted = dbPosts.map((p) => formatPost(p, viewerId));
    return res.status(200).json({ posts: formatted });
  } catch (error) {
    console.error('GET USER POSTS ERROR:', error);
    return res.status(500).json({ message: 'Failed to fetch user posts.', error: error.message });
  }
});

// ── GET /api/feed/:id/details : Single post details ──────────────────────────
router.get('/:id/details', authMiddleware, async (req, res) => {
  try {
    const viewerId = getAuthenticatedUserId(req);
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid post ID.' });
    }

    const post = await Post.findById(id)
      .populate('author', 'fullName username profilePicture headline location email')
      .populate('comments.user', 'fullName username profilePicture');

    if (!post) return res.status(404).json({ message: 'Post not found.' });

    return res.status(200).json({ post: formatPost(post, viewerId) });
  } catch (error) {
    console.error('GET POST DETAILS ERROR:', error);
    return res.status(500).json({ message: 'Failed to fetch post details.', error: error.message });
  }
});

// ── DELETE /api/feed/:id : Delete post (owner only) ──────────────────────────
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const userId = getAuthenticatedUserId(req);
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid post ID.' });
    }

    const post = await Post.findById(id);
    if (!post) return res.status(404).json({ message: 'Post not found.' });
    if (post.author.toString() !== userId.toString()) {
      return res.status(403).json({ message: 'You can only delete your own posts.' });
    }

    await Post.findByIdAndDelete(id);
    return res.status(200).json({ message: 'Post deleted successfully.' });
  } catch (error) {
    console.error('DELETE POST ERROR:', error);
    return res.status(500).json({ message: 'Failed to delete post.', error: error.message });
  }
});

// ── Real Estate & Commercial News (Curated Industry Feed) ───────────────────
const REAL_ESTATE_NEWS = [
  {
    id: 'news-1',
    title: 'Commercial Office Towers Surge in London & NYC',
    time: '9h ago',
    readers: '22,392 readers',
    category: 'Commercial Real Estate',
    summary: 'Institutional buyers and private equity funds have deployed more than $14.6B into trophy Grade-A commercial office towers across London and New York City.',
    content: 'The global commercial office landscape is undergoing a decisive renaissance driven by institutional capital pivot toward high-efficiency, amenity-rich properties. In Central London and Manhattan, prime yields have stabilized around 5.2% to 5.75%, encouraging institutional REITs to close multi-hundred-million-dollar transactions.',
    sourceName: 'Financial Times Property & Bloomberg Real Estate',
    sourceUrl: 'https://www.bloomberg.com/real-estate',
  },
  {
    id: 'news-2',
    title: 'Top 10 Prime Commercial Buildings For Sale in 2026',
    time: '9h ago',
    readers: '14,976 readers',
    category: 'Property Listings',
    summary: 'Exclusive institutional showcase reveals high-cap-rate tech parks, corporate headquarters, and mixed-use towers currently listed for acquisition across global financial hubs.',
    content: 'A curated catalog of premier commercial developments has arrived on the market this quarter, headlined by Outer Ring Road Tech Campus (Bangalore), Margaret River Estate (Australia), and Bishopsgate Corporate Tower (London).',
    sourceName: 'Boolok Institutional Asset Index & RERA Commercial',
    sourceUrl: 'https://www.cbre.com/insights',
  },
  {
    id: 'news-3',
    title: 'Boolok AI Property Valuation Index Hits Record High',
    time: '57m ago',
    readers: '8,709 readers',
    category: 'AI Market Intelligence',
    summary: 'Boolok’s proprietary neural real estate appraisal algorithm recorded an all-time high valuation confidence score across 45,000 commercial and multi-family properties.',
    content: 'By synthesizing spatial computer vision, municipal tax records, and live footfall telemetry, the Boolok AI Valuation Index delivers 4x faster institutional underwriting with 99% accuracy on cap rate trends.',
    sourceName: 'Boolok AI Research & MIT Center for Real Estate',
    sourceUrl: 'https://cre.mit.edu',
  },
  {
    id: 'news-4',
    title: 'Waterfront Luxury Estates See Record Institutional Influx',
    time: '6h ago',
    readers: '6,387 readers',
    category: 'Luxury Real Estate',
    summary: 'Private family offices and sovereign wealth vehicles allocated $4.2B into trophy beachfront residences and private island compounds.',
    content: 'Ultra-high-net-worth liquidity continues to migrate into resilient coastal real estate assets with deeded deepwater yacht docks and private helipads across Miami Beach, Palm Jumeirah, and coastal Australia.',
    sourceName: 'Knight Frank Global Wealth & Luxury Estates Review',
    sourceUrl: 'https://www.knightfrank.com/research',
  },
  {
    id: 'news-5',
    title: 'Retail-to-Residential Conversions Accelerating in Metros',
    time: '6h ago',
    readers: '3,158 readers',
    category: 'Urban Redevelopment',
    summary: 'Municipal zoning modernizations across Tier-1 cities are expediting the adaptive reuse of suburban shopping centres into dynamic residential communities.',
    content: 'Developers are seizing opportunities to convert underperforming retail malls into high-density urban residential hubs with expedited RERA permits and tax-increment financing.',
    sourceName: 'Urban Land Institute (ULI) Emerging Trends',
    sourceUrl: 'https://americas.uli.org',
  },
  {
    id: 'news-6',
    title: 'Singapore Grade-A Tech Parks Attract $1.2B Capital Inflow',
    time: '12h ago',
    readers: '5,420 readers',
    category: 'Global Assets',
    summary: 'Cross-border real estate investment trusts acquired three major business park clusters in Singapore’s One-North science district.',
    content: 'Buoyed by robust biomedical and generative AI enterprise expansions, Singapore’s institutional tech park occupancy sits at 96.2%, solidifying Southeast Asia’s premier position for commercial capital security.',
    sourceName: 'JLL Global Real Estate Intelligence',
    sourceUrl: 'https://www.jll.com/trends-and-insights',
  },
];

router.get('/news', (_req, res) => {
  return res.status(200).json({ news: REAL_ESTATE_NEWS });
});

module.exports = router;