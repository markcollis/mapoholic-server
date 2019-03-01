// seed data for test database
const { ObjectID } = require('mongodb');
const User = require('../models/user');
const Club = require('../models/club');
const Profile = require('../models/profile');
// const OEvent = require('../models/oevent');
// const LinkedEvent = require('../models/linkedEvent');

const userOneId = new ObjectID();
const userTwoId = new ObjectID();
const initUsers = [{
  _id: userOneId,
  email: 'mark@example.com',
  password: 'userOnePassword',
}, {
  _id: userTwoId,
  email: 'mark@test.com',
  password: 'userTwoPass',
}];

const populateUsers = (done) => {
  User.deleteMany({})
    .then(() => {
      const userOne = new User(initUsers[0]).save();
      const userTwo = new User(initUsers[1]).save();
      return Promise.all([userOne, userTwo]);
    })
    .then(() => done());
};

const clubOneId = new ObjectID();
const clubTwoId = new ObjectID();
const initClubs = [{
  _id: clubOneId,
  owner: userOneId,
  shortName: 'TEST',
  fullName: 'Test Orienteering Club',
  country: 'CZE',
  website: 'http://www.testo.com',
}, {
  _id: clubTwoId,
  owner: userTwoId,
  shortName: 'CLUB',
}];

const populateClubs = (done) => {
  Club.deleteMany({})
    .then(() => {
      const clubOne = new Club(initClubs[0]).save();
      const clubTwo = new Club(initClubs[1]).save();
      return Promise.all([clubOne, clubTwo]);
    })
    .then(() => done());
};

const profileOneId = new ObjectID();
const profileTwoId = new ObjectID();
const initProfiles = [{
  _id: profileOneId,
  user: userOneId,
  visibility: 'club',
  displayName: 'User1',
  fullName: 'User One',
  location: 'in a forest somewhere',
  about: 'If I wanted to, I could tell you all sorts of interesting things about me...',
  contact: { // can flesh out with others if desired later
    email: 'i@have.more.than.one',
    // not necessarily the same as the ACCOUNT email, UI needs to be clear on this
    facebook: 'userOneFB',
  },
  memberOf: [clubOneId, clubTwoId],
  profileImage: '/uploads/user/user_id/profile.jpg',
}, {
  _id: profileTwoId,
  user: userTwoId,
  displayName: initUsers[1].email,
}];

const populateProfiles = (done) => {
  Profile.deleteMany({})
    .then(() => {
      const profileOne = new Profile(initProfiles[0]).save();
      const profileTwo = new Profile(initProfiles[1]).save();
      return Promise.all([profileOne, profileTwo]);
    })
    .then(() => done());
};

module.exports = {
  initUsers,
  initClubs,
  initProfiles,
  // initOEvents,
  // initLinkedEvents,
  populateUsers, //     independent
  populateClubs, //     requires user_id
  populateProfiles, //  requires user_id, links to club_id
  // populateOEvents, //   requires user_id, links to club_id
  // populateLinkedEvents, // interdependent links to oevent_id and from oevent.linkedTo
};
