const express = require('express');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const User = require('../models/User');
const Post = require('../models/Post');
const Reel = require('../models/Reel');
const Notification = require('../models/Notification');
const authMiddleware = require('../middleware/auth');
const optionalAuth = require('../middleware/optionalAuth');

const router = express.Router();

function saveBase64Image(base64Data, subfolder = 'posts') {
  if (!base64Data || typeof base64Data !== 'string') return null;
  const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) {
    return null;
  }
  const mimeType = matches[1];
  let ext = 'jpg';
  if (mimeType.includes('png')) ext = 'png';
  else if (mimeType.includes('webp')) ext = 'webp';
  else if (mimeType.includes('jpeg') || mimeType.includes('jpg')) ext = 'jpg';

  const buffer = Buffer.from(matches[2], 'base64');
  const filename = `avatar-${Date.now()}-${Math.round(Math.random() * 1e9)}.${ext}`;
  const uploadDir = path.join(__dirname, '../uploads', subfolder);
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
  fs.writeFileSync(path.join(uploadDir, filename), buffer);
  return `/uploads/${subfolder}/${filename}`;
}

const getAuthenticatedUserId = (req) => req.user?.id || req.user?._id || req.userId || null;

// Canonical exclusion sets for discovery, search, and follower/following lists
// Note: These records are preserved in MongoDB (no deletion/merging/renaming),
// but excluded from Suggested for You, user search, and relationship counts/modals.
const EXCLUDED_DISCOVERY_IDS = new Set([
  '6aed46c6c434745e57daa204', // @brokers (Brokers)
  '6ae9bc64b549b88abf72eabf', // @logesh (Logesh)
  '6ae9bd78b549b88abf72eac0', // @mithulan_r_archived (Mithulan R archived duplicate)
  '6ae95fadfc368c444958f948', // @profile (Profile synthetic placeholder)
  '6ae831133794c3dc22c0673b', // @advisor (Advisor synthetic placeholder)
  '6ae8317d3794c3dc22c0673c', // @qauser_1793601913902
  '6ae831c93794c3dc22c0673d', // @qamatrix_1793601989818
  '6aeddcf9b640ccc8aeca4191', // @t1793973488209
]);

const EXCLUDED_DISCOVERY_USERNAMES = new Set([
  'brokers',
  'logesh',
  'mithulan_r_archived',
  'profile',
  'advisor',
  'aswin.realty',
  'aswin_realty',
  'ig_vicky16',
  'ig_vicky.16',
  'vicky',
  'vicky_luxury',
  'yashwanth_realty',
  'cinemahub.live',
  'cinemahub',
  'mithulanmass',
]);

const DINESH_CANONICAL_AVATAR = 'data:image/png;base64,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';

const CANONICAL_AVATAR_BY_ID_OR_USERNAME = {
  '6ace0e6586b4ca082d9f1432': 'https://boolok-backend-zcpn.onrender.com/uploads/posts/1789649928275-313418897.jpg',
  'logeshwarana': 'https://boolok-backend-zcpn.onrender.com/uploads/posts/1789649928275-313418897.jpg',
  '6addf49b5f3925f54f8491f6': 'https://lh3.googleusercontent.com/a/ACg8ocJNc1F5yHFweMK8qtYRFt_2AJJQqzi4y0P2t7z2a4IHwoWCQYKJ=s400-c',
  'mithulanr2003': 'https://lh3.googleusercontent.com/a/ACg8ocJNc1F5yHFweMK8qtYRFt_2AJJQqzi4y0P2t7z2a4IHwoWCQYKJ=s400-c',
  'mithulan_r': 'https://lh3.googleusercontent.com/a/ACg8ocJNc1F5yHFweMK8qtYRFt_2AJJQqzi4y0P2t7z2a4IHwoWCQYKJ=s400-c',
  '6aed5f1234567890abcdef01': DINESH_CANONICAL_AVATAR,
  'pgma251': DINESH_CANONICAL_AVATAR,
};

function isExcludedUserRef(ref) {
  if (!ref) return true;
  if (typeof ref === 'object') {
    if (ref.isArchived === true || ref.isTestAccount === true) return true;
    const rid = String(ref._id || ref.id || '').trim();
    const runame = String(ref.username || '').trim().toLowerCase();
    if (rid && EXCLUDED_DISCOVERY_IDS.has(rid)) return true;
    if (runame && (EXCLUDED_DISCOVERY_USERNAMES.has(runame) || /^(qauser_|qamatrix_|qatest_|t\d{10,})/i.test(runame))) return true;
    return false;
  }
  const str = String(ref).trim();
  if (!str) return true;
  if (EXCLUDED_DISCOVERY_IDS.has(str)) return true;
  if (EXCLUDED_DISCOVERY_USERNAMES.has(str.toLowerCase())) return true;
  return false;
}

function resolveCanonicalAvatar(userLike) {
  if (!userLike || typeof userLike !== 'object') return null;
  const uid = String(userLike._id || userLike.id || '').trim();
  const uname = String(userLike.username || '').trim().toLowerCase();
  if (uid === '6a7a0dbb51a42123f22c4edf' || uname === 'saivimenthanvl' || uname === 'saivimenthan') {
    return null;
  }
  if (uid && CANONICAL_AVATAR_BY_ID_OR_USERNAME[uid]) {
    return CANONICAL_AVATAR_BY_ID_OR_USERNAME[uid];
  }
  if (uname && CANONICAL_AVATAR_BY_ID_OR_USERNAME[uname]) {
    return CANONICAL_AVATAR_BY_ID_OR_USERNAME[uname];
  }
  const raw = userLike.profilePicture || userLike.avatar || null;
  if (!raw || typeof raw !== 'string') return null;
  if (
    raw.includes('ACg8ocJ_TV7') ||
    raw.includes('ACg8ocK0o5SZUMa') ||
    raw.includes('/uploads/avatars/dinesh.png') ||
    raw.includes('/uploads/avatars/mithulan.png')
  ) {
    return null;
  }
  return raw;
}

function sanitizeUserProfile(user, viewerId = null) {
  const rawFollowers = user.followers || [];
  const rawFollowing = user.following || [];

  // Deduplicate followers by id and filter out excluded/archived/test accounts
  const seenFids = new Set();
  const followers = [];
  for (const f of rawFollowers) {
    if (isExcludedUserRef(f)) continue;
    const fId = f && f._id ? f._id.toString() : String(f || '');
    if (!fId || seenFids.has(fId)) continue;
    seenFids.add(fId);
    followers.push(f);
  }

  // Deduplicate following by id and filter out excluded/archived/test accounts
  const seenFollowingIds = new Set();
  const following = [];
  for (const f of rawFollowing) {
    if (isExcludedUserRef(f)) continue;
    const fId = f && f._id ? f._id.toString() : String(f || '');
    if (!fId || seenFollowingIds.has(fId)) continue;
    seenFollowingIds.add(fId);
    following.push(f);
  }

  const isFollowing = viewerId
    ? followers.some((f) => {
      const fId = f._id ? f._id.toString() : f.toString();
      return fId === viewerId.toString();
    })
    : false;

  // Deduplicate follower display names strictly
  const seenNames = new Set();
  const followerNames = [];
  for (const f of followers) {
    if (typeof f === 'object' && f && f.fullName) {
      const name = f.fullName.trim();
      if (!seenNames.has(name.toLowerCase())) {
        seenNames.add(name.toLowerCase());
        followerNames.push(name);
      }
    }
  }

  let mutualsText = '';
  if (followerNames.length === 1) {
    mutualsText = `Followed by ${followerNames[0]}`;
  } else if (followerNames.length === 2) {
    mutualsText = `Followed by ${followerNames[0]} and ${followerNames[1]}`;
  } else if (followerNames.length === 3) {
    mutualsText = `Followed by ${followerNames[0]}, ${followerNames[1]} and 1 other`;
  } else if (followerNames.length > 3) {
    mutualsText = `Followed by ${followerNames[0]}, ${followerNames[1]} and ${followerNames.length - 2} others`;
  }

  const followerCount = followers.length;
  const followingCount = following.length;

  let sanitizedFullName = user.fullName;
  let sanitizedUsername = user.username || user.fullName?.replace(/\s+/g, '').toLowerCase() || 'user';
  if (sanitizedUsername === 'saivimenthanvl' || sanitizedUsername === 'saivimenthan' || (sanitizedFullName && sanitizedFullName.trim().toLowerCase() === 'sai')) {
    sanitizedFullName = 'Sai Vimenthan V L';
  }

  if (sanitizedUsername === 'ig_vicky16' || sanitizedUsername === 'ig_vicky.16' || sanitizedUsername === 'vicky' || (sanitizedFullName && sanitizedFullName.includes('Vicky'))) {
    sanitizedFullName = 'Vigneshwaran';
    sanitizedUsername = 'vignesh';
  }
  if (sanitizedUsername === 'yashwanth_realty' || sanitizedUsername === 'cinemahub.live' || sanitizedUsername === 'cinemahub' || (sanitizedFullName && (sanitizedFullName.includes('Yashwanth Realty') || sanitizedFullName.includes('cinemahub')))) {
    sanitizedFullName = 'Yashwanth';
    sanitizedUsername = 'yashwanth';
  }

  if (sanitizedUsername === 'aswin.realty' || sanitizedUsername === 'aswin.realty' || sanitizedUsername === 'aswin.realty' || (sanitizedFullName && sanitizedFullName.includes('Aswin'))) {
    sanitizedFullName = 'Aswin Real Estate';
    sanitizedUsername = 'aswin';
  }

  const resolvedProfilePicture = resolveCanonicalAvatar(user);

  return {
    id: user._id.toString(),
    _id: user._id.toString(),
    fullName: sanitizedFullName,
    username: sanitizedUsername,
    bio: user.bio || '',
    headline: user.headline || 'Real Estate Professional & Boolok Member',
    location: user.location || 'Chennai, Tamil Nadu · Prime Assets',
    coverImage: user.coverImage || 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1200',
    profilePicture: resolvedProfilePicture,
    closedDeals: user.closedDeals || '0',
    followerCount,
    followingCount,
    isFollowing,
    isSelf: viewerId ? viewerId.toString() === user._id.toString() : false,
    mutuals: mutualsText || `${followerCount} followers in Boolok Real Estate Network`,
    followers: followers.map((f) => (typeof f === 'object' ? { id: f._id, _id: f._id, fullName: f.fullName, username: f.username, profilePicture: resolveCanonicalAvatar(f) } : f)),
    following: following.map((f) => (typeof f === 'object' ? { id: f._id, _id: f._id, fullName: f.fullName, username: f.username, profilePicture: resolveCanonicalAvatar(f) } : f)),
  };
}

