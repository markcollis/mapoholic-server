const { ObjectID } = require('mongodb');
// const sharp = require('sharp');
// const fetch = require('node-fetch');
// const fs = require('fs');
// const path = require('path');
// const url = require('url');
// const User = require('../models/user');
// const Club = require('../models/club');
const Event = require('../models/oevent');
// const LinkedEvent = require('../models/linkedEvent');
const logger = require('../utils/logger');
const logReq = require('./logReq');
const { validateClubIds, validateLinkedEventIds } = require('./validateIds');

// POST routes
// create an event (event level fields)
const createEvent = (req, res) => {
  logReq(req);
  const creatorRole = req.user.role;
  const creatorId = req.user._id;
  const eventDate = req.body.date;
  const eventName = req.body.name;
  // simple validation checks
  if (creatorRole === 'guest') {
    logger('error')('Error creating event: Guest accounts can not create an event.');
    return res.status(401).send({ error: 'Guest accounts are not allowed to create an event.' });
  }
  if (!eventDate || !eventName) {
    logger('error')('Error creating event: No name and/or date provided.');
    return res.status(400).send({ error: 'You must provide an event\'s name and date.' });
  }
  if (!eventDate.match(/[1|2][0-9]{3}-((0[13578]|1[02])-(0[1-9]|[12][0-9]|3[01])|(0[469]|11)-(0[1-9]|[12][0-9]|30)|02-(0[1-9]|[12][0-9]))/)) {
    logger('error')('Error creating event: Invalid date provided.');
    return res.status(400).send({ error: 'The date format required is a string of the form "YYYY-MM-DD".' });
  } // note: basic input validation, doesn't check for leap years so 2019-02-29 would pass
  // now check that the date/name combination doesn't already exist
  return Event.findOne({ date: eventDate, name: eventName }).then((existingEvent) => {
    if (existingEvent) {
      logger('error')(`Error creating event: The event ${eventName} on ${eventDate} already exists.`);
      return res.status(400).send({ error: `Error creating event: The event ${eventName} on ${eventDate} already exists.` });
    }
    const fieldsToCreate = { owner: creatorId };
    const validFields = [ // owner is creator, orisId is only used by oris methods
      'date',
      'name',
      'mapName',
      'locPlace',
      'locRegions', // []
      'locCountry',
      'locLat',
      'locLong',
      'types', // []
      'tags', // []
      'website',
      'results',
    ];
    Object.keys(req.body).forEach((key) => {
      if (validFields.includes(key)) {
        fieldsToCreate[key] = req.body[key];
      }
    });
    // organisedBy and linkedTo need special treatment: array of ObjectIDs
    // note that these will REPLACE the existing array not add to it/edit it
    const checkClubIds = (req.body.organisedBy && Array.isArray(req.body.organisedBy))
      ? validateClubIds(req.body.organisedBy)
      : Promise.resolve(false);
    const checkLinkedEventIds = (req.body.linkedTo && Array.isArray(req.body.linkedTo))
      ? validateLinkedEventIds(req.body.linkedTo)
      : Promise.resolve(false);
    return Promise.all([checkClubIds, checkLinkedEventIds]).then(([clubIds, linkedEventIds]) => {
      if (clubIds) {
        fieldsToCreate.organisedBy = clubIds;
      }
      if (linkedEventIds) {
        fieldsToCreate.linkedTo = linkedEventIds;
      }
    }).then(() => {
      // separate handling to check ObjectID validity (i.e. that it IS an ObjectID,
      // not that it exists as a User or LinkedEvent)
      console.log('fieldsToCreate:', fieldsToCreate);
      const newEvent = new Event(fieldsToCreate);
      return newEvent.save()
        .then((savedEvent) => {
          console.log('savedEvent', savedEvent);
          logger('success')(`${savedEvent.name} on ${savedEvent.date} created by ${req.user.email}.`);
          return res.status(200).send(savedEvent);
        });
    }).catch((err) => {
      logger('error')('Error creating event:', err.message);
      return res.status(400).send({ error: err.message });
    });
  });
};
// create a new event linkage between the specified events
const createEventLink = (req, res) => {
  logReq(req);
  res.send('not done yet');
};
// add user as a runner at the specified event (event.runners[] fields except maps)
const addEventRunner = (req, res) => {
  logReq(req);
  res.send('not done yet');
};
// Post a new comment against the specified user's map in this event
const postComment = (req, res) => {
  logReq(req);
  res.send('not done yet');
};
// upload a scanned map to the specified event map document (maptitle for differentiation)
// :mapid is the index in runners.maps, :maptype is either course or route
// :maptitle is the label to use for each part of multi-part maps
const validateMapUploadPermission = (req, res, next) => {
  next();
};
const postMap = (req, res) => {
  logReq(req);
  res.send('not done yet');
};
// create a new event using oris data *eventid is ORIS event id*
// if a corresponding event is already in db, fill empty fields only
// create runner fields for logged in user if found in ORIS (i.e. can use to add user to event)
const orisCreateEvent = (req, res) => {
  logReq(req);
  res.send('not done yet');
};
// create a set of new events and auto-populate them based on the user's ORIS history
const orisCreateUserEvents = (req, res) => {
  logReq(req);
  res.send('not done yet');
};

