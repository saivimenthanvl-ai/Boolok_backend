const mongoose = require('mongoose');

const storySchema = new mongoose.Schema(
  {
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    mediaUrl: {
      type: String,
      required: true,
    },
    mediaType: {
      type: String,
      enum: ['image', 'video'],
      default: 'image',
    },
    caption: {
      type: String,
      maxlength: 300,
      default: '',
    },
    viewers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 }, // MongoDB TTL cleanup
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for active stories
storySchema.index({ author: 1, expiresAt: 1 });

module.exports = mongoose.model('Story', storySchema);
