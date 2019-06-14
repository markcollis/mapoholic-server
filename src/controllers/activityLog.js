// activity log to support reporting of recent activity (add, delete or change)

const Activity = require('../models/activity');
const logger = require('../utils/logger');

module.exports = (activity) => {
  const activityToLog = { ...activity, timestamp: new Date() };
  // console.log('activity to log:', activityToLog);
  const newActivity = new Activity(activityToLog);
  newActivity.save()
    .then((createdActivity) => {
      return createdActivity.populate('actionBy', '_id displayName').execPopulate();
    })
    .then((createdActivity) => {
      logger('success')(`activity logged by ${createdActivity.actionBy.displayName}.`);
    })
    .catch((err) => {
      logger('error')('Error logging activity:', err.message);
    });
};

// authentication
//  USER_CREATED, user
// clubs
//  CLUB_CREATED, club
//  CLUB_UPDATED, club
//  CLUB_DELETED, club
// eventsComment
//  COMMENT_POSTED, event, eventRunner, comment
//  COMMENT_UPDATED, event, eventRunner, comment
//  COMMENT_DELETED, event, eventRunner, comment
// eventsEvent
//  EVENT_CREATED, event
//  EVENT_UPDATED, event
//  EVENT_DELETED, event
// eventsEventLink
//   EVENT_LINK_CREATED, linkedEvent
//   EVENT_LINK_UPDATED, linkedEvent
//   EVENT_LINK_DELETED, linkedEvent
// eventsEventRunner
//   EVENT_RUNNER_ADDED, event, eventRunner
//   EVENT_RUNNER_UPDATED, event, eventRunner
//   EVENT_RUNNER_DELETED, event, eventRunner
// eventsMap
//   EVENT_MAP_UPLOADED, event, eventRunner
//   EVENT_MAP_DELETED, event, eventRunner
// users
//  USER_UPDATED, user (includes uploading profile image)
//  USER_DELETED, user
