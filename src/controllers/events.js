const { ObjectID } = require('mongodb');
// const sharp = require('sharp');
const fetch = require('node-fetch');
// const fs = require('fs');
// const path = require('path');
// const url = require('url');
// const User = require('../models/user');
const Club = require('../models/club');
const Event = require('../models/oevent');
const LinkedEvent = require('../models/linkedEvent');
const logger = require('../utils/logger');
const logReq = require('./logReq');
const {
  validateClubIds,
  validateEventIds,
  validateLinkedEventIds,
  validateUserId,
} = require('./validateIds');
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
    const validFields = [ // owner is creator, orisId is only used by oris-specific routes
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
      const newEvent = new Event(fieldsToCreate);
      return newEvent.save()
        .then((savedEvent) => {
          // add event reference to linkedEvents if there are any
          LinkedEvent.updateMany({ _id: { $in: (linkedEventIds || []) } },
            { $addToSet: { includes: savedEvent._id } })
            .then(() => {
              logger('success')(`${savedEvent.name} on ${savedEvent.date} created by ${req.user.email}.`);
              return res.status(200).send(savedEvent);
            });
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
  const creatorRole = req.user.role;
  const eventLinkName = req.body.displayName;
  const eventLinkIncludes = req.body.includes;
  // simple validation checks
  if (creatorRole === 'guest') {
    logger('error')('Error creating event link: Guest accounts can not create an event link.');
    return res.status(401).send({ error: 'Guest accounts are not allowed to create an event link.' });
  }
  if (!eventLinkName) {
    logger('error')('Error creating event link: No name provided.');
    return res.status(400).send({ error: 'You must provide a name for the event link.' });
  }
  return LinkedEvent.findOne({ displayName: eventLinkName }).then((existingLinkedEvent) => {
    if (existingLinkedEvent) {
      logger('error')(`Error creating event link: The event link ${eventLinkName} already exists.`);
      return res.status(400).send({ error: `Error creating event link: The event link ${eventLinkName} already exists.` });
    }
    const fieldsToCreate = { displayName: eventLinkName };
    // includes needs special treatment: array of ObjectIDs
    // note that these will REPLACE the existing array not add to it/edit it
    const checkEventIds = (eventLinkIncludes && Array.isArray(eventLinkIncludes))
      ? validateEventIds(eventLinkIncludes)
      : Promise.resolve(false);
    return checkEventIds.then((eventIds) => {
      if (!eventIds) {
        logger('error')('Error creating event link: No valid event IDs found.');
        return res.status(400).send({ error: 'Error creating event link: No valid event IDs found' });
      }
      fieldsToCreate.includes = eventIds;
      const newLinkedEvent = new LinkedEvent(fieldsToCreate);
      return newLinkedEvent.save()
        .then((savedLinkedEvent) => {
          // now add the linkedEvent reference to the events concerned
          Event.updateMany({ _id: { $in: eventIds } },
            { $addToSet: { linkedTo: savedLinkedEvent._id } },
            { new: true })
            .then(() => {
              logger('success')(`${savedLinkedEvent.displayName} created by ${req.user.email}.`);
              return res.status(200).send(savedLinkedEvent);
            });
        });
    }).catch((err) => {
      logger('error')('Error creating event link:', err.message);
      return res.status(400).send({ error: err.message });
    });
  });
};

// add user as a runner at the specified event (event.runners[] fields except maps)
const addEventRunner = (req, res) => {
  logReq(req);
  const { eventid } = req.params;
  const requestorRole = req.user.role;
  const requestorId = req.user._id.toString();
  if (requestorRole === 'guest') {
    logger('error')('Error: Guest accounts are not allowed to edit events.');
    return res.status(401).send({ error: 'Guest accounts are not allowed to edit events.' });
  }
  if (!ObjectID.isValid(eventid)) {
    logger('error')('Error adding runner to event: invalid ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  // now need to check database to identify existing runners
  return Event.findById(eventid).then((eventToAddRunnerTo) => {
    if (!eventToAddRunnerTo) {
      logger('error')('Error adding runner to event: no matching event found.');
      return res.status(404).send({ error: 'Event could not be found.' });
    }
    const runnerIds = (eventToAddRunnerTo.runners.length === 0)
      ? []
      : eventToAddRunnerTo.runners.map(runner => runner.user.toString());
    // console.log('runnerIds:', runnerIds);
    if (runnerIds.includes(requestorId)) {
      logger('error')('Error adding runner to event: runner already present.');
      return res.status(400).send({ error: 'Runner already present in event. Use PATCH to update.' });
    }
    const fieldsToCreateRunner = { user: requestorId };
    const validFields = [ // all except maps and comments which have their own POST routes
      'visibility',
      // course details from ORIS getEvent Data.Classes.Class_nnnn.
      'courseTitle', // ORIS Name
      'courseLength', // ORIS Distance (km)
      'courseClimb', // ORIS Climbing (m)
      'courseControls', // ORIS Controls
      'fullResults', // [] allowed to submit manually, front end might not support initially though
      // following can be obtained if ORIS hosts results via getEventResults&eventid&classid
      'time', // hhh:mm Data.Result_nnnnn.Time [UserID=orisId]
      'place', // Data.Result_nnnn.Place
      'timeBehind', // Data.Result_nnnn.Loss
      'fieldSize', // can work out from ORIS result set length
      'distanceRun', // actual km - from GPS (or some manual measurement of route length)
      'tags', // []
    ];
    Object.keys(req.body).forEach((key) => {
      if (validFields.includes(key)) {
        fieldsToCreateRunner[key] = req.body[key];
      }
    });
    // console.log('fieldsToCreateRunner:', fieldsToCreateRunner);
    return Event.findByIdAndUpdate(eventid, { $addToSet: { runners: fieldsToCreateRunner } },
      { new: true })
      .then((updatedEvent) => {
        logger('success')(`Added ${req.user.email} as runner to ${updatedEvent.name} (${updatedEvent.date}).`);
        return res.status(200).send(updatedEvent);
      })
      .catch((err) => {
        logger('error')('Error updating event:', err.message);
        return res.status(400).send({ error: err.message });
      });
  }).catch((err) => {
    logger('error')('Error adding runner to event:', err.message);
    return res.status(400).send({ error: err.message });
  });
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
        const includedEvents = [eventData.Stage1, eventData.Stage2, eventData.Stage3,
          eventData.Stage4, eventData.Stage5, eventData.Stage6, eventData.Stage7];
        logger('error')('Error creating event from ORIS: multi-stage event parent');
        return res.status(400).send({ error: `This ORIS event ID is the parent of a multi-stage event. The individual events are ${includedEvents}.` });
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
      // check to see if clubs exist and, if so, get their id; otherwise create them
      const firstClub = eventData.Org1.Abbr;
      const secondClub = eventData.Org2.Abbr || false;
      return Club.find({ shortName: [firstClub, secondClub] }).then((foundClubs) => {
        // console.log('foundClubs:', foundClubs);
        const foundClubsAbbr = foundClubs.map(foundClub => foundClub.shortName);
        const foundClubsIds = foundClubs.map(foundClub => foundClub._id);
        // console.log('foundClubsAbbr', foundClubsAbbr, 'foundClubsIds', foundClubsIds);
        const clubOneNeeded = firstClub && !foundClubsAbbr.includes(firstClub);
        const clubTwoNeeded = secondClub && !foundClubsAbbr.includes(secondClub);
        const checkOrisOne = (clubOneNeeded) ? getOrisClubData(firstClub) : Promise.resolve(false);
        const checkOrisTwo = (clubTwoNeeded) ? getOrisClubData(secondClub) : Promise.resolve(false);
        Promise.all([checkOrisOne, checkOrisTwo]).then((orisData) => {
          // console.log('orisData:', orisData);
          const createClubs = orisData.map((clubData) => {
            if (!clubData) return Promise.resolve(false);
            // console.log('clubData:', clubData);
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
            // console.log('createdClubsIds', createdClubsIds);
            // console.log('foundClubsIds', foundClubsIds);
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
  });
  // locLat and locLong need a different approach (<, >) as they are numbers, not strings
  // query of the format ?lat=x-y / ?lat=x- / ?lat=-y for ranges sought
  if (req.query.locLat) {
    const lowLat = parseFloat(req.query.locLat.split('-')[0]) || 0;
    const highLat = parseFloat(req.query.locLat.split('-')[1]) || 90;
    // console.log('low', low, 'high', high);
    eventSearchCriteria.locLat = { $gt: lowLat, $lt: highLat };
  }
  if (req.query.locLong) {
    const lowLong = parseFloat(req.query.locLong.split('-')[0]) || -180;
    const highLong = parseFloat(req.query.locLong.split('-')[1]) || 180;
    // console.log('low', low, 'high', high);
    eventSearchCriteria.locLong = { $gt: lowLong, $lt: highLong };
  }
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
  const eventLinkSearchCriteria = {};
  if (req.query.displayName) { // filter by name
    eventLinkSearchCriteria.displayName = { $regex: new RegExp(req.query.displayName) };
  }
  if (req.query.includes) { // filter by event (to include this specific event)
    if (ObjectID.isValid(req.query.includes)) {
      eventLinkSearchCriteria.includes = req.query.includes;
    } else {
      eventLinkSearchCriteria.includes = null;
    }
  }
  LinkedEvent.find(eventLinkSearchCriteria)
    .populate('includes', '_id name date')
    .select('-__v')
    .then((linkedEvents) => {
      logger('success')(`Returned list of ${linkedEvents.length} event link(s).`);
      return res.status(200).send(linkedEvents);
    })
    .catch((err) => {
      logger('error')('Error getting list of event links:', err.message);
      return res.status(400).send(err.message);
    });
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
    .populate({
      path: 'runners.user',
      select: '_id displayName fullName regNumber orisId profileImage visibility',
      populate: { path: 'memberOf', select: '_id shortName' },
    })
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
  const { eventid } = req.params;
  const requestorRole = req.user.role;
  const requestorId = req.user._id.toString();
  if (requestorRole === 'guest') {
    logger('error')('Error: Guest accounts are not allowed to edit events.');
    return res.status(401).send({ error: 'Guest accounts are not allowed to edit events.' });
  }
  if (!ObjectID.isValid(eventid)) {
    logger('error')('Error updating event: invalid ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  if (req.body.date) { // check that the date is valid IF an updated one is provided
    if (!req.body.date.match(/[1|2][0-9]{3}-((0[13578]|1[02])-(0[1-9]|[12][0-9]|3[01])|(0[469]|11)-(0[1-9]|[12][0-9]|30)|02-(0[1-9]|[12][0-9]))/)) {
      logger('error')('Error updating event: Invalid date provided.');
      return res.status(400).send({ error: 'The date format required is a string of the form YYYY-MM-DD.' });
    } // note: basic input validation, doesn't check for leap years so 2019-02-29 would pass
  }
  // now check that the date/name combination doesn't already exist
  return Event.findOne({ date: req.body.date, name: req.body.name }).then((existingEvent) => {
    if (existingEvent && existingEvent._id.toString() !== eventid) {
      logger('error')(`Error updating event: The event ${req.body.name} on ${req.body.date} already exists.`);
      return res.status(400).send({ error: `Error updating event: The event ${req.body.name} on ${req.body.date} already exists.` });
    }
    // now need to check database to identify owner and runners
    return Event.findById(eventid).then((eventToUpdate) => {
      if (!eventToUpdate) {
        logger('error')('Error updating event: no matching event found.');
        return res.status(404).send({ error: 'Event could not be found.' });
      }
      const runnerIds = (eventToUpdate.runners.length === 0)
        ? []
        : eventToUpdate.runners.map(runner => runner.user);
      // console.log('runnerIds:', runnerIds);
      const currentLinkedEvents = (eventToUpdate.linkedTo.length === 0)
        ? []
        : eventToUpdate.linkedTo.map(linkedEvent => linkedEvent.toString());
      // console.log('currentLinkedEvents:', currentLinkedEvents);
      const allowedToUpdate = ((requestorRole === 'admin')
      || (requestorRole === 'standard' && requestorId === eventToUpdate.owner.toString())
      || (requestorRole === 'standard' && runnerIds.includes(requestorId)));
      // console.log('allowedToUpdate', allowedToUpdate);
      if (allowedToUpdate) {
        const fieldsToUpdate = { };
        const validFields = [
          // Note: it is not possible to add an ORIS event ID and auto-populate if
          // an event wasn't created from ORIS originally. If there is a demand for
          // this it would be using e.g. PATCH /event/:eventid/oris/:oriseventid
          // calling a new, different function. Not a priority for now.
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
            fieldsToUpdate[key] = req.body[key];
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
        // only admin users can change a club's owner, need to check that ID is really a user
        const checkOwnerId = (req.body.owner && requestorRole === 'admin')
          ? validateUserId(req.body.owner)
          : Promise.resolve(false);
        return Promise.all([checkClubIds, checkLinkedEventIds, checkOwnerId])
          .then(([clubIds, linkedEventIds, ownerId]) => {
            if (clubIds) {
              fieldsToUpdate.organisedBy = clubIds;
            }
            if (linkedEventIds) {
              fieldsToUpdate.linkedTo = linkedEventIds;
            }
            const newLinkedEvents = (linkedEventIds)
              ? linkedEventIds.map(el => el.toString())
              : eventToUpdate.linkedTo;
            // console.log('newLinkedEvents:', newLinkedEvents);
            const addedLinkedEventIds = newLinkedEvents
              .filter(id => !currentLinkedEvents.includes(id));
            const removedLinkedEventIds = currentLinkedEvents
              .filter(id => !newLinkedEvents.includes(id));
            // console.log('added:', addedLinkedEventIds, 'removed:', removedLinkedEventIds);
            if (ownerId) fieldsToUpdate.owner = req.body.owner;
            // console.log('fieldsToUpdate:', fieldsToUpdate);
            const numberOfFieldsToUpdate = Object.keys(fieldsToUpdate).length;
            // console.log('fields to be updated:', numberOfFieldsToUpdate);
            if (numberOfFieldsToUpdate === 0) {
              logger('error')('Update event error: no valid fields to update.');
              return res.status(400).send({ error: 'No valid fields to update.' });
            }
            return Event.findByIdAndUpdate(eventid, { $set: fieldsToUpdate }, { new: true })
              .then((updatedEvent) => {
                // now change the Event references in relevant LinkedEvents
                LinkedEvent.updateMany({ _id: { $in: (addedLinkedEventIds || []) } },
                  { $addToSet: { includes: updatedEvent._id } })
                  .then(() => {
                    LinkedEvent.updateMany({ _id: { $in: (removedLinkedEventIds || []) } },
                      { $pull: { includes: updatedEvent._id } })
                      .then(() => {
                        logger('success')(`${updatedEvent.name} (${updatedEvent.date}) updated by ${req.user.email} (${numberOfFieldsToUpdate} field(s)).`);
                        return res.status(200).send(updatedEvent);
                      });
                  });
              })
              .catch((err) => {
                logger('error')('Error updating event:', err.message);
                return res.status(400).send({ error: err.message });
              });
          });
      }
      logger('error')(`Error: ${req.user.email} not allowed to update ${eventid}.`);
      return res.status(401).send({ error: 'Not allowed to update this event.' });
    });
  }).catch((err) => {
    logger('error')('Error updating event:', err.message);
    return res.status(400).send({ error: err.message });
  });
};

// update the specified runner and map data (multiple amendment not supported)
const updateEventRunner = (req, res) => {
  logReq(req);
  const { eventid, userid } = req.params;
  const requestorRole = req.user.role;
  const requestorId = req.user._id.toString();
  if (requestorRole === 'guest') {
    logger('error')('Error: Guest accounts are not allowed to edit events.');
    return res.status(401).send({ error: 'Guest accounts are not allowed to edit events.' });
  }
  if (!ObjectID.isValid(eventid)) {
    logger('error')('Error updating runner at event: invalid event ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  if (!ObjectID.isValid(userid)) {
    logger('error')('Error updating runner at event: invalid runner ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  // now need to check database to confirm that runner at event exists
  return Event.findById(eventid).then((eventToUpdateRunnerAt) => {
    if (!eventToUpdateRunnerAt) {
      logger('error')('Error updating runner at event: no matching event found.');
      return res.status(404).send({ error: 'Event could not be found.' });
    }
    const runnerIds = (eventToUpdateRunnerAt.runners.length === 0)
      ? []
      : eventToUpdateRunnerAt.runners.map(runner => runner.user.toString());
    // console.log('runnerIds:', runnerIds);
    if (!runnerIds.includes(userid)) {
      logger('error')('Error updating runner at event: runner not present.');
      return res.status(400).send({ error: 'Runner not present in event. Use POST to add.' });
    }
    const allowedToUpdate = ((requestorRole === 'admin')
    || (requestorRole === 'standard' && requestorId === userid));
    if (allowedToUpdate) {
      const fieldsToUpdateRunner = {};
      const validFields = [ // all except comments which have their own PATCH route
        'visibility',
        'courseTitle', // ORIS Name
        'courseLength', // ORIS Distance (km)
        'courseClimb', // ORIS Climbing (m)
        'courseControls', // ORIS Controls
        'fullResults', // [] will replace entire set of results recorded
        'time', // hhh:mm Data.Result_nnnnn.Time [UserID=orisId]
        'place', // Data.Result_nnnn.Place
        'timeBehind', // Data.Result_nnnn.Loss
        'fieldSize', // can work out from ORIS result set length
        'distanceRun', // actual km - from GPS (or some manual measurement of route length)
        'tags', // [] will replace entire set of tags
        'maps', // [] *** important *** will replace the entire map record, request must be complete
      ];
      Object.keys(req.body).forEach((key) => {
        if (validFields.includes(key)) {
          fieldsToUpdateRunner[key] = req.body[key];
        }
      });
      // console.log('fieldsToUpdateRunner:', fieldsToUpdateRunner);
      const numberOfFieldsToUpdate = Object.keys(fieldsToUpdateRunner).length;
      // console.log('fields to be updated:', numberOfFieldsToUpdate);
      if (numberOfFieldsToUpdate === 0) {
        logger('error')('Update runner at event error: no valid fields to update.');
        return res.status(400).send({ error: 'No valid fields to update.' });
      }
      return Event.findOneAndUpdate({ _id: eventid, 'runners.user': userid },
        { $set: { 'runners.$': fieldsToUpdateRunner } },
        { new: true })
        .then((updatedEvent) => {
          logger('success')(`Updated ${req.user.email} in ${updatedEvent.name} (${updatedEvent.date}) (${numberOfFieldsToUpdate} field(s)).`);
          return res.status(200).send(updatedEvent);
        })
        .catch((err) => {
          logger('error')('Error updating runner at event:', err.message);
          return res.status(400).send({ error: err.message });
        });
    }
    logger('error')(`Error: ${req.user.email} not allowed to update runner ${userid}.`);
    return res.status(401).send({ error: 'Not allowed to update this runner.' });
  }).catch((err) => {
    logger('error')('Error adding runner to event:', err.message);
    return res.status(400).send({ error: err.message });
  });
};

// update the specified link between events (multiple amendment not supported)
const updateEventLink = (req, res) => {
  logReq(req);
  const { eventlinkid } = req.params;
  const requestorRole = req.user.role;
  if (requestorRole === 'guest') { // guests can't edit, but all standard users can
    logger('error')('Error: Guest accounts are not allowed to edit event links.');
    return res.status(401).send({ error: 'Guest accounts are not allowed to edit event links.' });
  }
  if (!ObjectID.isValid(eventlinkid)) {
    logger('error')('Error updating event link: invalid ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  return LinkedEvent.findById(eventlinkid).then((linkedEventToUpdate) => {
    if (!linkedEventToUpdate) {
      logger('error')('Error updating event link: no matching event found.');
      return res.status(404).send({ error: 'Event link could not be found.' });
    }
    const currentIncludes = linkedEventToUpdate.includes.map(el => el.toString());
    // console.log('includes before editing:', currentIncludes);
    const fieldsToUpdate = {};
    if (req.body.displayName && req.body.displayName !== linkedEventToUpdate.displayName) {
      fieldsToUpdate.displayName = req.body.displayName;
    }
    const checkEventIds = (req.body.includes && Array.isArray(req.body.includes))
      ? validateEventIds(req.body.includes)
      : Promise.resolve(false);
    return checkEventIds.then((eventIds) => {
      if (eventIds) fieldsToUpdate.includes = eventIds;
      const newIncludes = (eventIds)
        ? eventIds.map(el => el.toString())
        : linkedEventToUpdate.includes;
      // console.log('eventIds to be new includes:', newIncludes);
      const addedEventIds = newIncludes.filter(eventId => !currentIncludes.includes(eventId));
      const removedEventIds = currentIncludes.filter(eventId => !newIncludes.includes(eventId));
      // console.log('added, removed:', addedEventIds, removedEventIds);
      const numberOfFieldsToUpdate = Object.keys(fieldsToUpdate).length;
      if (numberOfFieldsToUpdate === 0) {
        logger('error')('Update event link error: no valid fields to update.');
        return res.status(400).send({ error: 'No valid fields to update.' });
      }
      return LinkedEvent.findByIdAndUpdate(eventlinkid, { $set: fieldsToUpdate }, { new: true })
        .then((updatedLinkedEvent) => {
          // now change the linkedEvent references in relevant Events
          Event.updateMany({ _id: { $in: (addedEventIds || []) } },
            { $addToSet: { linkedTo: updatedLinkedEvent._id } })
            .then(() => {
              Event.updateMany({ _id: { $in: (removedEventIds || []) } },
                { $pull: { linkedTo: updatedLinkedEvent._id } })
                .then(() => {
                  logger('success')(`${updatedLinkedEvent.displayName} updated by ${req.user.email} (${numberOfFieldsToUpdate} field(s)).`);
                  return res.status(200).send(updatedLinkedEvent);
                });
            });
        })
        .catch((err) => {
          logger('error')('Error updating linked event:', err.message);
          return res.status(400).send({ error: err.message });
        });
    });
  });
};

// edit the specified comment (multiple amendment not supported)
const updateComment = (req, res) => {
  logReq(req);
  res.send('not done yet');
};

// DELETE routes
// delete the specified event (multiple delete not supported) - actually sets active=false
// [will fail if other users have records attached to event, unless admin]
const deleteEvent = (req, res) => {
  logReq(req);
  const { eventid } = req.params;
  const requestorRole = req.user.role;
  const requestorId = req.user._id.toString();
  if (!ObjectID.isValid(eventid)) {
    logger('error')('Error deleting event: invalid ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  return Event.findById(eventid).then((eventToDelete) => {
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
      return Event.findByIdAndUpdate(eventid,
        { $set: { active: false, name: newName } },
        { new: true })
        .then((deletedEvent) => {
          // console.log('deleted linkedTo', deletedEvent.linkedTo);
          // delete any references in LinkedEvents
          LinkedEvent.updateMany({ _id: { $in: (deletedEvent.linkedTo || []) } },
            { $pull: { includes: deletedEvent._id } }).then(() => {
            logger('success')(`Successfully deleted event ${deletedEvent._id} (${deletedEvent.name})`);
            return res.status(200).send(deletedEvent);
          });
        })
        .catch((err) => {
          logger('error')('Error deleting event:', err.message);
          return res.status(400).send({ error: err.message });
        });
    }
    logger('error')(`Error: ${req.user.email} not allowed to delete ${eventid}.`);
    return res.status(401).send({ error: 'Not allowed to delete this event.' });
  });
};
// delete the specified runner and map data (multiple amendment not supported) - actually deletes!
const deleteEventRunner = (req, res) => {
  logReq(req);
  res.send('not done yet');
};
// delete the specified link between events (multiple amendment not supported) - actually deletes!
const deleteEventLink = (req, res) => {
  logReq(req);
  const { eventlinkid } = req.params;
  const requestorRole = req.user.role;
  if (!ObjectID.isValid(eventlinkid)) {
    logger('error')('Error deleting event link: invalid ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  // only admin users are allowed to delete linkedEvents
  if (requestorRole === 'admin') {
    return LinkedEvent.findById(eventlinkid).then((linkedEventToDelete) => {
      if (!linkedEventToDelete) {
        logger('error')('Error deleting event link: no matching event link found.');
        return res.status(404).send({ error: 'Event link could not be found.' });
      }
      return LinkedEvent.deleteOne({ _id: eventlinkid }).then((deletion) => {
        if (deletion.deletedCount === 1) {
          return Event.updateMany({ _id: { $in: (linkedEventToDelete.includes || []) } },
            { $pull: { linkedTo: linkedEventToDelete._id } })
            .then(() => {
              logger('success')(`Successfully deleted event link ${linkedEventToDelete._id} (${linkedEventToDelete.displayName})`);
              return res.status(200).send(linkedEventToDelete);
            });
          // should now go through and delete all references from Event.linkedTo
        }
        logger('error')('Error deleting event link: deletedCount not 1');
        return res.status(400).send({ error: 'Error deleting event link: deletedCount not 1' });
      })
        .catch((err) => {
          logger('error')('Error deleting event link:', err.message);
          return res.status(400).send({ error: err.message });
        });
    });
  }
  logger('error')(`Error: ${req.user.email} not allowed to delete ${eventlinkid}.`);
  return res.status(401).send({ error: 'Not allowed to delete this event link.' });
};

// delete the specified comment (multiple amendment not supported) - actually deletes!
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
