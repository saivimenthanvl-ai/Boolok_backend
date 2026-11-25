const mongoose = require('mongoose');

const SavedBlueprintSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    generationId: {
      type: String,
      required: true,
      index: true,
    },
    mode: {
      type: String,
      enum: ['both', '2d', '3d'],
      default: 'both',
    },
    form: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    plan2dUrl: {
      type: String,
      default: null,
    },
    plan3dUrl: {
      type: String,
      default: null,
    },
    plan2dSvg: {
      type: String,
      default: null,
    },
    plan3dSvg: {
      type: String,
      default: null,
    },
    technicalCadSvg: {
      type: String,
      default: null,
    },
    summary: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.models.SavedBlueprint || mongoose.model('SavedBlueprint', SavedBlueprintSchema);
