const jwt = require('jwt-simple');
const chalk = require('chalk');
const User = require('../models/user');
const logger = require('../utils/logger');
const logReq = require('./logReq');

const tokenForUser = (user) => {
  const timestamp = new Date().getTime();
  return jwt.encode({ sub: user._id, iat: timestamp }, process.env.JWT_SECRET);
  // sub = subject (token owner), iat = issued at time (reference at jtw.io)
};

const login = (req, res) => {
  logReq(req); // WARNING - shows password as plain text
  // already authenticated, just need to issue a token
  res.json({ token: tokenForUser(req.user) });
};

const signup = (req, res, next) => {
  logReq(req); // WARNING - shows password as plain text
  const { email, password } = req.body;
  if (!email || !password) {
    logger('error', 'Signup error: Either email address or password missing');
    return res.status(400).send({ error: 'You must provide both an email address and a password.' });
  }
  if (password.length < 8) {
    logger('error', `Signup error: Password for ${email} is too short.`);
    return res.status(400).send({ error: 'Your password must be at least 8 characters long.' });
  }
  // does a user with the given email exist?
  User.findOne({ email }, (err, existingUser) => {
    // handle database error
    if (err) return next(err);
    // if one does, return an error
    if (existingUser) {
      logger('error', `Signup error: ${email} is already registered.`);
      return res.status(400).send({ error: 'This email address is already registered.' });
    }
    // if not, create the user
    const newUser = new User({ email, password, displayName: email });
    return newUser.save((saveUserErr) => {
      if (saveUserErr) return next(saveUserErr);
      logger('success', 'New user created:', newUser);
      // return token if successful
      return res.json({ token: tokenForUser(newUser) });
    });
  });
  return true;
};

module.exports = { login, signup };
