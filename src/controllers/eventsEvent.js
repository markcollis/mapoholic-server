const { ObjectID } = require('mongodb');
const mongoose = require('mongoose');
const fetch = require('node-fetch');
const Club = require('../models/club');
const Event = require('../models/oevent');
const LinkedEvent = require('../models/linkedEvent');
const logger = require('../utils/logger');
const logReq = require('./logReq');
const activityLog = require('./activityLog');
const {
  validateClubIds,
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
    const validFields = [ // owner is creator
      'date',
      'name',
      'mapName',
      'locPlace',
      'locRegions', // []
      'locCountry',
      'locLat',
      'locLong',
      'orisId',
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
      return newEvent.save((err, savedEvent) => {
        savedEvent
          .populate('owner', '_id displayName')
          .populate('organisedBy', '_id shortName')
          .populate('linkedTo', '_id displayName')
          .populate({
            path: 'runners.user',
            select: '_id displayName fullName regNumber orisId profileImage visibility',
            populate: { path: 'memberOf', select: '_id shortName' },
          })
          .populate({
            path: 'runners.comments.author',
            select: '_id displayName fullName regNumber',
          })
          .execPopulate()
          .then(() => {
            // add event reference to linkedEvents if there are any
            LinkedEvent.updateMany({ _id: { $in: (linkedEventIds || []) } },
              { $addToSet: { includes: savedEvent._id } })
              .then(() => {
                logger('success')(`${savedEvent.name} on ${savedEvent.date} created by ${req.user.email}.`);
                activityLog({
                  actionType: 'EVENT_CREATED',
                  actionBy: req.user._id,
                  event: savedEvent._id,
                });
                return res.status(200).send(savedEvent);
              });
          });
      });
    }).catch((err) => {
      logger('error')('Error creating event:', err.message);
      return res.status(400).send({ error: err.message });
    });
  });
};

// create a new event using oris data *eventid is ORIS event id*
// if a corresponding event is already in db, fill empty fields only
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
      // ? later work once linkedEvent ready - add the following 'big picture' actions instead:
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
  res.status(400).send('Not yet implemented');
};
// it may be unwise to ever implement this due to the volume of data this could populate
// automatically. See orisGetUserEvents for accessing a list of candidate ORIS events to add

