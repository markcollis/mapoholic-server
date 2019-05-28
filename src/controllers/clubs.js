const { ObjectID } = require('mongodb');
const mongoose = require('mongoose');
const fetch = require('node-fetch');
const Club = require('../models/club');
const User = require('../models/user');
const Event = require('../models/oevent');
const logger = require('../utils/logger');
const logReq = require('./logReq');
const { validateUserId } = require('./validateIds');

// *** /clubs routes ***  [Club model]

// helper function to get ORIS club data - returns a Promise
const getOrisClubData = (clubAbbr) => {
  const ORIS_API_GETCLUB = 'https://oris.orientacnisporty.cz/API/?format=json&method=getClub';
  return fetch(`${ORIS_API_GETCLUB}&id=${clubAbbr}`)
    .then(response => response.json())
    .then((json) => {
      // console.log('Response from ORIS:', json);
      return json.Data;
    })
    .catch((orisErr) => {
      logger('error')(`ORIS API error: ${orisErr.message}. Create operation may proceed.`);
      // don't send an HTTP error response, the club can still be created
    });
};

// create a club
// autopopulate Czech clubs from abbreviation
const createClub = (req, res) => {
  logReq(req);
  const creatorRole = req.user.role;
  const creatorId = req.user._id;
  const clubAbbr = req.body.shortName;
  if (creatorRole === 'guest') {
    logger('error')('Error creating club: Guest accounts can not create a club.');
    return res.status(401).send({ error: 'Guest accounts are not allowed to create a club.' });
  }
  if (!clubAbbr) {
    logger('error')('Error creating club: No short name provided.');
    return res.status(400).send({ error: 'You must provide a short name/abbreviation.' });
  }
  const fieldsToCreate = { owner: creatorId };
  const validFields = [ // owner is creator, orisId is always auto-populated
    'shortName',
    'fullName',
    'country',
    'website',
  ];
  Object.keys(req.body).forEach((key) => {
    if (validFields.includes(key)) {
      fieldsToCreate[key] = req.body[key];
    }
  });
  const checkOris = (req.body.country === 'CZE' && clubAbbr.match(/[A-Z]{3}/))
    ? getOrisClubData(clubAbbr)
    : Promise.resolve(false);
  return checkOris.then((orisData) => {
    if (orisData) {
      logger('info')(`Retrieved ORIS data for ${clubAbbr}.`);
      // console.log('orisClubData:', orisData);
      fieldsToCreate.orisId = orisData.ID; // only available through API
      if (!fieldsToCreate.fullName || fieldsToCreate.fullName === '') {
        fieldsToCreate.fullName = orisData.Name; // use ORIS if not provided
      }
      if (!fieldsToCreate.website || fieldsToCreate.website === '') {
        fieldsToCreate.website = orisData.WWW; // use ORIS if not provided
      }
    } else {
      // console.log('Nothing retrieved from ORIS.');
    }
  }).then(() => {
    // console.log('fieldsToCreate:', fieldsToCreate);
    const newClub = new Club(fieldsToCreate);
    newClub.save()
      .then((createdClub) => {
        return createdClub.populate('owner', '_id displayName').execPopulate();
      })
      .then((createdClub) => {
        logger('success')(`${createdClub.shortName} created by ${req.user.email}.`);
        return res.status(200).send(createdClub);
      })
      .catch((err) => {
        if (err.message.slice(0, 6) === 'E11000') {
          const duplicate = err.message.split('"')[1];
          logger('error')(`Error creating club: duplicate value ${duplicate}.`);
          return res.status(400).send({ error: `${duplicate} is already in use.` });
        }
        logger('error')('Error creating club:', err.message);
        return res.status(400).send({ error: err.message });
      });
  });
};

