// models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  // Monday.com user information
  mondayUserId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  mondayAccountId: {
    type: String,
    required: true,
    index: true
  },
  
  // User profile
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true
  },
  
  // Authentication
  accessToken: {
    type: String,
    required: true
  },
  refreshToken: {
    type: String
  },
  tokenExpiresAt: {
    type: Date
  },
  
  // App permissions and settings
  permissions: {
    type: [String],
    default: []
  },
  preferences: {
    aiModel: {
      type: String,
      default: 'claude-3-5-sonnet-20241022'
    },
    autoExecute: {
      type: Boolean,
      default: false
    },
    notificationSettings: {
      email: { type: Boolean, default: true },
      inApp: { type: Boolean, default: true }
    }
  },
  
  // Usage tracking
  usage: {
    totalRequests: { type: Number, default: 0 },
    lastRequestAt: { type: Date },
    monthlyRequests: { type: Number, default: 0 },
    monthlyResetDate: { type: Date, default: Date.now }
  },
  
  // Status
  isActive: {
    type: Boolean,
    default: true
  },
  lastLoginAt: {
    type: Date,
    default: Date.now
  },
  
  // Metadata
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  collection: 'users'
});

// Indexes for performance
userSchema.index({ mondayUserId: 1, mondayAccountId: 1 });
userSchema.index({ email: 1 });
userSchema.index({ isActive: 1 });
userSchema.index({ createdAt: -1 });

// Instance methods
userSchema.methods.toJSON = function() {
  const user = this.toObject();
  delete user.accessToken;
  delete user.refreshToken;
  return user;
};

userSchema.methods.incrementUsage = function() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  
  // Reset monthly counter if needed
  if (this.usage.monthlyResetDate < monthStart) {
    this.usage.monthlyRequests = 0;
    this.usage.monthlyResetDate = monthStart;
  }
  
  this.usage.totalRequests += 1;
  this.usage.monthlyRequests += 1;
  this.usage.lastRequestAt = now;
  
  return this.save();
};

userSchema.methods.updateLastLogin = function() {
  this.lastLoginAt = new Date();
  return this.save();
};

// Static methods
userSchema.statics.findByMondayId = function(mondayUserId, mondayAccountId) {
  return this.findOne({ 
    mondayUserId, 
    mondayAccountId,
    isActive: true 
  });
};

userSchema.statics.createFromMondayAuth = function(mondayUserData, tokens) {
  return this.create({
    mondayUserId: mondayUserData.id,
    mondayAccountId: mondayUserData.account.id,
    name: mondayUserData.name,
    email: mondayUserData.email,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    tokenExpiresAt: tokens.expires_at ? new Date(tokens.expires_at) : null,
    permissions: tokens.scope ? tokens.scope.split(' ') : []
  });
};

// Pre-save middleware
userSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Virtual for full name
userSchema.virtual('displayName').get(function() {
  return this.name || this.email;
});

module.exports = mongoose.model('User', userSchema);