// ── GET /api/users/self (Compatibility route for current user profile) ─────
router.get('/self', authMiddleware, async (req, res) => {
  try {
    const userId = getAuthenticatedUserId(req);
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }
    return res.status(200).json({ user: sanitizeUserProfile(user, userId) });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch current user.', error: error.message });
  }
});

// ── GET /api/users/search?q=query ──────────────────────────────────────────
router.get('/search', async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) {
      return res.status(200).json({ results: [] });
    }

    let viewerId = null;
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
      if (token) {
        const jwt = require('jsonwebtoken');
        const secrets = [
          process.env.JWT_SECRET,
          'boolok_default_jwt_secret_key_2026',
          'boolok_secret_key_2026',
        ].filter(Boolean);
        for (const s of secrets) {
          try {
            const decoded = jwt.verify(token, s);
            viewerId = decoded.id || decoded._id || decoded.userId;
            if (viewerId) break;
          } catch (_) {}
        }
      }
    } catch (_) { }

    const escapedQuery = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedQuery, 'i');

    const excludedIds = Array.from(EXCLUDED_DISCOVERY_IDS)
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    const users = await User.find({
      $and: [
        { _id: { $nin: excludedIds } },
        { username: { $nin: Array.from(EXCLUDED_DISCOVERY_USERNAMES) } },
        { username: { $not: /^(qauser_|qamatrix_|qatest_|t\d{10,})/i } },
        { isArchived: { $ne: true } },
        { isTestAccount: { $ne: true } },
        { fullName: { $not: /^(Advisor|Brokers|Profile)$/i } },
        {
          $or: [
            { fullName: regex },
            { username: regex },
            { email: regex },
            { headline: regex },
            { location: regex },
          ],
        },
      ],
    })
      .select('fullName username profilePicture bio headline location closedDeals followers following isArchived isTestAccount')
      .limit(20);

    const results = users
      .filter((u) => !isExcludedUserRef(u))
      .map((u) => sanitizeUserProfile(u, viewerId));

    const memberMatches = COMMUNITY_MEMBERS.filter(
      (m) =>
        m.fullName.toLowerCase().includes(q.toLowerCase()) ||
        m.username.toLowerCase().includes(q.toLowerCase()) ||
        m.headline.toLowerCase().includes(q.toLowerCase()) ||
        (m.location && m.location.toLowerCase().includes(q.toLowerCase()))
    );

    const seenUsernames = new Set(results.map((r) => (r.username || '').toLowerCase()));
    for (const m of memberMatches) {
      if (!seenUsernames.has(m.username.toLowerCase()) && !EXCLUDED_DISCOVERY_USERNAMES.has(m.username.toLowerCase())) {
        seenUsernames.add(m.username.toLowerCase());
        results.push({
          id: m.username,
          _id: m.username,
          fullName: m.fullName,
          username: m.username,
          headline: m.headline,
          location: m.location,
          profilePicture: resolveCanonicalAvatar(m) || m.profilePicture || null,
          followerCount: 0,
          isFollowing: false,
          isSelf: false,
        });
      }
    }

    // Filter out blacklisted/duplicate/archived usernames & IDs
    const filteredResults = results.filter((r) => {
      if (isExcludedUserRef(r)) return false;
      const u = (r.username || '').toLowerCase();
      const fn = (r.fullName || '').toLowerCase();
      if (EXCLUDED_DISCOVERY_USERNAMES.has(u)) return false;
      if (fn.includes('vicky') || fn.includes('cinemahub')) return false;
      if (fn === 'brokers' || (fn === 'logesh' && u === 'logesh')) return false;
      return true;
    });

    return res.status(200).json({ results: filteredResults });
  } catch (error) {
    console.error('SEARCH USERS ERROR:', error);
    return res.status(500).json({ message: 'Search failed.', error: error.message });
  }
});

const COMMUNITY_MEMBERS = [
  {
    username: 'shreekutti',
    aliases: ['shreekutti'],
    fullName: 'Shreekutti',
    email: 'shreekutti@boolok.ai',
    headline: 'Commercial Property & Tech Park Portfolio Lead @ Boolok',
    location: 'Bangalore, Karnataka · Tech Parks',
    bio: 'Specialized in commercial land development and Grade-A tech hub transactions across South India.',
    closedDeals: '4',
    profilePicture: null,
    coverImage: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200',
  },
  {
    username: 'logeshwarana',
    aliases: ['logeshwaran_ashok'],
    fullName: 'Logeshwaran A',
    email: 'waranlogesh0406@gmail.com',
    headline: 'Architectural Consultant & Real Estate Lead',
    location: 'Western Australia',
    bio: 'Focused on precision cap-rate calculations, commercial yield optimization, and real estate investment portfolios.',
    closedDeals: '3',
    profilePicture: 'https://boolok-backend-zcpn.onrender.com/uploads/posts/1789649928275-313418897.jpg',
    coverImage: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1200',
  },
  {
    username: 'ajmal',
    aliases: ['ajmal', 'mohammed_ajmal'],
    fullName: 'Mohammed Ajmal',
    email: 'ajmal@boolok.ai',
    headline: 'Luxury Living & High-End Residential Broker',
    location: 'Dubai & Kochi · Luxury Villas',
    bio: 'Connecting international investors to premier waterfront villas and bespoke residential developments.',
    closedDeals: '3',
    profilePicture: null,
    coverImage: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=1200',
  },
  {
    username: 'bavadharini_rs',
    aliases: ['bavadharini_rs', 'bavadharini'],
    fullName: 'Bavadharini RS',
    email: 'bavadharini@boolok.ai',
    headline: 'Interior Designer & Modern Living Specialist',
    location: 'Chennai, Tamil Nadu · Modern Living',
    bio: 'Bespoke high-end interior architecture, penthouse makeovers, and custom luxury styling.',
    closedDeals: '2',
    profilePicture: null,
    coverImage: 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?w=1200',
  },
  {
    username: 'the_akshtr_estate',
    aliases: ['agent-4', 'akshat_commercials', 'akshat', 'the_akshtr_estate'],
    fullName: 'Akshat Commercials',
    email: 'akshat.commercials@boolok.ai',
    headline: 'Commercial Property & Tech Park Portfolio Lead @ Boolok Network',
    location: 'Chennai, Tamil Nadu · Prime Assets',
    bio: 'Specializing in Grade-A IT SEZ parks, commercial lease syndications, and institutional asset acquisitions on OMR Chennai.',
    closedDeals: '2',
    profilePicture: null,
    coverImage: 'https://images.unsplash.com/photo-1577495508048-b635879837f1?w=1200',
  },
  {
    username: 'prasanth_properties',
    aliases: ['agent-1', 'prasanth', 'prasanth_properties'],
    fullName: 'Prasanth Properties',
    email: 'prasanth.properties@boolok.ai',
    headline: 'Luxury Waterfront Specialist · Miami & Coastal Estates',
    location: 'Miami, Florida · Coastal Estates',
    bio: 'Luxury real estate advisory focused on ultra-prime beachfront residences and waterfront villas.',
    closedDeals: '2',
    profilePicture: null,
    coverImage: 'https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=1200',
  },
  {
    username: 'aswin',
    aliases: ['agent-2', 'aswin'],
    fullName: 'Aswin Real Estate',
    email: 'aswin@boolok.ai',
    headline: 'Principal Real Estate Broker & Multi-Family Asset Advisor',
    location: 'Chennai, Tamil Nadu · Luxury & Commercial Assets',
    bio: 'Expert commercial multi-family portfolio manager with deep market analytics on cap rates and returns.',
    closedDeals: '1',
    profilePicture: null,
    coverImage: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1200',
  },
  {
    username: 'vignesh',
    aliases: ['agent-3', 'vignesh', 'vigneshwaran'],
    fullName: 'Vigneshwaran',
    email: 'vigneshwaran@boolok.ai',
    headline: 'Prime Architectural Estates & Beverly Hills Luxury Specialist',
    location: 'Beverly Hills, California · Ultra Luxury',
    bio: 'Curating custom luxury properties, penthouses, and architectural landmarks for high net worth clients.',
    closedDeals: '1',
    profilePicture: null,
    coverImage: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=1200',
  },
  {
    username: 'yashwanth',
    aliases: ['yashwanth'],
    fullName: 'Yashwanth',
    email: 'yashwanth@boolok.ai',
    headline: 'Prime Commercial Hubs & Institutional Realty Lead',
    location: 'Chennai & Bangalore · Commercial Hubs',
    bio: 'Acquiring prime commercial buildings, corporate hubs, and investment estates across South India.',
    closedDeals: '1',
    profilePicture: null,
    coverImage: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200',
  },
  {
    username: 'sophia_luxury',
    aliases: ['sophia_sterling', 'sophia_luxury', 'sophia'],
    fullName: 'Sophia Sterling',
    email: 'sophia.sterling@sterlingholdings.eu',
    headline: 'European Family Office Principal & Luxury Syndication Client',
    location: 'Geneva, Switzerland & London · Private Capital',
    bio: 'Managing cross-border real estate acquisitions and luxury fractional syndicates for European private wealth clients.',
    closedDeals: '2',
    profilePicture: null,
    coverImage: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1200',
  },
  {
    username: 'david_sterling',
    aliases: ['david_sterling', 'david'],
    fullName: 'David Sterling',
    email: 'david.sterling@sterlingholdings.eu',
    headline: 'Managing Director · Sterling Global Capital & Asset Co-Owner',
    location: 'London, UK & Beverly Hills · Private Equity',
    bio: 'Directing private equity allocation in architectural landmarks, luxury fractional estates, and prime commercial assets.',
    closedDeals: '3',
    profilePicture: null,
    coverImage: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=1200',
  },
  {
    username: 'marcus_vance',
    aliases: ['marcus_vance', 'marcus'],
    fullName: 'Marcus Vance',
    email: 'marcus.vance@vanceacquisitions.com',
    headline: 'Institutional Real Estate Syndicate Lead & Co-Ownership Client',
    location: 'New York, NY · Real Estate Private Equity',
    bio: 'Partnering in deeded fractional syndicates, commercial co-ownership models, and turnkey trophy estate acquisitions.',
    closedDeals: '2',
    profilePicture: null,
    coverImage: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200',
  },
  {
    username: 'saivimenthanvl',
    aliases: ['sai', 'saivimenthanvl', 'saivimenthan'],
    fullName: 'Sai Vimenthan V L',
    email: 'saivimenthanvl@gmail.com',
    headline: 'Principal Real Estate Broker & Portfolio Advisor',
    location: 'Chennai, Tamil Nadu · Prime Assets',
    bio: 'Principal Broker overseeing premium residential estates, commercial office syndication, and institutional real estate acquisitions.',
    closedDeals: '3',
    profilePicture: null,
    coverImage: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1200',
  },
];