// retrieve details for all clubs matching specified criteria
const getClubList = (req, res) => {
  logReq(req);
  const clubSearchCriteria = { active: true };
  // support basic filtering using query strings
  const validFilters = ['owner', 'shortName', 'fullName', 'orisId', 'country', 'website'];
  Object.keys(req.query).forEach((key) => {
    // console.log('filtering on', key, req.query[key]);
    if (validFilters.includes(key)) {
      if (key === 'owner') {
        // needs custom treatment to avoid ObjectID cast error/return empty array if no such owner
        if (ObjectID.isValid(req.query.owner)) {
          clubSearchCriteria.owner = req.query.owner;
        } else {
          clubSearchCriteria.owner = null;
        }
      } else {
        clubSearchCriteria[key] = { $regex: new RegExp(req.query[key]) };
      }
    }
  });
  // console.log('clubSearchCriteria:', JSON.stringify(clubSearchCriteria));
  Club.find(clubSearchCriteria)
    .populate('owner', '_id displayName')
    .select('-active -__v')
    .then((clubs) => {
      logger('success')(`Returned list of ${clubs.length} club(s).`);
      return res.status(200).send(clubs);
    })
    .catch((err) => {
      logger('error')('Error getting list of clubs:', err.message);
      return res.status(400).send(err.message);
    });
};

