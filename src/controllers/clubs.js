const { ObjectID } = require('mongodb');

const logger = require('../services/logger');
const logReq = require('./logReq');
const { recordActivity } = require('../services/activity');
const { validateUserId } = require('../services/validateIds');
const {
  createClubRecord,
  deleteClubById,
  getClubById,
  getClubRecords,
  getOrisClubData,
  updateClubById,
} = require('../services/clubServices');

// *** /clubs routes ***  [Club model]

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
    createClubRecord(fieldsToCreate).then((createdClub) => {
      logger('success')(`${createdClub.shortName} created by ${req.user.email}.`);
      recordActivity({
        actionType: 'CLUB_CREATED',
        actionBy: creatorId,
        club: createdClub._id,
      });
      return res.status(200).send(createdClub);
    }).catch((err) => {
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
  getClubRecords(clubSearchCriteria).then((clubs) => {
    logger('success')(`Returned list of ${clubs.length} club(s).`);
    return res.status(200).send(clubs);
  }).catch((err) => {
    logger('error')('Error getting list of clubs:', err.message);
    return res.status(400).send(err.message);
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
  return getClubById(id).then((clubToUpdate) => {
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
            fieldsToUpdate.orisId = orisData.ID; // only available through API
            if (!fieldsToUpdate.fullName || fieldsToUpdate.fullName === '') {
              fieldsToUpdate.fullName = orisData.Name; // use ORIS if not provided
            }
            if (!fieldsToUpdate.website || fieldsToUpdate.website === '') {
              fieldsToUpdate.website = orisData.WWW; // use ORIS if not provided
            }
          } else {
            logger('info')(`No ORIS data found for ${fieldsToUpdate.shortName}.`);
          }
        }).then(() => {
          const numberOfFieldsToUpdate = Object.keys(fieldsToUpdate).length;
          if (numberOfFieldsToUpdate === 0) {
            logger('error')('Update club error: no valid fields to update.');
            return res.status(400).send({ error: 'No valid fields to update.' });
          }
          return updateClubById(id, fieldsToUpdate).then((updatedClub) => {
            logger('success')(`${updatedClub.shortName} updated by ${req.user.email} (${numberOfFieldsToUpdate} field(s)).`);
            recordActivity({
              actionType: 'CLUB_UPDATED',
              actionBy: req.user._id,
              club: id,
            });
            return res.status(200).send(updatedClub);
          }).catch((err) => {
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
  return getClubById(id).then((clubToDelete) => {
    if (!clubToDelete) {
      logger('error')('Error deleting club: no matching club found.');
      return res.status(404).send({ error: 'Club could not be found.' });
    }
    const allowedToDelete = ((requestorRole === 'admin')
    || (requestorRole === 'standard' && requestorId === clubToDelete.owner.toString()));
    if (allowedToDelete) {
      deleteClubById(id).then((deletedClub) => {
        logger('success')(`Successfully deleted club ${deletedClub._id} (${deletedClub.shortName})`);
        recordActivity({
          actionType: 'CLUB_DELETED',
          actionBy: req.user._id,
          club: id,
        });
        return res.status(200).send(deletedClub);
      }).catch((err) => {
        logger('error')('Error deleting club:', err.message);
        return res.status(400).send({ error: err.message });
      });
    } else {
      logger('error')(`Error: ${req.user.email} not allowed to delete ${id}.`);
      return res.status(401).send({ error: 'Not allowed to delete this club.' });
    }
  });
};

module.exports = {
  createClub,
  getClubList,
  updateClub,
  deleteClub,
};
