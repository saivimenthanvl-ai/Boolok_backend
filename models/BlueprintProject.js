const mongoose = require('mongoose');

const BlueprintProjectSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
      index: true,
    },
    projectId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    title: {
      type: String,
      default: 'Residential Architectural Plan',
    },
    plot: {
      width: { type: Number, required: true },
      depth: { type: Number, required: true },
      unit: { type: String, default: 'feet' },
      facing: { type: String, default: 'north' },
      shape: { type: String, default: 'rectangular' },
      areaSqFt: { type: Number },
      roadWidth: { type: Number, default: 20 },
    },
    requirements: {
      stories: { type: Number, default: 1 },
      bedrooms: { type: Number, default: 2 },
      bathrooms: { type: Number, default: 2 },
      kitchenType: { type: String, default: 'closed' },
      parkingType: { type: String, default: 'covered' },
      cars: { type: Number, default: 1 },
      vastuEnabled: { type: Boolean, default: false },
    },
    canonicalLayout: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    geometryVersion: {
      type: String,
      default: '2026.4',
    },
    summary: {
      type: String,
    },
    plan2dFileUrl: {
      type: String,
    },
    plan3dFileUrl: {
      type: String,
    },
    technicalCadFileUrl: {
      type: String,
    },
    aiModelUsed: {
      type: String,
      default: null,
    },
    aiInsights: {
      type: String,
      default: null,
    },
    isPublic: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.models.BlueprintProject || mongoose.model('BlueprintProject', BlueprintProjectSchema);
