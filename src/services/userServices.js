// Functions concerned solely or primarily with user data (user model)
const mongoose = require('mongoose');
const Event = require('../models/oevent');
const User = require('../models/user');

// add a new user
const dbCreateUser = (fieldsToCreate) => {
  const newUser = new User(fieldsToCreate);
  return newUser.save();
};

// get a specific user record
const dbGetUserById = (id) => {
  return User.findOne({ _id: id, active: true }) // inactive users should not be visible through API
    .lean()
    .populate('memberOf')
    .select('-password -active -__v');
};

// get matching user records
const dbGetUsers = (searchCriteria) => {
  return User.find(searchCriteria)
    .lean()
    .populate('memberOf', 'shortName')
    .select('-password')
    .then((profiles) => {
      if (profiles.length === 0) return [];
      // reformat slightly so as not to expose all data
      return profiles.map((profile) => {
        const userSummary = {
          _id: profile._id,
          displayName: profile.displayName,
          fullName: profile.fullName,
          memberOf: profile.memberOf,
          profileImage: profile.profileImage || '',
          role: profile.role,
          joined: profile.createdAt,
        };
        return userSummary;
      });
    });
};

// update a user record
const dbUpdateUser = (id, fieldsToUpdate) => {
  return User.findByIdAndUpdate(id, { $set: fieldsToUpdate }, { new: true })
    .lean()
    .populate('memberOf', 'shortName')
    .select('-password');
};

// delete a user record and references to it in Events
const dbDeleteUser = (id) => {
  return dbGetUserById(id).then((userToDelete) => {
    if (!userToDelete) throw new Error('User could not be found.');
    const now = new Date();
    const deletedAt = 'deleted:'.concat((`0${now.getDate()}`).slice(-2))
      .concat((`0${(now.getMonth() + 1)}`).slice(-2))
      .concat(now.getFullYear().toString())
      .concat('@')
      .concat((`0${now.getHours()}`).slice(-2))
      .concat((`0${now.getMinutes()}`).slice(-2));
    const newEmail = `deleted${now.getTime()}${userToDelete.email}`;
    const newDisplayName = `${userToDelete.displayName} ${deletedAt}`;
    const fieldsToUpdate = {
      active: false,
      email: newEmail,
      displayName: newDisplayName,
    };
    return dbUpdateUser(id, fieldsToUpdate).then((deletedUser) => {
      // Consider all related records:
      // 1. Owner of club and event records: leave as deleted user, only admin can see them.
      // 2. Comment author: leave as deleted user, strip 'deleted' when retrieving comments?
      // 3. Runner records of this user: set to 'private' so admin can retrieve if needed.
      return Event.updateMany({ 'runners.user': mongoose.Types.ObjectId(id) },
        { $set: { 'runners.$.visibility': 'private' } }).then(() => deletedUser);
    });
  });
};

module.exports = {
  dbCreateUser,
  dbGetUserById,
  dbGetUsers,
  dbUpdateUser,
  dbDeleteUser,
};
