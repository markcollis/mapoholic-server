const { ObjectID } = require('mongodb');
const fetch = require('node-fetch');
// const url = require('url');
// const User = require('../models/user');
const Club = require('../models/club');
const logger = require('../utils/logger');
const logReq = require('./logReq');

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
      .then(() => {
        // console.log('newClub', newClub);
        logger('success')(`${newClub.shortName} created by ${req.user.email}.`);
        return res.status(200).send(newClub);
      })
      .catch((err) => {
        if (err.message.slice(0, 6) === 'E11000') {
          const duplicate = err.message.split('"')[1];
          logger('error')(`Error updating user: duplicate value ${duplicate}.`);
          return res.status(400).send({ error: `${duplicate} is already in use.` });
        }
        logger('error')('Error creating club:', err.message);
        return res.status(400).send({ error: err.message });
      });
  });
};

// retrieve a list of all clubs (ids) matching specified criteria
const getClubList = (req, res) => {
  logReq(req);
  res.send({ message: 'GET /clubs is still TBD' });
};

const getClubById = (req, res) => {
  logReq(req);
  res.send({ message: 'GET /clubs/:id is still TBD' });
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
    return res.status(404).send({ error: 'Invalid ID.' });
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
        // only admin users can change a club's owner
        if (key === 'owner' && requestorRole === 'admin' && ObjectID.isValid(req.body.owner)) {
          fieldsToUpdate.owner = req.body.owner;
        }
      });
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
    }
    logger('error')(`Error: ${req.user.email} not allowed to update ${id}.`);
    return res.status(401).send({ error: 'Not allowed to update this club.' });
  });
};

const deleteClub = (req, res) => {
  logReq(req);
  res.send({ message: 'DELETE /clubs/:id is still TBD' });
};

module.exports = {
  createClub,
  getClubList,
  getClubById,
  updateClub,
  deleteClub,
};
