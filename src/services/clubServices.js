const fetch = require('node-fetch');
const mongoose = require('mongoose');

const logger = require('../services/logger');
const Club = require('../models/club');
const Event = require('../models/oevent');
const User = require('../models/user');

// add a new club
const createClubRecord = (fieldsToCreate) => {
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
const getClubById = (id) => {
  return Club.findById(id);
};

// get matching club records
const getClubRecords = (clubSearchCriteria) => {
  return Club.find(clubSearchCriteria)
    .populate('owner', '_id displayName')
    .select('-active -__v');
};

// update a club record
const updateClubById = (clubId, fieldsToUpdate) => {
  return Club.findByIdAndUpdate(clubId, { $set: fieldsToUpdate }, { new: true })
    .populate('owner', '_id displayName')
    .select('-active -__v');
};

// delete a club record and references to it in Events and Users
const deleteClubById = (clubId) => {
  return getClubById(clubId).then((clubToDelete) => {
    const now = new Date();
    const deletedAt = 'deleted:'.concat((`0${now.getDate()}`).slice(-2))
      .concat((`0${(now.getMonth() + 1)}`).slice(-2))
      .concat(now.getFullYear().toString())
      .concat('@')
      .concat((`0${now.getHours()}`).slice(-2))
      .concat((`0${now.getMinutes()}`).slice(-2));
    const newShortName = `${clubToDelete.shortName} ${deletedAt}`;
    return Club.findByIdAndUpdate(clubId,
      { $set: { active: false, shortName: newShortName } },
      { new: true }).then((deletedClub) => {
      // now remove all references from User.memberOf
      return User.updateMany({ memberOf: mongoose.Types.ObjectId(clubId) },
        { $pull: { memberOf: mongoose.Types.ObjectId(clubId) } }).then(() => {
        // now remove all references from Event.organisedBy
        return Event.updateMany({ organisedBy: mongoose.Types.ObjectId(clubId) },
          { $pull: { organisedBy: mongoose.Types.ObjectId(clubId) } }).then(() => {
          return deletedClub;
        });
      });
    });
  });
};

// helper function to get ORIS club data - returns a Promise
const getOrisClubData = (clubAbbr) => {
  const ORIS_API_GETCLUB = 'https://oris.orientacnisporty.cz/API/?format=json&method=getClub';
  return fetch(`${ORIS_API_GETCLUB}&id=${clubAbbr}`)
    .then(response => response.json())
    .then((json) => {
      return json.Data;
    })
    .catch((orisErr) => {
      logger('error')(`ORIS API error: ${orisErr.message}. Create operation may proceed.`);
      // don't send an HTTP error response, the club can still be created
    });
};


module.exports = {
  createClubRecord,
  deleteClubById,
  getClubById,
  getClubRecords,
  getOrisClubData,
  updateClubById,
};
