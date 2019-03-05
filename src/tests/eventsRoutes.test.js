const expect = require('expect');
const request = require('supertest');
// const { ObjectID } = require('mongodb');

const { server } = require('../');
const User = require('../models/user');
const Club = require('../models/club');
const OEvent = require('../models/oevent');
const LinkedEvent = require('../models/linkedEvent');

const {
  initUsers,
  deletedUser,
  initUserTokens,
  initClubs,
  // initOEvents,
  // initLinkedEvents,
  // populateUsers, //           independent
  // populateClubs, //           requires user_id
  // populateOEvents, //      requires user_id, links to club_id
  // populateLinkedEvents, // interdependent links to oevent_id and from oevent.linkedTo
} = require('./seed');

// beforeEach(populateUsers);
// beforeEach(populateClubs);
// beforeEach(populateOEvents);
// beforeEach(populateLinkedEvents);

// create an event
describe('POST /events', () => {});
// etc.
