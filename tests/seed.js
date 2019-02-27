// seed data for test database
const { ObjectID } = require('mongodb');
const User = require('../models/user');
// const { Profile } = require('../models/profile');
// const { Club } = require('../models/club');
// const { OEvent } = require('../models/oevent');
// const { LinkedEvent } = require('../models/linkedEvent');

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

module.exports = {
  initUsers,
  // initClubs,
  // initProfiles,
  // initOEvents,
  // initLinkedEvents,
  populateUsers, //     independent
  // populateClubs, //     requires user_id
  // populateProfiles, //  requires user_id, links to club_id
  // populateOEvents, //   requires user_id, links to club_id
  // populateLinkedEvents, // interdependent links to oevent_id and from oevent.linkedTo
};


// copy from todo for reference - NOT USASBLE

// const jwt = require('jsonwebtoken');
// const { ToDo } = require('../models/ToDo');
// const { User } = require('../models/User');
//
//
// const userOneId = new ObjectID();
// const userTwoId = new ObjectID();
// const initUsers = [{
//   _id: userOneId,
//   email: 'mark@example.com',
//   password: 'userOnePass',
//   tokens: [{
//     access: 'auth',
//     token: jwt.sign({ _id: userOneId, access: 'auth' }, process.env.JWT_SECRET).toString(),
//   }],
// }, {
//   _id: userTwoId,
//   email: 'mark@test.com',
//   password: 'userTwoPass',
//   tokens: [{
//     access: 'auth',
//     token: jwt.sign({ _id: userTwoId, access: 'auth' }, process.env.JWT_SECRET).toString(),
//   }],
// }];
//
// const initTodos = [{
//   _id: new ObjectID(),
//   text: 'first test ToDo',
//   completed: false,
//   _creator: userOneId,
// }, {
//   _id: new ObjectID(),
//   text: 'second test ToDo',
//   completed: true,
//   completedAt: 1550610537505,
//   _creator: userTwoId,
// }];
//
// const populateTodos = (done) => {
//   ToDo.deleteMany({})
//     .then(() => ToDo.insertMany(initTodos))
//     .then(() => done());
// };
//
// const populateUsers = (done) => {
//   User.deleteMany({})
//     .then(() => {
//       const userOne = new User(initUsers[0]).save();
//       const userTwo = new User(initUsers[1]).save();
//       return Promise.all([userOne, userTwo]);
//     })
//     .then(() => done());
// };
//
// module.exports = {
//   initTodos,
//   initUsers,
//   populateTodos,
//   populateUsers,
// };