// GET routes
// return a list of summary details of all events in ORIS associated with the current user
const orisGetUserEvents = (req, res) => {
  logReq(req);
  if (!req.user.orisId) {
    logger('error')(`Error: No ORIS userid identified for ${req.user.email}.`);
    return res.status(400).send({ error: 'You do not have an associated ORIS userid' });
  }
  let dateFilter = ''; // supports passthrough of date filtering, front end default could be 1yr?
  if (req.query.datefrom) {
    if (req.query.datefrom.match(/[1|2][0-9]{3}-((0[13578]|1[02])-(0[1-9]|[12][0-9]|3[01])|(0[469]|11)-(0[1-9]|[12][0-9]|30)|02-(0[1-9]|[12][0-9]))/)) {
      dateFilter = dateFilter.concat(`&datefrom=${req.query.datefrom}`);
    } // note: basic input validation, doesn't check for leap years so 2019-02-29 would pass
  }
  if (req.query.dateto) {
    if (req.query.dateto.match(/[1|2][0-9]{3}-((0[13578]|1[02])-(0[1-9]|[12][0-9]|3[01])|(0[469]|11)-(0[1-9]|[12][0-9]|30)|02-(0[1-9]|[12][0-9]))/)) {
      dateFilter = dateFilter.concat(`&dateto=${req.query.dateto}`);
    } // note: basic input validation, doesn't check for leap years so 2019-02-29 would pass
  }
  // console.log('dateFilter:', dateFilter);
  const ORIS_API_GETUSEREVENTENTRIES = 'https://oris.orientacnisporty.cz/API/?format=json&method=getUserEventEntries';
  return fetch(`${ORIS_API_GETUSEREVENTENTRIES}&userid=${req.user.orisId}${dateFilter}`)
    .then(response => response.json())
    .then((orisEventList) => {
      const eventsEntered = Object.keys(orisEventList.Data).map((entry) => {
        const eventDetails = {
          orisEntryId: orisEventList.Data[entry].ID,
          orisClassId: orisEventList.Data[entry].ClassID,
          orisEventId: orisEventList.Data[entry].EventID,
          date: orisEventList.Data[entry].EventDate,
          class: orisEventList.Data[entry].ClassDesc,
        };
        return eventDetails;
      });
      const ORIS_API_GETEVENT = 'https://oris.orientacnisporty.cz/API/?format=json&method=getEvent';
      const expandOrisDetails = eventsEntered.map((eachEvent) => {
        return fetch(`${ORIS_API_GETEVENT}&id=${eachEvent.orisEventId}`)
          .then(response => response.json())
          .then((orisEvent) => {
            const eventData = {
              orisEventId: orisEvent.Data.ID,
              date: orisEvent.Data.Date,
              name: orisEvent.Data.Name,
              place: orisEvent.Data.Place,
              organiser: orisEvent.Data.Org1.Abbr,
            };
            if (orisEvent.Data.Stages !== '0') {
              const includedEvents = [orisEvent.Data.Stage1, orisEvent.Data.Stage2,
                orisEvent.Data.Stage3, orisEvent.Data.Stage4, orisEvent.Data.Stage5,
                orisEvent.Data.Stage6, orisEvent.Data.Stage7];
              eventData.includedEvents = includedEvents.filter(el => el !== '0');
            }
            return eventData;
          });
      });
      Promise.all(expandOrisDetails).then((details) => {
        // console.log('details', details);
        for (let i = 0; i < eventsEntered.length; i += 1) {
          eventsEntered[i].name = details[i].name;
          eventsEntered[i].place = details[i].place;
          if (details[i].includedEvents) {
            eventsEntered[i].includedEvents = details[i].includedEvents;
          }
        }
        logger('success')(`Returned list of ${eventsEntered.length} event(s) entered by ${req.user.email} (${req.user.orisId}).`);
        res.status(200).send(eventsEntered);
      });
    })
    .catch((orisErr) => {
      logger('error')(`ORIS API error: ${orisErr.message}.`);
      return res.status(400).send({ error: orisErr.message });
    });
};

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
        if (key === 'runners') {
          eventSearchCriteria.runners = { $elemMatch: { user: req.query.runners } };
        } else {
          eventSearchCriteria[key] = req.query[key];
        }
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
    // .populate('runners', 'tags')
    .populate('runners.user', '_id displayName memberOf active')
    .select('-active -__v')
    .then((events) => {
      // process to reduce level of detail and exclude non-visible runners
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
          locCornerSW: foundEvent.locCornerSW,
          locCornerNE: foundEvent.locCornerNE,
          organisedBy: foundEvent.organisedBy,
          linkedTo: foundEvent.linkedTo,
          types: foundEvent.types,
          tags: foundEvent.tags,
        };
        if (foundEvent.runners.length > 0) {
          const selectedRunners = foundEvent.runners.map((runner) => {
            let canSee = false;
            if (requestorRole === 'admin' && runner.user.active) canSee = true;
            // deleted users remain in the runners array but should be ignored
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
              const mapFiles = [];
              runner.maps.forEach((map) => {
                const { course, route } = map;
                if (course && course !== '') {
                  mapFiles.push(course);
                } else if (route && route !== '') {
                  mapFiles.push(route);
                }
              });
              const extractName = (mapFiles.length > 0)
                ? mapFiles[0].slice(0, -4).concat('-extract').concat(mapFiles[0].slice(-4))
                : null;
              return {
                user: runner.user._id,
                displayName: runner.user.displayName,
                courseTitle: runner.user.courseTitle,
                numberMaps: runner.maps.length,
                mapExtract: extractName,
                tags: runner.tags,
              };
            }
            return false;
          });
          eventDetails.runners = selectedRunners.filter(runner => runner);
          // eventDetails.totalRunners = eventDetails.runners.length;
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
      select: '_id active displayName fullName regNumber orisId profileImage visibility',
      populate: { path: 'memberOf', select: '_id shortName' },
    })
    .populate({
      path: 'runners.comments.author',
      select: '_id displayName fullName active profileImage',
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
          if (requestorRole === 'admin' && runner.user.active) canSee = true;
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
        : eventToUpdate.runners.map(runner => runner.user.toString());
      const currentLinkedEvents = (eventToUpdate.linkedTo.length === 0)
        ? []
        : eventToUpdate.linkedTo.map(linkedEvent => linkedEvent.toString());
      // console.log('currentLinkedEvents:', currentLinkedEvents);
      const allowedToUpdate = ((requestorRole === 'admin')
      || (requestorRole === 'standard' && requestorId === eventToUpdate.owner.toString())
      || (requestorRole === 'standard' && runnerIds.includes(requestorId)));
      // console.log('eventToUpdate:', eventToUpdate);
      // console.log('requestorRole:', requestorRole);
      // console.log('requestorId:', requestorId);
      // console.log('runnerIds:', runnerIds);
      // console.log('allowedToUpdate:', allowedToUpdate);
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
              .populate('owner', '_id displayName')
              .populate('organisedBy', '_id shortName')
              .populate('linkedTo', '_id displayName')
              .populate({
                path: 'runners.user',
                select: '_id displayName fullName regNumber orisId profileImage visibility',
                populate: { path: 'memberOf', select: '_id shortName' },
              })
              .populate({
                path: 'runners.comments.author',
                select: '_id displayName fullName regNumber',
              })
              .select('-active -__v')
              .then((updatedEvent) => {
                // now change the Event references in relevant LinkedEvents
                LinkedEvent.updateMany({ _id: { $in: (addedLinkedEventIds || []) } },
                  { $addToSet: { includes: updatedEvent._id } })
                  .then(() => {
                    LinkedEvent.updateMany({ _id: { $in: (removedLinkedEventIds || []) } },
                      { $pull: { includes: updatedEvent._id } })
                      .then(() => {
                        logger('success')(`${updatedEvent.name} (${updatedEvent.date}) updated by ${req.user.email} (${numberOfFieldsToUpdate} field(s)).`);
                        activityLog({
                          actionType: 'EVENT_UPDATED',
                          actionBy: req.user._id,
                          event: eventid,
                        });
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

// DELETE routes
// Delete the specified event (multiple delete not supported)
// Actually sets active=false rather than true delete (i.e. recoverable on server)
// Will fail if other users have records attached to event, unless done by admin
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
    const isAdmin = (requestorRole === 'admin');
    const isOwner = (requestorRole === 'standard'
      && requestorId === eventToDelete.owner.toString());
    // const hasPermissionToDelete = ((requestorRole === 'admin')
    // || (requestorRole === 'standard' && requestorId === eventToDelete.owner.toString()));
    const noOtherRunners = (eventToDelete.runners.length === 0)
      || (eventToDelete.runners.filter((runner) => {
        return (runner.user.toString() !== requestorId);
      }).length === 0);
    const ownerAlone = (isOwner && noOtherRunners);
    // console.log('has permission:', hasPermissionToDelete, 'no others:', noOtherRunners);
    const allowedToDelete = isAdmin || ownerAlone;
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
      const newOrisId = (eventToDelete.orisId)
        ? `${eventToDelete.orisId} ${deletedAt}`
        : null;
      return Event.findByIdAndUpdate(eventid,
        { $set: { active: false, name: newName, orisId: newOrisId } },
        { new: true })
        .then((deletedEvent) => {
          // console.log('deletedEvent:', deletedEvent);
          const { _id: deletedEventId, name } = deletedEvent;
          // delete any references in LinkedEvents
          LinkedEvent.updateMany({},
            { $pull: { includes: mongoose.Types.ObjectId(deletedEventId) } })
            .then(() => {
              logger('success')(`Successfully deleted event ${deletedEventId} (${name})`);
              activityLog({
                actionType: 'EVENT_DELETED',
                actionBy: req.user._id,
                event: eventid,
              });
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

module.exports = {
  createEvent,
  orisCreateEvent,
  orisCreateUserEvents,
  orisGetUserEvents,
  getEventList,
  getEvent,
  updateEvent,
  deleteEvent,
};
