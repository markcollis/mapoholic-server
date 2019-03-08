const { ObjectID } = require('mongodb');
const sharp = require('sharp');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const url = require('url');
const User = require('../models/user');
require('../models/club');
const logger = require('../utils/logger');
const logReq = require('./logReq');

// retrieve and format matching user list data
const findAndReturnUserList = (userSearchCriteria) => {
  // console.log('userSearchCriteria:', JSON.stringify(userSearchCriteria));
  return User.find(userSearchCriteria)
    .populate('memberOf', 'shortName')
    .select('-password')
    .then((profiles) => {
      if (profiles.length === 0) return [];
      // reformat into short summary of key data
      return profiles.map((profile) => {
        const clubList = (profile.memberOf.length > 0)
          ? profile.memberOf.map(club => club.shortName)
          : [];
        return {
          user_id: profile._id,
          displayName: profile.displayName,
          fullName: profile.fullName || '',
          email: profile.contact.email || '',
          memberOf: clubList,
          profileImage: profile.profileImage || '',
          role: profile.role,
        };
      });
    });
};

// retrieve a list of all users (ids) matching specified criteria
const getUserList = (req, res) => {
  logReq(req);
  const userSearchCriteria = { active: true };
  // support basic filtering using query strings (consider e.g. mongoose-string-query later?)
  const validFilters = ['displayName', 'fullName', 'regNumber', 'location', 'about', 'contact.email', 'memberOf'];
  Object.keys(req.query).forEach((key) => {
    // console.log('filtering on', key, req.query[key]);
    if (validFilters.includes(key)) {
      if (key === 'memberOf') {
        // needs custom treatment to avoid ObjectID cast error/return empty array if no such club
        if (ObjectID.isValid(req.query.memberOf)) {
          userSearchCriteria.memberOf = req.query.memberOf;
        } else {
          userSearchCriteria.memberOf = null;
        }
      } else {
        userSearchCriteria[key] = { $regex: new RegExp(req.query[key]) };
      }
    }
  });
  // anonymous users can only see public profiles
  if (req.user.role === 'anonymous') {
    userSearchCriteria.visibility = 'public';
  }
  // non-admin users can only see profiles with matching visibility limitations
  if (req.user.role === 'guest' || req.user.role === 'standard') {
    userSearchCriteria.$or = [
      { visibility: ['public', 'all'] },
      { user: req.user._id },
    ];
    const requestorClubs = req.user.memberOf.map(club => club._id.toString());
    // console.log('requestorClubs', requestorClubs);
    if (requestorClubs.length > 0) {
      requestorClubs.forEach((club) => {
        userSearchCriteria.$or.push({ visibility: 'club', memberOf: club });
      });
    }
  }
  findAndReturnUserList(userSearchCriteria).then((userList) => {
    logger('success')(`Returned list of ${userList.length} user(s).`);
    return res.status(200).send(userList);
  }, (err) => {
    logger('error')('Error getting list of users:', err.message);
    return res.status(400).send(err.message);
  });
};