async function resolveOrSeedUser(id, viewerId = null) {
  let profileUser = null;
  const lookup = (id || '').toString().trim().toLowerCase();
  if (!lookup) return null;

  // Handle 'self' or 'me' using the authenticated viewer ID
  if (lookup === 'self' || lookup === 'me') {
    if (!viewerId) return null;
    return await User.findById(viewerId)
      .populate('followers', 'fullName username profilePicture headline location')
      .populate('following', 'fullName username profilePicture headline location');
  }

  if (mongoose.Types.ObjectId.isValid(lookup)) {
    profileUser = await User.findById(lookup)
      .populate('followers', 'fullName username profilePicture headline location')
      .populate('following', 'fullName username profilePicture headline location');
  }

  if (!profileUser) {
    profileUser = await User.findOne({
      $or: [
        { username: lookup },
        { email: lookup },
      ]
    })
      .populate('followers', 'fullName username profilePicture headline location')
      .populate('following', 'fullName username profilePicture headline location');
  }

  if (!profileUser) {
    const memberDef = COMMUNITY_MEMBERS.find(
      (m) => m.username.toLowerCase() === lookup || (m.aliases && m.aliases.map((a) => a.toLowerCase()).includes(lookup))
    );

    if (memberDef) {
      let existing = await User.findOne({
        $or: [{ username: memberDef.username }, { email: memberDef.email }],
      });

      if (!existing) {
        existing = await User.create({
          fullName: memberDef.fullName,
          username: memberDef.username,
          email: memberDef.email,
          password: '$2a$10$BoolokDefaultPasswordHash2026.SeededUser',
          headline: memberDef.headline,
          location: memberDef.location,
          bio: memberDef.bio,
          closedDeals: memberDef.closedDeals || '0',
          profilePicture: memberDef.profilePicture || null,
          coverImage: memberDef.coverImage || 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1200',
          followers: [],
          following: [],
        });
      } else {
        let needsSave = false;
        if (memberDef.fullName && existing.fullName !== memberDef.fullName) {
          existing.fullName = memberDef.fullName;
          needsSave = true;
        }
        if (!existing.profilePicture && memberDef.profilePicture) {
          existing.profilePicture = memberDef.profilePicture;
          needsSave = true;
        }
        if (memberDef.headline && (!existing.headline || existing.headline.includes('Boolok Member'))) {
          existing.headline = memberDef.headline;
          needsSave = true;
        }
        if (memberDef.location && (!existing.location || existing.location.includes('Global'))) {
          existing.location = memberDef.location;
          needsSave = true;
        }
        if (memberDef.bio && !existing.bio) {
          existing.bio = memberDef.bio;
          needsSave = true;
        }
        if (memberDef.coverImage && !existing.coverImage) {
          existing.coverImage = memberDef.coverImage;
          needsSave = true;
        }
        if (needsSave) await existing.save();
      }

      profileUser = await User.findById(existing._id)
        .populate('followers', 'fullName username profilePicture headline location')
        .populate('following', 'fullName username profilePicture headline location');
    }
  }

  if (!profileUser && lookup && !mongoose.Types.ObjectId.isValid(lookup)) {
    const existing = await User.findOne({ username: lookup });
    if (existing) {
      profileUser = await User.findById(existing._id)
        .populate('followers', 'fullName username profilePicture headline location isArchived isTestAccount')
        .populate('following', 'fullName username profilePicture headline location isArchived isTestAccount');
    }
  }

  return profileUser;
}

async function ensureCommunityConnections() {
  try {
    // 0. Update and delete any duplicate/legacy MongoDB documents
    await User.deleteMany({
      $or: [
        { username: { $in: ['vicky', 'vicky_luxury', 'ig_vicky.16', 'ig_vicky16'] } },
        { fullName: /Vicky/i },
        { email: /vicky/i },
        { username: 'aswin.realty' },
      ],
    });

    await User.updateMany(
      { username: 'vignesh' },
      { $set: { username: 'vignesh', fullName: 'Vigneshwaran', email: 'vigneshwaran@boolok.ai' } }
    );
    await User.updateMany(
      { username: 'yashwanth' },
      { $set: { username: 'yashwanth', fullName: 'Yashwanth', email: 'yashwanth@boolok.ai' } }
    );
    await User.updateMany(
      { username: 'aswin' },
      { $set: { username: 'aswin', fullName: 'Aswin Real Estate', email: 'aswin@boolok.ai' } }
    );

    // 1. Ensure all community members are in MongoDB with their full details
    const memberDocs = {};
    for (const m of COMMUNITY_MEMBERS) {
      let user = await User.findOne({ email: m.email });
      if (!user) {
        user = await User.findOne({ username: m.username });
      }
      if (!user && m.aliases && m.aliases.length > 0) {
        user = await User.findOne({ username: { $in: m.aliases } });
      }

      if (!user) {
        user = await User.create({
          fullName: m.fullName,
          username: m.username,
          email: m.email,
          password: '$2a$10$BoolokDefaultPasswordHash2026.SeededUser',
          headline: m.headline,
          location: m.location,
          bio: m.bio,
          closedDeals: m.closedDeals || '0',
          profilePicture: m.profilePicture || null,
          coverImage: m.coverImage || 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1200',
          followers: [],
          following: [],
        });
      } else {
        let changed = false;
        if (user.username !== m.username && (!user.email || !user.email.includes('gmail.com'))) {
          user.username = m.username;
          changed = true;
        }
        if (user.fullName !== m.fullName && (!user.email || !user.email.includes('gmail.com'))) {
          user.fullName = m.fullName;
          changed = true;
        }
        if (user.closedDeals !== (m.closedDeals || '0')) {
          user.closedDeals = m.closedDeals || '0';
          changed = true;
        }
        if (changed) {
          try {
            await user.save();
          } catch (saveErr) {
            // Ignore duplicate key conflicts during seed update
          }
        }
      }
      memberDocs[m.username] = user;
    }

    // 2. Establish realistic, verified mutual follower relationships if empty (Only among seed demo accounts, NEVER on real users)
    const INITIAL_FOLLOW_MAP = {
      shreekutti: ['logeshwarana', 'ajmal'],
      logeshwarana: ['shreekutti', 'ajmal'],
      ajmal: ['shreekutti', 'logeshwarana', 'vignesh'],
      the_akshtr_estate: ['shreekutti', 'logeshwarana'],
      prasanth_properties: ['ajmal', 'bavadharini_rs'],
      bavadharini_rs: ['logeshwarana', 'ajmal'],
      vignesh: ['shreekutti', 'logeshwarana'],
      aswin: ['shreekutti', 'logeshwarana'],
      yashwanth: ['shreekutti', 'logeshwarana'],
      sophia_luxury: ['david_sterling', 'marcus_vance'],
      david_sterling: ['sophia_luxury', 'marcus_vance'],
      marcus_vance: ['sophia_luxury', 'david_sterling'],
    };

    for (const [targetUsername, followerUsernames] of Object.entries(INITIAL_FOLLOW_MAP)) {
      const targetUser = memberDocs[targetUsername];
      if (!targetUser) continue;

      if (!targetUser.followers || targetUser.followers.length === 0) {
        const followerIds = [];
        for (const fUname of followerUsernames) {
          const fDoc = memberDocs[fUname];
          if (fDoc && fDoc._id.toString() !== targetUser._id.toString()) {
            followerIds.push(fDoc._id);
            await User.updateOne({ _id: fDoc._id }, { $addToSet: { following: targetUser._id } }).catch(() => {});
          }
        }
        if (followerIds.length > 0) {
          await User.updateOne({ _id: targetUser._id }, { $addToSet: { followers: { $each: followerIds } } }).catch(() => {});
        }
      }
    }
  } catch (err) {
    console.error('ensureCommunityConnections error:', err);
  }
}

