const express = require('express');
const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

const getAuthenticatedUserId = (req) => req.user?.id || req.user?._id || req.userId || null;

// ── GET /api/messages/unread-count (Total unread count for user) ───────────
router.get('/unread-count', authMiddleware, async (req, res) => {
  try {
    const viewerId = getAuthenticatedUserId(req);
    if (!viewerId) return res.status(401).json({ message: 'Unauthorized.' });

    const count = await Message.countDocuments({
      recipient: viewerId,
      read: false,
    });

    return res.status(200).json({ unreadCount: count });
  } catch (error) {
    console.error('GET UNREAD COUNT ERROR:', error);
    return res.status(500).json({ message: 'Failed to fetch unread count.', error: error.message });
  }
});

// ── GET /api/messages/conversations (List user's active chats) ─────────────
router.get('/conversations', authMiddleware, async (req, res) => {
  try {
    const viewerId = getAuthenticatedUserId(req);
    if (!viewerId) return res.status(401).json({ message: 'Unauthorized.' });

    const conversations = await Conversation.find({
      participants: viewerId,
      hiddenFor: { $ne: viewerId },
    })
      .populate('participants', 'fullName username profilePicture headline location')
      .populate('lastMessage.sender', 'fullName username')
      .sort({ updatedAt: -1 });

    const formatted = conversations.map((conv) => {
      const otherUser = (conv.participants || []).find(
        (p) => p && p._id.toString() !== viewerId.toString()
      ) || null;

      const unread = conv.unreadCounts ? conv.unreadCounts.get(viewerId.toString()) || 0 : 0;

      return {
        _id: conv._id,
        id: conv._id,
        participants: conv.participants,
        otherUser,
        lastMessage: conv.lastMessage,
        unreadCount: unread,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
      };
    });

    return res.status(200).json({ conversations: formatted });
  } catch (error) {
    console.error('GET CONVERSATIONS ERROR:', error);
    return res.status(500).json({ message: 'Failed to fetch conversations.', error: error.message });
  }
});

// ── GET /api/messages/history/:conversationId (Fetch chat history) ────────
router.get('/history/:conversationId', authMiddleware, async (req, res) => {
  try {
    const viewerId = getAuthenticatedUserId(req);
    const { conversationId } = req.params;

    if (!viewerId) return res.status(401).json({ message: 'Unauthorized.' });
    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({ message: 'Invalid conversation ID.' });
    }

    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: viewerId,
    }).populate('participants', 'fullName username profilePicture headline location');

    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found or access denied.' });
    }

    const messages = await Message.find({ conversationId })
      .populate('sender', 'fullName username profilePicture')
      .populate('recipient', 'fullName username profilePicture')
      .sort({ createdAt: 1 })
      .limit(100);

    return res.status(200).json({
      conversation,
      messages,
    });
  } catch (error) {
    console.error('GET MESSAGE HISTORY ERROR:', error);
    return res.status(500).json({ message: 'Failed to fetch message history.', error: error.message });
  }
});

// ── POST /api/messages/start (Initiate chat with broker or member) ────────
router.post('/start', authMiddleware, async (req, res) => {
  try {
    const viewerId = getAuthenticatedUserId(req);
    const { targetUserId, targetUsername } = req.body;

    if (!viewerId) return res.status(401).json({ message: 'Unauthorized.' });

    let targetUser = null;
    if (targetUserId && mongoose.Types.ObjectId.isValid(targetUserId)) {
      targetUser = await User.findById(targetUserId);
    }

    if (!targetUser && targetUsername) {
      targetUser = await User.findOne({
        $or: [
          { username: targetUsername.trim().toLowerCase() },
          { email: targetUsername.trim().toLowerCase() },
        ],
      });
    }

    if (!targetUser) {
      return res.status(404).json({ message: 'Target user not found.' });
    }

    if (targetUser._id.toString() === viewerId.toString()) {
      return res.status(400).json({ message: 'Cannot start conversation with yourself.' });
    }

    // Check if conversation already exists between the two users
    let conversation = await Conversation.findOne({
      participants: { $all: [viewerId, targetUser._id], $size: 2 },
    }).populate('participants', 'fullName username profilePicture headline location');

    if (!conversation) {
      conversation = await Conversation.create({
        participants: [viewerId, targetUser._id],
        unreadCounts: new Map([[viewerId.toString(), 0], [targetUser._id.toString(), 0]]),
        lastMessage: {
          text: '',
          sender: viewerId,
          createdAt: new Date(),
        },
      });

      conversation = await Conversation.findById(conversation._id).populate(
        'participants',
        'fullName username profilePicture headline location'
      );
    }

    const otherUser = (conversation.participants || []).find(
      (p) => p && p._id.toString() !== viewerId.toString()
    );

    return res.status(200).json({
      success: true,
      conversation: {
        _id: conversation._id,
        id: conversation._id,
        participants: conversation.participants,
        otherUser,
        lastMessage: conversation.lastMessage,
        unreadCount: 0,
        updatedAt: conversation.updatedAt,
      },
    });
  } catch (error) {
    console.error('START CONVERSATION ERROR:', error);
    return res.status(500).json({ message: 'Failed to start conversation.', error: error.message });
  }
});

