// seed data for test database
const { ObjectID } = require('mongodb');
const User = require('../models/user');
const Club = require('../models/club');
// const OEvent = require('../models/oevent');
// const LinkedEvent = require('../models/linkedEvent');

const userOneId = new ObjectID();
const userTwoId = new ObjectID();
const initUsers = [{
  _id: userOneId,
  email: 'mark@example.com',
  password: 'userOnePassword',
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
  profileImage: '/uploads/user/user_id/profile.jpg',
}, {
  _id: userTwoId,
  email: 'mark@test.com',
  password: 'userTwoPass',
  displayName: 'Mark@Test',
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

const mapUsersToClubs = (done) => {
  User.findByIdAndUpdate(userOneId, { memberOf: [clubOneId, clubTwoId] }, { new: true })
    .then(() => done());
};

module.exports = {
  initUsers,
  initClubs,
  // initOEvents,
  // initLinkedEvents,
  populateUsers, //           independent
  populateClubs, //           requires user_id
  mapUsersToClubs, //         links to user_id, club_id
  // populateOEvents, //      requires user_id, links to club_id
  // populateLinkedEvents, // interdependent links to oevent_id and from oevent.linkedTo
};
