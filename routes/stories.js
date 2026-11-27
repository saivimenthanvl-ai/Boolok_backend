const express = require('express');
const router = express.Router();
const Story = require('../models/Story');
const User = require('../models/User');
const auth = require('../middleware/auth');
const optionalAuth = require('../middleware/optionalAuth');

/**
 * GET /api/stories/feed
 * Returns list of active stories grouped by user, along with unviewed status for viewer.
 */
router.get('/feed', optionalAuth, async (req, res) => {
  try {
    const viewerId = req.user?.id ? req.user.id.toString() : null;
    const now = new Date();

    // Query unexpired stories
    const stories = await Story.find({ expiresAt: { $gt: now } })
      .populate('author', 'fullName username profilePicture avatar role headline isVerified')
      .sort({ createdAt: -1 });

    // Group by author
    const userStoriesMap = new Map();
    for (const story of stories) {
      if (!story.author) continue;
      const authorId = story.author._id.toString();
      if (!userStoriesMap.has(authorId)) {
        userStoriesMap.set(authorId, {
          user: story.author,
          stories: [],
          hasUnviewed: false,
          latestStoryAt: story.createdAt,
        });
      }
      const entry = userStoriesMap.get(authorId);
      const isViewed = viewerId ? story.viewers.some((v) => v.toString() === viewerId) : false;
      if (!isViewed) {
        entry.hasUnviewed = true;
      }
      entry.stories.push({
        _id: story._id,
        mediaUrl: story.mediaUrl,
        mediaType: story.mediaType,
        caption: story.caption,
        createdAt: story.createdAt,
        expiresAt: story.expiresAt,
        viewed: isViewed,
      });
    }

    const feed = Array.from(userStoriesMap.values());
    return res.status(200).json({ success: true, feed });
  } catch (error) {
    console.error('Error fetching story feed:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch stories.' });
  }
});

/**
 * GET /api/stories/user/:userId
 * Get active stories for a specific user.
 */
router.get('/user/:userId', optionalAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const viewerId = req.user?.id ? req.user.id.toString() : null;
    const now = new Date();

    const stories = await Story.find({
      author: userId,
      expiresAt: { $gt: now },
    }).sort({ createdAt: 1 });

    const formatted = stories.map((s) => ({
      _id: s._id,
      mediaUrl: s.mediaUrl,
      mediaType: s.mediaType,
      caption: s.caption,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      viewed: viewerId ? s.viewers.some((v) => v.toString() === viewerId) : false,
    }));

    return res.status(200).json({ success: true, stories: formatted });
  } catch (error) {
    console.error('Error fetching user stories:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch user stories.' });
  }
});

/**
 * POST /api/stories
 * Publish a new 24h story for the authenticated user.
 */
router.post('/', auth, async (req, res) => {
  try {
    const authorId = req.user.id;
    const { mediaUrl, mediaType = 'image', caption = '' } = req.body;

    if (!mediaUrl) {
      return res.status(400).json({ success: false, message: 'mediaUrl is required.' });
    }

    // Story expires in 24 hours
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const newStory = await Story.create({
      author: authorId,
      mediaUrl,
      mediaType,
      caption,
      viewers: [],
      expiresAt,
    });

    return res.status(201).json({ success: true, story: newStory });
  } catch (error) {
    console.error('Error creating story:', error);
    return res.status(500).json({ success: false, message: 'Failed to create story.' });
  }
});

/**
 * POST /api/stories/:storyId/view
 * Mark a story as viewed by the authenticated user.
 */
router.post('/:storyId/view', auth, async (req, res) => {
  try {
    const viewerId = req.user.id;
    const { storyId } = req.params;

    const story = await Story.findById(storyId);
    if (!story) {
      return res.status(404).json({ success: false, message: 'Story not found.' });
    }

    // Atomic push unique viewer
    if (!story.viewers.some((v) => v.toString() === viewerId)) {
      story.viewers.push(viewerId);
      await story.save();
    }

    return res.status(200).json({ success: true, message: 'Story marked as viewed.' });
  } catch (error) {
    console.error('Error recording story view:', error);
    return res.status(500).json({ success: false, message: 'Failed to record story view.' });
  }
});

/**
 * DELETE /api/stories/:storyId
 * Delete a story owned by the authenticated user.
 */
router.delete('/:storyId', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { storyId } = req.params;

    const story = await Story.findById(storyId);
    if (!story) {
      return res.status(404).json({ success: false, message: 'Story not found.' });
    }

    if (story.author.toString() !== userId) {
      return res.status(403).json({ success: false, message: 'Unauthorized to delete this story.' });
    }

    await Story.findByIdAndDelete(storyId);
    return res.status(200).json({ success: true, message: 'Story deleted successfully.' });
  } catch (error) {
    console.error('Error deleting story:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete story.' });
  }
});

module.exports = router;