const getClubById = (req, res) => {
  logReq(req);
  const { id } = req.params;
  if (!ObjectID.isValid(id)) {
    logger('error')('Error getting club details: invalid club id.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  return Club.findOne({ _id: id, active: true })
    .populate('owner', '_id displayName')
    .select('-active -__v')
    .then((club) => {
      if (!club) {
        logger('error')('Error getting club details: no club found.');
        return res.status(404).send({ error: 'No club found.' });
      }
      logger('success')(`Returned club details for ${club.shortName}.`);
      return res.status(200).send(club);
    })
    .catch((err) => {
      logger('error')('Error getting club details:', err.message);
      return res.status(400).send({ error: err.message });
    });
};

const updateClub = (req, res) => {
  logReq(req);
  const { id } = req.params;
  const requestorRole = req.user.role;
  const requestorId = req.user._id.toString();
  if (requestorRole === 'guest') {
    logger('error')('Error: Guest accounts are not allowed to edit club details.');
    return res.status(401).send({ error: 'Guest accounts are not allowed to edit club details.' });
  }
  if (!ObjectID.isValid(id)) {
    logger('error')('Error updating club: invalid club id.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  // now need to check database to identify owner
  return Club.findById(id).then((clubToUpdate) => {
    if (!clubToUpdate) {
      logger('error')('Error updating club: no matching club found.');
      return res.status(404).send({ error: 'Club could not be found.' });
    }
    const allowedToUpdate = ((requestorRole === 'admin')
      || (requestorRole === 'standard' && requestorId === clubToUpdate.owner.toString()));
    // console.log('allowedToUpdate', allowedToUpdate);
    if (allowedToUpdate) {
      const fieldsToUpdate = { };
      const validFields = [ // owner can only be set by admin, orisId is always auto-populated
        'shortName',
        'fullName',
        'country',
        'website',
      ];
      Object.keys(req.body).forEach((key) => {
        if (validFields.includes(key)) {
          if (req.body[key] !== clubToUpdate[key]) {
            fieldsToUpdate[key] = req.body[key];
          }
        }
      });
      // only admin users can change a club's owner, need to check that ID is really a user
      const checkOwnerId = (req.body.owner && requestorRole === 'admin')
        ? validateUserId(req.body.owner)
        : Promise.resolve(false);
      return checkOwnerId.then((validId) => {
        if (validId) fieldsToUpdate.owner = req.body.owner;
      }).then(() => {
        const checkOris = (fieldsToUpdate.shortName && (fieldsToUpdate.country === 'CZE' || clubToUpdate.country === 'CZE') && fieldsToUpdate.shortName.match(/[A-Z]{3}/))
          ? getOrisClubData(fieldsToUpdate.shortName)
          : Promise.resolve(false);
        return checkOris.then((orisData) => {
          if (orisData) {
            logger('info')(`Retrieved ORIS data for ${orisData.Abbr}.`);
            // console.log('orisClubData:', orisData);
            fieldsToUpdate.orisId = orisData.ID; // only available through API
            if (!fieldsToUpdate.fullName || fieldsToUpdate.fullName === '') {
              fieldsToUpdate.fullName = orisData.Name; // use ORIS if not provided
            }
            if (!fieldsToUpdate.website || fieldsToUpdate.website === '') {
              fieldsToUpdate.website = orisData.WWW; // use ORIS if not provided
            }
          } else {
            // console.log('Nothing retrieved from ORIS.');
          }
        }).then(() => {
          // console.log('fieldsToUpdate:', fieldsToUpdate);
          const numberOfFieldsToUpdate = Object.keys(fieldsToUpdate).length;
          // console.log('fields to be updated:', numberOfFieldsToUpdate);
          if (numberOfFieldsToUpdate === 0) {
            logger('error')('Update club error: no valid fields to update.');
            return res.status(400).send({ error: 'No valid fields to update.' });
          }
          return Club.findByIdAndUpdate(id, { $set: fieldsToUpdate }, { new: true })
            .populate('owner', '_id displayName')
            .select('-active -__v')
            .then((updatedClub) => {
              logger('success')(`${updatedClub.shortName} updated by ${req.user.email} (${numberOfFieldsToUpdate} field(s)).`);
              return res.status(200).send(updatedClub);
            })
            .catch((err) => {
              if (err.message.slice(0, 6) === 'E11000') {
                const duplicate = err.message.split('"')[1];
                logger('error')(`Error updating club: duplicate value ${duplicate}.`);
                return res.status(400).send({ error: `${duplicate} is already in use.` });
              }
              logger('error')('Error updating user:', err.message);
              return res.status(400).send({ error: err.message });
            });
        });
      });
    }
    logger('error')(`Error: ${req.user.email} not allowed to update ${id}.`);
    return res.status(401).send({ error: 'Not allowed to update this club.' });
  });
};

const deleteClub = (req, res) => {
  logReq(req);
  const { id } = req.params;
  const requestorRole = req.user.role;
  const requestorId = req.user._id.toString();
  if (!ObjectID.isValid(id)) {
    logger('error')('Error deleting club: invalid club id.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  return Club.findById(id).then((clubToDelete) => {
    if (!clubToDelete) {
      logger('error')('Error deleting club: no matching club found.');
      return res.status(404).send({ error: 'Club could not be found.' });
    }
    const allowedToDelete = ((requestorRole === 'admin')
    || (requestorRole === 'standard' && requestorId === clubToDelete.owner.toString()));
    // console.log('allowedToDelete', allowedToDelete, clubToDelete.shortName);
    if (allowedToDelete) {
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
        { new: true })
        .then((deletedClub) => {
          // now remove all references from User.memberOf
          User.updateMany({ memberOf: mongoose.Types.ObjectId(id) },
            { $pull: { memberOf: mongoose.Types.ObjectId(id) } })
            .then(() => {
              // now remove all references from Event.organisedBy
              Event.updateMany({ organisedBy: mongoose.Types.ObjectId(id) },
                { $pull: { organisedBy: mongoose.Types.ObjectId(id) } })
                .then(() => {
                  logger('success')(`Successfully deleted club ${deletedClub._id} (${deletedClub.shortName})`);
                  return res.status(200).send(deletedClub);
                });
            });
        })
        .catch((err) => {
          logger('error')('Error deleting club:', err.message);
          return res.status(400).send({ error: err.message });
        });
    }
    logger('error')(`Error: ${req.user.email} not allowed to delete ${id}.`);
    return res.status(401).send({ error: 'Not allowed to delete this club.' });
  });
};

module.exports = {
  createClub,
  getClubList,
  getClubById,
  updateClub,
  deleteClub,
  getOrisClubData, // used in events controller rather than router
};
