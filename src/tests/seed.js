// seed data for test database
const { ObjectID } = require('mongodb');
const jwt = require('jwt-simple');
const User = require('../models/user');
const Club = require('../models/club');
// const OEvent = require('../models/oevent');
// const LinkedEvent = require('../models/linkedEvent');

// generate ObjectIDs up front so they can be used for cross-referencing when required
const userOneId = new ObjectID();
const userTwoId = new ObjectID();
const userThreeId = new ObjectID();
const userFourId = new ObjectID();
const clubOneId = new ObjectID();
const clubTwoId = new ObjectID();

// generate bearer tokens to use in test requests
const timestamp = new Date().getTime();
const initUserTokens = [
  jwt.encode({ sub: userOneId, iat: timestamp }, process.env.JWT_SECRET),
  jwt.encode({ sub: userTwoId, iat: timestamp }, process.env.JWT_SECRET),
  jwt.encode({ sub: userThreeId, iat: timestamp }, process.env.JWT_SECRET),
  jwt.encode({ sub: userFourId, iat: timestamp }, process.env.JWT_SECRET),
];

// need enough users to test all combinations of role/visibility
const initUsers = [{
  _id: userOneId,
  email: 'mark@example.com',
  password: 'userOnePassword',
  visibility: 'club',
  role: 'admin',
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
  _id: userTwoId,
  email: 'mark@test.com',
  password: 'userTwoPass',
  displayName: 'Mark@Test',
  visibility: 'private',
}, {
  _id: userThreeId,
  email: 'mark@guest.com',
  password: 'userThreePass',
  displayName: 'Mark@Guest',
  visibility: 'public',
  role: 'guest',
}, {
  _id: userFourId,
  email: 'mark@clubmember.com',
  password: 'userFourPass',
  displayName: 'Mark@Club',
  visibility: 'all',
  memberOf: [clubOneId],
}];
const populateUsers = (done) => {
  User.deleteMany({})
    .then(() => {
      const userOne = new User(initUsers[0]).save();
      const userTwo = new User(initUsers[1]).save();
      const userThree = new User(initUsers[2]).save();
      const userFour = new User(initUsers[3]).save();
      return Promise.all([userOne, userTwo, userThree, userFour]);
    })
    .then(() => done());
};

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

module.exports = {
  initUsers,
  initUserTokens,
  initClubs,
  // initOEvents,
  // initLinkedEvents,
  populateUsers, //           independent
  populateClubs, //           requires user_id
  // populateOEvents, //      requires user_id, links to club_id
  // populateLinkedEvents, // interdependent links to oevent_id and from oevent.linkedTo
};