// helper method for the two retrieve full details routes
const findAndReturnUserDetails = requestingUser => (userId) => {
  const requestorRole = requestingUser.role;
  const requestorId = (requestorRole === 'anonymous')
    ? null
    : requestingUser._id.toString();
  const requestorClubs = (requestorRole === 'anonymous')
    ? null
    : requestingUser.memberOf.map(club => club._id.toString());
  // console.log('requestor:', requestorRole, requestorId, requestorClubs);
  // return User.findById(userId)
  return User.findOne({ _id: userId, active: true })
    .populate('memberOf')
    .select('-password -active')
    .then((profile) => {
      if (!profile) return { searchError: true };
      const { visibility, _id, memberOf } = profile;
      const profileUserId = _id.toString();
      const profileClubs = memberOf.map(club => club._id.toString());
      // console.log('target:', visibility, profileUserId, profileClubs);
      // is the requestor allowed to see this user profile or not?
      let allowedToSee = false;
      if (requestorRole === 'admin') allowedToSee = true;
      if (requestorRole === 'anonymous' && visibility === 'public') allowedToSee = true;
      if (requestorRole === 'standard' || requestorRole === 'guest') {
        if (requestorId === profileUserId) allowedToSee = true;
        if (visibility === 'public' || visibility === 'all') allowedToSee = true;
      }
      if (requestorRole !== 'anonymous' && visibility === 'club') {
        // console.log('profileClubs', profileClubs);
        // console.log('requestorClubs', requestorClubs);
        const commonClubs = profileClubs.filter(club => requestorClubs.includes(club));
        // console.log('commonClubs', commonClubs);
        if (commonClubs.length > 0) allowedToSee = true;
        // console.log('allowedToSeeClub', allowedToSee);
      }
      // console.log(' -> allowedToSee:', allowedToSee);
      if (allowedToSee) {
        return profile;
      }
      return { authError: true };
    });
};
// retrieve full details for the currently logged in user
const getLoggedInUser = (req, res) => {
  logReq(req);
  findAndReturnUserDetails(req.user)(req.user._id).then((userDetails) => {
    if (userDetails.authError) {
      logger('error')(`Error: ${req.user.email} is not authorised to view their own details!`);
      return res.status(401).send({ error: 'Not authorised to view user details.' });
    }
    if (userDetails.searchError || !userDetails._id) {
      logger('error')('Error fetching own user details: no matching user found');
      return res.status(404).send({ error: 'User details could not be found.' });
    }
    logger('success')(`Returned user details for ${userDetails.email}.`);
    return res.status(200).send(userDetails);
  })
    .catch((err) => {
      logger('error')('Error getting own user details:', err.message);
      return res.status(400).send({ error: err.message });
    });
};
// retrieve full details for the specified user
const getUserById = (req, res) => {
  logReq(req);
  findAndReturnUserDetails(req.user)(req.params.id).then((userDetails) => {
    if (userDetails.authError) {
      logger('error')(`Error: ${req.user.email} is not authorised to view ${req.params.id}`);
      return res.status(401).send({ error: 'Not authorised to view user details.' });
    }
    if (!userDetails._id) {
      logger('error')('Error fetching user details: no matching user found');
      return res.status(404).send({ error: 'User details could not be found.' });
    }
    logger('success')(`Returned user details for ${userDetails.email} to ${req.user.email}.`);
    return res.status(200).send(userDetails);
  })
    .catch((err) => {
      logger('error')('Error getting user details:', err.message);
      return res.status(400).send({ error: err.message });
    });
};

// helper function to get ORIS user id - returns a Promise
const getOrisId = (regNumber) => {
  const ORIS_API_GETUSER = 'https://oris.orientacnisporty.cz/API/?format=json&method=getUser';
  return fetch(`${ORIS_API_GETUSER}&rgnum=${regNumber}`)
    .then(response => response.json())
    .then((json) => {
      // console.log('Response from ORIS:', json);
      return json.Data.ID;
    })
    .catch((orisErr) => {
      logger('error')(`ORIS API error: ${orisErr.message}. Rest of update may proceed.`);
      // don't send an HTTP error response, the rest of the update may be fine
    });
};