// ── GET /api/users/suggested ───────────────────────────────────────────────
router.get('/suggested', optionalAuth, async (req, res) => {
  try {
    const viewerId = getAuthenticatedUserId(req);

    // Auto-seed community members into MongoDB with full relationships
    await ensureCommunityConnections();

    const excludedIds = Array.from(EXCLUDED_DISCOVERY_IDS)
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));
    if (viewerId && mongoose.Types.ObjectId.isValid(viewerId)) {
      excludedIds.push(new mongoose.Types.ObjectId(viewerId));
    }

    const query = {
      _id: { $nin: excludedIds },
      email: { $ne: 'logeshwarana@boolok.ai' },
      username: {
        $nin: Array.from(EXCLUDED_DISCOVERY_USERNAMES),
        $not: /^(qauser_|qamatrix_|qatest_|t\d{10,})/i,
      },
      isArchived: { $ne: true },
      isTestAccount: { $ne: true },
      fullName: { $not: /^(Advisor|Brokers|Profile)$/i },
    };

    const users = await User.find(query)
      .populate('followers', 'fullName username profilePicture isArchived isTestAccount')
      .select('fullName username email profilePicture bio headline location followers following isArchived isTestAccount')
      .limit(30);

    const seen = new Set();
    const suggested = [];

    for (const u of users) {
      if (isExcludedUserRef(u)) continue;
      const sanitized = sanitizeUserProfile(u, viewerId);
      const uname = (sanitized.username || sanitized.id || '').toLowerCase();
      const fname = (sanitized.fullName || '').toLowerCase();
      if (EXCLUDED_DISCOVERY_USERNAMES.has(uname) || EXCLUDED_DISCOVERY_IDS.has(sanitized.id)) continue;
      if (uname.includes('6a8dc') || fname.includes('6a8dc') || /^[0-9a-fA-F]{24}$/.test(uname)) continue;
      if (/^(qauser_|qamatrix_|qatest_|t\d{10,})/i.test(uname)) continue;
      if (fname === 'brokers' || (fname === 'logesh' && uname === 'logesh')) continue;
      if (seen.has(uname)) continue;
      seen.add(uname);

      suggested.push({
        id: sanitized.id,
        _id: sanitized.id,
        fullName: sanitized.fullName,
        username: sanitized.username,
        title: sanitized.headline,
        headline: sanitized.headline,
        location: sanitized.location,
        avatar: sanitized.profilePicture,
        profilePicture: sanitized.profilePicture,
        followerCount: sanitized.followerCount,
        followingCount: sanitized.followingCount,
        isFollowing: sanitized.isFollowing,
        subtitle: sanitized.mutuals || (sanitized.followerCount > 0 ? `${sanitized.followerCount} follower${sanitized.followerCount > 1 ? 's' : ''}` : 'New Member'),
      });
    }

    return res.status(200).json({ suggested });
  } catch (error) {
    console.error('GET SUGGESTED USERS ERROR:', error);
    return res.status(500).json({ message: 'Failed to fetch suggested users.', error: error.message });
  }
});

// ── GET /api/users/notifications ──────────────────────────────────────────
router.get('/notifications', authMiddleware, async (req, res) => {
  try {
    const viewerId = getAuthenticatedUserId(req);
    if (!viewerId) return res.status(401).json({ message: 'Unauthorized.' });

    const notifications = await Notification.find({ recipient: viewerId })
      .populate('sender', 'fullName username profilePicture')
      .sort({ createdAt: -1 })
      .limit(30);

    const unreadCount = await Notification.countDocuments({ recipient: viewerId, read: false });

    return res.status(200).json({
      notifications,
      unreadCount,
    });
  } catch (error) {
    console.error('GET NOTIFICATIONS ERROR:', error);
    return res.status(500).json({ message: 'Failed to fetch notifications.', error: error.message });
  }
});

// ── PUT /api/users/notifications/read-all ─────────────────────────────────
router.put('/notifications/read-all', authMiddleware, async (req, res) => {
  try {
    const viewerId = getAuthenticatedUserId(req);
    if (!viewerId) return res.status(401).json({ message: 'Unauthorized.' });

    await Notification.updateMany({ recipient: viewerId, read: false }, { $set: { read: true } });

    return res.status(200).json({ success: true, message: 'All notifications marked as read.' });
  } catch (error) {
    console.error('READ ALL NOTIFICATIONS ERROR:', error);
    return res.status(500).json({ message: 'Failed to mark notifications as read.', error: error.message });
  }
});

const upload = require('../config/localUpload');

// ── POST /api/users/avatar (Upload custom avatar photo from device / camera) 
router.post('/avatar', authMiddleware, upload.single('avatar'), async (req, res) => {
  try {
    const viewerId = getAuthenticatedUserId(req);
    if (!viewerId) return res.status(401).json({ message: 'Unauthorized.' });

    let profilePicture = null;
    if (req.file) {
      try {
        const fileBuffer = fs.readFileSync(req.file.path);
        const mime = req.file.mimetype || 'image/jpeg';
        profilePicture = `data:${mime};base64,${fileBuffer.toString('base64')}`;
        try { fs.unlinkSync(req.file.path); } catch (_) {}
      } catch (readErr) {
        profilePicture = `/uploads/posts/${req.file.filename}`;
      }
    } else if (req.body.avatar && typeof req.body.avatar === 'string') {
      profilePicture = req.body.avatar.trim();
    } else if (req.body.profilePicture && typeof req.body.profilePicture === 'string') {
      profilePicture = req.body.profilePicture.trim();
    }

    if (!profilePicture) {
      return res.status(400).json({ message: 'No avatar image provided.' });
    }

    if (profilePicture.startsWith('blob:') || profilePicture.startsWith('file:')) {
      return res.status(400).json({ message: 'Cannot save temporary client blob URI. Please upload as multipart file.' });
    }

    // Note: profilePicture (including data:image/) is kept directly in MongoDB for permanent persistence across Render restarts.

    const updatedUser = await User.findByIdAndUpdate(
      viewerId,
      { $set: { profilePicture } },
      { new: true }
    )
      .populate('followers', 'fullName username profilePicture')
      .populate('following', 'fullName username profilePicture');

    if (!updatedUser) return res.status(404).json({ message: 'User not found.' });

    return res.status(200).json({
      success: true,
      profilePicture,
      user: sanitizeUserProfile(updatedUser, viewerId),
    });
  } catch (error) {
    console.error('AVATAR UPLOAD ERROR:', error);
    return res.status(500).json({ message: 'Failed to upload avatar.', error: error.message });
  }
});

// ── PUT /api/users/profile (Update self profile) ──────────────────────────
router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const viewerId = getAuthenticatedUserId(req);
    if (!viewerId) return res.status(401).json({ message: 'Unauthorized.' });

    const { fullName, username, bio, headline, location, coverImage, profilePicture, closedDeals } = req.body;
    const updateData = {};

    if (typeof fullName === 'string' && fullName.trim()) updateData.fullName = fullName.trim();
    if (typeof username === 'string' && username.trim()) updateData.username = username.trim().toLowerCase();
    if (typeof bio === 'string') updateData.bio = bio.trim();
    if (typeof headline === 'string') updateData.headline = headline.trim();
    if (typeof location === 'string') updateData.location = location.trim();
    if (typeof coverImage === 'string') updateData.coverImage = coverImage.trim();
    if (typeof closedDeals === 'string') updateData.closedDeals = closedDeals.trim();
    if (profilePicture !== undefined) {
      if (!profilePicture) {
        updateData.profilePicture = null;
      } else if (typeof profilePicture === 'string' && profilePicture.startsWith('data:image/')) {
        updateData.profilePicture = profilePicture.trim();
      } else if (typeof profilePicture === 'string' && !profilePicture.startsWith('blob:') && !profilePicture.startsWith('file:')) {
        updateData.profilePicture = profilePicture.trim();
      }
    }

    const updatedUser = await User.findByIdAndUpdate(viewerId, { $set: updateData }, { new: true })
      .populate('followers', 'fullName username profilePicture')
      .populate('following', 'fullName username profilePicture');

    if (!updatedUser) return res.status(404).json({ message: 'User not found.' });

    return res.status(200).json({
      success: true,
      user: sanitizeUserProfile(updatedUser, viewerId),
    });
  } catch (error) {
    console.error('UPDATE PROFILE ERROR:', error);
    return res.status(500).json({ message: 'Failed to update profile.', error: error.message });
  }
});

