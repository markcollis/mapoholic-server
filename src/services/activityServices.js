// Functions concerned with activity data (activity model)

const Activity = require('../models/activity');
const logger = require('../services/logger');

const dbRecordActivity = (activity) => {
  const activityToLog = { ...activity, timestamp: new Date() };
  const newActivity = new Activity(activityToLog);
  return newActivity.save()
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

// *** Types of activity expected to be logged: ***
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
//   EVENT_LINK_CREATED, eventLink
//   EVENT_LINK_UPDATED, eventLink
//   EVENT_LINK_DELETED, eventLink
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

const dbGetActivities = (searchCriteria, requestor, listLength) => {
  return Activity.find(searchCriteria)
    .lean()
    // 1. populate relevant data
    .populate('actionBy', '_id displayName visibility memberOf active')
    .populate('club', '_id shortName active')
    .populate('event', '_id date name active runners.user runners.visibility')
    .populate('eventRunner', '_id displayName visibility memberOf active')
    .populate('eventLink', '_id displayName')
    .populate('user', '_id displayName visibility memberOf active')
    .select('-__v')
    // 2. filter based on who can see what
    .then((activities) => {
      const requestorId = requestor._id.toString();
      const requestorRole = requestor.role;
      const requestorClubs = requestor.memberOf.map(club => club._id.toString());

      const filteredActivities = activities.filter((activity) => {
        const {
          actionBy,
          actionType,
          club,
          event,
          eventRunner,
          eventLink,
          user,
        } = activity;
        let include = false; // default - include relevant activity using conditions
        if (requestorRole === 'admin') include = true; // administrators can see everything
        if (requestorId === actionBy._id.toString()) include = true; // can see all own activity
        if (club && club.active) { // ignore actions for deleted clubs for non-admin/self
          if (actionType === 'CLUB_CREATED') include = true;
          if (actionType === 'CLUB_UPDATED') include = true;
        }
        if (event && event.active) { // ignore actions for deleted events for non-admin/self
          if (actionType === 'EVENT_CREATED') include = true;
          if (actionType === 'EVENT_UPDATED') include = true;
          if (eventRunner) {
            const stillEventRunner = event.runners.find((runner) => {
              return runner.user.toString() === eventRunner._id.toString();
            });
            const runnerVisibility = (stillEventRunner)
              ? stillEventRunner.visibility : 'private'; // default if we don't know
            if (runnerVisibility === 'public' || runnerVisibility === 'all') include = true;
            if (runnerVisibility === 'club') {
              if (eventRunner.memberOf && eventRunner.memberOf.length > 0) {
                eventRunner.memberOf.forEach((clubId) => {
                  if (requestorClubs.includes(clubId.toString())) include = true;
                });
              }
            }
          }
        }
        if (eventLink) { // no active flag for eventLink, null if it has been deleted
          if (actionType === 'EVENT_LINK_CREATED') include = true;
          if (actionType === 'EVENT_LINK_UPDATED') include = true;
        }
        if (user && user.active) { // ignore actions for deleted users for non-admin/self
          if (actionType === 'USER_CREATED' || actionType === 'USER_UPDATED') {
            if (user.visibility === 'public' || user.visibility === 'all') include = true;
            if (user.visibility === 'club') {
              if (user.memberOf && user.memberOf.length > 0) {
                user.memberOf.forEach((clubId) => {
                  if (requestorClubs.includes(clubId.toString())) include = true;
                });
              }
            }
          }
        }
        return include;
      });
      return filteredActivities;
    })
    // 3. sort in descending order of timestamp and truncate to listLength
    .then((activities) => {
      const totalFound = activities.length;
      const activitiesRecentFirst = activities.sort((a, b) => {
        if (a.timestamp < b.timestamp) return 1;
        if (a.timestamp > b.timestamp) return -1;
        return 0;
      });
      const activitiesToSend = (listLength && listLength < totalFound)
        ? activitiesRecentFirst.slice(0, listLength)
        : activitiesRecentFirst;
      return activitiesToSend;
    })
    .catch((err) => {
      throw new Error('Unable to get activity list:', err.message);
    });
};

module.exports = {
  dbRecordActivity,
  dbGetActivities,
};