// update the specified user (multiple amendment not supported)
const updateUser = (req, res) => {
  logReq(req);
  const { id } = req.params;
  const requestorRole = req.user.role;
  const requestorId = req.user._id.toString();
  if (!ObjectID.isValid(id)) {
    logger('error')('Error updating user: invalid user id.');
    return res.status(404).send({ error: 'Invalid ID.' });
  }
  const fieldsToUpdate = {};
  const validFields = [ // password needs a separate hook in authentication
    'email',
    'visibility',
    'displayName',
    'fullName',
    'regNumber',
    'location',
    'about',
    'contact',
    'memberOf',
    'profileImage', // path to uploaded image will need to be set in middleware
  ];
  Object.keys(req.body).forEach((key) => {
    // console.log('filtering on', key, req.query[key]);
    if (validFields.includes(key)) {
      fieldsToUpdate[key] = req.body[key];
    }
    // standard and guest users can't make themselves admin!
    if (key === 'role' && requestorRole === 'admin') {
      fieldsToUpdate.role = req.body.role;
    }
  });
  // custom check on regNumber if it appears to be a valid Czech code
  // (Czech clubs with three letter codes only)
  // console.log('regNumber:', req.body.regNumber);
  const checkOris = (req.body.regNumber && req.body.regNumber.match(/[A-Z]{3}[0-9]{4}/))
    ? getOrisId(req.body.regNumber)
    : Promise.resolve(false);
  return checkOris.then((orisId) => {
    if (orisId) {
      logger('info')(`Setting ORIS id for ${id} to ${orisId}.`);
      // console.log('orisId to update', orisId);
      fieldsToUpdate.orisId = orisId;
    } else {
      // console.log('nothing to update');
    }
  }).then(() => {
    const numberOfFieldsToUpdate = Object.keys(fieldsToUpdate).length;
    // console.log('fields to be updated:', numberOfFieldsToUpdate);
    if (numberOfFieldsToUpdate === 0) {
      logger('error')('Update user error: no valid fields to update.');
      return res.status(400).send({ error: 'No valid fields to update.' });
    }
    // console.log('fieldsToUpdate:', fieldsToUpdate);
    const allowedToUpdate = ((requestorRole === 'admin')
      || (requestorRole === 'standard' && requestorId === id));
    // console.log('allowedToUpdate', allowedToUpdate);
    if (allowedToUpdate) {
      return User.findByIdAndUpdate(id, { $set: fieldsToUpdate }, { new: true })
        .select('-password')
        .then((updatedUser) => {
          // console.log('updatedUser', updatedUser);
          logger('success')(`${updatedUser.email} updated by ${req.user.email} (${numberOfFieldsToUpdate} field(s)).`);
          return res.status(200).send(updatedUser);
        })
        .catch((err) => {
          if (err.message.slice(0, 6) === 'E11000') {
            const duplicate = err.message.split('"')[1];
            logger('error')(`Error updating user: duplicate value ${duplicate}.`);
            return res.status(400).send({ error: `${duplicate} is already in use.` });
          }
          logger('error')('Error updating user:', err.message);
          return res.status(400).send({ error: err.message });
        });
    }
    logger('error')(`Error: ${req.user.email} not allowed to update ${id}.`);
    return res.status(401).send({ error: 'Not allowed to update this user.' });
  });
};

// delete the specified user (multiple deletion not supported)
const deleteUser = (req, res) => {
  logReq(req);
  const { id } = req.params;
  const requestorRole = req.user.role;
  const requestorId = req.user._id.toString();
  if (!ObjectID.isValid(id)) {
    logger('error')('Error deleting user: invalid user id.');
    return res.status(404).send({ error: 'Invalid ID.' });
  }
  const allowedToDelete = ((requestorRole === 'admin')
    || (requestorRole === 'standard' && requestorId === id));
  // console.log('allowedToDelete', allowedToDelete);
  if (allowedToDelete) {
    return User.findById(id).then((userToDelete) => {
      if (!userToDelete) {
        logger('error')('Error deleting user: no matching user found.');
        return res.status(404).send({ error: 'User could not be found.' });
      }
      const now = new Date();
      const deletedAt = 'deleted:'.concat((`0${now.getDate()}`).slice(-2))
        .concat((`0${(now.getMonth() + 1)}`).slice(-2))
        .concat(now.getFullYear().toString())
        .concat('@')
        .concat((`0${now.getHours()}`).slice(-2))
        .concat((`0${now.getMinutes()}`).slice(-2));
      const newEmail = `${userToDelete.email} ${deletedAt}`;
      const newDisplayName = `${userToDelete.displayName} ${deletedAt}`;
      return User.findByIdAndUpdate(id,
        { $set: { active: false, email: newEmail, displayName: newDisplayName } },
        { new: true })
        .select('-password')
        .then((deletedUser) => {
          // console.log('deletedUser', deletedUser);
          logger('success')(`Successfully deleted user ${deletedUser._id} (${deletedUser.email})`);
          return res.status(200).send(deletedUser);
        })
        .catch((err) => {
          logger('error')('Error deleting user:', err.message);
          return res.status(400).send({ error: err.message });
        });
    });
  }
  logger('error')(`Error: ${req.user.email} not allowed to delete ${id}.`);
  return res.status(401).send({ error: 'Not allowed to delete this user.' });
};

