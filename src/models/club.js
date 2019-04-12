const mongoose = require('mongoose');
const validator = require('validator');

// define model for club (training group, individual organiser, etc.) information
// https://oris.orientacnisporty.cz/API/?format=json&method=getClub&id=xxx could be
// used to auto-populate for official Czech clubs from the abbreviation alone.

const clubSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },
  shortName: { type: String, required: true, unique: true }, // ORIS Data.Abbr
  fullName: { type: String, trim: true, default: '' }, // ORIS Data.Name
  orisId: { type: String, trim: true, default: '' }, // CZE specific hook, ORIS Data.ID
  country: { type: String, validate: value => (value === '' || validator.isISO31661Alpha3(value)) },
  website: { type: String, validate: value => (value === '' || validator.isURL(value)) }, // ORIS Data.WWW
  active: { type: Boolean, default: true }, // set to false on 'deletion', recovery by db admin only
}, { timestamps: true });

// create model class
const ModelClass = mongoose.model('club', clubSchema);

// export model
module.exports = ModelClass;
