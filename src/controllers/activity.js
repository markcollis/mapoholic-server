const { ObjectID } = require('mongodb');
// const mongoose = require('mongoose');
const Activity = require('../models/activity');
const logger = require('../utils/logger');
const logReq = require('./logReq');

// retrieve a list of recent activity matching specified criteria
const getActivityLog = (req, res) => {
  logReq(req);
  const activitySearchCriteria = {};
  const listLength = req.query.number;
  // console.log('list length:', listLength);
  // support filtering using query strings
  const validFilters = ['actionType', 'actionBy', 'club', 'comment', 'event', 'eventRunner', 'linkedEvent', 'user'];
  Object.keys(req.query).forEach((key) => {
    // console.log('filtering on', key, req.query[key]);
    if (validFilters.includes(key)) {
      if (key === 'actionType') {
        activitySearchCriteria.actionType = req.query.actionType;
      } else if (ObjectID.isValid(req.query[key])) {
        // needs additional check to avoid ObjectID cast error
        activitySearchCriteria[key] = req.query[key];
      } else {
        // console.log('invalid value for', key, req.query[key]);
        activitySearchCriteria[key] = null;
      }
    }
  });
  // console.log('clubSearchCriteria:', JSON.stringify(clubSearchCriteria));
  Activity.find(activitySearchCriteria)
    // 1. populate relevant data
    .populate('actionBy', '_id displayName visibility memberOf active')
    .populate('club', '_id shortName active')
    .populate('event', '_id date name active runners.user runners.visibility')
    .populate('eventRunner', '_id displayName visibility memberOf active')
    .populate('linkedEvent', '_id displayName')
    .populate('user', '_id displayName visibility memberOf active')
    // 2. filter based on who can see what
    .then((activities) => {
      const requestorId = req.user._id.toString();
      const requestorRole = req.user.role;
      const requestorClubs = req.user.memberOf.map(club => club._id.toString());

      const filteredActivities = activities.filter((activity) => {
        const {
          actionBy,
          actionType,
          club,
          event,
          eventRunner,
          linkedEvent,
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
            const runnerVisibility = event.runners.find((runner) => {
              return runner.user.toString() === eventRunner._id.toString();
            }).visibility;
            // console.log('runnerVisibility:', runnerVisibility);
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
        if (linkedEvent) { // no active flag for linkedEvent, null if it has been deleted
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
    // 3. truncate to listLength
    .then((activities) => {
      const totalFound = activities.length;
      const activitiesToSend = (listLength && listLength < totalFound)
        ? activities.slice(0, listLength)
        : activities;
      logger('success')(`Returned list of ${activitiesToSend.length} activities.`);
      return res.status(200).send(activitiesToSend);
    })
    .catch((err) => {
      logger('error')('Error getting activity log:', err.message);
      return res.status(400).send(err.message);
    });
};

module.exports = {
  getActivityLog,
};