// GET routes
// retrieve a list of all events matching specified criteria
// [may include events without *maps* visible to current user, include number
// of (visible) maps in returned list]
const getEventList = (req, res) => {
  logReq(req);
  // set up requestor information for later filtering of runners
  const requestorRole = req.user.role;
  const requestorId = (requestorRole === 'anonymous')
    ? null
    : req.user._id.toString();
  const requestorClubs = (requestorRole === 'anonymous')
    ? null
    : req.user.memberOf.map(club => club._id.toString());
  const eventSearchCriteria = { active: true };
  // support basic filtering using query strings
  const validStringFilters = ['date', 'name', 'orisId', 'mapName', 'locName',
    'locPlace', 'locRegions', 'locCountry', 'types', 'tags', 'website', 'results'];
  const validIdFilters = ['owner', 'organisedBy', 'linkedTo', 'runners'];
  Object.keys(req.query).forEach((key) => {
    // console.log('filtering on', key, req.query[key]);
    if (validStringFilters.includes(key)) {
      eventSearchCriteria[key] = { $regex: new RegExp(req.query[key]) };
    }
    if (validIdFilters.includes(key)) {
      // needs custom treatment to avoid ObjectID cast error/return empty array if no such owner
      if (ObjectID.isValid(req.query[key])) {
        eventSearchCriteria.req.query[key] = req.query[key];
      }
    }
    // locLat and locLong need a different approach (<, >) as they are numbers, not strings
  });
  console.log('eventSearchCriteria:', JSON.stringify(eventSearchCriteria));
  Event.find(eventSearchCriteria)
    .populate('owner', '_id displayName')
    .populate('organisedBy', '_id shortName')
    .populate('linkedTo', '_id displayName')
    .populate('runners.user', '_id displayName memberOf')
    .select('-active -__v')
    .then((events) => {
      // process to reduce level of detail and exclude non-visibile runners
      const eventsSummary = events.map((foundEvent) => {
        const eventDetails = {
          _id: foundEvent._id,
          orisId: foundEvent.orisId,
          date: foundEvent.date,
          name: foundEvent.name,
          mapName: foundEvent.mapName,
          locPlace: foundEvent.locPlace,
          locCountry: foundEvent.locCountry,
          locLat: foundEvent.locLat,
          locLong: foundEvent.locLong,
          organisedBy: foundEvent.organisedBy,
          linkedTo: foundEvent.linkedTo,
        };
        if (foundEvent.runners.length > 0) {
          const selectedRunners = foundEvent.runners.map((runner) => {
            let canSee = false;
            if (requestorRole === 'admin') canSee = true;
            if (runner.visibility === 'public') canSee = true;
            if ((requestorRole === 'standard') || (requestorRole === 'guest')) {
              if (runner.visibility === 'all') canSee = true;
              if (requestorId === runner.user._id.toString()) canSee = true;
              if (runner.visibility === 'club') {
                const commonClubs = runner.user.memberOf.filter((clubId) => {
                  return requestorClubs.includes(clubId.toString());
                });
                console.log('commonClubs', commonClubs);
                if (commonClubs.length > 0) canSee = true;
              }
            }
            if (canSee) {
              return {
                user: runner.user._id,
                displayName: runner.user.displayName,
                courseTitle: runner.user.courseTitle,
                numberMaps: runner.maps.length,
              };
            }
            return false;
          });
          eventDetails.runners = selectedRunners.filter(runner => runner);
        }
        return eventDetails;
      });
      logger('success')(`Returned list of ${eventsSummary.length} event(s).`);
      return res.status(200).send(eventsSummary);
    })
    .catch((err) => {
      logger('error')('Error getting list of events:', err.message);
      return res.status(400).send(err.message);
    });
};

