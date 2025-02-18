const mongoose = require('mongoose');
const { getCurrentDay, DAYS_SHORT } = require('../utils/dateFormatter.cjs');

// Venue Ordering Schema
const venueOrderingSchema = {
  orderingEnabled: { type: Boolean, default: false },
  startMessage: { 
    type: String, 
    default: "Start your night!" 
  },
  pickupLocations: [String],
  menuSections: [{
    name: String,
    description: String,
    displayOrder: Number,
    items: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MenuItem'
    }],
    availableStart: String, // time
    availableEnd: String,   // time
    active: Boolean
  }],
  quickAccess: {
    popularItems: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MenuItem',
      limit: 4
    }],
    recentlyOrdered: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MenuItem',
      limit: 4
    }]
  },
  preparationBuffer: { type: Number, default: 10 }, // minutes
  maxOrdersPerSlot: { type: Number, default: 20 }
};

// Happy Hour Schema
const happyHourSchema = {
  active: { type: Boolean, default: false },
  schedule: [{
    days: [{
      type: String, 
      enum: DAYS_SHORT 
    }],
    startTime: String, // "16:00"
    endTime: String,   // "19:00"
  }],
  drinks: [{
    menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem' },
    discountPercentage: { type: Number, min: 0, max: 100 }
  }]
};

// Pricing Schema
const pricingSchema = {
  basePrice: { type: Number, default: 0 },
  premium: { type: Number, default: 5 },
  currentPrice: { type: Number, default: 5 },
  surge: {
    lastUpdate: Date,
    totalIncrease: { type: Number, default: 0 }
  },
  priceLocks: {
    type: [{
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      price: Number,
      expiresAt: Date
    }],
    default: []
  }
};

// Cover Pass Schema
const coverPassSchema = {
  price: Number,
  enabled: Boolean,
  updatedAt: Date
};

// Drink Ordering Schema
const drinkOrderingSchema = {
  active: { type: Boolean, default: false },
  serviceFee: {
    enabled: { type: Boolean, default: false },
    amount: { type: Number, default: 0 }
  },
  tipping: {
    enabled: { type: Boolean, default: false },
    options: [{
      percentage: { type: Number },
      isDefault: { type: Boolean, default: false }
    }],
    minimumOrderAmount: { type: Number, default: 0 }
  }
};

// Pass Schedule Schema
const passScheduleSchema = new mongoose.Schema({
    scheduleType: {
        type: String,
        enum: ['continuous', 'dayOfWeek', 'customDays'],
        required: true,
        default: 'continuous'
    },
    scheduleDescription: {
        continuous: {
            type: String,
            default: "The pass is sold every day. The pass will be purchasable on the day of the event by default."
        },
        dayOfWeek: {
            type: String,
            default: "Sell the pass on certain day(s) every week. By default, passes are purchasable once created."
        },
        customDays: {
            type: String,
            default: "Add inventory on different dates with different prices, limit, and stock of the day."
        }
    },
    daysOfWeek: [{
        type: String,
        enum: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    }],
    customDates: [{
        date: Date,
        price: Number,
        inventory: Number,
        limit: Number
    }],
    startDate: Date,
    endDate: Date,
    noEndDate: {
        type: Boolean,
        default: false
    }
});

// Update pass config schema
const passConfigSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    type: {
        type: String,
        required: true,
        enum: ['LineSkip', 'VIP', 'Premium', 'DrinkDeal', 'Other']
    },
    price: {
        type: Number,
        required: true,
        min: 0
    },
    isVisible: {
        type: Boolean,
        default: true
    },
    isAvailable: {
        type: Boolean,
        default: true
    },
    schedule: passScheduleSchema,
    serviceFee: {
        enabled: { type: Boolean, default: false },
        amount: { type: Number, default: 0 }
    },
    tipping: {
        enabled: { type: Boolean, default: false },
        options: [{
            amount: { type: Number },
            isDefault: { type: Boolean, default: false }
        }]
    },
    startMessage: {
        type: String,
        default: "Start your night!"
    },
    description: {
        type: String,
        required: true
    },
    instructions: {
        type: String,
        required: true,
        default: "Show this pass to the bartender. The bartender will redeem the pass."
    },
    warning: {
        type: String,
        default: "Stop! Once you redeem this pass you cannot undo it. Make sure you have your drink before you redeem."
    },
    customQuestions: [{
        question: String,
        required: Boolean
    }],
    maxDaily: {
        type: Number,
        min: 0
    },
    restrictions: [{
        type: String
    }],
    status: {
        type: String,
        enum: ['incomplete', 'active', 'inactive'],
        default: 'incomplete'
    }
});

const venueSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    index: true 
  },
  type: {
    type: String,
    required: true,
    enum: ['Rooftop Lounge', 'Nightclub', 'Bar', 'Lounge']
  },
  music: {
    type: String,
    required: true,
    enum: ['Deep House', 'Hip Hop', 'Top 40', 'Latin', 'EDM', 'Mixed']
  },
  image: {
    type: String,
    required: true
  },
  socialProof: {
    type: String,
    default: "0 people here"
  },
  friendsHere: {
    type: Number,
    default: 0
  },
  likeCount: {
    type: Number,
    default: 0
  },
  passes: [passConfigSchema],
  coverPass: coverPassSchema,
  trending: {
    type: Boolean,
    default: false
  },
  highlights: [{
    type: String  // URLs for highlight images
  }],
  location: {
    address: {
      type: String,
      required: true
    },
    city: {
      type: String,
      required: true
    },
    province: {
      type: String,
      required: true
    },
    postalCode: {
      type: String,
      required: true
    }
  },
  operatingHours: {
    open: {
      type: String,
      required: true,
      default: '22:00'
    },
    close: {
      type: String,
      required: true,
      default: '02:00'
    },
    daysOpen: [{
      type: String,
      enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    }]
  },
  trendingScore: {
    type: Number,
    default: 0
  },
  checkInHistory: [{
    count: Number,
    timestamp: Date
  }],
  ordering: venueOrderingSchema,
  happyHour: happyHourSchema,
  pricing: pricingSchema,
  drinkOrdering: drinkOrderingSchema,
  blackoutDates: [{
    type: Date
  }],
  passSettings: {
    allowMultiplePasses: {
      type: Boolean,
      default: false
    },
    requireAdvanceBooking: {
      type: Boolean,
      default: false
    },
    minAdvanceHours: {
      type: Number,
      default: 0
    },
    maxAdvanceDays: {
      type: Number,
      default: 7
    },
    autoExpireHours: {
      type: Number,
      default: 24
    }
  }
}, {
  timestamps: true,
  indexes: [
    { 'location.city': 1 },
    { trendingScore: -1 },
    { 'passes.available': 1 }
  ],
  version: { type: Number, default: 0 } 
});

// Add method to check pass availability
venueSchema.methods.isPassAvailable = function(passType, date = new Date()) {
    const pass = this.passes.find(p => p.type === passType);
    if (!pass || !pass.isAvailable) return false;

    // Check blackout dates
    const isBlackout = this.blackoutDates.some(blackoutDate => 
        blackoutDate.getFullYear() === date.getFullYear() &&
        blackoutDate.getMonth() === date.getMonth() &&
        blackoutDate.getDate() === date.getDate()
    );
    if (isBlackout) return false;

    return true;
};

// Add method to get pass price
venueSchema.methods.getPassPrice = function(passType) {
    const pass = this.passes.find(p => p.type === passType);
    return pass ? pass.price : null;
};

// Add method to update pass schedule
venueSchema.methods.updatePassSchedule = function(passId, scheduleData) {
    const pass = this.passes.id(passId);
    if (!pass) throw new Error('Pass not found');
    
    pass.schedule = scheduleData;
    return this.save();
};

// Add method to manage blackout dates
venueSchema.methods.manageBlackoutDates = function(dates, operation = 'add') {
    if (operation === 'add') {
        this.blackoutDates.push(...dates);
    } else if (operation === 'remove') {
        this.blackoutDates = this.blackoutDates.filter(date => 
            !dates.some(d => d.getTime() === date.getTime())
        );
    }
    return this.save();
};

module.exports = mongoose.model('Venue', venueSchema);
DAYS_SHORT 












