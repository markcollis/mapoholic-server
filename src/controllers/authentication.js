const jwt = require('jwt-simple');
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
  const displayName = req.body.displayName || req.body.email;
  if (!email || !password) {
    logger('error')('Signup error: Either email address or password missing');
    return res.status(400).send({ error: 'You must provide both an email address and a password.' });
  }
  if (password.length < 8) {
    logger('error')(`Signup error: Password for ${email} is too short.`);
    return res.status(400).send({ error: 'Your password must be at least 8 characters long.' });
  }
  // does a user with the given email or displayName exist?
  User.findOne({ $or: [{ email }, { displayName }] }, (err, existingUser) => {
    // handle database error
    if (err) return next(err);
    // if one does, return an error
    if (existingUser) {
      if (existingUser.email === email) {
        logger('error')(`Signup error: ${email} is already registered.`);
        return res.status(400).send({ error: 'This email address is already registered.' });
      }
      logger('error')(`Signup error: ${displayName} is already in use.`);
      return res.status(400).send({ error: 'This display name is already in use, please choose another.' });
    }
    // if not, create the user
    const newUser = new User({ email, password, displayName });
    return newUser.save((saveUserErr, savedUser) => {
      if (saveUserErr) return next(saveUserErr);
      logger('success')('New user created:', savedUser);
      // return token if successful
      return res.json({ token: tokenForUser(savedUser) });
    });
  });
  return true;
};

const passwordChange = (req, res) => {
  logReq(req); // WARNING - shows passwords as plain text
  const { currentPassword, newPassword } = req.body;
  const requestorId = req.user._id;
  const requestorRole = req.user.role;
  const targetId = req.params.id;
  if (requestorRole === 'guest') {
    logger('error')('Password change error: guest attempting to change own password');
    return res.status(400).send({ error: 'Guest accounts are not allowed to change passwords.' });
  }
  if (!currentPassword || !newPassword) {
    logger('error')('Password change error: password missing');
    return res.status(400).send({ error: 'You must provide both old and new passwords.' });
  }
  if (newPassword.length < 8) {
    logger('error')('Error: New password is too short.');
    return res.status(400).send({ error: 'Your password must be at least 8 characters long.' });
  }
  return req.user.comparePassword(currentPassword, (err, isMatch) => {
    // console.log('isMatch:', isMatch);
    if (err) return res.status(400).send(err.message);
    // if valid, call done with the user
    if (!isMatch) {
      logger('error')(`Password change error: Wrong password (for ${req.user.email})`);
      return res.status(400).send({ error: 'Current password does not match.' });
    }
    if (requestorId.toString() !== targetId.toString() && requestorRole !== 'admin') {
      logger('error')('Password change error: insufficient permissions');
      return res.status(400).send({ error: 'You are not allowed to change this user\'s password.' });
    }
    return User.findOneAndUpdate({ _id: targetId },
      { $set: { password: newPassword } },
      { new: true })
      .then((updatedUser) => {
        if (updatedUser.error) return res.status(400).send(updatedUser.error.message);
        // console.log('updatedUser after password change:', updatedUser);
        logger('success')(`Password for ${updatedUser.email} changed by ${req.user.email}.`);
        return res.status(200).json('Password changed successfully.');
      }).catch(e => res.status(400).send(e));
  });
};

module.exports = { login, signup, passwordChange };