// retrieve a list of links between events matching specified criteria
const getEventLinks = (req, res) => {
  logReq(req);
  res.send('not done yet');
};

// retrieve full details for the specified event
// [including visible maps and basic info for linked events]
const getEvent = (req, res) => {
  logReq(req);
  // set up requestor information for later filtering of runners
  const requestorRole = req.user.role;
  const requestorId = (requestorRole === 'anonymous')
    ? null
    : req.user._id.toString();
  const requestorClubs = (requestorRole === 'anonymous')
    ? null
    : req.user.memberOf.map(club => club._id.toString());
  const { eventid } = req.params;
  if (!ObjectID.isValid(eventid)) {
    logger('error')('Error getting event details: invalid ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  return Event.findOne({ _id: eventid, active: true })
    .populate('owner', '_id displayName')
    .populate('organisedBy', '_id shortName')
    .populate('linkedTo', '_id displayName')
    .populate('runners.user', '_id displayName fullName regNumber orisId memberOf profileImage visibility')
    .select('-active -__v')
    .then((foundEvent) => {
      if (!foundEvent) {
        logger('error')('Error getting event details: no event found.');
        return res.status(404).send({ error: 'No event found.' });
      }
      const filteredEvent = foundEvent;
      if (foundEvent.runners.length > 0) {
        const selectedRunners = foundEvent.runners.map((runner) => {
          let canSee = false;
          if (requestorRole === 'admin') canSee = true;
          if (runner.visibility === 'public') canSee = true;
          if ((requestorRole === 'standard') || (requestorRole === 'guest')) {
            if (runner.visibility === 'all') canSee = true;
            if (requestorId === runner.user._id.toString()) canSee = true;
            if (runner.visibility === 'club') {
              const commonClubs = runner.user.memberOf.filter((clubId) => {
                return requestorClubs.includes(clubId.toString());
              });
              console.log('commonClubs', commonClubs);
              if (commonClubs.length > 0) canSee = true;
            }
          }
          if (canSee) return runner;
          return false;
        });
        filteredEvent.runners = selectedRunners.filter(runner => runner);
      }
      logger('success')(`Returned event details for ${foundEvent.name} (${foundEvent.date}).`);
      return res.status(200).send(filteredEvent);
    })
    .catch((err) => {
      logger('error')('Error getting event details:', err.message);
      return res.status(400).send({ error: err.message });
    });
};

// PATCH routes
// update the specified event (multiple amendment not supported)
const updateEvent = (req, res) => {
  logReq(req);
  res.send('not done yet');
};
// update the specified runner and map data (multiple amendment not supported)
const updateEventRunner = (req, res) => {
  logReq(req);
  res.send('not done yet');
};
// update the specified link between events (multiple amendment not supported)
const updateEventLink = (req, res) => {
  logReq(req);
  res.send('not done yet');
};
// edit the specified comment (multiple amendment not supported)
const updateComment = (req, res) => {
  logReq(req);
  res.send('not done yet');
};

// DELETE routes
// delete the specified event (multiple delete not supported)
// [will fail if other users have records attached to event, unless admin]
const deleteEvent = (req, res) => {
  logReq(req);
  res.send('not done yet');
};
// delete the specified runner and map data (multiple amendment not supported)
const deleteEventRunner = (req, res) => {
  logReq(req);
  res.send('not done yet');
};
// delete the specified link between events (multiple amendment not supported)
const deleteEventLink = (req, res) => {
  logReq(req);
  res.send('not done yet');
};
// delete the specified comment (multiple amendment not supported)
const deleteComment = (req, res) => {
  logReq(req);
  res.send('not done yet');
};


module.exports = {
  createEvent,
  createEventLink,
  addEventRunner,
  postComment,
  validateMapUploadPermission,
  postMap,
  orisCreateEvent,
  orisCreateUserEvents,
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
  deleteComment,
};
