const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  text: {
    type: String,
    trim: true,
    required: true,
    maxlength: 1000,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const reelSchema = new mongoose.Schema(
  {
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    videoUrl: { type: String, required: true, trim: true },
    thumbnail: { type: String, trim: true },
    poster: { type: String, trim: true },
    caption: { type: String, trim: true, maxlength: 2200 },
    title: { type: String, trim: true, maxlength: 150 },
    authorName: { type: String, trim: true, maxlength: 100 },
    location: { type: String, trim: true, maxlength: 150 },
    price: { type: String, default: '', trim: true, maxlength: 80 },
    aiMatch: { type: Number, min: 0, max: 100, default: null },
    insight: { type: String, trim: true, maxlength: 500, default: '' },
    views: { type: Number, default: 0, min: 0 },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    comments: [commentSchema],
  },
  { timestamps: true }
);

// Feed query sorts newest-first
reelSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Reel', reelSchema);
