const mongoose = require('mongoose');

// define model for activity log
const activityLogSchema = new mongoose.Schema({
  timestamp: { type: Date, required: true },
  actionType: { type: String, required: true },
  actionBy: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
  club: { type: mongoose.Schema.Types.ObjectId, ref: 'club' },
  comment: { type: mongoose.Schema.Types.ObjectId }, // no ref as within oevent model
  event: { type: mongoose.Schema.Types.ObjectId, ref: 'oevent' },
  eventRunner: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
  linkedEvent: { type: mongoose.Schema.Types.ObjectId, ref: 'linkedEvent' },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
});

// create model class
const ModelClass = mongoose.model('activitylog', activityLogSchema);

// export model
module.exports = ModelClass;