const validateProfileImagePermission = (req, res, next) => {
  const allowedToPostProfileImage = ((req.user.role === 'admin')
  || (req.user.role === 'standard' && req.user._id.toString() === req.params.id.toString()));
  // console.log('allowed?', allowedToPostProfileImage);
  if (!allowedToPostProfileImage) {
    logger('error')(`Error: ${req.user.email} not allowed to upload profile image for ${req.params.id}.`);
    return res.status(401).send({ error: 'Not allowed to upload profile image for this user.' });
    // next(new Error('No file uploaded.'));
  }
  return next();
};

const postProfileImage = (req, res) => {
  logReq(req);
  if (!req.file) {
    logger('error')('Error: postProfileImage request without image attached.');
    return res.status(400).send({ error: 'No profile image file attached.' });
  }
  const newFileLocation = path.join('images', 'avatars', req.file.path.split('/').pop());
  // alt - simple move from upload to avatars
  // return fs.rename(req.file.path, newFileLocation, (renameErr) => {
  //   if (renameErr) throw renameErr;
  return sharp(req.file.path).resize(200, 200).toFile(newFileLocation, (err) => {
    if (err) throw err;
    const profileImageUrl = url.format({
      protocol: req.protocol,
      host: req.get('host'),
      pathname: newFileLocation,
    });
    return User.findByIdAndUpdate(req.params.id,
      { $set: { profileImage: profileImageUrl } },
      { new: true })
      .select('-password')
      .then((updatedUser) => {
        // console.log('updatedUser', updatedUser);
        logger('success')(`Profile image added to ${updatedUser.email} by ${req.user.email}.`);
        return res.status(200).send({ profileImageUrl });
      }).catch((saveUrlErr) => {
        logger('error')('Error recording new profile image URL:', saveUrlErr.message);
        return res.status(400).send({ error: saveUrlErr.message });
      });
  });
};

const deleteProfileImage = (req, res) => {
  logReq(req);
  const allowedToDeleteProfileImage = ((req.user.role === 'admin')
  || (req.user.role === 'standard' && req.user._id.toString() === req.params.id.toString()));
  // console.log('allowed?', allowedToDeleteProfileImage);
  if (!allowedToDeleteProfileImage) {
    logger('error')(`Error: ${req.user.email} not allowed to delete profile image for ${req.params.id}.`);
    return res.status(401).send({ error: 'Not allowed to delete profile image for this user.' });
  }
  // fs.readdir('images/avatars', (err, files) => {
  //   if (err) throw err;
  //   console.log('listing files before delete:');
  //   files.forEach(file => console.log(file));
  // });
  // delete the reference to it in the user document
  return User.findByIdAndUpdate(req.params.id, { $set: { profileImage: '' } }, { new: false })
    .select('profileImage email')
    .then((deletedUser) => {
      // then delete the file
      if (!deletedUser.profileImage) {
        logger('error')(`Error: ${deletedUser.email} does not have a profile image.`);
        return res.status(404).send({ error: `Error: ${deletedUser.email} does not have a profile image.` });
      }
      // console.log('deletedUser', deletedUser);
      const fileToDelete = path.join('images', 'avatars', deletedUser.profileImage.split('/').pop());
      // console.log('fileToDelete', fileToDelete);
      return fs.unlink(fileToDelete, (err) => {
        if (err) throw err;
        // fs.readdir('images/avatars', (err2, files) => {
        //   if (err2) throw err2;
        //   console.log('listing files after delete:');
        //   files.forEach(file => console.log(file));
        // });
        logger('success')(`Profile image deleted from ${deletedUser.email} by ${req.user.email}.`);
        return res.status(200).send({ status: `Profile image deleted from ${deletedUser.email} by ${req.user.email}.` });
      });
    })
    .catch((err) => {
      logger('error')('Error deleting profile image:', err.message);
      return res.status(400).send({ error: err.message });
    });
};

module.exports = {
  getUserList,
  getLoggedInUser,
  getUserById,
  updateUser,
  deleteUser,
  validateProfileImagePermission,
  postProfileImage,
  deleteProfileImage,
};
