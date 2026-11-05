const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema(
  {
    target: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    otp: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ['email', 'phone', 'login', 'register'],
      default: 'register',
    },
    // TTL index: Document will automatically be removed from MongoDB after 300 seconds (5 minutes)
    createdAt: {
      type: Date,
      default: Date.now,
      expires: 300,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Otp || mongoose.model('Otp', otpSchema);