// ── GET /api/users/:id/followers (Get real-time followers list) ───────────
router.get('/:id/followers', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const viewerId = getAuthenticatedUserId(req);
    const profileUser = await resolveOrSeedUser(id, viewerId);

    if (!profileUser) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const seen = new Set();
    const populatedFollowers = (profileUser.followers || [])
      .filter((f) => {
        if (!f || isExcludedUserRef(f)) return false;
        const fid = (typeof f === 'object' ? (f._id || f.id || f.username) : f).toString();
        if (!fid || seen.has(fid)) return false;
        seen.add(fid);
        return true;
      })
      .map((f) => {
        if (typeof f === 'object' && f !== null) {
          const fid = (f._id || f.id).toString();
          const uname = f.username || 'member';
          let fullName = f.fullName || 'Boolok Member';
          if (uname === 'saivimenthanvl' || uname === 'saivimenthan') fullName = 'Sai Vimenthan V L';
          return {
            id: fid,
            _id: fid,
            fullName,
            username: uname,
            headline: f.headline || 'Real Estate Professional',
            location: f.location || 'Global Real Estate Network',
            profilePicture: resolveCanonicalAvatar(f),
          };
        }
        return { id: f.toString(), _id: f.toString(), fullName: 'Boolok Member', username: 'member', profilePicture: null };
      });

    return res.status(200).json({
      followers: populatedFollowers,
      followerCount: populatedFollowers.length,
    });
  } catch (error) {
    console.error('GET FOLLOWERS LIST ERROR:', error);
    return res.status(500).json({ message: 'Failed to fetch followers list.', error: error.message });
  }
});

// ── GET /api/users/:id/following (Get real-time following list) ───────────
router.get('/:id/following', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const viewerId = getAuthenticatedUserId(req);
    const profileUser = await resolveOrSeedUser(id, viewerId);

    if (!profileUser) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const seen = new Set();
    const populatedFollowing = (profileUser.following || [])
      .filter((f) => {
        if (!f || isExcludedUserRef(f)) return false;
        const fid = (typeof f === 'object' ? (f._id || f.id || f.username) : f).toString();
        if (!fid || seen.has(fid)) return false;
        seen.add(fid);
        return true;
      })
      .map((f) => {
        if (typeof f === 'object' && f !== null) {
          const fid = (f._id || f.id).toString();
          const uname = f.username || 'member';
          let fullName = f.fullName || 'Boolok Member';
          if (uname === 'saivimenthanvl' || uname === 'saivimenthan') fullName = 'Sai Vimenthan V L';
          return {
            id: fid,
            _id: fid,
            fullName,
            username: uname,
            headline: f.headline || 'Real Estate Professional',
            location: f.location || 'Global Real Estate Network',
            profilePicture: resolveCanonicalAvatar(f),
          };
        }
        return { id: f.toString(), _id: f.toString(), fullName: 'Boolok Member', username: 'member', profilePicture: null };
      });

    return res.status(200).json({
      following: populatedFollowing,
      followingCount: populatedFollowing.length,
    });
  } catch (error) {
    console.error('GET FOLLOWING LIST ERROR:', error);
    return res.status(500).json({ message: 'Failed to fetch following list.', error: error.message });
  }
});

const COMMUNITY_DEALS = {
  shreekutti: [
    {
      id: 'd-shree-1',
      title: 'Grade-A Tech Park SEZ Tower A',
      location: 'Outer Ring Road, Bangalore',
      price: '$42,000,000',
      capRate: '8.4% Cap Rate',
      type: 'Institutional IT Campus',
      date: 'Aug 2026',
      status: 'Verified Institutional Settlement',
      sqft: '92,000 sq ft',
      icon: 'business',
    },
    {
      id: 'd-shree-2',
      title: 'Manyata Tech Park Commercial Wing',
      location: 'Hebbal, Bangalore',
      price: '$28,500,000',
      capRate: '8.1% Cap Rate',
      type: 'Grade-A Corporate Office',
      date: 'Jun 2026',
      status: 'Verified Institutional Settlement',
      sqft: '65,000 sq ft',
      icon: 'apartment',
    },
    {
      id: 'd-shree-3',
      title: 'Whitefield Corporate Center',
      location: 'Whitefield, Bangalore',
      price: '$19,200,000',
      capRate: '8.7% Cap Rate',
      type: '100% Leased Tech Hub',
      date: 'Apr 2026',
      status: 'Verified Institutional Settlement',
      sqft: '48,000 sq ft',
      icon: 'domain',
    },
    {
      id: 'd-shree-4',
      title: 'Electronic City Tech Hub Block B',
      location: 'Electronic City, Bangalore',
      price: '₹123.6 Cr',
      capRate: '9.0% Cap Rate',
      type: 'Commercial Office Tower',
      date: 'Jan 2026',
      status: 'Verified Institutional Settlement',
      sqft: '36,000 sq ft',
      icon: 'location-city',
    },
  ],
  logeshwarana: [
    {
      id: 'd-logesh-1',
      title: 'Margaret River Commercial Vineyard',
      location: 'Western Australia',
      price: '$18,500,000',
      capRate: '7.8% Cap Rate',
      type: '140-Acre Agricultural Estate & Winery',
      date: 'Jul 2026',
      status: 'Verified Institutional Settlement',
      sqft: '140 Acres',
      icon: 'landscape',
    },
    {
      id: 'd-logesh-2',
      title: 'Kyoto Forest Eco-Luxury Retreat', location: 'Kyoto, Japan', price: '¥1,900,000,000',
      capRate: '8.5% Cap Rate',
      type: 'Boutique Hospitality Estate',
      date: 'May 2026',
      status: 'Verified Institutional Settlement',
      sqft: '28,000 sq ft',
      icon: 'spa',
    },
    {
      id: 'd-logesh-3',
      title: 'Uluwatu Oceanfront Resort',
      location: 'Bali, Indonesia',
      price: '$24,000,000',
      capRate: '9.2% Cap Rate',
      type: 'Luxury Hospitality Parcel',
      date: 'Feb 2026',
      status: 'Verified Institutional Settlement',
      sqft: '85,000 sq ft',
      icon: 'beach-access',
    },
  ],
  ajmal: [
    {
      id: 'd-ajmal-1',
      title: 'Palm Jumeirah Signature Villa',
      location: 'Palm Jumeirah, Dubai, UAE',
      price: '$24,000,000',
      capRate: '6.5% Yield',
      type: 'Ultra-Luxury Beachfront Mansion',
      date: 'Aug 2026',
      status: 'Verified Institutional Settlement',
      sqft: '14,500 sq ft',
      icon: 'villa',
    },
    {
      id: 'd-ajmal-2',
      title: 'Emirates Hills Golf Course Estate',
      location: 'Dubai, UAE',
      price: '$18,200,000',
      capRate: '7.1% Yield',
      type: 'Private Gated Golf Villa',
      date: 'Jun 2026',
      status: 'Verified Institutional Settlement',
      sqft: '12,000 sq ft',
      icon: 'golf-course',
    },
    {
      id: 'd-ajmal-3',
      title: 'Marine Drive Waterfront Penthouse',
      location: 'Kochi, Kerala',
      price: '$6,500,000',
      capRate: '7.6% Yield',
      type: 'Luxury Panoramic Penthouse',
      date: 'Mar 2026',
      status: 'Verified Institutional Settlement',
      sqft: '6,800 sq ft',
      icon: 'house',
    },
  ],
  bavadharini_rs: [
    {
      id: 'd-bava-1',
      title: 'Poes Garden Ultra Luxury Penthouse', location: 'Poes Garden, Chennai, TN', price: '₹58.5 Cr',
      capRate: '7.2% Yield',
      type: 'Bespoke Architectural Penthouse',
      date: 'Jul 2026',
      status: 'Verified Institutional Settlement',
      sqft: '5,800 sq ft',
      icon: 'home',
    },
    {
      id: 'd-bava-2',
      title: 'Boat Club Road Contemporary Estate',
      location: 'RA Puram, Chennai, TN',
      price: '$8,400,000',
      capRate: '6.8% Yield',
      type: 'Modern Custom Villa',
      date: 'May 2026',
      status: 'Verified Institutional Settlement',
      sqft: '7,200 sq ft',
      icon: 'deck',
    },
  ],
  the_akshtr_estate: [
    {
      id: 'd-akshat-1',
      title: 'OMR Cyber Park Tower B', location: 'OMR IT Corridor, Chennai, TN', price: '₹330.4 Cr',
      capRate: '8.8% Cap Rate',
      type: 'Fortune 500 Leased IT Tower',
      date: 'Aug 2026',
      status: 'Verified Institutional Settlement',
      sqft: '110,000 sq ft',
      icon: 'business-center',
    },
    {
      id: 'd-akshat-2',
      title: 'Tidel Park Commercial Hub',
      location: 'Taramani, Chennai, TN',
      price: '$21,500,000',
      capRate: '8.4% Cap Rate',
      type: 'Grade-A Commercial Space',
      date: 'Jun 2026',
      status: 'Verified Institutional Settlement',
      sqft: '75,000 sq ft',
      icon: 'apartment',
    },
  ],
  prasanth_properties: [
    {
      id: 'd-prasanth-1',
      title: 'Star Island Waterfront Estate',
      location: 'Miami Beach, Florida',
      price: '$19,800,000',
      capRate: '6.2% Yield',
      type: 'Mega-Yacht Deepwater Villa',
      date: 'Jul 2026',
      status: 'Verified Institutional Settlement',
      sqft: '11,500 sq ft',
      icon: 'sailing',
    },
    {
      id: 'd-prasanth-2',
      title: 'Fisher Island Luxury Penthouse',
      location: 'Fisher Island, Miami, FL',
      price: '$14,500,000',
      capRate: '6.9% Yield',
      type: 'Private Island Luxury Condo',
      date: 'May 2026',
      status: 'Verified Institutional Settlement',
      sqft: '8,200 sq ft',
      icon: 'apartment',
    },
  ],
  sai: [
    {
      id: 'd-sai-1',
      title: 'Coventry Corporate Headquarters', location: 'Coventry, United Kingdom', price: '£12,242,788',
      capRate: '8.2% Cap Rate',
      type: 'Institutional Grade-A Office Hub',
      date: 'Aug 2026',
      status: 'Verified Institutional Settlement',
      sqft: '52,000 sq ft',
      icon: 'business',
    },
    {
      id: 'd-sai-2',
      title: 'Anna Nagar Prime Retail Flagship',
      location: 'Chennai, Tamil Nadu',
      price: '$9,200,000',
      capRate: '8.9% Cap Rate',
      type: 'High-Street Multi-Brand Retail',
      date: 'Jun 2026',
      status: 'Verified Institutional Settlement',
      sqft: '34,000 sq ft',
      icon: 'store',
    },
    {
      id: 'd-sai-3',
      title: 'OMR Expressway IT Campus Block A',
      location: 'Chennai, Tamil Nadu',
      price: '$26,000,000',
      capRate: '8.6% Cap Rate',
      type: 'Commercial Tech Park Syndication',
      date: 'Apr 2026',
      status: 'Verified Institutional Settlement',
      sqft: '88,000 sq ft',
      icon: 'domain',
    },
  ],
  aswin: [
    {
      id: 'd-aswin-1',
      title: 'Aswin Real Estate Prime Commercial Acquisition', location: 'Chennai, Tamil Nadu · Luxury & Commercial Assets', price: '₹118.0 Cr',
      capRate: '8.4% Cap Rate',
      type: 'Institutional Commercial Asset',
      date: '2026',
      status: 'Verified Institutional Settlement',
      sqft: '45,000 sq ft',
      icon: 'business',
    },
  ],
  'aswin': [
    {
      id: 'd-aswin-1',
      title: 'Aswin Real Estate Prime Commercial Acquisition', location: 'Chennai, Tamil Nadu · Luxury & Commercial Assets', price: '₹118.0 Cr',
      capRate: '8.4% Cap Rate',
      type: 'Institutional Commercial Asset',
      date: '2026',
      status: 'Verified Institutional Settlement',
      sqft: '45,000 sq ft',
      icon: 'business',
    },
  ],
  vignesh: [
    {
      id: 'd-vignesh-1',
      title: 'Beverly Hills Sunset Estate Acquisition',
      location: 'Beverly Hills, California',
      price: '$15,800,000',
      capRate: '6.4% Yield',
      type: 'Ultra-Luxury Custom Architectural Landmark',
      date: '2026',
      status: 'Verified Institutional Settlement',
      sqft: '9,500 sq ft',
      icon: 'villa',
    },
  ],
  yashwanth: [
    {
      id: 'd-yashwanth-1',
      title: 'Yashwanth Realty Grade-A Corporate Hub',
      location: 'Chennai & Bangalore',
      price: '$13,200,000',
      capRate: '8.5% Cap Rate',
      type: 'Prime Institutional Commercial Hub',
      date: '2026',
      status: 'Verified Institutional Settlement',
      sqft: '50,000 sq ft',
      icon: 'apartment',
    },
  ],
  sophia_luxury: [
    {
      id: 'd-sophia-1',
      title: 'Beverly Hills Syndicate Share Acquisition',
      location: 'Beverly Hills, California',
      price: '$12,500,000',
      capRate: '6.8% Yield',
      type: 'Luxury Fractional House Share',
      date: 'Jul 2026',
      status: 'Verified Institutional Settlement',
      sqft: '9,500 sq ft',
      icon: 'villa',
    },
    {
      id: 'd-sophia-2',
      title: 'Geneva Lakeside Residence Co-Ownership',
      location: 'Geneva, Switzerland',
      price: '$8,900,000',
      capRate: '5.9% Yield',
      type: 'Private Family Office Syndicate',
      date: 'May 2026',
      status: 'Verified Institutional Settlement',
      sqft: '6,200 sq ft',
      icon: 'holiday-village',
    },
  ],
  david_sterling: [
    {
      id: 'd-david-1',
      title: 'Beverly Hills Co-Ownership Landmark',
      location: 'Beverly Hills, California',
      price: '$12,500,000',
      capRate: '6.8% Yield',
      type: 'Bespoke Co-Ownership Syndicate',
      date: 'Aug 2026',
      status: 'Verified Institutional Settlement',
      sqft: '9,500 sq ft',
      icon: 'villa',
    },
    {
      id: 'd-david-2',
      title: 'Mayfair Commercial Townhouse',
      location: 'London, United Kingdom',
      price: '$18,500,000',
      capRate: '6.2% Cap Rate',
      type: 'Prime Commercial Co-Ownership',
      date: 'Jun 2026',
      status: 'Verified Institutional Settlement',
      sqft: '8,400 sq ft',
      icon: 'business',
    },
    {
      id: 'd-david-3',
      title: 'Kensington High Street Retail Hub',
      location: 'London, United Kingdom',
      price: '$14,200,000',
      capRate: '7.1% Cap Rate',
      type: 'Institutional Asset Settlement',
      date: 'Mar 2026',
      status: 'Verified Institutional Settlement',
      sqft: '12,000 sq ft',
      icon: 'store',
    },
  ],
  marcus_vance: [
    {
      id: 'd-marcus-1',
      title: 'Manhattan Mixed-Use Asset Syndicate',
      location: 'New York, NY',
      price: '$22,000,000',
      capRate: '7.4% Cap Rate',
      type: 'Commercial Syndicate Settlement',
      date: 'Aug 2026',
      status: 'Verified Institutional Settlement',
      sqft: '35,000 sq ft',
      icon: 'apartment',
    },
    {
      id: 'd-marcus-2',
      title: 'Beverly Hills House Share Deeded Title',
      location: 'Beverly Hills, California',
      price: '$12,500,000',
      capRate: '6.8% Yield',
      type: 'Deeded Fractional Title',
      date: 'Jul 2026',
      status: 'Verified Institutional Settlement',
      sqft: '9,500 sq ft',
      icon: 'villa',
    },
  ],
};

