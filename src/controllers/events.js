const { ObjectID } = require('mongodb');
// const sharp = require('sharp');
const fetch = require('node-fetch');
// const fs = require('fs');
// const path = require('path');
// const url = require('url');
// const User = require('../models/user');
const Club = require('../models/club');
const Event = require('../models/oevent');
// const LinkedEvent = require('../models/linkedEvent');
const logger = require('../utils/logger');
const logReq = require('./logReq');
const { validateClubIds, validateLinkedEventIds } = require('./validateIds');
const { getOrisClubData } = require('./clubs');

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
      // console.log('fieldsToCreate:', fieldsToCreate);
      const newEvent = new Event(fieldsToCreate);
      return newEvent.save()
        .then((savedEvent) => {
          // console.log('savedEvent', savedEvent);
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
  const ORIS_API_GETEVENT = 'https://oris.orientacnisporty.cz/API/?format=json&method=getEvent';
  fetch(`${ORIS_API_GETEVENT}&id=${req.params.oriseventid}`)
    .then(response => response.json())
    .then((orisEvent) => {
      const eventData = orisEvent.Data;
      // console.log('eventData:', eventData);
      if (eventData.Stages !== '0') {
        logger('error')('Error creating event from ORIS: multi-stage event parent');
        return res.status(400).send({ error: 'This ORIS event ID is the parent of a multi-stage event.' });
      }
      // later work once linkedEvent ready - add the following 'big picture' actions instead:
      // 1. if Stages !== "0" create a linkedEvent record *instead* and then the events within
      // it (Stage1, Stage2, ... Stage7 if not "0")
      // 2. if ParentID !== null, create a linkedEvent record from that parent then the siblings
      // ORIS Data.ParentID, Data.Stages, Data.Stage1-7 have relevant information
      // also Data.Level.ShortName = ET (multi-day wrapper)
      const disciplineAndSportToType = {
        SP: 'Sprint', // ORIS SP Sprint Sprint
        KT: 'Middle', // ORIS KT Middle Krátká trať
        KL: 'Long', // ORIS KL Long Klasická trať
        DT: 'Ultra-Long', // ORIS DT Ultra-Long Dlouhá trať
        ST: 'Relay', // ORIS ST Relay Štafety
        NOB: 'Night', // ORIS NOB Night Noční (not combined with distance in ORIS)
        TeO: 'TempO', // ORIS TeO TempO TempO
        MS: 'Mass start', // ORIS MS Mass start Hromadný start
        MTBO: 'MTBO', // ORIS MTBO MTBO
        LOB: 'SkiO', // ORIS LOB SkiO
        TRAIL: 'TrailO', // ORIS TRAIL TrailO
      };
      const disciplineType = disciplineAndSportToType[eventData.Discipline.ShortName];
      const sportType = disciplineAndSportToType[eventData.Sport.NameCZ];
      const typesToCreate = [];
      if (disciplineType) typesToCreate.push(disciplineType);
      if (sportType) typesToCreate.push(disciplineType);
      req.body = {
        date: eventData.Date,
        name: eventData.Name,
        orisId: eventData.ID,
        mapName: eventData.Map,
        locPlace: eventData.Place,
        locRegions: eventData.Region.split(', '),
        locCountry: 'CZE',
        locLat: parseFloat(eventData.GPSLat),
        locLong: parseFloat(eventData.GPSLon),
        types: typesToCreate,
        website: `https://oris.orientacnisporty.cz/Zavod?id=${eventData.ID}`,
        results: `https://oris.orientacnisporty.cz/Vysledky?id=${eventData.ID}`,
        // always a valid page, whether or not there are any results stored
      };
      // console.log('Documents:', eventData.Documents);
      // console.log('length:', eventData.Documents.length);
      if (Object.keys(eventData.Documents).length > 0) {
        Object.keys(eventData.Documents).forEach((documentRef) => {
          // console.log('documentRef:', documentRef);
          if (eventData.Documents[documentRef].SourceType.ID === '4') {
            req.body.results = eventData.Documents[documentRef].Url;
          }
        });
      }
      if (!['E', 'ET', 'S', 'OST'].includes(eventData.Level.ShortName)) {
        req.body.tags = [eventData.Level.NameCZ];
      }
      // organisedBy: Data.Org1.ID, Data.Org2.ID (corresponding to Club.orisId)
      // => create club if it doesn't exist?
      const firstClub = eventData.Org1.Abbr;
      const secondClub = eventData.Org2.Abbr || false;
      return Club.find({ shortName: [firstClub, secondClub] }).then((foundClubs) => {
        const foundClubsAbbr = foundClubs.map(foundClub => foundClub.shortName);
        const foundClubsIds = foundClubs.map(foundClub => foundClub._id);
        console.log('foundClubsAbbr', foundClubsAbbr, 'foundClubsIds', foundClubsIds);
        const clubOneExists = foundClubsAbbr.includes(firstClub);
        const clubTwoExists = foundClubsAbbr.includes(secondClub);
        const checkOrisOne = (clubOneExists) ? Promise.resolve(false) : getOrisClubData(firstClub);
        const checkOrisTwo = (clubTwoExists) ? Promise.resolve(false) : getOrisClubData(secondClub);
        Promise.all([checkOrisOne, checkOrisTwo]).then((orisData) => {
          console.log('orisData:', orisData);
          const createClubs = orisData.map((clubData) => {
            if (!clubData) return Promise.resolve(false);
            const fieldsToCreate = {
              owner: req.user._id,
              shortName: clubData.Abbr,
              fullName: clubData.Name,
              orisId: clubData.ID,
              country: 'CZE',
              website: clubData.WWW,
            };
            const newClub = new Club(fieldsToCreate);
            return newClub.save().then(() => {
              logger('success')(`${newClub.shortName} created by ${req.user.email} alongside event.`);
              return newClub;
            });
          });
          Promise.all(createClubs).then((createdClubs) => {
            const createdClubsIds = createdClubs.map(createdClub => createdClub._id);
            console.log('createdClubsIds', createdClubsIds);
            console.log('foundClubsIds', foundClubsIds);
            req.body.organisedBy = createdClubsIds.concat(foundClubsIds);
            return createEvent(req, res);
          }).catch((err) => {
            logger('error')('Error creating club alongside event:', err.message);
            return res.status(400).send({ error: err.message });
          });
        });
      });
    })
    .catch((orisErr) => {
      logger('error')(`ORIS API error: ${orisErr.message}.`);
      return res.status(400).send({ error: orisErr.message });
    });
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
  // console.log('eventSearchCriteria:', JSON.stringify(eventSearchCriteria));
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
                // console.log('commonClubs', commonClubs);
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
              // console.log('commonClubs', commonClubs);
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
  const { id } = req.params;
  const requestorRole = req.user.role;
  const requestorId = req.user._id.toString();
  if (!ObjectID.isValid(id)) {
    logger('error')('Error deleting event: invalid ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  return Event.findById(id).then((eventToDelete) => {
    if (!eventToDelete) {
      logger('error')('Error deleting event: no matching event found.');
      return res.status(404).send({ error: 'Event could not be found.' });
    }
    // can only delete if owner is the only runner or there are no runners
    // (forcing the deletion of other runners before the event can go)
    const hasPermissionToDelete = ((requestorRole === 'admin')
    || (requestorRole === 'standard' && requestorId === eventToDelete.owner.toString()));
    const noOtherRunners = (eventToDelete.runners.length === 0)
      || (eventToDelete.runners.filter((runner) => {
        return (runner.user.toString() !== requestorId);
      }).length === 0);
    // console.log('has permission:', hasPermissionToDelete, 'no others:', noOtherRunners);
    const allowedToDelete = hasPermissionToDelete && noOtherRunners;
    // console.log('doesn\'t actually delete yet!');
    // const allowedToDelete = false;
    if (allowedToDelete) {
      const now = new Date();
      const deletedAt = 'deleted:'.concat((`0${now.getDate()}`).slice(-2))
        .concat((`0${(now.getMonth() + 1)}`).slice(-2))
        .concat(now.getFullYear().toString())
        .concat('@')
        .concat((`0${now.getHours()}`).slice(-2))
        .concat((`0${now.getMinutes()}`).slice(-2));
      const newName = `${eventToDelete.name} ${deletedAt}`;
      return Event.findByIdAndUpdate(id,
        { $set: { active: false, name: newName } },
        { new: true })
        .then((deletedEvent) => {
          logger('success')(`Successfully deleted event ${deletedEvent._id} (${deletedEvent.name})`);
          return res.status(200).send(deletedEvent);
        })
        .catch((err) => {
          logger('error')('Error deleting event:', err.message);
          return res.status(400).send({ error: err.message });
        });
    }
    logger('error')(`Error: ${req.user.email} not allowed to delete ${id}.`);
    return res.status(401).send({ error: 'Not allowed to delete this event.' });
  });
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
