// Functions concerned solely or primarily with club data (club model)

const mongoose = require('mongoose');

const Club = require('../models/club');
const Event = require('../models/oevent');
const User = require('../models/user');

// add a new club
const dbCreateClub = (fieldsToCreate) => {
  const newClub = new Club(fieldsToCreate);
  return newClub.save().then((createdClub) => {
    return createdClub.populate('owner', '_id displayName').execPopulate();
  }).catch((err) => {
    if (err.message.slice(0, 6) === 'E11000') {
      const duplicate = err.message.split('"')[1];
      throw new Error(`Duplicate value ${duplicate}.`);
    }
    throw new Error(`Error creating club: ${err.message}`);
  });
};

// get a specific club record
const dbGetClubById = (id) => {
  return Club.findById(id).lean();
};

// get matching club records
const dbGetClubs = (searchCriteria) => {
  return Club.find(searchCriteria)
    .lean()
    .populate('owner', '_id displayName')
    .select('-active -__v');
};

// update a club record
const dbUpdateClub = (id, fieldsToUpdate) => {
  return Club.findByIdAndUpdate(id, { $set: fieldsToUpdate }, { new: true })
    .lean()
    .populate('owner', '_id displayName')
    .select('-active -__v');
};

// delete a club record and references to it in Events and Users
const dbDeleteClub = (id) => {
  return dbGetClubById(id).then((clubToDelete) => {
    // error handling!
    if (!clubToDelete) throw new Error('Club could not be found.');
    const now = new Date();
    const deletedAt = 'deleted:'.concat((`0${now.getDate()}`).slice(-2))
      .concat((`0${(now.getMonth() + 1)}`).slice(-2))
      .concat(now.getFullYear().toString())
      .concat('@')
      .concat((`0${now.getHours()}`).slice(-2))
      .concat((`0${now.getMinutes()}`).slice(-2));
    const newShortName = `${clubToDelete.shortName} ${deletedAt}`;
    return Club.findByIdAndUpdate(id,
      { $set: { active: false, shortName: newShortName } },
      { new: true }).then((deletedClub) => {
      // now remove all references from User.memberOf
      return User.updateMany({ memberOf: mongoose.Types.ObjectId(id) },
        { $pull: { memberOf: mongoose.Types.ObjectId(id) } }).then(() => {
        // now remove all references from Event.organisedBy
        return Event.updateMany({ organisedBy: mongoose.Types.ObjectId(id) },
          { $pull: { organisedBy: mongoose.Types.ObjectId(id) } }).then(() => {
          return deletedClub;
        });
      });
    });
  });
};

module.exports = {
  dbCreateClub,
  dbGetClubById,
  dbGetClubs,
  dbUpdateClub,
  dbDeleteClub,
};
