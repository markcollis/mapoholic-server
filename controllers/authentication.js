const jwt = require('jwt-simple');
const chalk = require('chalk');
const User = require('../models/user');
const Profile = require('../models/profile');

const tokenForUser = (user) => {
  const timestamp = new Date().getTime();
  console.log('user _id for token:', user._id);
  return jwt.encode({ sub: user._id, iat: timestamp }, process.env.JWT_SECRET);
  // sub = subject (token owner), iat = issued at time (reference at jtw.io)
};

const login = (req, res) => {
  console.log('received login POST request');
  console.log('req.body:', req.body); // shows password in plaintext - DEV ONLY!
  console.log('req.user:', req.user);
  // already authenticated, just need to issue a token
  res.json({ token: tokenForUser(req.user) });
};

const signup = (req, res, next) => {
  console.log('received signup POST request');
  console.log('req.body:', req.body); // shows password in plaintext - DEV ONLY!
  const { email, password } = req.body;
  if (!email || !password) {
    console.log(chalk.red('Signup error: Either email address or password missing'));
    return res.status(400).send({ error: 'You must provide both an email address and a password.' });
  }
  if (password.length < 8) {
    console.log(chalk.red(`Signup error: Password for ${email} is too short.`));
    return res.status(400).send({ error: 'Your password must be at least 8 characters long.' });
  }
  // does a user with the given email exist?
  User.findOne({ email }, (err, existingUser) => {
    // handle database error
    if (err) return next(err);
    // if one does, return an error
    if (existingUser) {
      console.log(chalk.red(`Signup error: ${email} is already registered.`));
      return res.status(400).send({ error: 'This email address is already registered.' });
    }
    // if not, create the user
    const newUser = new User({ email, password });
    // console.log('newUser', newUser);
    return newUser.save((saveUserErr) => {
      if (saveUserErr) return next(saveUserErr);
      const newProfile = new Profile({
        user: newUser._id,
        displayName: newUser.email,
      });
      console.log('new user created:', newUser);
      return newProfile.save((saveProfileErr) => {
        if (saveProfileErr) {
          return User.findOneAndDelete({ _id: newUser._id }).then(() => {
            return next(saveProfileErr);
          });
        }
        console.log('new profile created:', newProfile);
        // return token if successful
        return res.json({ token: tokenForUser(newUser) });
      });
    });
  });
  return true;
};

module.exports = { login, signup };
