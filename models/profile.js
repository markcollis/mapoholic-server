const mongoose = require('mongoose');
const validator = require('validator');

// define model for user profile information
const profileSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectID, ref: 'user', required: true },
  visibility: {
    type: String,
    required: true,
    enum: [
      'public', //  visible to anyone even if not logged in
      'all', //     visible to all logged in users (including guests)
      'club', //    visible to logged in users that are members of the same club
      'private', // only visible to the user concerned (and admin users)
    ],
    default: 'all',
  },
  displayName: { type: String, required: true, unique: true },
  fullName: { type: String },
  location: { type: String },
  about: { type: String },
  contact: { // can flesh out with others if desired later
    email: { type: String, validate: value => validator.isEmail(value) },
    // not necessarily the same as the ACCOUNT email, UI needs to be clear on this
    facebook: { type: String },
  },
  memberOf: [{ type: mongoose.Schema.Types.ObjectID, ref: 'club' }],
  profileImage: { type: String }, // reference to file in /uploads/user/user_id/profile.jpg
}, { timestamps: true });

// set lastModified timestamp when saving NOT NEEDED IN MODERN VERSIONS
// profileSchema.pre('save', function updateLastModified(next) {
//   const profile = this;
//   profile.lastModified = Date.now();
//   next();
// });

// create model class
const ModelClass = mongoose.model('profile', profileSchema);

// export model
module.exports = ModelClass;