// ── GET /api/users/:id/deals (Get completed transaction history) ───────────
router.get('/:id/deals', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const viewerId = getAuthenticatedUserId(req);
    const profileUser = await resolveOrSeedUser(id, viewerId);

    if (!profileUser) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const key = (profileUser.username || '').toLowerCase();
    let deals = [];
    if (COMMUNITY_DEALS[key]) {
      deals = COMMUNITY_DEALS[key];
    } else if (key.includes('shree')) {
      deals = COMMUNITY_DEALS.shreekutti || [];
    } else if (key.includes('logesh')) {
      deals = COMMUNITY_DEALS.logeshwarana || [];
    } else if (key.includes('ajmal')) {
      deals = COMMUNITY_DEALS.ajmal || [];
    } else if (key.includes('bava')) {
      deals = COMMUNITY_DEALS.bavadharini_rs || [];
    } else if (key.includes('akshat') || key.includes('akshtr')) {
      deals = COMMUNITY_DEALS.the_akshtr_estate || [];
    } else if (key.includes('prasanth')) {
      deals = COMMUNITY_DEALS.prasanth_properties || [];
    } else if (key.includes('aswin')) {
      deals = COMMUNITY_DEALS.aswin || [];
    } else if (key.includes('vignesh') || key.includes('vicky')) {
      deals = COMMUNITY_DEALS.vignesh || [];
    } else if (key.includes('yashwanth') || key.includes('cinemahub')) {
      deals = COMMUNITY_DEALS.yashwanth || [];
    } else if (key.includes('sophia')) {
      deals = COMMUNITY_DEALS.sophia_luxury || [];
    } else if (key.includes('david')) {
      deals = COMMUNITY_DEALS.david_sterling || [];
    } else if (key.includes('marcus')) {
      deals = COMMUNITY_DEALS.marcus_vance || [];
    } else if (key.includes('sai') || profileUser._id.toString() === getAuthenticatedUserId(req)?.toString()) {
      deals = COMMUNITY_DEALS.sai || [];
    } else {
      deals = [];
    }

    const totalDeals = deals.length.toString();
    if (profileUser.closedDeals !== totalDeals) {
      profileUser.closedDeals = totalDeals;
      await profileUser.save().catch(() => { });
    }

    return res.status(200).json({
      deals,
      totalDeals,
      fullName: profileUser.fullName,
    });
  } catch (error) {
    console.error('GET CLOSED DEALS ERROR:', error);
    return res.status(500).json({ message: 'Failed to fetch deals.', error: error.message });
  }
});

const LOGESHWARAN_REELS = [
  {
    _id: 'logesh-reel-1',
    title: 'Margaret River Vineyard',
    location: 'Western Australia',
    price: 'A$3,485,000',
    aiMatch: null,
    insight: 'Soil analysis indicates 92% suitability for premium Cabernet Sauvignon. Water rights pre-verified for 50 years.',
    likes: 2400,
    poster: 'https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=1200',
    thumbnail: 'https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=1200',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    comments: [
      { _id: 'c1-1', user: { fullName: 'Shreekutti' }, text: 'The terroir and climate suitability metrics are exceptional here! 🍇✨', createdAt: new Date() },
      { _id: 'c1-2', user: { fullName: 'Mohammed Ajmal' }, text: '50-year pre-verified water rights make this a bulletproof acquisition. 🍷', createdAt: new Date() },
    ],
  },
  {
    _id: 'logesh-reel-2',
    title: 'Kyoto Forest Retreat', location: 'Kyoto, Japan', price: '¥1,900,000,000',
    aiMatch: null,
    insight: 'Thermal zoning optimized. High potential for eco-luxury cabins or a private wellness estate.',
    likes: 920,
    poster: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?w=1200',
    thumbnail: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?w=1200',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
    comments: [
      { _id: 'c2-1', user: { fullName: 'Mohammed Ajmal' }, text: 'Thermal zoning and serene forested topography are hard to find in Kyoto! ⛩️🍃', createdAt: new Date() },
      { _id: 'c2-2', user: { fullName: 'Shreekutti' }, text: 'Eco-luxury cabins here will command top-tier international ADRs. 🏡✨', createdAt: new Date() },
    ],
  },
  {
    _id: 'logesh-reel-3',
    title: 'Uluwatu Cliffside',
    location: 'Bali, Indonesia',
    price: '$24,000,000',
    aiMatch: null,
    insight: 'Tourism growth in this sector is up 14% YoY. Zoning allows for luxury boutique resort development.',
    likes: 1800,
    poster: 'https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=1200',
    thumbnail: 'https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=1200',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
    comments: [
      { _id: 'c3-1', user: { fullName: 'Akshat Commercials' }, text: 'Breathtaking ocean cliff views! Perfect setting for luxury resort hospitality. 🌅🏖️', createdAt: new Date() },
      { _id: 'c3-2', user: { fullName: 'Shreekutti' }, text: '14% YoY tourism surge matches our regional Bali portfolio forecast. 📈', createdAt: new Date() },
    ],
  },
];

