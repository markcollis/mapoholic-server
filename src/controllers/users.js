const chalk = require('chalk');
// const querystring = require('querystring');
const User = require('../models/user');
const Club = require('../models/club');

// log content of request to aid development - remove/comment out in production
const logReq = (req) => {
  console.log(chalk.inverse(req.method, req.url, req.route));
  console.log(chalk.blue('req.body:', JSON.stringify(req.body)));
  console.log(chalk.blue('req.params:', JSON.stringify(req.params)));
  console.log(chalk.blue('req.query:', JSON.stringify(req.query)));
  console.log(chalk.blue('req.user:', JSON.stringify(req.user)));
};

// retrieve and format matching user list data
const findAndReturnUserList = (userSearchCriteria) => {
  console.log('userSearchCriteria:', userSearchCriteria);
  return User.find(userSearchCriteria)
    .populate('memberOf', 'shortName')
    .select('-password')
    .then((profiles) => {
      // console.log('profiles:', profiles);
      // reformat into short summary of key data
      return profiles.map((profile) => {
        const clubList = (profile.memberOf.length > 0)
          ? profile.memberOf.map(club => club.shortName)
          : [];
        return {
          user_id: profile.user._id,
          displayName: profile.displayName,
          fullName: profile.fullName || '',
          email: profile.contact.email || '',
          memberOf: clubList,
          profileImage: profile.profileImage || '',
          role: profile.user.role,
        };
      });
    });
};

// retrieve a list of all users (ids) matching specified criteria
const getUserList = (req, res) => {
  logReq(req);
  const requestorClubs = req.user.memberOf.map(club => club._id.toString());
  console.log('requestorClubs', requestorClubs);
  const userSearchCriteria = {};
  const validFilters = ['displayName', 'fullName', 'location', 'about', 'contact', 'memberOf'];
  Object.keys(req.query).forEach((key) => {
    console.log('filtering on', key, req.query[key]);
    if (validFilters.includes(key)) {
      userSearchCriteria[key] = { $regex: new RegExp(req.query[key]) };
    }
  });
  // define criteria based on permissions (what about query string parameters?)
  if (req.user.role === 'anonymous') {
    userSearchCriteria.visibility = 'public';
  }
  if (req.user.role === 'guest' || req.user.role === 'standard') {
    userSearchCriteria.$or = [
      { visibility: ['public', 'all'] },
      { user: req.user._id },
    ];
  }
  if (req.user.role === 'standard' && requestorClubs.length > 0) {
    requestorClubs.forEach((club) => {
      userSearchCriteria.$or.push({ visibility: ['club'], memberOf: [club] });
    });
  }
  findAndReturnUserList(userSearchCriteria).then((userList) => {
    if (userList.error) return res.status(400).send(userList.error.message);
    return res.status(200).send(userList);
  }, (err) => {
    res.status(400).send(err.message);
  });
};

// helper method for the two retrieve full details routes
const findAndReturnUserDetails = requestingUser => (userId) => {
  const requestorRole = requestingUser.role;
  const requestorId = requestingUser._id.toString();
  const requestorClubs = requestingUser.memberOf.map(club => club._id.toString());
  console.log('requestor:', requestorRole, requestorId, requestorClubs);
  return User.findOneById(userId)
    .populate('memberOf')
    .select('-password')
    .then((profile) => {
      const { visibility, _id, memberOf } = profile;
      const profileVisibility = visibility;
      const profileUserId = _id.toString();
      const profileClubs = memberOf.map(club => club._id.toString());
      console.log('subject:', profileVisibility, profileUserId, profileClubs);
      // is the requestor allowed to see this user profile or not?
      let allowedToSee = false;
      if (requestorRole === 'admin') allowedToSee = true;
      if (requestorRole === 'anonymous' && visibility === 'public') allowedToSee = true;
      if (requestorRole === 'standard' || requestorRole === 'guest') {
        if (requestorId === profileUserId) allowedToSee = true;
        if (visibility === 'public' || visibility === 'all') allowedToSee = true;
      }
      if (requestorRole !== 'anonymous' && visibility === 'club') {
        console.log('profileClubs', profileClubs);
        console.log('requestorClubs', requestorClubs);
        const commonClubs = profileClubs.filter(club => requestorClubs.includes(club));
        console.log('commonClubs', commonClubs);
        if (commonClubs.length > 0) allowedToSee = true;
        console.log('allowedToSeeClub', allowedToSee);
      }
      console.log('allowedToSee', allowedToSee);
      if (allowedToSee) {
        return { profile };
      }
      return { error: { message: 'Not authorised to view this profile.' } };
    }, (err) => {
      console.log('error:', err);
      return { error: err };
    });
};
// retrieve full details for the currently logged in user
const getLoggedInUser = (req, res) => {
  logReq(req);
  findAndReturnUserDetails(req.user)(req.user._id).then((userDetails) => {
    if (userDetails.error) return res.status(400).send(userDetails.error.message);
    if (!userDetails.profile) return res.status(400).send('User details could not be found.');
    return res.status(200).send(userDetails);
  }).catch(e => res.status(400).send(e.message));
};
// retrieve full details for the specified user
const getUserById = (req, res) => {
  logReq(req);
  findAndReturnUserDetails(req.user)(req.params.id, res).then((userDetails) => {
    if (userDetails.error) return res.status(400).send(userDetails.error.message);
    if (!userDetails.profile) return res.status(400).send('User details could not be found.');
    return res.status(200).send(userDetails);
  }).catch(e => res.status(400).send(e.message));
};

// update the specified user (multiple amendment not supported)
const updateUser = (req, res) => {
  logReq(req);
  res.send({ message: 'PATCH /users/:id is still TBD' });
};
// delete the specified user (multiple deletion not supported)
const deleteUser = (req, res) => {
  logReq(req);
  res.send({ message: 'DELETE /users:id is still TBD' });
};

module.exports = {
  getUserList,
  getLoggedInUser,
  getUserById,
  updateUser,
  deleteUser,
};
