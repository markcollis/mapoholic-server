// const User = require('../models/user');
const Profile = require('../models/profile');
// const OEvent = require('../models/oevent');

const canViewProfile = (userPermissions, profileId) => {
  const { id, role, clubs } = userPermissions;
  console.log('id, role, clubs:', id, role, clubs);
  return Profile.findOne({ _id: profileId }).then((profile) => {
    const { user, visibility, memberOf } = profile;
    console.log('user, visibility, memberOf', user, visibility, memberOf);
    if (role === 'admin') return true;
    if (role === 'anonymous' && visibility === 'public') return true;
    // default if no conditions match
    return false;
  });
};

module.exports = {
  canViewProfile,
};
