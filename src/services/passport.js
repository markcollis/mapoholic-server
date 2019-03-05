const passport = require('passport');
const LocalStrategy = require('passport-local');
const { Strategy, ExtractJwt } = require('passport-jwt');
const User = require('../models/user');
const logger = require('../utils/logger');

// create local strategy (email/password)
const localOptions = { usernameField: 'email' };
const localLogin = new LocalStrategy(localOptions, (email, password, done) => {
  // verify this user email and password combination
  User.findOne({ email }, (errFind, user) => {
    if (errFind) return done(errFind, false);
    if (!user) {
      // if user does not exist, call done without a user
      logger('error')(`Local auth strategy error: No such user (${email})`);
      return done(null, false);
    }
    return user.comparePassword(password, (errCompare, isMatch) => {
      if (errCompare) return done(errCompare, false);
      // if valid, call done with the user
      if (isMatch) return done(null, user);
      // if not, call done without a user
      logger('error')(`Local auth strategy error: Wrong password (for ${email})`);
      return done(null, false);
    });
  });
});

// set up options for JWT strategy
const JwtOptions = {
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: process.env.JWT_SECRET,
};

// create JWT strategy
const jwtLogin = new Strategy(JwtOptions, (payload, done) => {
  // does user ID in payload exist in database?
  User.findById(payload.sub, (err, user) => {
    if (err) return done(err, false);
    // if so, call done with that user
    if (user) return done(null, user);
    // if not, call done without a user object (i.e. auth failure)
    return done(null, false);
  });
});

// tell passport to use these strategies
passport.use(jwtLogin);
passport.use(localLogin);