const SAI_REELS = [
  {
    _id: 'sai-reel-coventry',
    title: 'Coventry Corporate Headquarters', location: 'Coventry, United Kingdom', price: '£12,242,788',
    aiMatch: null,
    insight: 'Strong engagement expected based on similar recent listings.',
    likes: 100,
    poster: 'https://images.unsplash.com/photo-1613977257363-707ba9348227?w=1200',
    thumbnail: 'https://images.unsplash.com/photo-1613977257363-707ba9348227?w=1200',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    comments: [
      { _id: 'c4-1', user: { fullName: 'Logeshwaran A', username: 'logeshwarana', profilePicture: null }, text: 'Grade-A office specs with strong institutional tenant appeal. 🏢💼', createdAt: new Date() },
      { _id: 'c4-2', user: { fullName: 'Shreekutti', username: 'shreekutti' }, text: 'High floor efficiency and convenient transit access. 🚆', createdAt: new Date() },
    ],
  },
];

const COMMUNITY_POSTS_MAP = {
  shreekutti: [
    {
      _id: 'shree-p-1',
      title: 'Grade-A Commercial IT Campus',
      price: '$42,000,000',
      location: 'Bangalore, Karnataka',
      specs: '92,000 sq ft · 8.4% Cap Rate',
      content: 'Fully leased Grade-A Tech Park development with pre-verified institutional efficiency ratings.',
      image: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200',
      mediaUrl: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200',
      likes: ['sai', 'logeshwarana', 'ajmal'],
      comments: [
        { author: { fullName: 'Logeshwaran A', username: 'logeshwarana' }, text: '8.4% cap rate on Outer Ring Road is top quartile.' },
        { author: { fullName: 'Akshat Commercials', username: 'the_akshtr_estate' }, text: 'Strong institutional covenants.' },
      ],
    },
  ],
  logeshwarana: [
    {
      _id: 'logesh-p-1',
      title: 'Margaret River Commercial Vineyard',
      price: '$18,500,000',
      location: 'Western Australia',
      specs: '140 Acres · Pre-Verified Water Rights',
      content: 'World-class vineyard estate with high soil suitability index and pre-approved zoning.',
      image: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1200',
      mediaUrl: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1200',
      likes: ['sai', 'shreekutti', 'bavadharini_rs'],
      comments: [
        { author: { fullName: 'Akshat Commercials', username: 'the_akshtr_estate' }, text: 'Soil analysis and water rights are pristine.' },
        { author: { fullName: 'Bavadharini RS', username: 'bavadharini_rs' }, text: 'Architectural layout is stunning.' },
      ],
    },
  ],
  ajmal: [
    {
      _id: 'ajmal-p-1',
      title: 'Waterfront Palm Signature Mansion',
      price: '$24,000,000',
      location: 'Palm Jumeirah, Dubai',
      specs: '7 Beds · 9 Baths · Private Beach',
      content: 'Direct beach access, smart home automation, infinity pool overlooking Dubai Marina.',
      image: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=1200',
      mediaUrl: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=1200',
      likes: ['sai', 'logeshwarana', 'shreekutti', 'the_akshtr_estate'],
      comments: [
        { author: { fullName: 'Shreekutti', username: 'shreekutti' }, text: 'Unrivaled private beach frontage!' },
        { author: { fullName: 'Logeshwaran A', username: 'logeshwarana' }, text: 'Bespoke marble and high ceiling elevation.' },
      ],
    },
  ],
  bavadharini_rs: [
    {
      _id: 'bava-p-1',
      title: 'High-Ceiling Ultra Penthouse',
      price: '₹51.8 Cr',
      location: 'Chennai, Tamil Nadu',
      specs: '5,800 sq ft · Private Elevator',
      content: 'Double-height glass living room, customized Italian joinery, panoramic sea view balcony.',
      image: 'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?w=1200',
      mediaUrl: 'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?w=1200',
      likes: ['sai', 'ajmal', 'logeshwarana'],
      comments: [
        { author: { fullName: 'Akshat Commercials', username: 'the_akshtr_estate' }, text: 'Incredible acoustic zoning and clean lines!' },
      ],
    },
  ],
  the_akshtr_estate: [
    {
      _id: 'akshat-p-1',
      title: 'Institutional Grade-A Office Hub',
      price: '₹292.3 Cr',
      location: 'OMR IT Corridor, Chennai',
      specs: '120,000 sq ft · 8.9% Yield',
      content: 'Modern commercial tower with multi-level parking, 100% power backup, and prime expressway frontage.',
      image: 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=1200',
      mediaUrl: 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=1200',
      likes: ['sai', 'shreekutti', 'logeshwarana'],
      comments: [
        { author: { fullName: 'Logeshwaran A', username: 'logeshwarana' }, text: 'Triple net lease with institutional covenants is top tier!' },
      ],
    },
  ],
  prasanth_properties: [
    {
      _id: 'prasanth-p-1',
      title: 'Star Island Waterfront Estate',
      price: '$19,800,000',
      location: 'Miami Beach, Florida',
      specs: '6 Beds · 8 Baths · Private Mega-Yacht Dock',
      content: 'Bespoke modern architecture with floor-to-ceiling glass, sunset views, and private yacht slip.',
      image: 'https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=1200',
      mediaUrl: 'https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=1200',
      likes: ['sai', 'ajmal', 'bavadharini_rs'],
      comments: [
        { author: { fullName: 'Mohammed Ajmal', username: 'ajmal' }, text: 'Deepwater dock specs and yacht clearance are remarkable.' },
      ],
    },
  ],
  vignesh: [
    {
      _id: 'vignesh-p-1',
      title: 'Beverly Hills Modern Architectural Masterpiece',
      price: '$12,500,000',
      location: 'Beverly Hills, California',
      specs: '8 Beds · 11 Baths · Zero-Edge Pool',
      content: 'New architectural masterpiece in Beverly Hills. 8 Bedrooms, 11 Baths, custom Italian marble, and zero-edge cascading pool. 🏆✨ Price: $12.5M.',
      image: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1200',
      mediaUrl: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1200',
      likes: ['sai', 'logeshwarana', 'shreekutti'],
      comments: [
        {
          _id: 'vg-c1',
          author: { fullName: 'Sophia Sterling', username: 'sophia_luxury' },
          text: 'Are 1/8th fractional house share syndicate slots still available for European co-owners? 🏡✨',
          time: '09:15 am',
        },
        {
          _id: 'vg-c2',
          author: { fullName: 'David Sterling', username: 'david_sterling' },
          text: 'Bespoke co-ownership model on Beverly Hills estates provides exceptional capital preservation.',
          time: '11:40 am',
        },
        {
          _id: 'vg-c3',
          author: { fullName: 'Marcus Vance', username: 'marcus_vance' },
          text: 'Deeded fractional title and seasonal syndicate booking structure looks turnkey. DM sent! 🔑',
          time: '01:25 pm',
        },
      ],
    },
  ],
  aswin: [
    {
      _id: 'aswin-p-1',
      title: 'Prime Multi-Family Commercial Asset',
      price: '$12,500,000',
      location: 'Chennai, Tamil Nadu',
      specs: '45,000 sq ft · 8.4% Cap Rate',
      content: 'High-yield commercial multi-family portfolio with pre-verified institutional efficiency ratings.',
      image: 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1200',
      mediaUrl: 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1200',
      likes: ['sai', 'ajmal'],
      comments: [],
    },
  ],
  sai: [
    {
      _id: 'sai-p-1',
      title: 'Coventry Corporate Headquarters', price: '£12,242,788', location: 'Coventry, United Kingdom',
      specs: '52,000 sq ft · 8.2% Cap Rate',
      content: 'Grade-A institutional office headquarters with 100% occupancy and blue-chip covenants.',
      image: 'https://images.unsplash.com/photo-1577495508048-b635879837f1?w=1200',
      mediaUrl: 'https://images.unsplash.com/photo-1577495508048-b635879837f1?w=1200',
      likes: ['logeshwarana', 'shreekutti'],
      comments: [
        { author: { fullName: 'Logeshwaran A', username: 'logeshwarana' }, text: 'Prime UK corporate covenants.' },
      ],
    },
  ],
};

