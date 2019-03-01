const mongoose = require('mongoose');
const validator = require('validator');

// define model for club (training group, individual organiser, etc.) information
const clubSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },
  shortName: { type: String, required: true, unique: true },
  fullName: { type: String },
  country: { type: String, validate: value => validator.isISO31661Alpha3(value) },
  website: { type: String, validate: value => validator.isURL(value) },
}, { timestamps: true });

// create model class
const ModelClass = mongoose.model('club', clubSchema);

// export model
module.exports = ModelClass;
