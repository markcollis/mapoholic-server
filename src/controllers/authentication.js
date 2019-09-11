const jwt = require('jwt-simple');

const logger = require('../services/logger');
const { dbRecordActivity } = require('../services/activityServices');
const {
  dbCreateUser,
  dbGetUsers,
  dbUpdateUser,
} = require('../services/userServices');

const tokenForUser = (user) => {
  const timestamp = new Date().getTime();
  return jwt.encode({ sub: user._id, iat: timestamp }, process.env.JWT_SECRET);
  // sub = subject (token owner), iat = issued at time (reference at jtw.io)
};

const login = (req, res) => {
  // already authenticated, just need to issue a token
  logger('success')(`Successful login by ${req.user.email}`);
  return res.status(200).send({ token: tokenForUser(req.user) });
};

const signup = (req, res) => {
  const { email, password, displayName } = req.body;
  if (!email || !password) {
    logger('error')('Signup error: either email address or password missing.');
    return res.status(400).send({ error: 'You must provide both an email address and a password.' });
  }
  if (password.length < 8) {
    logger('error')(`Signup error: password for ${email} is too short.`);
    return res.status(400).send({ error: 'Your password must be at least 8 characters long.' });
  }
  // default if no display name explicitly provided
  const displayNameToAdd = (!displayName || displayName === '') ? email : displayName;
  // does a user with the given email or displayName exist?
  return dbGetUsers({ $or: [{ email }, { displayName: displayNameToAdd }] })
    .then((matchingUsers) => {
      // if one does, return an error
      if (matchingUsers.length > 0) {
        if (matchingUsers[0].email === email) {
          logger('error')(`Signup error: ${email} is already registered.`);
          return res.status(400).send({ error: 'This email address is already registered.' });
        }
        logger('error')(`Signup error: ${displayNameToAdd} is already in use.`);
        return res.status(400).send({ error: 'This display name is already in use, please choose another.' });
      }
      // if not, create the user
      const fieldsToCreate = { email, password, displayName: displayNameToAdd };
      return dbCreateUser(fieldsToCreate).then((savedUser) => {
        // return token if successful
        logger('success')(`New user created: ${savedUser._id} (${savedUser.email}).`);
        dbRecordActivity({
          actionType: 'USER_CREATED',
          actionBy: savedUser._id,
          user: savedUser._id,
        });
        return res.status(200).send({ token: tokenForUser(savedUser) });
      }).catch((createErr) => {
        logger('error')('Error creating user:', createErr.message);
        return res.status(400).send({ error: createErr.message });
      });
    });
};

const passwordChange = (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const requestorId = req.user._id;
  const requestorRole = req.user.role;
  const targetId = req.params.id;
  if (requestorRole === 'guest') {
    logger('error')('Password change error: guest attempting to change own password.');
    return res.status(400).send({ error: 'Guest accounts are not allowed to change passwords.' });
  }
  if (!currentPassword || !newPassword) {
    logger('error')('Password change error: password missing.');
    return res.status(400).send({ error: 'You must provide both old and new passwords.' });
  }
  if (newPassword.length < 8) {
    logger('error')('Error: New password is too short.');
    return res.status(400).send({ error: 'Your password must be at least 8 characters long.' });
  }
  return req.user.comparePassword(currentPassword, (err, isMatch) => {
    if (err) {
      logger('error')(`Error in comparePassword: ${err.message}.`);
      return res.status(400).send({ error: err.message });
    }
    // if valid, call done with the user
    if (!isMatch) {
      logger('error')(`Password change error: Wrong password (for ${req.user.email}).`);
      return res.status(400).send({ error: 'Current password does not match.' });
    }
    if (requestorId.toString() !== targetId.toString() && requestorRole !== 'admin') {
      logger('error')('Password change error: insufficient permissions.');
      return res.status(400).send({ error: 'You are not allowed to change this user\'s password.' });
    }
    return dbUpdateUser(targetId, { password: newPassword })
      .then((updatedUser) => {
        logger('success')(`Password for ${updatedUser.email} changed by ${req.user.email}.`);
        return res.status(200).send({ status: 'Password changed successfully.' });
      }).catch((updateErr) => {
        logger('error')('Error in findOneAndUpdate:', updateErr.message);
        return res.status(400).send({ error: updateErr.message });
      });
  });
};

module.exports = { login, signup, passwordChange };