// ── GET /api/users/:id (Get profile by ID or username) ────────────────────
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const viewerId = getAuthenticatedUserId(req);

    const profileUser = await resolveOrSeedUser(id, viewerId);

    if (!profileUser) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const [postCount, dbPosts, dbReels] = await Promise.all([
      Post.countDocuments({ author: profileUser._id }),
      Post.find({ author: profileUser._id })
        .populate('author', 'fullName username profilePicture headline location email')
        .populate('comments.user', 'fullName username profilePicture')
        .sort({ createdAt: -1 }),
      Reel.find({
        $or: [
          { author: profileUser._id },
          ...(profileUser.username ? [{ author: null, authorName: profileUser.username }] : []),
        ],
      })
        .populate('author', 'fullName username profilePicture')
        .populate('comments.user', 'fullName username profilePicture')
        .sort({ createdAt: -1 }),
    ]);

    const sanitized = sanitizeUserProfile(profileUser, viewerId);
    const usernameKey = (profileUser.username || '').toLowerCase();

    const formattedPosts = (dbPosts || []).map((p) => {
      const likesArray = (p.likes || []).map((l) => (l._id ? l._id.toString() : l.toString()));
      const isLiked = viewerId ? likesArray.includes(viewerId.toString()) : false;
      const comments = (p.comments || []).map((c) => ({
        _id: c._id ? c._id.toString() : undefined,
        user: c.user,
        author: c.user,
        text: c.text,
        time: c.createdAt ? new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now',
        createdAt: c.createdAt,
      }));

      return {
        _id: p._id.toString(),
        content: p.content || '',
        title: p.title || (p.content ? (p.content.length > 50 ? p.content.slice(0, 50) + '...' : p.content) : 'Property Update'),
        price: p.price || '',
        location: p.location || '',
        specs: p.specs || '',
        mediaUrl: p.mediaUrl || null,
        image: p.mediaUrl || null,
        author: p.author
          ? {
              _id: p.author._id ? p.author._id.toString() : p.author.toString(),
              fullName: p.author.fullName || 'Boolok Member',
              username: p.author.username || 'member',
              profilePicture: p.author.profilePicture || null,
              headline: p.author.headline || 'Real Estate Professional',
              location: p.author.location || 'Global',
            }
          : null,
        likes: likesArray,
        likesCount: likesArray.length,
        isLiked,
        currentUserReaction: isLiked ? 'like' : null,
        comments,
        commentsCount: comments.length,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      };
    });

    let userPosts = formattedPosts;
    // For non-self community profiles with 0 posts in DB, allow community fallback
    if (!sanitized.isSelf && userPosts.length === 0) {
      userPosts = COMMUNITY_POSTS_MAP[usernameKey] || [];
    }

    const formattedReels = (dbReels || []).map((r) => {
      const likesArray = (r.likes || []).map((l) => (l._id ? l._id.toString() : l.toString()));
      const isLiked = viewerId ? likesArray.includes(viewerId.toString()) : false;
      const comments = (r.comments || []).map((c) => ({
        _id: c._id ? c._id.toString() : undefined,
        user: c.user,
        author: c.user,
        text: c.text,
        createdAt: c.createdAt,
      }));
      const poster = r.poster || r.thumbnail || 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1200';
      return {
        _id: r._id.toString(),
        title: r.title || r.caption || 'Property Reel',
        location: r.location || '',
        authorName: r.authorName || (r.author && r.author.fullName) || '',
        caption: r.caption || '',
        price: r.price !== undefined && r.price !== null && String(r.price).trim() !== '' ? String(r.price).trim() : ((r.title || '').toLowerCase().includes('coventry') ? '£12,242,788' : ''),
        aiMatch: typeof r.aiMatch === 'number' ? r.aiMatch : null,
        insight: r.insight || r.caption || '',
        likes: likesArray.length,
        likesCount: likesArray.length,
        isLiked,
        comments,
        commentsCount: comments.length,
        author: r.author
          ? {
              _id: r.author._id ? r.author._id.toString() : r.author.toString(),
              fullName: r.authorName || r.author.fullName || 'Boolok Member',
              username: r.author.username || 'member',
              profilePicture: r.author.profilePicture || null,
            }
          : {
              _id: profileUser._id.toString(),
              fullName: r.authorName || profileUser.fullName,
              username: profileUser.username,
              profilePicture: profileUser.profilePicture,
            },
        poster,
        thumbnail: poster,
        videoUrl: r.videoUrl,
        music: 'Boolok AI · Property Showcase Track',
        createdAt: r.createdAt,
      };
    });

    let userReels = formattedReels;
    // Only static seeded demo accounts show demo showcase reels if non-self and has 0 DB reels
    if (!sanitized.isSelf && userReels.length === 0) {
      if (usernameKey === 'logeshwarana') {
        userReels = LOGESHWARAN_REELS;
      } else if (usernameKey === 'saivimenthanvl') {
        userReels = SAI_REELS;
      }
    }

    return res.status(200).json({
      user: sanitized,
      postCount: userPosts.length,
      reelCount: userReels.length,
      followerCount: sanitized.followerCount,
      followingCount: sanitized.followingCount,
      isFollowing: sanitized.isFollowing,
      isSelf: sanitized.isSelf,
      posts: userPosts,
      reels: userReels,
    });
  } catch (error) {
    console.error('GET USER PROFILE ERROR:', error);
    return res.status(500).json({ message: 'Failed to load profile.', error: error.message });
  }
});

// Keep POST /follow as a toggle for existing clients. Explicit routes set a desired state.
const handleFollowUser = async (req, res) => {
  let session;
  try {
    const viewerId = getAuthenticatedUserId(req);
    if (!viewerId) return res.status(401).json({ message: 'Unauthorized.' });

    const resolvedUser = await resolveOrSeedUser(req.params.id, viewerId);
    if (!resolvedUser) return res.status(404).json({ message: 'User not found.' });
    if (resolvedUser._id.toString() === viewerId.toString()) {
      return res.status(400).json({ message: 'You cannot follow yourself.' });
    }

    session = await mongoose.startSession();
    let result;
    await session.withTransaction(async () => {
      const viewer = await User.findById(viewerId).session(session);
      const target = await User.findById(resolvedUser._id).session(session);
      if (!viewer || !target) {
        result = { status: 404, body: { message: !viewer ? 'Viewer not found.' : 'User not found.' } };
        return;
      }

      const isAlreadyFollowing =
        (target.followers || []).some((id) => id.toString() === viewerId.toString()) ||
        (viewer.following || []).some((id) => id.toString() === target._id.toString());
      const isUnfollow = req.method === 'DELETE' || req.route.path === '/:id/unfollow';
      const isFollowing = isUnfollow ? false : req.method === 'PUT' ? true : !isAlreadyFollowing;
      const operator = isFollowing ? '$addToSet' : '$pull';

      // Both sides and their notification commit together, or all roll back.
      await User.updateOne({ _id: target._id }, { [operator]: { followers: viewer._id } }, { session });
      await User.updateOne({ _id: viewer._id }, { [operator]: { following: target._id } }, { session });
      if (!isFollowing) {
        await Notification.deleteMany({ recipient: target._id, sender: viewer._id, type: 'follow' }, { session });
      } else if (!isAlreadyFollowing) {
        await Notification.create([{
          recipient: target._id,
          sender: viewer._id,
          type: 'follow',
          message: `${viewer.fullName} started following you.`,
          metadata: { senderUsername: viewer.username, senderAvatar: viewer.profilePicture },
        }], { session });
      }

      const updatedTarget = await User.findById(target._id).session(session);
      const updatedViewer = await User.findById(viewer._id).session(session);
      result = {
        status: 200,
        body: {
          isFollowing,
          followerCount: new Set(updatedTarget.followers.map(String)).size,
          followingCount: new Set(updatedViewer.following.map(String)).size,
          targetUser: {
            id: updatedTarget._id.toString(),
            _id: updatedTarget._id.toString(),
            fullName: updatedTarget.fullName,
            username: updatedTarget.username,
          },
          message: `${isFollowing ? 'Following' : 'Unfollowed'} ${target.fullName}`,
        },
      };
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error('FOLLOW UPDATE ERROR:', error);
    return res.status(500).json({ message: 'Failed to update follow status.', error: error.message });
  } finally {
    if (session) await session.endSession();
  }
};

router.post('/:id/follow', authMiddleware, handleFollowUser);
router.put('/:id/follow', authMiddleware, handleFollowUser);
router.post('/:id/unfollow', authMiddleware, handleFollowUser);
router.delete('/:id/follow', authMiddleware, handleFollowUser);

// ── DELETE /api/users/me (Account Deletion — GDPR / DPDP Act 2023 Right to Erasure) ──
router.delete('/me', authMiddleware, async (req, res) => {
  try {
    const viewerId = getAuthenticatedUserId(req);
    if (!viewerId) return res.status(401).json({ message: 'Unauthorized.' });

    // 1. Delete all posts created by this user
    await Post.deleteMany({ author: viewerId });

    // 2. Remove this user from all followers/following arrays of other users
    await User.updateMany(
      { followers: viewerId },
      { $pull: { followers: viewerId } }
    );
    await User.updateMany(
      { following: viewerId },
      { $pull: { following: viewerId } }
    );

    // 3. Delete all notifications involving this user
    await Notification.deleteMany({
      $or: [{ recipient: viewerId }, { sender: viewerId }],
    });

    // 4. Finally, delete the user document itself
    await User.findByIdAndDelete(viewerId);

    return res.status(200).json({
      success: true,
      message: 'Your account and all associated data have been permanently deleted.',
    });
  } catch (error) {
    console.error('DELETE ACCOUNT ERROR:', error);
    return res.status(500).json({
      message: 'Failed to delete account. Please try again or contact support.',
      error: error.message,
    });
  }
});

module.exports = router;