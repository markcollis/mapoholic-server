const mongoose = require('mongoose');
const bcrypt = require('bcrypt-nodejs');
const validator = require('validator');

// define model for basic user account data
const userSchema = new mongoose.Schema({
  email: {
    type: String,
    unique: true,
    required: true,
    lowercase: true, // force lowercase to avoid duplicates
    validate: value => validator.isEmail(value),
  },
  password: { type: String, required: true },
  role: { type: String, enum: ['standard', 'admin', 'guest'], default: 'standard' },
  lastModified: { type: Date },
}, { timestamps: true });

// on save hook, encrypt password
userSchema.pre('save', function hashPassword(next) { // run this before saving a model
  const user = this; // i.e. this instance
  bcrypt.genSalt(10, (err, salt) => { // generate salt then run callback
    // console.log('salt', salt);
    if (err) return next(err);
    return bcrypt.hash(user.password, salt, null, (err2, hash) => { // encrypt then...
      if (err2) return next(err2); // ...run callback to overwrite unencrypted password
      // console.log('hash', hash);
      user.password = hash;
      // console.log('user', user);
      return next();
    });
  });
});

userSchema.methods.comparePassword = function compare(candidatePassword, callback) {
  bcrypt.compare(candidatePassword, this.password, (err, isMatch) => {
    if (err) return callback(err);
    return callback(null, isMatch);
  });
};

// create model class
const ModelClass = mongoose.model('user', userSchema);

// export model
module.exports = ModelClass;
