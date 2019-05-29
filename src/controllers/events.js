// split into sub-sections due to excessive length
const {
  deleteComment,
  postComment,
  updateComment,
} = require('./eventsComment');
const {
  createEvent,
  orisCreateEvent,
  orisCreateUserEvents,
  orisGetUserEvents,
  getEventList,
  getEvent,
  updateEvent,
  deleteEvent,
} = require('./eventsEvent');
const {
  createEventLink,
  deleteEventLink,
  getEventLinks,
  updateEventLink,
} = require('./eventsEventLink');
const {
  addEventRunner,
  deleteEventRunner,
  orisAddEventRunner,
  updateEventRunner,
} = require('./eventsEventRunner');
const {
  deleteMap,
  postMap,
  validateMapUploadPermission,
} = require('./eventsMap');

module.exports = {
  createEvent,
  createEventLink,
  addEventRunner,
  orisAddEventRunner,
  postComment,
  validateMapUploadPermission,
  postMap,
  orisCreateEvent,
  orisCreateUserEvents,
  orisGetUserEvents,
  getEventList,
  getEventLinks,
  getEvent,
  updateEvent,
  updateEventLink,
  updateEventRunner,
  updateComment,
  deleteEvent,
  deleteEventLink,
  deleteEventRunner,
  deleteMap,
  deleteComment,
};