// ── POST /api/messages/send (HTTP fallback for sending message) ───────────
router.post('/send', authMiddleware, async (req, res) => {
  try {
    const viewerId = getAuthenticatedUserId(req);
    const { conversationId, recipientId, text, mediaUrl } = req.body;

    if (!viewerId) return res.status(401).json({ message: 'Unauthorized.' });
    if (!text && !mediaUrl) {
      return res.status(400).json({ message: 'Message text or media is required.' });
    }

    let conversation = null;
    if (conversationId && mongoose.Types.ObjectId.isValid(conversationId)) {
      conversation = await Conversation.findOne({ _id: conversationId, participants: viewerId });
    }

    if (!conversation && recipientId) {
      conversation = await Conversation.findOne({
        participants: { $all: [viewerId, recipientId], $size: 2 },
      });

      if (!conversation) {
        conversation = await Conversation.create({
          participants: [viewerId, recipientId],
          unreadCounts: new Map([[viewerId.toString(), 0], [recipientId.toString(), 0]]),
        });
      }
    }

    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found.' });
    }

    const actualRecipient = (conversation.participants || []).find(
      (p) => p.toString() !== viewerId.toString()
    );

    const message = await Message.create({
      conversationId: conversation._id,
      sender: viewerId,
      recipient: actualRecipient,
      text: (text || '').trim(),
      mediaUrl: mediaUrl || null,
      read: false,
    });

    const currentUnread = conversation.unreadCounts ? conversation.unreadCounts.get(actualRecipient.toString()) || 0 : 0;
    const newUnreadMap = new Map(conversation.unreadCounts || []);
    newUnreadMap.set(actualRecipient.toString(), currentUnread + 1);

    conversation.lastMessage = {
      text: (text || '').trim() || 'Shared a media attachment',
      sender: viewerId,
      createdAt: new Date(),
      mediaUrl: mediaUrl || null,
    };
    conversation.unreadCounts = newUnreadMap;
    await conversation.save();

    const populatedMessage = await Message.findById(message._id)
      .populate('sender', 'fullName username profilePicture')
      .populate('recipient', 'fullName username profilePicture');

    // Broadcast through socket if available
    const io = req.app.get('io');
    if (io) {
      io.to(`conv_${conversation._id}`).emit('new_message', populatedMessage);
      if (actualRecipient) {
        const recipientRoom = `user_${actualRecipient.toString()}`;
        io.to(recipientRoom).emit('new_message', populatedMessage);
        io.to(recipientRoom).emit('message_notification', {
          message: populatedMessage,
          conversationId: conversation._id,
        });
      }
      if (viewerId) {
        io.to(`user_${viewerId.toString()}`).emit('new_message', populatedMessage);
      }
    }

    return res.status(201).json({
      success: true,
      message: populatedMessage,
      conversationId: conversation._id,
    });
  } catch (error) {
    console.error('SEND MESSAGE ERROR:', error);
    return res.status(500).json({ message: 'Failed to send message.', error: error.message });
  }
});

// ── PUT /api/messages/read/:conversationId (Mark conversation as read) ────
router.put('/read/:conversationId', authMiddleware, async (req, res) => {
  try {
    const viewerId = getAuthenticatedUserId(req);
    const { conversationId } = req.params;

    if (!viewerId) return res.status(401).json({ message: 'Unauthorized.' });

    await Message.updateMany(
      { conversationId, recipient: viewerId, read: false },
      { $set: { read: true, readAt: new Date() } }
    );

    const conversation = await Conversation.findById(conversationId);
    if (conversation) {
      const newUnreadMap = new Map(conversation.unreadCounts || []);
      newUnreadMap.set(viewerId.toString(), 0);
      conversation.unreadCounts = newUnreadMap;
      await conversation.save();
    }

    const io = req.app.get('io');
    if (io) {
      io.to(`conv_${conversationId}`).emit('messages_read', {
        conversationId,
        readerId: viewerId,
      });
    }

    return res.status(200).json({ success: true, message: 'Marked as read.' });
  } catch (error) {
    console.error('MARK AS READ ERROR:', error);
    return res.status(500).json({ message: 'Failed to mark messages as read.', error: error.message });
  }
});

// ── PUT /api/messages/hide/:conversationId (Hide conversation for authenticated viewer) ──
router.put('/hide/:conversationId', authMiddleware, async (req, res) => {
  try {
    const viewerId = getAuthenticatedUserId(req);
    const { conversationId } = req.params;

    if (!viewerId) return res.status(401).json({ message: 'Unauthorized.' });
    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({ message: 'Invalid conversation ID.' });
    }

    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: viewerId,
    });

    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found or access denied.' });
    }

    await Conversation.findByIdAndUpdate(conversationId, {
      $addToSet: { hiddenFor: viewerId },
    });

    return res.status(200).json({ success: true, message: 'Conversation hidden for user.' });
  } catch (error) {
    console.error('HIDE CONVERSATION ERROR:', error);
    return res.status(500).json({ message: 'Failed to hide conversation.', error: error.message });
  }
});

module.exports = router;
