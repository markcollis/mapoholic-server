const { ObjectID } = require('mongodb');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const logger = require('../services/logger');
const logReq = require('./logReq');
const { dbRecordActivity } = require('../services/activityServices');
const { validateClubIds } = require('../services/validateIds');
const { getOrisUserId } = require('../services/orisAPI');
const { prefixImagePath } = require('../services/prefixImagePaths');
const {
  dbDeleteUser,
  dbGetUserById,
  dbGetUsers,
  dbUpdateUser,
} = require('../services/userServices');

// retrieve a list of all users (incl ids) matching specified criteria
const getUserList = (req, res) => {
  logReq(req);
  const userSearchCriteria = { active: true };
  // support basic filtering using query strings (consider e.g. mongoose-string-query later?)
  const validFilters = ['displayName', 'fullName', 'regNumber', 'location', 'about', 'memberOf', 'role'];
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
    if (requestorClubs.length > 0) {
      requestorClubs.forEach((club) => {
        userSearchCriteria.$or.push({ visibility: 'club', memberOf: club });
      });
    }
  }
  dbGetUsers(userSearchCriteria).then((userList) => {
    logger('success')(`Returned list of ${userList.length} user(s).`);
    const userListToReturn = userList.map((user) => {
      return { ...user, profileImage: prefixImagePath(user.profileImage) };
    });
    return res.status(200).send(userListToReturn);
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
  return dbGetUserById(userId)
    .then((profile) => {
      if (!profile) return { searchError: true };
      const { visibility, _id, memberOf } = profile;
      const profileUserId = _id.toString();
      const profileClubs = memberOf.map(club => club._id.toString());
      // is the requestor allowed to see this user profile or not?
      let allowedToSee = false;
      if (requestorRole === 'admin') allowedToSee = true;
      if (visibility === 'public') allowedToSee = true;
      if (requestorRole === 'standard' || requestorRole === 'guest') {
        if (requestorId === profileUserId) allowedToSee = true;
        if (visibility === 'all') allowedToSee = true;
      }
      if (requestorRole !== 'anonymous' && visibility === 'club') {
        const commonClubs = profileClubs.filter(club => requestorClubs.includes(club));
        if (commonClubs.length > 0) allowedToSee = true;
      }
      if (allowedToSee) {
        const profileToReturn = { ...profile, profileImage: prefixImagePath(profile.profileImage) };
        return profileToReturn;
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
    logger('success')(`Returned user details for ${userDetails.email} to ${req.user.email || 'an anonymous user'}.`);
    return res.status(200).send(userDetails);
  })
    .catch((err) => {
      logger('error')('Error getting user details:', err.message);
      return res.status(400).send({ error: err.message });
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
  const validFields = [ // password needs a separate approach in authentication
    'visibility',
    'displayName',
    'fullName',
    'regNumber',
    'location',
    'about',
    'contact',
    'memberOf',
    'email',
  ];
  Object.keys(req.body).forEach((key) => {
    if (validFields.includes(key)) {
      fieldsToUpdate[key] = req.body[key];
    }
    // standard and guest users can't make themselves admin!
    if (key === 'role' && requestorRole === 'admin') {
      fieldsToUpdate.role = req.body.role;
    }
  });
  // memberOf needs special treatment: array of ObjectIDs
  // note that this will REPLACE the existing array not add to it/edit it
  const checkClubIds = (req.body.memberOf && Array.isArray(req.body.memberOf))
    ? validateClubIds(req.body.memberOf)
    : Promise.resolve(false);
  return checkClubIds.then((validIds) => {
    if (validIds) {
      fieldsToUpdate.memberOf = validIds;
    }
  }).then(() => {
    // custom check on regNumber if it appears to be a valid Czech code
    const checkOris = (req.body.regNumber && req.body.regNumber.match(/([A-Z]|[0-9]){2}[A-Z][0-9]{4}/))
      ? getOrisUserId(req.body.regNumber)
      : Promise.resolve(false);
    return checkOris.then((orisId) => {
      if (orisId) {
        logger('info')(`Setting ORIS id for ${id} to ${orisId}.`);
        fieldsToUpdate.orisId = orisId;
      }
    }).then(() => {
      const numberOfFieldsToUpdate = Object.keys(fieldsToUpdate).length;
      if (numberOfFieldsToUpdate === 0) {
        logger('error')('Update user error: no valid fields to update.');
        return res.status(400).send({ error: 'No valid fields to update.' });
      }
      const allowedToUpdate = ((requestorRole === 'admin')
        || (requestorRole === 'standard' && requestorId === id));
      if (allowedToUpdate) {
        return dbUpdateUser(id, fieldsToUpdate).then((updatedUser) => {
          logger('success')(`${updatedUser.email} updated by ${req.user.email} (${numberOfFieldsToUpdate} field(s)).`);
          dbRecordActivity({
            actionType: 'USER_UPDATED',
            actionBy: req.user._id,
            user: id,
          });
          const userToReturn = {
            ...updatedUser,
            profileImage: prefixImagePath(updatedUser.profileImage),
          };
          return res.status(200).send(userToReturn);
        }).catch((err) => {
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
  if (allowedToDelete) {
    return dbDeleteUser(id).then((deletedUser) => {
      logger('success')(`Successfully deleted user ${deletedUser._id} (${deletedUser.email})`);
      dbRecordActivity({
        actionType: 'USER_DELETED',
        actionBy: req.user._id,
        user: req.params.id,
      });
      return res.status(200).send(deletedUser);
    }).catch((err) => {
      logger('error')('Error deleting user:', err.message);
      return res.status(400).send({ error: err.message });
    });
  }
  logger('error')(`Error: ${req.user.email} not allowed to delete ${id}.`);
  return res.status(401).send({ error: 'Not allowed to delete this user.' });
};

const validateProfileImagePermission = (req, res, next) => {
  const allowedToPostProfileImage = ((req.user.role === 'admin')
  || (req.user.role === 'standard' && req.user._id.toString() === req.params.id.toString()));
  if (!allowedToPostProfileImage) {
    logger('error')(`Error: ${req.user.email} not allowed to upload profile image for ${req.params.id}.`);
    return res.status(401).send({ error: 'Not allowed to upload profile image for this user.' });
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
  return fs.unlink(newFileLocation, () => {
    return sharp(req.file.path)
      .resize(200, 200, { fit: 'contain', background: 'white' })
      .toFile(newFileLocation, (err) => {
        sharp.cache(false); // stops really confusing behaviour if changing more than once!
        if (err) {
          logger('error')(`Error saving file to ${newFileLocation}: ${err.message}`);
          return res.status(400).send({ error: 'Error processing profile image.' });
        }
        return dbUpdateUser(req.params.id, { profileImage: newFileLocation })
          .then((updatedUser) => {
            logger('success')(`Profile image added to ${updatedUser.email} by ${req.user.email}.`);
            dbRecordActivity({
              actionType: 'USER_UPDATED',
              actionBy: req.user._id,
              user: req.params.id,
            });
            return res.status(200).send(prefixImagePath(updatedUser.profileImage));
          }).catch((saveUrlErr) => {
            logger('error')('Error recording new profile image URL:', saveUrlErr.message);
            return res.status(400).send({ error: saveUrlErr.message });
          });
      });
  });
};

const deleteProfileImage = (req, res) => {
  logReq(req);
  const allowedToDeleteProfileImage = ((req.user.role === 'admin')
  || (req.user.role === 'standard' && req.user._id.toString() === req.params.id.toString()));
  if (!allowedToDeleteProfileImage) {
    logger('error')(`Error: ${req.user.email} not allowed to delete profile image for ${req.params.id}.`);
    return res.status(401).send({ error: 'Not allowed to delete profile image for this user.' });
  }
  // need to find first to get location of current profileImage
  return dbGetUserById(req.params.id).then((userToUpdate) => {
    if (!userToUpdate.profileImage || userToUpdate.profileImage === '') {
      logger('error')(`Error: ${userToUpdate.email} does not have a profile image.`);
      return res.status(404).send({ error: `Error: ${userToUpdate.email} does not have a profile image.` });
    }
    // delete the reference to the profile image in the user document
    return dbUpdateUser(req.params.id, { profileImage: '' }).then(() => {
      // then delete the file
      const fileToDelete = path.join('images', 'avatars', userToUpdate.profileImage.split('/').pop());
      return fs.unlink(fileToDelete, (err) => {
        if (err) {
          if (err.code === 'ENOENT') {
            logger('warning')(`Can not delete profile image at ${fileToDelete} as it doesn't exist`);
          // It didn't exist so can't be deleted
          } else {
            logger('error')(`Error deleting profile image at ${fileToDelete}: ${err.message}`);
            // log error but continue with deletion from the database,
            // issues with local filesystem will need to be reviewed separately
          }
        }
        logger('success')(`Profile image deleted from ${userToUpdate.email} by ${req.user.email}.`);
        return res.status(200).send({ status: `Profile image deleted from ${userToUpdate.email} by ${req.user.email}.` });
      });
    });
  }).catch((err) => {
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
