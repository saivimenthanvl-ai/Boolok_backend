const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
    },
    username: {
      type: String,
      trim: true,
      lowercase: true,
      sparse: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    password: {
      type: String,
      required: false,
      default: null,
      select: false,
    },
    requiresPasswordReset: {
      type: Boolean,
      default: false,
    },
    phoneNumber: {
      type: String,
      trim: true,
      default: null,
      sparse: true,
    },
    isPhoneVerified: {
      type: Boolean,
      default: false,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    authProvider: {
      type: String,
      enum: ['local', 'google'],
      default: 'local',
    },
    googleSubject: {
      type: String,
      default: null,
      index: true,
      sparse: true,
    },
    profilePicture: {
      type: String,
      default: null,
    },
    bio: {
      type: String,
      default: '',
    },
    headline: {
      type: String,
      default: 'Real Estate Professional & Boolok Member',
    },
    location: {
      type: String,
      default: 'Global Real Estate Network',
    },
    coverImage: {
      type: String,
      // Default cover photo — Unsplash free-to-use license (https://unsplash.com/license)
      // Photo by Philipp Berndt: https://unsplash.com/photos/5i0GnoTTjSE
      default: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1200',
    },
    closedDeals: {
      type: String,
      default: '0',
    },
    followers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    following: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    goal: {
      type: String,
      enum: ['buying', 'selling', 'investing', 'analysis', null],
      default: null,
    },
    avatarInitial: {
      type: String,
      default: null,
    },
    avatarBgColor: {
      type: String,
      default: null,
    },
    avatarMode: {
      type: String,
      default: null,
    },
    isPro: {
      type: Boolean,
      default: false,
    },
    subscription: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    isArchived: {
      type: Boolean,
      default: false,
    },
    isTestAccount: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.models.User || mongoose.model('User', userSchema);