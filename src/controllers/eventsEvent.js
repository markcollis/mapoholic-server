const { ObjectID } = require('mongodb');

const logger = require('../services/logger');
const logReq = require('./logReq');
const { dbRecordActivity } = require('../services/activityServices');
const {
  prefixImagePath,
  prefixEventImagePaths,
} = require('../services/prefixImagePaths');
const {
  validateClubIds,
  validateEventLinkIds,
  validateUserId,
} = require('../services/validateIds');
const {
  getOrisClubData,
  getOrisEventData,
  getOrisEventList,
} = require('../services/orisAPI');
const {
  dbCreateClub,
  dbGetClubs,
} = require('../services/clubServices');
const {
  dbCreateEvent,
  dbGetEventById,
  dbGetEvents,
  dbUpdateEvent,
  dbDeleteEvent,
} = require('../services/eventServices');

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
  return dbGetEvents({ date: eventDate, name: eventName }).then((matchingEvents) => {
    if (matchingEvents.length > 0) {
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
      'locCornerNW', // [lat, long]
      'locCornerNE', // [lat, long]
      'locCornerSW', // [lat, long]
      'locCornerSE', // [lat, long]
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
    const checkEventLinkIds = (req.body.linkedTo && Array.isArray(req.body.linkedTo))
      ? validateEventLinkIds(req.body.linkedTo)
      : Promise.resolve(false);
    return Promise.all([checkClubIds, checkEventLinkIds]).then(([clubIds, eventLinkIds]) => {
      if (clubIds) {
        fieldsToCreate.organisedBy = clubIds;
      }
      if (eventLinkIds) {
        fieldsToCreate.linkedTo = eventLinkIds;
      }
      return dbCreateEvent(fieldsToCreate).then((savedEvent) => {
        logger('success')(`${savedEvent.name} on ${savedEvent.date} created by ${req.user.email}.`);
        dbRecordActivity({
          actionType: 'EVENT_CREATED',
          actionBy: req.user._id,
          event: savedEvent._id,
        });
        const eventToReturn = prefixEventImagePaths(savedEvent);
        return res.status(200).send(eventToReturn);
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
  getOrisEventData(req.params.oriseventid).then((eventData) => {
    if (eventData.Stages !== '0') {
      const includedEvents = [eventData.Stage1, eventData.Stage2, eventData.Stage3,
        eventData.Stage4, eventData.Stage5, eventData.Stage6, eventData.Stage7];
      logger('error')('Error creating event from ORIS: multi-stage event parent');
      return res.status(400).send({ error: `This ORIS event ID is the parent of a multi-stage event. The individual events are ${includedEvents}.` });
    }
    // Extra refinement to add in future:
    // 1. if Stages !== "0" create a eventLink record *instead* and then the events within
    // it (Stage1, Stage2, ... Stage7 if not "0")
    // 2. if ParentID !== null, create a eventLink record from that parent then the siblings
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
    const firstClub = eventData.Org1.Abbr || false;
    const secondClub = eventData.Org2.Abbr || false;
    return dbGetClubs({ shortName: [firstClub, secondClub] }).then((foundClubs) => {
      const foundClubsAbbr = foundClubs.map(foundClub => foundClub.shortName);
      const foundClubsIds = foundClubs.map(foundClub => foundClub._id);
      const clubOneNeeded = firstClub && !foundClubsAbbr.includes(firstClub);
      const clubTwoNeeded = secondClub && !foundClubsAbbr.includes(secondClub);
      const checkOrisOne = (clubOneNeeded) ? getOrisClubData(firstClub) : Promise.resolve(false);
      const checkOrisTwo = (clubTwoNeeded) ? getOrisClubData(secondClub) : Promise.resolve(false);
      Promise.all([checkOrisOne, checkOrisTwo]).then((orisData) => {
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
          return dbCreateClub(fieldsToCreate).then((createdClub) => {
            logger('success')(`${createdClub.shortName} created by ${req.user.email} alongside event.`);
            return createdClub;
          });
        });
        Promise.all(createClubs).then((createdClubs) => {
          const createdClubsIds = createdClubs.map(createdClub => createdClub._id);
          req.body.organisedBy = createdClubsIds.concat(foundClubsIds);
          return createEvent(req, res);
        }).catch((err) => {
          logger('error')('Error creating club alongside event:', err.message);
          return res.status(400).send({ error: err.message });
        });
      });
    });
  }).catch((orisErr) => {
    logger('error')(`ORIS API error: ${orisErr.message}.`);
    return res.status(400).send({ error: orisErr.message });
  });
};

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
  return getOrisEventList(req.user.orisId, dateFilter).then((eventListData) => {
    const eventsEntered = Object.keys(eventListData).map((entry) => {
      const eventDetails = {
        orisEntryId: eventListData[entry].ID,
        orisClassId: eventListData[entry].ClassID,
        orisEventId: eventListData[entry].EventID,
        date: eventListData[entry].EventDate,
        class: eventListData[entry].ClassDesc,
      };
      return eventDetails;
    });
    const expandOrisDetails = eventsEntered.map(({ orisEventId }) => {
      return getOrisEventData(orisEventId).then((eventData) => {
        const eventDetails = {
          orisEventId: eventData.ID,
          date: eventData.Date,
          name: eventData.Name,
          place: eventData.Place,
          organiser: eventData.Org1.Abbr,
        };
        if (eventData.Stages !== '0') {
          const includedEvents = [eventData.Stage1, eventData.Stage2, eventData.Stage3,
            eventData.Stage4, eventData.Stage5, eventData.Stage6, eventData.Stage7];
          eventDetails.includedEvents = includedEvents.filter(el => el !== '0');
        }
        return eventDetails;
      });
    });
    Promise.all(expandOrisDetails).then((details) => {
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
  }).catch((orisErr) => {
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
    eventSearchCriteria.locLat = { $gt: lowLat, $lt: highLat };
  }
  if (req.query.locLong) {
    const lowLong = parseFloat(req.query.locLong.split('-')[0]) || -180;
    const highLong = parseFloat(req.query.locLong.split('-')[1]) || 180;
    eventSearchCriteria.locLong = { $gt: lowLong, $lt: highLong };
  }
  dbGetEvents(eventSearchCriteria).then((events) => {
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
        locCornerNW: foundEvent.locCornerNW,
        locCornerNE: foundEvent.locCornerNE,
        locCornerSE: foundEvent.locCornerSE,
        organisedBy: foundEvent.organisedBy,
        linkedTo: foundEvent.linkedTo,
        types: foundEvent.types,
        tags: foundEvent.tags,
      };
      if (foundEvent.runners && foundEvent.runners.length > 0) {
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
              mapExtract: prefixImagePath(extractName),
              tags: runner.tags,
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
  }).catch((err) => {
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
  return dbGetEventById(eventid).then((foundEvent) => {
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
            if (commonClubs.length > 0) canSee = true;
          }
        }
        if (canSee) return runner;
        return false;
      });
      filteredEvent.runners = selectedRunners.filter(runner => runner);
    }
    logger('success')(`Returned event details for ${foundEvent.name} (${foundEvent.date}).`);
    const eventToReturn = prefixEventImagePaths(filteredEvent);
    return res.status(200).send(eventToReturn);
  }).catch((err) => {
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
  const requestorClubs = req.user.memberOf.map(club => club._id.toString());
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
  return dbGetEvents({ date: req.body.date, name: req.body.name }).then((existingEvents) => {
    if (existingEvents[0] && existingEvents[0]._id.toString() !== eventid) {
      logger('error')(`Error updating event: The event ${req.body.name} on ${req.body.date} already exists.`);
      return res.status(400).send({ error: `Error updating event: The event ${req.body.name} on ${req.body.date} already exists.` });
    }
    // now need to check database to identify owner and runners
    return dbGetEventById(eventid).then((eventToUpdate) => {
      if (!eventToUpdate) {
        logger('error')('Error updating event: no matching event found.');
        return res.status(404).send({ error: 'Event could not be found.' });
      }
      const runnerIds = (eventToUpdate.runners.length === 0)
        ? []
        : eventToUpdate.runners.map(runner => runner.user._id.toString());
      const allowedToUpdate = ((requestorRole === 'admin')
      || (requestorRole === 'standard' && requestorId === eventToUpdate.owner._id.toString())
      || (requestorRole === 'standard' && runnerIds.includes(requestorId)));
      // console.log('eventToUpdate:', eventToUpdate);
      // console.log('requestorRole:', requestorRole);
      // console.log('requestorId:', requestorId);
      // console.log('runnerIds:', runnerIds);
      // console.log('allowedToUpdate:', allowedToUpdate);
      if (allowedToUpdate) {
        const fieldsToUpdate = {};
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
          'locCornerNW', // [lat, long]
          'locCornerNE', // [lat, long]
          'locCornerSW', // [lat, long]
          'locCornerSE', // [lat, long]
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
        const checkEventLinkIds = (req.body.linkedTo && Array.isArray(req.body.linkedTo))
          ? validateEventLinkIds(req.body.linkedTo)
          : Promise.resolve(false);
        // only admin users can change a club's owner, need to check that ID is really a user
        const checkOwnerId = (req.body.owner && requestorRole === 'admin')
          ? validateUserId(req.body.owner)
          : Promise.resolve(false);
        return Promise.all([checkClubIds, checkEventLinkIds, checkOwnerId])
          .then(([clubIds, eventLinkIds, ownerId]) => {
            if (clubIds) {
              fieldsToUpdate.organisedBy = clubIds;
            }
            fieldsToUpdate.linkedTo = eventLinkIds || eventToUpdate.linkedTo;
            const currentEventLinks = (eventToUpdate.linkedTo.length === 0)
              ? []
              : eventToUpdate.linkedTo.map(eventLink => eventLink._id.toString());
            if (ownerId) fieldsToUpdate.owner = req.body.owner;
            const numberOfFieldsToUpdate = Object.keys(fieldsToUpdate).length;
            if (numberOfFieldsToUpdate === 0) {
              logger('error')('Update event error: no valid fields to update.');
              return res.status(400).send({ error: 'No valid fields to update.' });
            }
            // console.log('fieldsToUpdate', fieldsToUpdate);
            return dbUpdateEvent(eventid, fieldsToUpdate, currentEventLinks)
              .then((updatedEvent) => {
                logger('success')(`${updatedEvent.name} (${updatedEvent.date}) updated by ${req.user.email} (${numberOfFieldsToUpdate} field(s)).`);
                dbRecordActivity({
                  actionType: 'EVENT_UPDATED',
                  actionBy: req.user._id,
                  event: eventid,
                });
                const filteredEvent = updatedEvent;
                if (updatedEvent.runners.length > 0) {
                  const selectedRunners = updatedEvent.runners.map((runner) => {
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
                        if (commonClubs.length > 0) canSee = true;
                      }
                    }
                    if (canSee) return runner;
                    return false;
                  });
                  filteredEvent.runners = selectedRunners.filter(runner => runner);
                }
                logger('success')(`Returned event details for ${updatedEvent.name} (${updatedEvent.date}).`);
                const eventToReturn = prefixEventImagePaths(filteredEvent);
                return res.status(200).send(eventToReturn);
              }).catch((err) => {
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
  return dbGetEventById(eventid).then((eventToDelete) => {
    if (!eventToDelete) {
      logger('error')('Error deleting event: no matching event found.');
      return res.status(404).send({ error: 'Event could not be found.' });
    }
    // can only delete if owner is the only runner or there are no runners
    // (forcing the deletion of other runners before the event can go)
    const isAdmin = (requestorRole === 'admin');
    const isOwner = (requestorRole === 'standard'
      && requestorId === eventToDelete.owner._id.toString());
    const noOtherRunners = (eventToDelete.runners.length === 0)
      || (eventToDelete.runners.filter((runner) => {
        return (runner.user._id.toString() !== requestorId);
      }).length === 0);
    const ownerAlone = (isOwner && noOtherRunners);
    const allowedToDelete = isAdmin || ownerAlone;
    if (allowedToDelete) {
      return dbDeleteEvent(eventid).then((deletedEvent) => {
        logger('success')(`Successfully deleted event ${eventid} (${deletedEvent.name})`);
        dbRecordActivity({
          actionType: 'EVENT_DELETED',
          actionBy: req.user._id,
          event: eventid,
        });
        return res.status(200).send(deletedEvent);
      }).catch((err) => {
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
  orisGetUserEvents,
  getEventList,
  getEvent,
  updateEvent,
  deleteEvent,
};
